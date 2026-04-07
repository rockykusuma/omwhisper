use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use super::vad::Vad;

const TARGET_SAMPLE_RATE: u32 = 16000;

pub struct AudioCapture {
    /// True while the cpal stream thread is alive (set at launch, cleared only on shutdown).
    stream_active: Arc<AtomicBool>,
    /// True while the user is actively recording (toggled per hotkey session).
    recording: Arc<AtomicBool>,
    /// VAD shared between the cpal callback and end_recording() for flush.
    vad: Arc<Mutex<Vad>>,
    /// Speech utterance sender — swapped in on begin_recording(), cleared on end_recording().
    speech_tx: Arc<Mutex<Option<std::sync::mpsc::SyncSender<Vec<f32>>>>>,
    /// RMS level sender — swapped in on begin_recording(), cleared on end_recording().
    level_tx: Arc<Mutex<Option<std::sync::mpsc::Sender<f32>>>>,
}

impl AudioCapture {
    pub fn new(vad_sensitivity: f32, vad_engine: &str) -> Self {
        AudioCapture {
            stream_active: Arc::new(AtomicBool::new(false)),
            recording: Arc::new(AtomicBool::new(false)),
            vad: Arc::new(Mutex::new(Vad::new(vad_engine, vad_sensitivity, TARGET_SAMPLE_RATE))),
            speech_tx: Arc::new(Mutex::new(None)),
            level_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the persistent cpal stream. Called once at app launch.
    /// The stream runs idle (callback returns immediately) until begin_recording() is called.
    /// Returns an error if no input device is available or the stream fails to open.
    pub fn start(&self, preferred_device: Option<String>) -> Result<()> {
        let stream_active = self.stream_active.clone();
        stream_active.store(true, Ordering::SeqCst);

        let (err_tx, err_rx) = std::sync::mpsc::channel::<anyhow::Error>();

        let recording_for_thread = self.recording.clone();
        let stream_active_for_thread = self.stream_active.clone();
        let vad_for_thread = self.vad.clone();
        let speech_tx_shared = Arc::clone(&self.speech_tx);
        let level_tx_shared = Arc::clone(&self.level_tx);

        std::thread::spawn(move || {
            // ── Build stream ──────────────────────────────────────────────────
            let host = cpal::default_host();

            let device = if let Some(ref name) = preferred_device {
                let found = host.devices()
                    .ok()
                    .and_then(|devs| {
                        devs.filter(|d| d.default_input_config().is_ok())
                            .find(|d| d.name().ok().as_deref() == Some(name.as_str()))
                    });
                match found {
                    Some(d) => d,
                    None => {
                        tracing::warn!("preferred audio device {:?} not found, falling back to system default", name);
                        match host.default_input_device() {
                            Some(d) => d,
                            None => {
                                let _ = err_tx.send(anyhow::anyhow!("no input device available"));
                                return;
                            }
                        }
                    }
                }
            } else {
                match host.default_input_device() {
                    Some(d) => d,
                    None => {
                        let _ = err_tx.send(anyhow::anyhow!("no input device available"));
                        return;
                    }
                }
            };

            tracing::info!(
                "audio capture: opening device {:?}",
                device.name().unwrap_or_else(|_| "unknown".into())
            );

            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ = err_tx.send(anyhow::anyhow!("failed to get default input config: {e}"));
                    return;
                }
            };

            let sample_rate = config.sample_rate().0;
            let channels = config.channels() as usize;

            tracing::info!(
                "audio capture: device config — rate={}Hz channels={} format={:?}",
                sample_rate, channels, config.sample_format()
            );

            // The cpal callback reads from the shared sender slots.
            // begin_recording() swaps in fresh senders; end_recording() clears them.
            macro_rules! make_callback {
                ($convert:expr) => {{
                    let speech_tx = Arc::clone(&speech_tx_shared);
                    let level_tx = Arc::clone(&level_tx_shared);
                    let vad = vad_for_thread.clone();
                    let recording = recording_for_thread.clone();
                    move |data: &[_], _: &cpal::InputCallbackInfo| {
                        if !recording.load(Ordering::SeqCst) {
                            return;
                        }
                        let f32data: Vec<f32> = data.iter().map($convert).collect();
                        let mono = to_mono_f32(&f32data, channels);
                        let resampled = resample(&mono, sample_rate, TARGET_SAMPLE_RATE);

                        let rms = Vad::rms(&resampled);
                        if let Some(tx) = level_tx.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                            let _ = tx.send(rms);
                        }

                        if let Some(utterance) = vad.lock().unwrap_or_else(|e| e.into_inner()).process(&resampled) {
                            if let Some(tx) = speech_tx.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                                let _ = tx.send(utterance);
                            }
                        }
                    }
                }};
            }

            // On device error (e.g. USB mic unplugged), mark stream as dead so the
            // keep-alive loop exits and end_recording() can still send the sentinel cleanly.
            // Use a macro so each match arm gets its own move closure (each moves a fresh clone).
            macro_rules! make_err_fn {
                () => {{
                    let sa = stream_active_for_thread.clone();
                    move |err: cpal::StreamError| {
                        eprintln!("audio stream error: {err}");
                        sa.store(false, Ordering::SeqCst);
                    }
                }};
            }

            let stream_result = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    make_callback!(|&s: &f32| s),
                    make_err_fn!(),
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    make_callback!(|&s: &i16| s as f32 / 32768.0),
                    make_err_fn!(),
                    None,
                ),
                cpal::SampleFormat::I32 => device.build_input_stream(
                    &config.into(),
                    make_callback!(|&s: &i32| s as f32 / 2_147_483_648.0),
                    make_err_fn!(),
                    None,
                ),
                cpal::SampleFormat::U8 => device.build_input_stream(
                    &config.into(),
                    make_callback!(|&s: &u8| (s as f32 - 128.0) / 128.0),
                    make_err_fn!(),
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

            // Signal success (dropping err_tx without sending = success).
            drop(err_tx);

            // Keep the stream alive until shutdown() is called.
            while stream_active_for_thread.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            drop(stream);
            tracing::debug!("audio capture: stream thread exiting");
        });

        // Block until stream thread signals success or error.
        match err_rx.recv() {
            Ok(err) => {
                stream_active.store(false, Ordering::SeqCst);
                sentry_anyhow::capture_anyhow(&err);
                Err(err)
            }
            Err(_) => Ok(()), // err_tx dropped without sending = success
        }
    }

    /// Begin actively recording. Resets VAD, creates fresh channels, flips recording flag.
    /// Returns `(speech_rx, level_rx)` for the transcription thread to consume.
    pub fn begin_recording(&self, live_text_streaming: bool) -> Result<(std::sync::mpsc::Receiver<Vec<f32>>, std::sync::mpsc::Receiver<f32>)> {
        let (speech_tx, speech_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(8);
        let (level_tx, level_rx) = std::sync::mpsc::channel::<f32>();

        // Discard any stale audio buffered before the hotkey was pressed.
        self.vad.lock().unwrap_or_else(|e| e.into_inner()).reset();

        // Swap in fresh channel senders — the cpal callback will start writing into them.
        *self.speech_tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(speech_tx.clone());
        *self.level_tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(level_tx);

        // Flip the recording gate — cpal callback starts processing.
        self.recording.store(true, Ordering::SeqCst);

        // Optional: periodic flush thread for live text streaming.
        if live_text_streaming {
            let recording = Arc::clone(&self.recording);
            let vad = Arc::clone(&self.vad);
            let tx = Arc::clone(&self.speech_tx);
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(4000));
                    if !recording.load(Ordering::SeqCst) { break; }
                    {
                        let guard = tx.lock().unwrap_or_else(|e| e.into_inner());
                        if guard.is_none() { break; }
                    }
                    if let Some(speech) = vad.lock().unwrap_or_else(|e| e.into_inner()).flush() {
                        if let Some(sender) = tx.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                            let _ = sender.send(speech);
                        }
                    }
                }
            });
        }

        Ok((speech_rx, level_rx))
    }

    /// Stop recording. Flushes VAD, sends sentinel, clears channel senders.
    /// Does NOT stop the cpal stream — it continues running idle.
    pub fn end_recording(&self) {
        self.recording.store(false, Ordering::SeqCst);

        // Flush any speech still buffered in VAD.
        if let Some(utterance) = self.vad.lock().unwrap_or_else(|e| e.into_inner()).flush() {
            if let Some(tx) = self.speech_tx.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                let _ = tx.send(utterance);
            }
        }

        // Empty sentinel tells the transcription thread to exit its loop.
        if let Some(tx) = self.speech_tx.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            let _ = tx.try_send(vec![]);
        }

        // Drop senders so receivers close cleanly.
        *self.speech_tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
        *self.level_tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Fully shut down the cpal stream. Called on app quit or device change.
    pub fn shutdown(&self) {
        self.recording.store(false, Ordering::SeqCst);
        self.stream_active.store(false, Ordering::SeqCst);
        *self.speech_tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
        *self.level_tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Returns true if the user is currently recording (begin_recording called, not yet ended).
    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::SeqCst)
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
