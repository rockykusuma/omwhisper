pub mod cloud;
pub mod llm;
pub mod ollama;


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
            let api_key = settings.cloud_api_key.clone()
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
        text: strip_llm_wrapper(&text),
        backend_used,
        processing_time_ms: start.elapsed().as_millis() as u64,
    })
}

/// Strip preamble/postamble that LLMs add despite being told not to.
pub(crate) fn strip_llm_wrapper(text: &str) -> String {
    // Strip "Output:" prefix if model echoed the pattern format
    let text = text.strip_prefix("Output:").unwrap_or(text).trim();

    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return text.to_string();
    }

    // Drop leading preamble line if it ends with ':' and is followed by a blank line
    let start = if lines.len() > 1
        && lines[0].trim().ends_with(':')
        && lines.get(1).map(|l| l.trim().is_empty()).unwrap_or(false)
    {
        2
    } else {
        0
    };

    // Drop trailing meta-commentary lines
    let mut end = lines.len();
    while end > start {
        let line = lines[end - 1].trim();
        if line.is_empty() || is_meta_commentary(line) {
            end -= 1;
        } else {
            break;
        }
    }

    if start >= end {
        return text.to_string();
    }

    // Check if the last surviving line has inline commentary appended after a sentence.
    // e.g. "...back home.\n\nI made some minor adjustments..."
    let mut result: Vec<&str> = lines[start..end].to_vec();
    if let Some(last) = result.last_mut() {
        if let Some(stripped) = strip_inline_commentary(last) {
            *last = stripped;
        }
    }

    result.join("\n").trim().to_string()
}

/// Check if a line is LLM meta-commentary (not actual transcription content).
///
/// Uses two guards to reduce false positives on real dictation:
/// 1. Parenthesized lines `(...)` are always meta-commentary (very specific pattern).
/// 2. All other patterns require the line to be short (< 150 chars) — real transcription
///    paragraphs are typically longer, while LLM meta-commentary is 1-2 short sentences.
fn is_meta_commentary(line: &str) -> bool {
    // Parenthesized commentary — always strip regardless of length
    if line.starts_with('(') && line.ends_with(')') {
        return true;
    }

    // For all other patterns, only match short lines (likely meta-commentary, not content)
    if line.len() >= 150 {
        return false;
    }

    let lower = line.to_lowercase();
    lower.starts_with("note:")
        || lower.starts_with("i removed some")
        || lower.starts_with("i removed filler")
        || lower.starts_with("i removed the filler")
        || lower.starts_with("i corrected the")
        || lower.starts_with("i corrected some")
        || lower.starts_with("i corrected grammar")
        || lower.starts_with("i cleaned up")
        || lower.starts_with("i made some adjustments")
        || lower.starts_with("i made some changes")
        || lower.starts_with("i made some minor")
        || lower.starts_with("i adjusted the")
        || lower.starts_with("let me know if you'd like")
        || lower.starts_with("let me know if you need any")
        || (lower.starts_with("here is") && line.trim_end().ends_with(':'))
        || (lower.starts_with("here's") && line.trim_end().ends_with(':'))
}

/// If the last line has meta-commentary appended after a sentence boundary, return
/// the line truncated to just the content. Returns None if no inline commentary found.
///
/// Only strips when the trailing portion is short (< 100 chars) to avoid false positives
/// on real content that happens to follow a sentence boundary.
fn strip_inline_commentary(line: &str) -> Option<&str> {
    // Look for sentence-ending punctuation followed by commentary
    for (i, _) in line.match_indices(". ") {
        let after = line[i + 2..].trim_start();
        if after.len() < 100 && is_meta_commentary(after) {
            return Some(line[..=i].trim());
        }
    }
    // Also check after "!" and "?"
    for (i, _) in line.match_indices("! ") {
        let after = line[i + 2..].trim_start();
        if after.len() < 100 && is_meta_commentary(after) {
            return Some(line[..=i].trim());
        }
    }
    for (i, _) in line.match_indices("? ") {
        let after = line[i + 2..].trim_start();
        if after.len() < 100 && is_meta_commentary(after) {
            return Some(line[..=i].trim());
        }
    }
    None
}

// ─── Cloud API Key helpers ────────────────────────────────────────────────────

pub async fn save_cloud_api_key(key: &str) -> anyhow::Result<()> {
    let mut settings = crate::settings::load_settings().await;
    settings.cloud_api_key = Some(key.to_string());
    crate::settings::save_settings(&settings).await
}

pub async fn delete_cloud_api_key() -> anyhow::Result<()> {
    let mut settings = crate::settings::load_settings().await;
    settings.cloud_api_key = None;
    crate::settings::save_settings(&settings).await
}
