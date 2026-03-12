use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    stream: bool,
    messages: Vec<ChatMessage<'a>>,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    message: MessageContent,
}

#[derive(Deserialize)]
struct MessageContent {
    content: String,
}

#[derive(Deserialize)]
struct TagsResponse {
    models: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    name: String,
}

/// Returns true if Ollama is reachable at the given base URL.
pub async fn check_status(base_url: &str) -> bool {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Returns the list of installed model names from Ollama.
pub async fn list_models(base_url: &str) -> Vec<String> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let Ok(resp) = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    else {
        return vec![];
    };
    let Ok(tags) = resp.json::<TagsResponse>().await else {
        return vec![];
    };
    tags.models.into_iter().map(|m| m.name).collect()
}

/// Send text + system prompt to Ollama and return the polished result.
pub async fn polish_text(
    text: &str,
    system_prompt: &str,
    model: &str,
    base_url: &str,
    timeout_seconds: u32,
) -> Result<String> {
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let body = ChatRequest {
        model,
        stream: false,
        messages: vec![
            ChatMessage { role: "system", content: system_prompt },
            ChatMessage { role: "user", content: text },
        ],
    };

    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(timeout_seconds as u64))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Ollama request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Ollama error {}: {}", status, err_body);
    }

    let chat_resp = resp
        .json::<ChatResponse>()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to parse Ollama response: {}", e))?;

    Ok(chat_resp.message.content.trim().to_string())
}
