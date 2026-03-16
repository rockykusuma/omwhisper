pub mod cloud;
pub mod llm;
pub mod ollama;

/// Keychain service name for storing the cloud API key.
const KEYCHAIN_SERVICE: &str = "com.omwhisper.app.ai_api_key";

pub struct PolishRequest {
    pub text: String,
    pub system_prompt: String,
}

#[derive(Clone, serde::Serialize)]
pub struct PolishResponse {
    pub text: String,
    pub backend_used: String,
    pub processing_time_ms: u64,
}

/// Dispatch a polish request to whichever backend is configured in settings.
pub async fn polish(
    request: PolishRequest,
    settings: &crate::settings::Settings,
) -> anyhow::Result<PolishResponse> {
    let start = std::time::Instant::now();

    let (text, backend_used) = match settings.ai_backend.as_str() {
        "ollama" => {
            let text = ollama::polish_text(
                &request.text,
                &request.system_prompt,
                &settings.ai_ollama_model,
                &settings.ai_ollama_url,
                settings.ai_timeout_seconds,
            )
            .await?;
            (text, "ollama".to_string())
        }
        "cloud" => {
            let api_key = load_cloud_api_key()
                .ok_or_else(|| anyhow::anyhow!("No cloud API key configured"))?;
            let text = cloud::polish_text(
                &request.text,
                &request.system_prompt,
                &settings.ai_cloud_model,
                &settings.ai_cloud_api_url,
                &api_key,
                settings.ai_timeout_seconds,
            )
            .await?;
            (text, "cloud".to_string())
        }
        _ => anyhow::bail!("AI backend is disabled"),
    };

    Ok(PolishResponse {
        text,
        backend_used,
        processing_time_ms: start.elapsed().as_millis() as u64,
    })
}

// ─── Keychain helpers ─────────────────────────────────────────────────────────

pub fn save_cloud_api_key(key: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, "default")?;
    entry.set_password(key)?;
    Ok(())
}

pub fn load_cloud_api_key() -> Option<String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, "default").ok()?;
    entry.get_password().ok().filter(|s| !s.is_empty())
}

pub fn delete_cloud_api_key() -> anyhow::Result<()> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, "default")?;
    entry.delete_password().map_err(|e| anyhow::anyhow!("{}", e))?;
    Ok(())
}
