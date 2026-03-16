use std::io::Cursor;

static START_WAV: &[u8] = include_bytes!("../resources/sounds/start.wav");
static STOP_WAV: &[u8] = include_bytes!("../resources/sounds/stop.wav");

pub enum Sound {
    Start,
    Stop,
}

/// Play a sound effect non-blocking at the given volume (0.0–1.0).
pub fn play(sound: Sound, volume: f32) {
    let bytes: &'static [u8] = match sound {
        Sound::Start => START_WAV,
        Sound::Stop => STOP_WAV,
    };

    std::thread::spawn(move || {
        if let Ok((_stream, handle)) = rodio::OutputStream::try_default() {
            if let Ok(sink) = rodio::Sink::try_new(&handle) {
                if let Ok(source) = rodio::Decoder::new(Cursor::new(bytes)) {
                    sink.set_volume(volume.clamp(0.0, 1.0));
                    sink.append(source);
                    sink.sleep_until_end();
                }
            }
        }
    });
}
