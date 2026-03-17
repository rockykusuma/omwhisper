use std::sync::OnceLock;
use serde_json::{json, Value};

const APTABASE_APP_KEY: &str = match option_env!("APTABASE_APP_KEY") {
    Some(k) => k,
    None => "",
};
const APTABASE_URL: &str = "https://eu.aptabase.com/api/v0/events";

static SESSION_ID: OnceLock<String> = OnceLock::new();

/// Call once at process start (from lib.rs run()) to generate a session ID.
pub fn init() {
    SESSION_ID.get_or_init(|| uuid::Uuid::new_v4().to_string());
}

/// Fire an analytics event. No-op when disabled or when APTABASE_APP_KEY is empty.
///
/// `enabled` — pass `settings.analytics_enabled` from the calling context.
/// `props`   — arbitrary JSON object with event properties. No PII.
pub fn track(enabled: bool, name: &str, props: Value) {
    if !enabled || APTABASE_APP_KEY.is_empty() {
        return;
    }
    let session_id = SESSION_ID.get().cloned().unwrap_or_default();
    let event_name = name.to_string();
    let os_name = if cfg!(target_os = "macos") { "macOS" } else { "Windows" };
    let version = env!("CARGO_PKG_VERSION");

    tokio::spawn(async move {
        let body = json!({
            "events": [{
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "sessionId": session_id,
                "eventName": event_name,
                "props": props,
                "systemProps": {
                    "appVersion": version,
                    "osName": os_name,
                }
            }]
        });
        let client = reqwest::Client::new();
        let result = client
            .post(APTABASE_URL)
            .header("App-Key", APTABASE_APP_KEY)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;
        if let Err(e) = result {
            tracing::debug!("Aptabase track failed (non-fatal): {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_is_noop_when_disabled() {
        track(false, "test_event", json!({}));
    }

    #[test]
    fn track_is_noop_when_key_empty() {
        init();
        track(true, "test_event", json!({}));
    }

    #[test]
    fn init_is_idempotent() {
        init();
        let id1 = SESSION_ID.get().cloned();
        init();
        let id2 = SESSION_ID.get().cloned();
        assert_eq!(id1, id2, "init() must not change the session ID after first call");
    }
}
