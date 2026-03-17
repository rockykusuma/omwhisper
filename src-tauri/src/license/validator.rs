use anyhow::Result;
use serde::Deserialize;
use std::sync::OnceLock;

const BASE_URL: &str = "https://api.lemonsqueezy.com/v1/licenses";

// ─── Response types ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ActivateResponse {
    pub activated: bool,
    pub error: Option<String>,
    pub license_key: Option<LicenseKeyData>,
    pub instance: Option<InstanceData>,
    pub meta: Option<MetaData>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ValidateResponse {
    pub valid: bool,
    pub error: Option<String>,
    pub license_key: Option<LicenseKeyData>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct LicenseKeyData {
    pub id: u64,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct InstanceData {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct MetaData {
    pub customer_name: String,
    pub customer_email: String,
}

// ─── API calls ────────────────────────────────────────────────────────────────

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    })
}

pub async fn activate(key: &str, instance_name: &str) -> Result<ActivateResponse> {
    let resp = client()
        .post(format!("{}/activate", BASE_URL))
        .form(&[("license_key", key), ("instance_name", instance_name)])
        .send()
        .await?
        .json::<ActivateResponse>()
        .await?;
    Ok(resp)
}

pub async fn validate(key: &str, instance_id: &str) -> Result<ValidateResponse> {
    let resp = client()
        .post(format!("{}/validate", BASE_URL))
        .form(&[("license_key", key), ("instance_id", instance_id)])
        .send()
        .await?
        .json::<ValidateResponse>()
        .await?;
    Ok(resp)
}

pub async fn deactivate(key: &str, instance_id: &str) -> Result<()> {
    let _ = client()
        .post(format!("{}/deactivate", BASE_URL))
        .form(&[("license_key", key), ("instance_id", instance_id)])
        .send()
        .await?;
    Ok(())
}
