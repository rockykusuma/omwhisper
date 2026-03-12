use anyhow::{Context, Result};
use dirs::data_local_dir;
use rusqlite::{params, Connection};
use std::path::PathBuf;

pub const FREE_TIER_SECONDS: i64 = 30 * 60; // 30 minutes per day

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TranscriptionEntry {
    pub id: i64,
    pub text: String,
    pub duration_seconds: f64,
    pub model_used: String,
    pub created_at: String,
    pub word_count: i64,
}

fn db_path() -> PathBuf {
    data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("history.db")
}

fn open_db() -> Result<Connection> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("failed to create app data dir")?;
    }
    let conn = Connection::open(&path).context("failed to open history database")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS transcriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            duration_seconds REAL NOT NULL DEFAULT 0,
            model_used TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            word_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS daily_usage (
            date TEXT PRIMARY KEY,
            seconds_used INTEGER NOT NULL DEFAULT 0
        );",
    )
    .context("failed to create tables")?;
    Ok(conn)
}

/// Save a transcription to history. Returns the new entry id.
pub fn add_transcription(text: &str, duration_seconds: f64, model_used: &str) -> Result<i64> {
    let conn = open_db()?;
    let word_count = text.split_whitespace().count() as i64;
    let created_at = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO transcriptions (text, duration_seconds, model_used, created_at, word_count)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![text, duration_seconds, model_used, created_at, word_count],
    )
    .context("failed to insert transcription")?;
    Ok(conn.last_insert_rowid())
}

/// Paginated history, newest first.
pub fn get_history(limit: i64, offset: i64) -> Result<Vec<TranscriptionEntry>> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, text, duration_seconds, model_used, created_at, word_count
         FROM transcriptions
         ORDER BY created_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let entries = stmt
        .query_map(params![limit, offset], |row| {
            Ok(TranscriptionEntry {
                id: row.get(0)?,
                text: row.get(1)?,
                duration_seconds: row.get(2)?,
                model_used: row.get(3)?,
                created_at: row.get(4)?,
                word_count: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

/// Full-text search (LIKE).
pub fn search_history(query: &str) -> Result<Vec<TranscriptionEntry>> {
    let conn = open_db()?;
    let pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT id, text, duration_seconds, model_used, created_at, word_count
         FROM transcriptions
         WHERE text LIKE ?1
         ORDER BY created_at DESC
         LIMIT 100",
    )?;
    let entries = stmt
        .query_map(params![pattern], |row| {
            Ok(TranscriptionEntry {
                id: row.get(0)?,
                text: row.get(1)?,
                duration_seconds: row.get(2)?,
                model_used: row.get(3)?,
                created_at: row.get(4)?,
                word_count: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

pub fn delete_transcription(id: i64) -> Result<()> {
    let conn = open_db()?;
    conn.execute("DELETE FROM transcriptions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_history() -> Result<()> {
    let conn = open_db()?;
    conn.execute_batch("DELETE FROM transcriptions;")?;
    Ok(())
}

/// Export all history as txt, markdown, or json.
pub fn export_history(format: &str) -> Result<String> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, text, duration_seconds, model_used, created_at, word_count
         FROM transcriptions
         ORDER BY created_at DESC",
    )?;
    let entries: Vec<TranscriptionEntry> = stmt
        .query_map([], |row| {
            Ok(TranscriptionEntry {
                id: row.get(0)?,
                text: row.get(1)?,
                duration_seconds: row.get(2)?,
                model_used: row.get(3)?,
                created_at: row.get(4)?,
                word_count: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    match format {
        "json" => Ok(serde_json::to_string_pretty(&entries)?),
        "markdown" => {
            let mut out = String::from("# OmWhisper Transcription History\n\n");
            for e in &entries {
                out.push_str(&format!("## {}\n\n", e.created_at));
                out.push_str(&format!(
                    "**Model:** {} | **Words:** {} | **Duration:** {:.1}s\n\n",
                    e.model_used, e.word_count, e.duration_seconds
                ));
                out.push_str(&e.text);
                out.push_str("\n\n---\n\n");
            }
            Ok(out)
        }
        _ => {
            // txt
            let mut out = String::new();
            for e in &entries {
                out.push_str(&format!("[{}]\n{}\n\n", e.created_at, e.text));
            }
            Ok(out)
        }
    }
}

// ─── Daily Usage Tracking ─────────────────────────────────────────────────────

fn today_date() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Returns seconds used today.
pub fn get_seconds_used_today() -> Result<i64> {
    let conn = open_db()?;
    let today = today_date();
    let seconds: i64 = conn
        .query_row(
            "SELECT seconds_used FROM daily_usage WHERE date = ?1",
            params![today],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(seconds)
}

/// Adds `seconds` to today's usage counter (upsert).
pub fn add_seconds_today(seconds: i64) -> Result<()> {
    let conn = open_db()?;
    let today = today_date();
    conn.execute(
        "INSERT INTO daily_usage (date, seconds_used) VALUES (?1, ?2)
         ON CONFLICT(date) DO UPDATE SET seconds_used = seconds_used + ?2",
        params![today, seconds],
    )?;
    Ok(())
}
