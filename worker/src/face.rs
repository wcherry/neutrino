//! Facial recognition service.
//!
//! Wraps the `rustface` SeetaFace detector. The detection model is loaded once
//! at startup; each call scans a single image file and returns the faces found.

use rustface::{Detector, ImageData};

/// A face detected in an image, in pixel coordinates, along with the dimensions
/// of the source image the box refers to.
#[derive(Debug)]
pub struct DetectedFace {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub score: f64,
    pub image_width: u32,
    pub image_height: u32,
}

/// Owns the loaded detection model and scans images for faces.
pub struct FaceScanner {
    detector: Box<dyn Detector>,
}

impl FaceScanner {
    /// Loads the detection model from `model_path` (a SeetaFace `.bin` model).
    pub fn new(model_path: &str) -> Result<Self, String> {
        let mut detector = rustface::create_detector(model_path)
            .map_err(|e| format!("failed to load face model {model_path}: {e}"))?;
        detector.set_min_face_size(20);
        detector.set_score_thresh(2.0);
        detector.set_pyramid_scale_factor(0.8);
        detector.set_slide_window_step(4, 4);
        Ok(Self { detector })
    }

    /// Scans the image at `image_path` and returns the faces detected.
    pub fn scan(&mut self, image_path: &str) -> Result<Vec<DetectedFace>, String> {
        let gray = image::open(image_path)
            .map_err(|e| format!("cannot open image {image_path}: {e}"))?
            .to_luma8();
        self.detect(gray)
    }

    /// Scans raw (already-decoded) image bytes and returns the faces detected.
    pub fn scan_bytes(&mut self, bytes: &[u8]) -> Result<Vec<DetectedFace>, String> {
        let gray = image::load_from_memory(bytes)
            .map_err(|e| format!("cannot decode image bytes: {e}"))?
            .to_luma8();
        self.detect(gray)
    }

    fn detect(&mut self, gray: image::GrayImage) -> Result<Vec<DetectedFace>, String> {
        let (width, height) = gray.dimensions();
        let mut image_data = ImageData::new(gray.as_raw(), width, height);

        let faces = self
            .detector
            .detect(&mut image_data)
            .into_iter()
            .map(|f| {
                let b = f.bbox();
                DetectedFace {
                    x: b.x(),
                    y: b.y(),
                    width: b.width(),
                    height: b.height(),
                    score: f.score(),
                    image_width: width,
                    image_height: height,
                }
            })
            .collect();
        Ok(faces)
    }
}
