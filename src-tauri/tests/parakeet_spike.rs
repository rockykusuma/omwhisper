//! Spike: confirms parakeet-rs 0.3 loads the int8 model (saved under base names)
//! and transcribes a known wav. Run manually — requires the ~670MB model present.
//! `cargo test --test parakeet_spike -- --ignored --nocapture`
#![cfg(target_os = "macos")]

use parakeet_rs::{ParakeetTDT, TimestampMode, Transcriber};
use std::path::PathBuf;

fn model_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap()
        .join("com.omwhisper.app/models/parakeet/parakeet-tdt-0.6b-v3")
}

/// Minimal 16kHz mono WAV reader for the fixture (avoids depending on app internals).
fn read_wav_16k_mono(path: &str) -> Vec<f32> {
    let mut reader = hound::WavReader::open(path).expect("open wav");
    let spec = reader.spec();
    assert_eq!(spec.sample_rate, 16000, "fixture must be 16kHz");
    assert_eq!(spec.channels, 1, "fixture must be mono");
    match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / 32768.0)
            .collect(),
        hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap()).collect(),
    }
}

#[test]
#[ignore = "requires the ~670MB Parakeet model downloaded locally"]
fn spike_loads_int8_and_transcribes() {
    let dir = model_dir();
    assert!(
        dir.join("encoder-model.onnx").exists(),
        "run the Task 1 model download first"
    );

    let mut tdt = ParakeetTDT::from_pretrained(&dir, None)
        .expect("from_pretrained should load int8 encoder saved under base name");

    let audio = read_wav_16k_mono("tests/fixtures/jfk-16k.wav");
    let result = tdt
        .transcribe_samples(audio, 16000, 1, Some(TimestampMode::Sentences))
        .expect("transcribe_samples");

    println!("PARAKEET SPIKE TEXT: {:?}", result.text);
    assert!(
        !result.text.trim().is_empty(),
        "expected non-empty transcription"
    );
}
