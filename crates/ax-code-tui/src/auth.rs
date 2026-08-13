//! Runtime authorization for the sidecar TUI (fail closed).

use base64::Engine;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AuthError {
    #[error("runtime authorization required: set AX_CODE_TUI_AUTH_HEADER or AX_CODE_TUI_PASSWORD")]
    Missing,
}

/// Credentials passed from the Node launcher via environment (not argv).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthConfig {
    /// Full `Authorization` header value, e.g. `Basic …`.
    pub authorization_header: String,
}

impl AuthConfig {
    /// Build auth from explicit header or username/password pair.
    ///
    /// Fail closed: empty header and missing password → [`AuthError::Missing`].
    pub fn from_parts(
        authorization_header: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<Self, AuthError> {
        if let Some(header) = authorization_header.map(str::trim).filter(|s| !s.is_empty()) {
            return Ok(Self {
                authorization_header: header.to_string(),
            });
        }
        let password = password.map(str::trim).filter(|s| !s.is_empty());
        let Some(password) = password else {
            return Err(AuthError::Missing);
        };
        let user = username
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("ax-code");
        let token = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"));
        Ok(Self {
            authorization_header: format!("Basic {token}"),
        })
    }

    /// Resolve from process environment variables used by the dogfood launcher.
    pub fn from_env() -> Result<Self, AuthError> {
        let header = std::env::var("AX_CODE_TUI_AUTH_HEADER").ok();
        let user = std::env::var("AX_CODE_TUI_USERNAME")
            .ok()
            .or_else(|| std::env::var("AX_CODE_SERVER_USERNAME").ok());
        let password = std::env::var("AX_CODE_TUI_PASSWORD")
            .ok()
            .or_else(|| std::env::var("AX_CODE_SERVER_PASSWORD").ok());
        Self::from_parts(
            header.as_deref(),
            user.as_deref(),
            password.as_deref(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_password_is_error() {
        assert_eq!(
            AuthConfig::from_parts(None, Some("ax-code"), None),
            Err(AuthError::Missing)
        );
    }

    #[test]
    fn basic_auth_encodes() {
        let auth = AuthConfig::from_parts(None, Some("ax-code"), Some("secret")).unwrap();
        assert!(auth.authorization_header.starts_with("Basic "));
        let raw = auth.authorization_header.trim_start_matches("Basic ");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(raw)
            .unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), "ax-code:secret");
    }

    #[test]
    fn explicit_header_wins() {
        let auth = AuthConfig::from_parts(Some("Bearer tok"), Some("u"), Some("p")).unwrap();
        assert_eq!(auth.authorization_header, "Bearer tok");
    }
}
