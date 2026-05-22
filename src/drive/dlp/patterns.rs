pub const SSN_PATTERN: &str = r"\b\d{3}-\d{2}-\d{4}\b";
pub const CREDIT_CARD_PATTERN: &str = r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b";
pub const US_PHONE_PATTERN: &str = r"\b(\+1[\-.\s]?)?\(?\d{3}\)?[\-.\s]?\d{3}[\-.\s]?\d{4}\b";
pub const EMAIL_PATTERN: &str = r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b";

/// Returns built-in pattern templates: (name, pattern_type, pattern, severity, action)
pub fn built_in_patterns() -> Vec<(&'static str, &'static str, &'static str, &'static str, &'static str)> {
    vec![
        ("SSN Detection", "ssn", SSN_PATTERN, "high", "restrict_sharing"),
        ("Credit Card Detection", "credit_card", CREDIT_CARD_PATTERN, "high", "restrict_sharing"),
        ("US Phone Number", "phone", US_PHONE_PATTERN, "low", "notify"),
        ("Email Address", "email", EMAIL_PATTERN, "low", "notify"),
    ]
}
