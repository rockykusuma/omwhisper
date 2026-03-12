use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: MessageContent,
}

#[derive(Deserialize)]
struct MessageContent {
    content: String,
}

/// Send text + system prompt to an OpenAI-compatible cloud API and return the result.
pub async fn polish_text(
    text: &str,
    system_prompt: &str,
    model: &str,
    api_url: &str,
    api_key: &str,
    timeout_seconds: u32,
) -> Result<String> {
    let url = format!("{}/chat/completions", api_url.trim_end_matches('/'));
    let body = ChatRequest {
        model,
        messages: vec![
            ChatMessage { role: "system", content: system_prompt },
            ChatMessage { role: "user", content: text },
        ],
        temperature: 0.3,
    };

    let resp = reqwest::Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .timeout(std::time::Duration::from_secs(timeout_seconds as u64))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Cloud API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Cloud API error {}: {}", status, err_body);
    }

    let chat_resp = resp
        .json::<ChatResponse>()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to parse API response: {}", e))?;

    chat_resp
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content.trim().to_string())
        .ok_or_else(|| anyhow::anyhow!("Empty response from cloud API"))
}

/// Send a minimal test prompt to verify the cloud connection works.
pub async fn test_connection(
    model: &str,
    api_url: &str,
    api_key: &str,
    timeout_seconds: u32,
) -> Result<()> {
    polish_text("Hello.", "Reply with exactly: OK", model, api_url, api_key, timeout_seconds)
        .await?;
    Ok(())
}
