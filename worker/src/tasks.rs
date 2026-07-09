//! Task handlers.
//!
//! Each job type is handled by a [`TaskHandler`]. Handlers declare the job type
//! they run via [`TaskHandler::job_type`], and `main` builds a map from that job
//! type to the handler so the poll loop can dispatch each claimed task.

use std::io::Read;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use diesel::prelude::*;

use crate::crypto::{DecryptingStream, TempFileGuard};
use crate::face::{DetectedFace, FaceScanner};
use crate::schema::faces;
use crate::{DbPool, Task};

/// Row inserted into the `faces` table for each detected face.
#[derive(Insertable)]
#[diesel(table_name = crate::schema::faces)]
struct NewFace<'a> {
    id: &'a str,
    photo_id: &'a str,
    bounding_box: &'a str,
    created_at: chrono::NaiveDateTime,
}

/// Handles one kind of job. Implementors are registered by job type in `main`.
pub trait TaskHandler {
    /// The `job_type` value this handler is responsible for.
    fn job_type(&self) -> &'static str;

    /// Runs the task. Returns `Err(message)` on failure.
    fn process(&mut self, task: &Task) -> Result<(), String>;
}

/// Scans an image for faces and stores them in the `faces` table. The image is
/// either a plaintext file referenced by path, or an encrypted attachment
/// referenced in the payload.
pub struct FaceScanHandler {
    scanner: FaceScanner,
    pool: DbPool,
}

impl FaceScanHandler {
    /// The job type this handler is registered under.
    pub const JOB_TYPE: &'static str = "face_scan";

    pub fn new(scanner: FaceScanner, pool: DbPool) -> Self {
        Self { scanner, pool }
    }

    /// Inserts a row into `faces` for each detected face, keyed by `photo_id`.
    fn store_faces(&self, photo_id: &str, faces: &[DetectedFace]) -> Result<(), String> {
        let mut conn = self
            .pool
            .get()
            .map_err(|e| format!("could not get db connection: {e}"))?;
        let now = chrono::Utc::now().naive_utc();

        for face in faces {
            let bounding_box = serde_json::json!({
                "x": face.x as f32,
                "y": face.y as f32,
                "width": face.width as f32,
                "height": face.height as f32,
                "confidence": face.score as f32,
                "imageWidth": face.image_width,
                "imageHeight": face.image_height,
            })
            .to_string();

            let id = uuid::Uuid::new_v4().to_string();
            let row = NewFace {
                id: &id,
                photo_id,
                bounding_box: &bounding_box,
                created_at: now,
            };
            diesel::insert_into(faces::table)
                .values(&row)
                .execute(&mut conn)
                .map_err(|e| format!("failed to insert face: {e}"))?;
        }
        Ok(())
    }
}

impl TaskHandler for FaceScanHandler {
    fn job_type(&self) -> &'static str {
        Self::JOB_TYPE
    }

    fn process(&mut self, task: &Task) -> Result<(), String> {
        let faces = if let Some(enc) = parse_encrypted_file(&task.payload) {
            // Guarantee the temp file is removed once we've read it, no matter
            // how we exit below.
            let _guard = TempFileGuard::new(&enc.path);

            let mut stream = DecryptingStream::open(&enc.path, &enc.key)?;
            let mut bytes = Vec::new();
            stream
                .read_to_end(&mut bytes)
                .map_err(|e| format!("failed to read decrypted stream: {e}"))?;
            self.scanner.scan_bytes(&bytes)?
        } else {
            let image_path = payload_path(&task.payload);
            self.scanner.scan(&image_path)?
        };

        // Persist the detected faces against the photo named in the payload.
        match photo_id(&task.payload) {
            Some(photo_id) => {
                self.store_faces(&photo_id, &faces)?;
                tracing::info!(
                    job = %task.id,
                    photo = %photo_id,
                    faces = faces.len(),
                    "stored detected faces"
                );
            }
            None => {
                tracing::warn!(
                    job = %task.id,
                    faces = faces.len(),
                    "payload has no photoId; detected faces not stored"
                );
            }
        }
        Ok(())
    }
}

/// An encrypted attachment referenced by a job payload.
struct EncryptedFile {
    path: String,
    key: [u8; 32],
}

/// Pulls an `_encrypted_file` reference (path + one-time key) out of a payload,
/// if present and well-formed.
fn parse_encrypted_file(payload: &str) -> Option<EncryptedFile> {
    let value: serde_json::Value = serde_json::from_str(payload).ok()?;
    let enc = value.get("_encrypted_file")?;
    let path = enc.get("path")?.as_str()?.to_string();
    let key_bytes = BASE64.decode(enc.get("key")?.as_str()?).ok()?;
    let key: [u8; 32] = key_bytes.try_into().ok()?;
    Some(EncryptedFile { path, key })
}

/// Extracts the image path from a job payload. The path may be given as a `path`
/// field on a JSON object, a bare JSON string, or a bare (non-JSON) string.
fn payload_path(payload: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
        if let Some(path) = value.get("path").and_then(|v| v.as_str()) {
            return path.to_string();
        }
        if let Some(s) = value.as_str() {
            return s.to_string();
        }
    }
    payload.trim().to_string()
}

/// Pulls the `photoId` the detected faces belong to out of a JSON payload.
fn photo_id(payload: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(payload).ok()?;
    Some(value.get("photoId")?.as_str()?.to_string())
}
