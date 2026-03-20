#!/usr/bin/env python3
"""Generate distinct start (rising chirp) and stop (falling chirp) chime sounds."""

import wave
import struct
import math
import os

SAMPLE_RATE = 44100
DURATION_S = 0.18        # 180 ms
AMPLITUDE = 0.6          # 60% volume headroom

def chirp(freq_start: float, freq_end: float, duration: float, sample_rate: int) -> list[float]:
    """Sine wave that sweeps linearly from freq_start to freq_end."""
    n = int(sample_rate * duration)
    fade = int(sample_rate * 0.02)  # 20 ms fade in/out
    samples = []
    for i in range(n):
        t = i / sample_rate
        freq = freq_start + (freq_end - freq_start) * (i / n)
        sample = math.sin(2 * math.pi * freq * t)
        # Apply fade envelope
        if i < fade:
            sample *= i / fade
        elif i > n - fade:
            sample *= (n - i) / fade
        samples.append(sample)
    return samples

def write_wav(path: str, samples: list[float], sample_rate: int) -> None:
    n_channels = 1
    sampwidth = 2  # 16-bit
    with wave.open(path, 'w') as f:
        f.setnchannels(n_channels)
        f.setsampwidth(sampwidth)
        f.setframerate(sample_rate)
        for s in samples:
            clamped = max(-1.0, min(1.0, s * AMPLITUDE))
            f.writeframes(struct.pack('<h', int(clamped * 32767)))

script_dir = os.path.dirname(os.path.abspath(__file__))
sounds_dir = os.path.join(script_dir, '..', 'src-tauri', 'resources', 'sounds')

# Rising chirp: 880 Hz → 1760 Hz (one octave up)
start_samples = chirp(880, 1760, DURATION_S, SAMPLE_RATE)
write_wav(os.path.join(sounds_dir, 'start.wav'), start_samples, SAMPLE_RATE)
print("✓ start.wav written (rising 880→1760 Hz)")

# Falling chirp: 1760 Hz → 880 Hz (one octave down)
stop_samples = chirp(1760, 880, DURATION_S, SAMPLE_RATE)
write_wav(os.path.join(sounds_dir, 'stop.wav'), stop_samples, SAMPLE_RATE)
print("✓ stop.wav written (falling 1760→880 Hz)")

print("Done. Run: touch src-tauri/src/sounds.rs && cargo build")
