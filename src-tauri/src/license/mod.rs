mod validator;

use anyhow::Result;
use chrono::Utc;
use dirs::data_local_dir;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "com.omwhisper.app";
const KEYRING_USER: &str = "license_data";
const GRACE_PERIOD_DAYS: i64 = 30;
const REVALIDATE_DAYS: i64 = 7;

// ─── Public types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LicenseStatus {
    Free,
    Licensed,
    GracePeriod,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInfo {
    pub status: LicenseStatus,
    pub email: Option<String>,
    pub activated_on: Option<String>,
    pub last_validated: Option<String>,
}

// ─── Internal storage ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredLicense {
    license_key: String,
    instance_id: String,
    customer_email: String,
    activation_date: String,
    last_validated_date: String,
}

fn fallback_path() -> PathBuf {
    data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("license.json")
}

fn load_stored() -> Option<StoredLicense> {
    // Try keyring first
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if let Ok(data) = entry.get_password() {
            if let Ok(lic) = serde_json::from_str::<StoredLicense>(&data) {
                return Some(lic);
            }
        }
    }
    // File fallback (e.g. if Keychain access denied)
    let path = fallback_path();
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(lic) = serde_json::from_str::<StoredLicense>(&data) {
            return Some(lic);
        }
    }
    None
}

fn save_stored(lic: &StoredLicense) -> Result<()> {
    let data = serde_json::to_string(lic)?;
    // Try keyring
    let keyring_ok = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map(|e| e.set_password(&data).is_ok())
        .unwrap_or(false);
    if !keyring_ok {
        // Fall back to file
        let path = fallback_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, data)?;
    }
    Ok(())
}

fn clear_stored() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        let _ = entry.delete_password();
    }
    let _ = std::fs::remove_file(fallback_path());
}

// ─── Machine ID ───────────────────────────────────────────────────────────────

/// Returns a stable 16-char hex ID for this machine.
pub fn get_machine_id() -> String {
    // macOS: hash the hardware UUID from ioreg
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(uuid) = line.split('"').nth(3) {
                        use sha2::{Digest, Sha256};
                        let hash = hex::encode(Sha256::digest(uuid.as_bytes()));
                        return hash[..16].to_string();
                    }
                }
            }
        }
    }

    // Windows: read stable MachineGuid from registry
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        use sha2::{Digest, Sha256};

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(key) = hklm.open_subkey("SOFTWARE\\Microsoft\\Cryptography") {
            if let Ok(guid) = key.get_value::<String, _>("MachineGuid") {
                let hash = hex::encode(Sha256::digest(guid.as_bytes()));
                return hash[..16].to_string();
            }
        }
        // Falls through to the shared UUID fallback below if registry read fails
    }

    // Fallback: generate and persist a random UUID
    let id_path = data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.omwhisper.app")
        .join("machine_id");

    if let Ok(id) = std::fs::read_to_string(&id_path) {
        let id = id.trim().to_string();
        if !id.is_empty() {
            return id;
        }
    }

    let id = &uuid::Uuid::new_v4().simple().to_string()[..16];
    if let Some(parent) = id_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&id_path, id);
    id.to_string()
}

pub fn instance_name() -> String {
    format!("omwhisper-{}", get_machine_id())
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Check local storage only — no network call.
pub fn get_status() -> LicenseStatus {
    let stored = match load_stored() {
        Some(s) => s,
        None => return LicenseStatus::Free,
    };
    days_since_validated_to_status(&stored.last_validated_date)
}

fn days_since_validated_to_status(last_validated: &str) -> LicenseStatus {
    match chrono::DateTime::parse_from_rfc3339(last_validated) {
        Ok(dt) => {
            let days = (Utc::now() - dt.with_timezone(&Utc)).num_days();
            if days <= REVALIDATE_DAYS {
                LicenseStatus::Licensed
            } else if days <= GRACE_PERIOD_DAYS {
                LicenseStatus::GracePeriod
            } else {
                LicenseStatus::Expired
            }
        }
        Err(_) => LicenseStatus::Free,
    }
}

pub fn get_info() -> LicenseInfo {
    let status = get_status();
    match load_stored() {
        Some(s) => LicenseInfo {
            status,
            email: Some(s.customer_email),
            activated_on: Some(s.activation_date),
            last_validated: Some(s.last_validated_date),
        },
        None => LicenseInfo {
            status,
            email: None,
            activated_on: None,
            last_validated: None,
        },
    }
}

/// Returns true if the license allows unlimited use.
pub fn is_active() -> bool {
    matches!(get_status(), LicenseStatus::Licensed | LicenseStatus::GracePeriod)
}

/// Activate a license key against Lemon Squeezy. Stores credentials on success.
pub async fn activate(key: &str) -> Result<LicenseInfo, String> {
    let name = instance_name();
    let resp = validator::activate(key, &name)
        .await
        .map_err(|_| "network_error".to_string())?;

    if !resp.activated {
        let msg = resp.error.unwrap_or_default().to_lowercase();
        if msg.contains("already activated") || msg.contains("activation limit") {
            return Err("max_activations_reached".to_string());
        }
        return Err("invalid_key".to_string());
    }

    let instance_id = resp.instance.map(|i| i.id).unwrap_or_default();
    let email = resp.meta.map(|m| m.customer_email).unwrap_or_default();
    let now = Utc::now().to_rfc3339();

    let stored = StoredLicense {
        license_key: key.to_string(),
        instance_id,
        customer_email: email,
        activation_date: now.clone(),
        last_validated_date: now,
    };
    save_stored(&stored).map_err(|e| e.to_string())?;

    Ok(get_info())
}

/// Validate against Lemon Squeezy. Falls back to cached status if offline.
pub async fn validate() -> LicenseStatus {
    let stored = match load_stored() {
        Some(s) => s,
        None => return LicenseStatus::Free,
    };

    match validator::validate(&stored.license_key, &stored.instance_id).await {
        Ok(resp) if resp.valid => {
            // Refresh last_validated timestamp
            let mut updated = stored;
            updated.last_validated_date = Utc::now().to_rfc3339();
            let _ = save_stored(&updated);
            LicenseStatus::Licensed
        }
        Ok(_) => {
            // Server says invalid — could be revoked or deactivated
            LicenseStatus::Expired
        }
        Err(_) => {
            // Network failure — fall back to grace period logic
            get_status()
        }
    }
}

/// Deactivate this instance and clear local credentials.
pub async fn deactivate() -> Result<(), String> {
    let stored = match load_stored() {
        Some(s) => s,
        None => return Ok(()),
    };
    // Best-effort network call — don't fail if offline
    let _ = validator::deactivate(&stored.license_key, &stored.instance_id).await;
    clear_stored();
    Ok(())
}
