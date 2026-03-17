use serde::Deserialize;

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
pub struct VersionInfo {
    pub latest: String,
    pub download_url: String,
    pub release_notes: String,
}

/// Fetch the remote version manifest and return it if a newer version is available.
/// Silently returns None on any network or parse error.
pub async fn check_for_update() -> Option<VersionInfo> {
    let current = env!("CARGO_PKG_VERSION");

    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .ok()?
        .get("https://omwhisper.com/api/version.json")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let info: VersionInfo = resp.json().await.ok()?;

    if is_newer(&info.latest, current) {
        tracing::info!("update available: {} -> {}", current, info.latest);
        Some(info)
    } else {
        None
    }
}

/// Simple semver comparison: returns true if `remote` > `current`.
pub(crate) fn is_newer(remote: &str, current: &str) -> bool {
    let parse = |s: &str| -> (u32, u32, u32) {
        let mut parts = s.trim_start_matches('v').splitn(3, '.');
        let major = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
        let minor = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
        let patch = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
        (major, minor, patch)
    };
    parse(remote) > parse(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_version_is_not_newer() {
        assert!(!is_newer("0.1.0", "0.1.0"));
    }

    #[test]
    fn higher_patch_is_newer() {
        assert!(is_newer("0.1.1", "0.1.0"));
    }

    #[test]
    fn lower_patch_is_not_newer() {
        assert!(!is_newer("0.1.0", "0.1.1"));
    }

    #[test]
    fn higher_minor_is_newer() {
        assert!(is_newer("0.2.0", "0.1.9"));
    }

    #[test]
    fn higher_major_is_newer() {
        assert!(is_newer("1.0.0", "0.9.9"));
    }

    #[test]
    fn lower_major_is_not_newer() {
        assert!(!is_newer("0.9.9", "1.0.0"));
    }

    #[test]
    fn v_prefix_stripped_correctly() {
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(!is_newer("v0.1.0", "0.1.0"));
    }

    #[test]
    fn malformed_version_treated_as_zero() {
        // "abc" parses as (0,0,0) — not newer than any real version
        assert!(!is_newer("abc", "0.1.0"));
    }

    #[test]
    fn minor_beats_patch() {
        assert!(is_newer("0.2.0", "0.1.99"));
    }
}
