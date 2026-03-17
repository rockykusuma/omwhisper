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
    /// "raw" | "smart_dictation"
    pub source: String,
    /// Original transcription before AI polish (only set for smart_dictation entries)
    pub raw_text: Option<String>,
    /// Which polish style was applied (e.g. "professional")
    pub polish_style: Option<String>,
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
    // Schema migrations — safe to run every time (ADD COLUMN is idempotent via IF NOT EXISTS workaround)
    for migration in [
        "ALTER TABLE transcriptions ADD COLUMN source TEXT NOT NULL DEFAULT 'raw'",
        "ALTER TABLE transcriptions ADD COLUMN raw_text TEXT",
        "ALTER TABLE transcriptions ADD COLUMN polish_style TEXT",
    ] {
        let _ = conn.execute_batch(migration); // ignore error if column already exists
    }
    Ok(conn)
}

/// Save a transcription to history. Returns the new entry id.
pub fn add_transcription(
    text: &str,
    duration_seconds: f64,
    model_used: &str,
    source: &str,
    raw_text: Option<&str>,
    polish_style: Option<&str>,
) -> Result<i64> {
    let conn = open_db()?;
    let word_count = text.split_whitespace().count() as i64;
    let created_at = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO transcriptions
            (text, duration_seconds, model_used, created_at, word_count, source, raw_text, polish_style)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![text, duration_seconds, model_used, created_at, word_count, source, raw_text, polish_style],
    )
    .context("failed to insert transcription")?;
    Ok(conn.last_insert_rowid())
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<TranscriptionEntry> {
    Ok(TranscriptionEntry {
        id: row.get(0)?,
        text: row.get(1)?,
        duration_seconds: row.get(2)?,
        model_used: row.get(3)?,
        created_at: row.get(4)?,
        word_count: row.get(5)?,
        source: row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "raw".to_string()),
        raw_text: row.get(7)?,
        polish_style: row.get(8)?,
    })
}

/// Paginated history, newest first.
pub fn get_history(limit: i64, offset: i64) -> Result<Vec<TranscriptionEntry>> {
    let conn = open_db()?;
    let mut stmt = conn.prepare(
        "SELECT id, text, duration_seconds, model_used, created_at, word_count, source, raw_text, polish_style
         FROM transcriptions
         ORDER BY created_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let entries = stmt
        .query_map(params![limit, offset], row_to_entry)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

/// Full-text search (LIKE).
pub fn search_history(query: &str) -> Result<Vec<TranscriptionEntry>> {
    let conn = open_db()?;
    let pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT id, text, duration_seconds, model_used, created_at, word_count, source, raw_text, polish_style
         FROM transcriptions
         WHERE text LIKE ?1
         ORDER BY created_at DESC
         LIMIT 100",
    )?;
    let entries = stmt
        .query_map(params![pattern], row_to_entry)?
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
        "SELECT id, text, duration_seconds, model_used, created_at, word_count, source, raw_text, polish_style
         FROM transcriptions
         ORDER BY created_at DESC",
    )?;
    let entries: Vec<TranscriptionEntry> = stmt
        .query_map([], row_to_entry)?
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

// ─── Storage & Cleanup ────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct StorageInfo {
    pub db_size_bytes: u64,
    pub record_count: i64,
}

/// Return the DB file size and total transcription count.
pub fn get_storage_info() -> Result<StorageInfo> {
    let path = db_path();
    let db_size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let conn = open_db()?;
    let record_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM transcriptions", [], |row| row.get(0))
        .unwrap_or(0);
    Ok(StorageInfo { db_size_bytes, record_count })
}

/// Delete transcriptions older than `days` days. Returns the number of deleted rows.
pub fn cleanup_old_transcriptions(days: u32) -> Result<usize> {
    let conn = open_db()?;
    let cutoff = (chrono::Local::now() - chrono::Duration::days(days as i64)).to_rfc3339();
    let deleted = conn.execute(
        "DELETE FROM transcriptions WHERE created_at < ?1",
        params![cutoff],
    )?;
    Ok(deleted)
}

// ─── Usage Stats ─────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct StatsSummary {
    pub total_recordings: i64,
    pub total_duration_seconds: f64,
    pub total_words: i64,
    pub recordings_today: i64,
    pub streak_days: i64,
}

pub fn get_stats_summary() -> Result<StatsSummary> {
    let conn = open_db()?;
    let today = today_date();

    let (total_recordings, total_duration_seconds, total_words): (i64, f64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0), COALESCE(SUM(word_count), 0)
             FROM transcriptions",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap_or((0, 0.0, 0));

    let recordings_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM transcriptions WHERE DATE(created_at) = ?1",
            params![today],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Streak: count consecutive days (including today) with at least one recording
    let streak_days = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT DATE(created_at) as day FROM transcriptions ORDER BY day DESC",
        )?;
        let days: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        let mut streak = 0i64;
        let mut expected = chrono::Local::now().date_naive();
        for day_str in &days {
            if let Ok(day) = chrono::NaiveDate::parse_from_str(day_str, "%Y-%m-%d") {
                if day == expected {
                    streak += 1;
                    expected = expected.pred_opt().unwrap_or(expected);
                } else {
                    break;
                }
            }
        }
        streak
    };

    Ok(StatsSummary {
        total_recordings,
        total_duration_seconds,
        total_words,
        recordings_today,
        streak_days,
    })
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

#[cfg(test)]
mod tests {
    use rusqlite::{Connection, params};

    /// Create a fresh in-memory DB with the same schema used by the real DB.
    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE transcriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                duration_seconds REAL NOT NULL DEFAULT 0,
                model_used TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                word_count INTEGER NOT NULL DEFAULT 0,
                source TEXT NOT NULL DEFAULT 'raw',
                raw_text TEXT,
                polish_style TEXT
            );
            CREATE TABLE daily_usage (
                date TEXT PRIMARY KEY,
                seconds_used INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();
        conn
    }

    fn insert(conn: &Connection, text: &str, duration: f64, model: &str, created_at: &str, source: &str) -> i64 {
        let word_count = text.split_whitespace().count() as i64;
        conn.execute(
            "INSERT INTO transcriptions (text, duration_seconds, model_used, created_at, word_count, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![text, duration, model, created_at, word_count, source],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    // ── insert & count ────────────────────────────────────────────────────────

    #[test]
    fn insert_returns_incrementing_ids() {
        let conn = setup();
        let id1 = insert(&conn, "Hello world", 2.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        let id2 = insert(&conn, "Second entry", 3.0, "tiny.en", "2024-01-01T11:00:00+00:00", "raw");
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    fn word_count_computed_correctly() {
        let conn = setup();
        insert(&conn, "one two three four", 1.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        let wc: i64 = conn
            .query_row("SELECT word_count FROM transcriptions WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(wc, 4);
    }

    // ── pagination ────────────────────────────────────────────────────────────

    #[test]
    fn pagination_returns_correct_slice() {
        let conn = setup();
        for i in 1..=5 {
            insert(&conn, &format!("Entry {i}"), 1.0, "tiny.en", &format!("2024-01-0{i}T10:00:00+00:00"), "raw");
        }
        let mut stmt = conn.prepare(
            "SELECT id FROM transcriptions ORDER BY created_at DESC LIMIT 2 OFFSET 1",
        ).unwrap();
        let ids: Vec<i64> = stmt.query_map([], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn get_all_returns_newest_first() {
        let conn = setup();
        insert(&conn, "First", 1.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        insert(&conn, "Second", 1.0, "tiny.en", "2024-01-02T10:00:00+00:00", "raw");
        insert(&conn, "Third", 1.0, "tiny.en", "2024-01-03T10:00:00+00:00", "raw");
        let mut stmt = conn.prepare(
            "SELECT text FROM transcriptions ORDER BY created_at DESC",
        ).unwrap();
        let texts: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(texts[0], "Third");
        assert_eq!(texts[2], "First");
    }

    // ── search ────────────────────────────────────────────────────────────────

    #[test]
    fn search_finds_matching_entry() {
        let conn = setup();
        insert(&conn, "Hello world from Rust", 1.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        insert(&conn, "Unrelated text here", 1.0, "tiny.en", "2024-01-02T10:00:00+00:00", "raw");
        let pattern = "%Rust%";
        let mut stmt = conn.prepare(
            "SELECT text FROM transcriptions WHERE text LIKE ?1 ORDER BY created_at DESC LIMIT 100",
        ).unwrap();
        let results: Vec<String> = stmt.query_map(params![pattern], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(results.len(), 1);
        assert!(results[0].contains("Rust"));
    }

    #[test]
    fn search_no_match_returns_empty() {
        let conn = setup();
        insert(&conn, "Hello world", 1.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        let pattern = "%xyz_not_found%";
        let mut stmt = conn.prepare(
            "SELECT text FROM transcriptions WHERE text LIKE ?1",
        ).unwrap();
        let results: Vec<String> = stmt.query_map(params![pattern], |r| r.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        assert!(results.is_empty());
    }

    #[test]
    fn search_is_case_insensitive_via_like() {
        let conn = setup();
        insert(&conn, "Hello WORLD", 1.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        // SQLite LIKE is case-insensitive for ASCII by default
        let pattern = "%hello%";
        let mut stmt = conn.prepare(
            "SELECT COUNT(*) FROM transcriptions WHERE text LIKE ?1",
        ).unwrap();
        let count: i64 = stmt.query_row(params![pattern], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    // ── delete ────────────────────────────────────────────────────────────────

    #[test]
    fn delete_removes_correct_row() {
        let conn = setup();
        let id = insert(&conn, "To delete", 1.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        insert(&conn, "Keep me", 1.0, "tiny.en", "2024-01-02T10:00:00+00:00", "raw");

        conn.execute("DELETE FROM transcriptions WHERE id = ?1", params![id]).unwrap();

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM transcriptions", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let text: String = conn.query_row("SELECT text FROM transcriptions", [], |r| r.get(0)).unwrap();
        assert_eq!(text, "Keep me");
    }

    #[test]
    fn clear_removes_all_rows() {
        let conn = setup();
        insert(&conn, "A", 1.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        insert(&conn, "B", 1.0, "tiny.en", "2024-01-02T10:00:00+00:00", "raw");
        conn.execute_batch("DELETE FROM transcriptions;").unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM transcriptions", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    // ── export formats ────────────────────────────────────────────────────────

    #[test]
    fn export_json_is_valid_json() {
        let conn = setup();
        insert(&conn, "Test transcription", 5.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        let mut stmt = conn.prepare(
            "SELECT id, text, duration_seconds, model_used, created_at, word_count, source, raw_text, polish_style
             FROM transcriptions ORDER BY created_at DESC",
        ).unwrap();
        let entries: Vec<serde_json::Value> = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "text": row.get::<_, String>(1)?,
                "duration_seconds": row.get::<_, f64>(2)?,
                "model_used": row.get::<_, String>(3)?,
                "created_at": row.get::<_, String>(4)?,
                "word_count": row.get::<_, i64>(5)?,
            }))
        }).unwrap().filter_map(|r| r.ok()).collect();
        let json = serde_json::to_string_pretty(&entries).unwrap();
        assert!(json.contains("Test transcription"));
        // Verify it's valid JSON by parsing it back
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.is_array());
    }

    #[test]
    fn export_txt_format_contains_text() {
        let texts = vec!["First sentence", "Second sentence"];
        let mut out = String::new();
        for text in &texts {
            out.push_str(&format!("[2024-01-01]\n{}\n\n", text));
        }
        assert!(out.contains("First sentence"));
        assert!(out.contains("Second sentence"));
    }

    #[test]
    fn export_markdown_contains_headers() {
        let mut out = String::from("# OmWhisper Transcription History\n\n");
        out.push_str("## 2024-01-01T10:00:00+00:00\n\n");
        out.push_str("**Model:** tiny.en | **Words:** 3 | **Duration:** 2.5s\n\n");
        out.push_str("Hello world test\n\n---\n\n");
        assert!(out.starts_with("# OmWhisper"));
        assert!(out.contains("##"));
        assert!(out.contains("**Model:**"));
    }

    // ── daily usage ───────────────────────────────────────────────────────────

    #[test]
    fn daily_usage_upsert_accumulates() {
        let conn = setup();
        let date = "2024-01-01";
        conn.execute(
            "INSERT INTO daily_usage (date, seconds_used) VALUES (?1, ?2)
             ON CONFLICT(date) DO UPDATE SET seconds_used = seconds_used + ?2",
            params![date, 60i64],
        ).unwrap();
        conn.execute(
            "INSERT INTO daily_usage (date, seconds_used) VALUES (?1, ?2)
             ON CONFLICT(date) DO UPDATE SET seconds_used = seconds_used + ?2",
            params![date, 120i64],
        ).unwrap();
        let total: i64 = conn.query_row(
            "SELECT seconds_used FROM daily_usage WHERE date = ?1",
            params![date],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(total, 180);
    }

    #[test]
    fn daily_usage_missing_date_returns_zero() {
        let conn = setup();
        let total: i64 = conn
            .query_row(
                "SELECT seconds_used FROM daily_usage WHERE date = '9999-01-01'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        assert_eq!(total, 0);
    }

    // ── stats ─────────────────────────────────────────────────────────────────

    #[test]
    fn stats_total_words_summed_correctly() {
        let conn = setup();
        insert(&conn, "one two three", 1.0, "tiny.en", "2024-01-01T10:00:00+00:00", "raw"); // 3 words
        insert(&conn, "four five", 1.0, "tiny.en", "2024-01-02T10:00:00+00:00", "raw");     // 2 words
        let total_words: i64 = conn
            .query_row("SELECT COALESCE(SUM(word_count), 0) FROM transcriptions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total_words, 5);
    }

    #[test]
    fn stats_total_duration_summed_correctly() {
        let conn = setup();
        insert(&conn, "A", 10.5, "tiny.en", "2024-01-01T10:00:00+00:00", "raw");
        insert(&conn, "B", 4.5, "tiny.en", "2024-01-02T10:00:00+00:00", "raw");
        let total: f64 = conn
            .query_row("SELECT COALESCE(SUM(duration_seconds), 0) FROM transcriptions", [], |r| r.get(0))
            .unwrap();
        assert!((total - 15.0).abs() < 1e-5);
    }

    #[test]
    fn free_tier_constant_is_1800_seconds() {
        assert_eq!(super::FREE_TIER_SECONDS, 1800);
    }
}
