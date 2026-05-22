use totp_rs::{Algorithm, Secret, TOTP};

pub fn generate_secret() -> String {
    Secret::generate_secret().to_encoded().to_string()
}

pub fn generate_otpauth_uri(secret: &str, email: &str, issuer: &str) -> Result<String, String> {
    let secret_bytes = Secret::Encoded(secret.to_string())
        .to_bytes()
        .map_err(|e| format!("Invalid TOTP secret: {e}"))?;
    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        Some(issuer.to_string()),
        email.to_string(),
    )
    .map_err(|e| format!("Failed to create TOTP: {e}"))?;
    Ok(totp.get_url())
}

pub fn verify_totp(secret: &str, code: &str) -> bool {
    let Ok(secret_bytes) = Secret::Encoded(secret.to_string()).to_bytes() else {
        return false;
    };
    let Ok(totp) = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret_bytes,
        None,
        String::from("user"),
    ) else {
        return false;
    };
    totp.check_current(code).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_secret_is_nonempty() {
        let secret = generate_secret();
        assert!(!secret.is_empty());
    }

    #[test]
    fn generate_secret_produces_base32_chars() {
        let secret = generate_secret();
        assert!(secret.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '='));
    }

    #[test]
    fn generate_otpauth_uri_starts_with_scheme() {
        let secret = generate_secret();
        let uri = generate_otpauth_uri(&secret, "user@example.com", "Neutrino").unwrap();
        assert!(uri.starts_with("otpauth://totp/"));
    }

    #[test]
    fn generate_otpauth_uri_contains_issuer() {
        let secret = generate_secret();
        let uri = generate_otpauth_uri(&secret, "user@example.com", "Neutrino").unwrap();
        assert!(uri.contains("Neutrino"));
    }

    #[test]
    fn verify_totp_returns_false_for_wrong_code() {
        let secret = generate_secret();
        assert!(!verify_totp(&secret, "000000"));
        assert!(!verify_totp(&secret, "999999"));
    }

    #[test]
    fn verify_totp_returns_false_for_invalid_secret() {
        assert!(!verify_totp("not-valid-base32-!!!!", "123456"));
    }

    #[test]
    fn verify_totp_returns_false_for_wrong_length_code() {
        let secret = generate_secret();
        assert!(!verify_totp(&secret, "12345")); // 5 digits, not 6
    }
}
