use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::vad::Vad;

const TARGET_SAMPLE_RATE: u32 = 16000;

pub struct AudioCapture {
    running: Arc<AtomicBool>,
    /// VAD instance shared between the capture thread and stop() so flush works.
    vad: Arc<Mutex<Vad>>,
    /// Speech utterance sender so stop() can flush remaining speech.
    speech_tx: Arc<Mutex<Option<std::sync::mpsc::SyncSender<Vec<f32>>>>>,
}

impl AudioCapture {
    pub fn new(vad_sensitivity: f32, vad_engine: &str) -> Self {
        AudioCapture {
            running: Arc::new(AtomicBool::new(false)),
            vad: Arc::new(Mutex::new(Vad::new(vad_engine, vad_sensitivity, TARGET_SAMPLE_RATE))),
            speech_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Start capturing audio. Spawns a background thread that owns the cpal stream.
    /// Returns a tuple of:
    ///   - `Receiver<Vec<f32>>` — speech utterances ready for Whisper
    ///   - `Receiver<f32>`     — RMS audio level for the frontend meter (sent every chunk)
    pub fn start(&self) -> Result<(std::sync::mpsc::Receiver<Vec<f32>>, std::sync::mpsc::Receiver<f32>)> {
        let running = self.running.clone();
        running.store(true, Ordering::SeqCst);

        // Bounded channel for speech utterances (backpressure so Whisper can keep up).
        let (speech_tx, speech_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(8);
        // Unbounded channel for level events — small f32 values, high throughput is fine.
        let (level_tx, level_rx) = std::sync::mpsc::channel::<f32>();

        // Store speech_tx so stop() can send a final flush.
        {
            let mut guard = self.speech_tx.lock().unwrap();
            *guard = Some(speech_tx.clone());
        }

        // One-shot channel to propagate startup errors back to the caller.
        let (err_tx, err_rx) = std::sync::mpsc::channel::<anyhow::Error>();

        let running_for_thread = running.clone();
        let vad_for_thread = self.vad.clone();

        std::thread::spawn(move || {
            // ---- Build stream ----
            let host = cpal::default_host();
            let device = match host.default_input_device() {
                Some(d) => d,
                None => {
                    let _ = err_tx.send(anyhow::anyhow!("no input device available"));
                    return;
                }
            };

            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ =
                        err_tx.send(anyhow::anyhow!("failed to get default input config: {e}"));
                    return;
                }
            };

            let sample_rate = config.sample_rate().0;
            let channels = config.channels() as usize;

            // Helper closure factory — produces the data callback for each sample format branch.
            macro_rules! make_callback {
                ($convert:expr) => {{
                    let speech_tx = speech_tx.clone();
                    let level_tx = level_tx.clone();
                    let vad = vad_for_thread.clone();
                    let run = running_for_thread.clone();
                    move |data: &[_], _: &cpal::InputCallbackInfo| {
                        if !run.load(Ordering::SeqCst) {
                            return;
                        }
                        let f32data: Vec<f32> = data.iter().map($convert).collect();
                        let mono = to_mono_f32(&f32data, channels);
                        let resampled = resample(&mono, sample_rate, TARGET_SAMPLE_RATE);

                        // Always emit the RMS level for the frontend meter.
                        let rms = Vad::rms(&resampled);
                        let _ = level_tx.send(rms);

                        // Only send to Whisper when VAD detects end-of-utterance.
                        if let Some(utterance) = vad.lock().unwrap().process(&resampled) {
                            let _ = speech_tx.send(utterance);
                        }
                    }
                }};
            }

            let err_fn = |err| eprintln!("audio stream error: {err}");

            let stream_result = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    make_callback!(|&s: &f32| s),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    make_callback!(|&s: &i16| s as f32 / 32768.0),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I32 => device.build_input_stream(
                    &config.into(),
                    make_callback!(|&s: &i32| s as f32 / 2_147_483_648.0),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::U8 => device.build_input_stream(
                    &config.into(),
                    make_callback!(|&s: &u8| (s as f32 - 128.0) / 128.0),
                    err_fn,
                    None,
                ),
                fmt => {
                    let _ = err_tx.send(anyhow::anyhow!("unsupported sample format: {fmt:?}"));
                    return;
                }
            };

            let stream = match stream_result {
                Ok(s) => s,
                Err(e) => {
                    let _ = err_tx.send(anyhow::anyhow!("failed to build input stream: {e}"));
                    return;
                }
            };

            if let Err(e) = stream.play() {
                let _ = err_tx.send(anyhow::anyhow!("failed to start audio stream: {e}"));
                return;
            }

            // Signal success (by dropping err_tx without sending anything).
            drop(err_tx);

            // Keep the stream alive until stop() is called.
            while running_for_thread.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            // stream is dropped here, which stops capture.
            drop(stream);
        });

        // Block until the thread either signals an error or confirms success
        // (err_tx drop = success).
        match err_rx.recv() {
            Ok(err) => {
                // Signal the thread to stop so it doesn't linger after a startup failure.
                running.store(false, Ordering::SeqCst);
                sentry_anyhow::capture_anyhow(&err);
                Err(err)
            }
            Err(_) => Ok((speech_rx, level_rx)), // sender dropped without sending = success
        }
    }

    /// Stop the capture. Flushes any remaining VAD-buffered speech before returning.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);

        // Flush any speech that VAD was still accumulating.
        if let Some(utterance) = self.vad.lock().unwrap().flush() {
            if let Some(tx) = self.speech_tx.lock().unwrap().as_ref() {
                let _ = tx.send(utterance);
            }
        }

        // Drop the sender so the speech receiver channel closes cleanly.
        let mut guard = self.speech_tx.lock().unwrap();
        *guard = None;
    }
}

fn to_mono_f32(data: &[f32], channels: usize) -> Vec<f32> {
    if channels == 1 {
        return data.to_vec();
    }
    data.chunks(channels)
        .map(|ch| ch.iter().sum::<f32>() / channels as f32)
        .collect()
}

fn resample(samples: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if src_rate == dst_rate {
        return samples.to_vec();
    }
    let ratio = src_rate as f64 / dst_rate as f64;
    let new_len = (samples.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(new_len);
    for i in 0..new_len {
        let pos = i as f64 * ratio;
        let idx = pos as usize;
        let frac = (pos - idx as f64) as f32;
        let a = samples.get(idx).copied().unwrap_or(0.0);
        let b = samples.get(idx + 1).copied().unwrap_or(0.0);
        out.push(a + frac * (b - a));
    }
    out
}
