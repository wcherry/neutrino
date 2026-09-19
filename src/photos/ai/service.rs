use crate::shared::{AiClient, AiCredentials, ApiError};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectedObject {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub label: String,
}

/// A verdict on how badly an image is blurred, and the smear to correct along.
///
/// `angle_degrees` and `length_px` describe a motion-blur kernel: the axis the image was smeared
/// along and how far. The client sharpens along that axis rather than isotropically, which is what
/// makes the correction do anything for camera shake — an ordinary sharpen amplifies the smear in
/// every direction at once, including the one it was already smeared in.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlurAnalysis {
    pub blurred: bool,
    /// "motion", "focus" or "none". Only motion blur has an axis to correct along.
    pub kind: String,
    /// 0.0 (sharp) to 1.0 (unrecognisable).
    pub severity: f32,
    /// The axis of the smear, folded into [0, 180).
    pub angle_degrees: f32,
    /// How far the image smeared, in pixels of the image as analysed.
    pub length_px: f32,
    /// Whether sharpening is worth offering at all.
    pub recoverable: bool,
    /// What happened, in the photographer's terms.
    pub advice: String,
}

/// Beyond this the smear has destroyed the detail rather than displaced it, and a directional
/// sharpen amplifies noise into streaks instead of recovering an edge. Offering a correction past
/// it would be offering to make the photo worse.
const MAX_CORRECTABLE_LENGTH_PX: f32 = 64.0;

/// A model asked for numbers returns numbers, not necessarily ones in the range it was asked for —
/// an angle of 400, a severity of 5, a NaN from a malformed float. Every field is therefore brought
/// into range here rather than trusted, because each one is about to be fed to a convolution: a
/// nonsense length is a kernel the size of the image, and a NaN silently blanks every pixel it
/// touches.
fn sanitize_blur_analysis(mut a: BlurAnalysis) -> BlurAnalysis {
    a.kind = match a.kind.as_str() {
        "motion" | "focus" => a.kind,
        _ => "none".to_string(),
    };
    a.severity = clamp_finite(a.severity, 0.0, 1.0);
    a.angle_degrees = fold_angle(a.angle_degrees);
    a.length_px = clamp_finite(a.length_px, 0.0, MAX_CORRECTABLE_LENGTH_PX);

    // Nothing to sharpen along unless this is motion blur with an actual smear. Focus blur has no
    // axis, and a zero-length kernel is the identity, so in both cases a "correctable" verdict
    // would put a slider on screen that cannot change a pixel.
    if !a.blurred || a.kind != "motion" || a.length_px <= 0.0 {
        a.recoverable = false;
    }
    a
}

fn clamp_finite(v: f32, min: f32, max: f32) -> f32 {
    if v.is_finite() {
        v.clamp(min, max)
    } else {
        min
    }
}

/// A smear has no head or tail — 200° and 20° describe the same axis — so the angle folds into
/// [0, 180). Correcting along 200° and along 20° are the same operation, and leaving both spellings
/// in the response would make two identical kernels look like different answers.
fn fold_angle(deg: f32) -> f32 {
    if !deg.is_finite() {
        return 0.0;
    }
    let d = deg % 180.0;
    if d < 0.0 {
        d + 180.0
    } else {
        d
    }
}

pub struct PhotosAIService {
    ai: Arc<AiClient>,
}

impl PhotosAIService {
    pub fn new(ai: Arc<AiClient>) -> Self {
        Self { ai }
    }

    /// Ask the caller's configured provider about an image.
    ///
    /// Every route here is a vision prompt, and every one of them fails the same way — no key
    /// configured, or the provider refusing the call — so they all report it as `AI_UNAVAILABLE`
    /// rather than as a fault of this server.
    async fn ask(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, ApiError> {
        self.ai
            .complete_with_vision(credentials, image_base64, media_type, prompt, max_tokens)
            .await
            .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))
    }

    pub async fn ocr(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
    ) -> Result<String, ApiError> {
        let prompt = "Extract all text visible in this image. \
            Output only the extracted text, preserving line breaks and structure where possible. \
            If no text is found, respond with an empty string.";
        self.ask(credentials, image_base64, media_type, prompt, 2048)
            .await
    }

    pub async fn screenshot_intelligence(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
        output_type: &str,
    ) -> Result<String, ApiError> {
        let prompt = match output_type {
            "table" => {
                "Convert the content of this screenshot into a Markdown table. \
                Output only the Markdown table, nothing else."
            }
            "document" => {
                "Convert the content of this screenshot into a clean Markdown document. \
                Preserve headings, lists, and paragraphs. Output only the Markdown, nothing else."
            }
            "diagram" => {
                "Describe the structure or diagram in this screenshot as a Mermaid diagram. \
                Output only the Mermaid code block (```mermaid ... ```), nothing else."
            }
            _ => return Err(ApiError::bad_request("Invalid output_type")),
        };
        self.ask(credentials, image_base64, media_type, prompt, 4096)
            .await
    }

    pub async fn detect_objects(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
        target: &str,
    ) -> Result<Vec<DetectedObject>, ApiError> {
        let target_desc = match target {
            "people" => "people, persons, and humans",
            "power_lines" => "power lines, electrical cables, utility wires, and telephone lines strung between poles",
            "cars" => "vehicles including cars, trucks, buses, and motorcycles",
            "clutter" => "distracting background clutter, signs, garbage, and unwanted objects",
            _ => return Err(ApiError::bad_request("Invalid target")),
        };
        let prompt = format!(
            "Detect all {} in this image. \
            Return a JSON array where each element has these exact keys: \
            \"x\" (left edge as a 0.0–1.0 fraction of image width), \
            \"y\" (top edge as a 0.0–1.0 fraction of image height), \
            \"w\" (width as a 0.0–1.0 fraction), \
            \"h\" (height as a 0.0–1.0 fraction), \
            \"label\" (a short string like \"person\" or \"power line\"). \
            If none are found return []. Output only valid JSON with no markdown fences.",
            target_desc
        );
        let raw = self
            .ask(credentials, image_base64, media_type, &prompt, 1024)
            .await?;

        let trimmed = raw.trim();
        let json = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        serde_json::from_str::<Vec<DetectedObject>>(json)
            .map_err(|_| ApiError::internal("Failed to parse object detection result"))
    }

    /// Judge how blurred an image is and, for motion blur, which way it smeared.
    ///
    /// The angle and length are what separate this from "is this photo blurry" — they are the
    /// kernel the client sharpens against. Asking for them in pixels rather than as a fraction is
    /// deliberate: the caller downsamples before sending (a full-resolution photo is a large
    /// base64 payload), so both sides are talking about the image as analysed, and the client
    /// scales the length by the ratio it downsampled by.
    pub async fn analyze_blur(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
    ) -> Result<BlurAnalysis, ApiError> {
        let prompt = "Judge whether this photograph is blurred, and if so how.\n\
            Return a JSON object with these exact keys:\n\
            \"blurred\" (boolean — true only if blur is visible at normal viewing size),\n\
            \"kind\" (\"motion\" if the image is smeared along a direction, \"focus\" if it is \
            softly out of focus with no direction, \"none\" if sharp),\n\
            \"severity\" (number 0.0–1.0, where 0.1 is barely noticeable and 0.9 is unrecognisable),\n\
            \"angleDegrees\" (number 0–180 — the axis the image is smeared along, measured \
            anticlockwise from horizontal; 0 for anything that is not motion blur),\n\
            \"lengthPx\" (number — how far the image smeared, in pixels of the image as given to \
            you; 0 for anything that is not motion blur),\n\
            \"recoverable\" (boolean — whether sharpening along that axis would plausibly help, \
            false when the detail is destroyed rather than displaced),\n\
            \"advice\" (one or two sentences telling the photographer what happened and what to \
            change next time — name camera shake or subject movement if you can tell them apart).\n\
            Output only valid JSON with no markdown fences.";

        let raw = self
            .ask(credentials, image_base64, media_type, prompt, 512)
            .await?;

        let parsed = serde_json::from_str::<BlurAnalysis>(strip_code_fences(&raw))
            .map_err(|_| ApiError::internal("Failed to parse blur analysis result"))?;
        Ok(sanitize_blur_analysis(parsed))
    }
}

/// Providers wrap JSON in a markdown fence often enough that every caller here has to undo it,
/// however plainly the prompt asks them not to.
fn strip_code_fences(raw: &str) -> &str {
    raw.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn analysis(kind: &str, severity: f32, angle: f32, length: f32) -> BlurAnalysis {
        BlurAnalysis {
            blurred: true,
            kind: kind.to_string(),
            severity,
            angle_degrees: angle,
            length_px: length,
            recoverable: true,
            advice: "Camera shake.".to_string(),
        }
    }

    // MARK: - Ranges

    #[test]
    fn a_severity_outside_the_scale_is_brought_back_onto_it() {
        assert_eq!(
            sanitize_blur_analysis(analysis("motion", 5.0, 0.0, 8.0)).severity,
            1.0
        );
        assert_eq!(
            sanitize_blur_analysis(analysis("motion", -2.0, 0.0, 8.0)).severity,
            0.0
        );
    }

    /// A kernel as long as the image is not a correction, it is a smear of its own.
    #[test]
    fn an_absurd_smear_length_is_capped() {
        let a = sanitize_blur_analysis(analysis("motion", 0.5, 30.0, 4000.0));
        assert_eq!(a.length_px, MAX_CORRECTABLE_LENGTH_PX);
    }

    /// NaN must never reach the convolution: it blanks every pixel it touches, silently.
    #[test]
    fn a_non_finite_number_becomes_the_bottom_of_its_range() {
        let a = sanitize_blur_analysis(analysis("motion", f32::NAN, f32::INFINITY, f32::NAN));
        assert_eq!(a.severity, 0.0);
        assert_eq!(a.angle_degrees, 0.0);
        assert_eq!(a.length_px, 0.0);
    }

    // MARK: - The angle is an axis

    #[test]
    fn an_angle_folds_into_a_half_turn() {
        // 200° and 20° describe the same smear; so do -10° and 170°.
        assert_eq!(
            sanitize_blur_analysis(analysis("motion", 0.5, 200.0, 8.0)).angle_degrees,
            20.0
        );
        assert_eq!(
            sanitize_blur_analysis(analysis("motion", 0.5, -10.0, 8.0)).angle_degrees,
            170.0
        );
        assert_eq!(
            sanitize_blur_analysis(analysis("motion", 0.5, 540.0, 8.0)).angle_degrees,
            0.0
        );
    }

    #[test]
    fn an_angle_already_in_range_is_left_alone() {
        assert_eq!(
            sanitize_blur_analysis(analysis("motion", 0.5, 17.0, 8.0)).angle_degrees,
            17.0
        );
    }

    // MARK: - What is worth offering a correction for

    #[test]
    fn focus_blur_is_never_recoverable_because_it_has_no_axis() {
        assert!(!sanitize_blur_analysis(analysis("focus", 0.5, 0.0, 0.0)).recoverable);
    }

    /// A zero-length kernel is the identity, so a slider over it could not change a pixel.
    #[test]
    fn motion_blur_with_no_smear_is_not_recoverable() {
        assert!(!sanitize_blur_analysis(analysis("motion", 0.5, 30.0, 0.0)).recoverable);
    }

    #[test]
    fn a_sharp_photo_is_not_recoverable_whatever_the_model_claims() {
        let mut a = analysis("none", 0.0, 0.0, 0.0);
        a.blurred = false;
        a.recoverable = true;
        assert!(!sanitize_blur_analysis(a).recoverable);
    }

    #[test]
    fn real_motion_blur_stays_recoverable() {
        let a = sanitize_blur_analysis(analysis("motion", 0.6, 17.0, 9.0));
        assert!(a.recoverable);
        assert_eq!((a.angle_degrees, a.length_px), (17.0, 9.0));
    }

    #[test]
    fn an_unrecognised_kind_reads_as_none() {
        assert_eq!(
            sanitize_blur_analysis(analysis("wobbly", 0.5, 0.0, 4.0)).kind,
            "none"
        );
    }

    // MARK: - Parsing

    #[test]
    fn a_fenced_response_is_unwrapped() {
        assert_eq!(strip_code_fences("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_code_fences("```\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_code_fences("  {\"a\":1}  "), "{\"a\":1}");
    }
}
