use serde::{Deserialize, Serialize};

/// A built-in polish style.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuiltInStyle {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// A user-defined custom polish style.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomStyle {
    pub name: String,
    pub system_prompt: String,
}

/// All style definitions returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct StyleList {
    pub built_in: Vec<BuiltInStyle>,
    pub custom: Vec<CustomStyle>,
}

/// Return the built-in style catalog (no prompts exposed to frontend).
pub fn built_in_styles() -> Vec<BuiltInStyle> {
    vec![
        BuiltInStyle {
            id: "professional".to_string(),
            name: "Professional".to_string(),
            description: "Polished, formal, business-ready".to_string(),
        },
        BuiltInStyle {
            id: "casual".to_string(),
            name: "Casual".to_string(),
            description: "Clear and natural, filler words removed".to_string(),
        },
        BuiltInStyle {
            id: "concise".to_string(),
            name: "Concise".to_string(),
            description: "Shorter and more direct, same meaning".to_string(),
        },
        BuiltInStyle {
            id: "translate".to_string(),
            name: "Translate".to_string(),
            description: "Translate into your chosen language".to_string(),
        },
        BuiltInStyle {
            id: "email".to_string(),
            name: "Email Format".to_string(),
            description: "Structured as a professional email".to_string(),
        },
        BuiltInStyle {
            id: "meeting_notes".to_string(),
            name: "Meeting Notes".to_string(),
            description: "Key points and action items, bullet-pointed".to_string(),
        },
    ]
}

/// Return the system prompt for a given style id.
/// `target_language` is only used when style == "translate".
pub fn system_prompt_for(style: &str, target_language: &str) -> String {
    match style {
        "professional" => "\
You are a text improvement assistant. Rewrite the given text to be more \
professional, polished, and formal. Rules:
1) Keep the same meaning and core message
2) Only output the improved text — no preamble, no explanation, no quotes
3) Match the original language
4) Maintain the approximate length
5) Fix grammar, punctuation, and sentence structure
6) Use appropriate professional vocabulary"
            .to_string(),

        "casual" => "\
You are a text cleanup assistant. Clean up the given text to be clear and \
natural, like a well-written message to a friend or colleague. Rules:
1) Keep the tone relaxed and conversational
2) Only output the cleaned text — nothing else
3) Fix obvious grammar issues but keep contractions and informal style
4) Remove filler words (um, uh, like, you know)
5) Don't make it longer than the original"
            .to_string(),

        "concise" => "\
You are a text compression assistant. Rewrite the given text to be shorter \
and more direct while keeping the full meaning. Rules:
1) Reduce length by 30-50% where possible
2) Only output the compressed text — nothing else
3) Remove redundancy and filler
4) Keep all important information
5) Use active voice and strong verbs"
            .to_string(),

        "translate" => format!(
            "You are a translation assistant. Translate the given text into {target_language}. \
Rules:
1) Only output the translation — nothing else
2) Maintain the tone and register of the original
3) Use natural, fluent {target_language}
4) Keep proper nouns unchanged"
        ),

        "email" => "\
You are an email writing assistant. Rewrite the given text as a professional \
email. Rules:
1) Add an appropriate greeting if missing
2) Structure into clear paragraphs
3) Add a professional closing if missing
4) Fix grammar and punctuation
5) Only output the email text — no subject line unless requested
6) Keep the same core message and requests"
            .to_string(),

        "meeting_notes" => "\
You are a meeting notes formatter. Rewrite the given text as structured \
meeting notes. Rules:
1) Extract key points and action items
2) Format with bullet points or numbered lists
3) Add section headers if multiple topics are discussed
4) Only output the formatted notes — nothing else
5) Preserve all factual details and names"
            .to_string(),

        other => {
            // Custom style — the frontend passes the system prompt directly in the
            // style field prefixed with "custom:". If just an unknown id is given,
            // fall back to professional.
            if let Some(prompt) = other.strip_prefix("custom:") {
                prompt.to_string()
            } else {
                system_prompt_for("professional", target_language)
            }
        }
    }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_polish_styles() -> StyleList {
    let settings = crate::settings::load_settings().await;
    StyleList {
        built_in: built_in_styles(),
        custom: settings.custom_polish_styles,
    }
}

#[tauri::command]
pub async fn add_custom_style(name: String, system_prompt: String) -> Result<(), String> {
    let mut settings = crate::settings::load_settings().await;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Style name cannot be empty".to_string());
    }
    settings.custom_polish_styles.retain(|s| s.name != name);
    settings.custom_polish_styles.push(CustomStyle { name, system_prompt });
    crate::settings::save_settings(&settings).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_custom_style(name: String) -> Result<(), String> {
    let mut settings = crate::settings::load_settings().await;
    settings.custom_polish_styles.retain(|s| s.name != name);
    crate::settings::save_settings(&settings).await.map_err(|e| e.to_string())
}
