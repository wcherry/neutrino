use crate::photos::learning::{
    dto::{ReprocessingResponse, ThresholdsResponse},
    repository::LearningRepository,
};
use crate::photos::persons::repository::PersonsRepository;
use crate::photos::suggestions::repository::SuggestionsRepository;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

/// Default cosine-distance thresholds (mirrored from persons/service.rs).
const DEFAULT_AUTO_TAG: f32 = 0.30;
const DEFAULT_SUGGEST: f32 = 0.55;

/// Thresholds are nudged by this amount per adjustment.
const ADJUST_STEP: f32 = 0.05;
/// Minimum signal count required before adjusting thresholds.
const MIN_SIGNALS_TO_ADJUST: usize = 5;

pub struct LearningService {
    pub repo: Arc<LearningRepository>,
    pub persons_repo: Arc<PersonsRepository>,
    pub suggestions_repo: Arc<SuggestionsRepository>,
}

impl LearningService {
    pub fn new(
        repo: Arc<LearningRepository>,
        persons_repo: Arc<PersonsRepository>,
        suggestions_repo: Arc<SuggestionsRepository>,
    ) -> Self {
        LearningService {
            repo,
            persons_repo,
            suggestions_repo,
        }
    }

    /// Return the current recognition thresholds for a user (defaults if none stored).
    pub fn get_thresholds(&self, user_id: &str) -> Result<ThresholdsResponse, ApiError> {
        match self.repo.get_thresholds(user_id)? {
            Some(t) => Ok(ThresholdsResponse {
                auto_tag_threshold: t.auto_tag_threshold,
                suggest_threshold: t.suggest_threshold,
                total_accepts: t.total_accepts,
                total_rejects: t.total_rejects,
                updated_at: Some(t.updated_at.and_utc().to_rfc3339()),
            }),
            None => Ok(ThresholdsResponse {
                auto_tag_threshold: DEFAULT_AUTO_TAG,
                suggest_threshold: DEFAULT_SUGGEST,
                total_accepts: 0,
                total_rejects: 0,
                updated_at: None,
            }),
        }
    }

    /// Process unprocessed feedback signals for a user:
    /// 1. Adjust recognition thresholds based on the accept/reject ratio.
    /// 2. Re-evaluate unassigned faces against named persons using updated thresholds.
    pub fn process_pending_for_user(
        &self,
        user_id: &str,
    ) -> Result<ReprocessingResponse, ApiError> {
        let now = chrono::Utc::now().naive_utc();

        // ── 1. Load unprocessed signals ───────────────────────────────────────
        let signals = self.repo.list_unprocessed_signals_for_user(user_id)?;
        if signals.is_empty() {
            return Ok(ReprocessingResponse {
                suggestions_created: 0,
                faces_auto_tagged: 0,
            });
        }

        // ── 2. Adjust thresholds ──────────────────────────────────────────────
        let new_accepts = signals.iter().filter(|s| s.action == "accepted").count();
        let new_rejects = signals.iter().filter(|s| s.action == "rejected").count();

        // Load existing cumulative counts.
        let existing = self.repo.get_thresholds(user_id)?;
        let (mut auto_thresh, mut suggest_thresh, cum_accepts, cum_rejects) = match &existing {
            Some(t) => (
                t.auto_tag_threshold,
                t.suggest_threshold,
                t.total_accepts,
                t.total_rejects,
            ),
            None => (DEFAULT_AUTO_TAG, DEFAULT_SUGGEST, 0, 0),
        };
        let total_accepts = cum_accepts + new_accepts as i32;
        let total_rejects = cum_rejects + new_rejects as i32;

        // Only adjust thresholds if we have enough new signals to make a meaningful decision.
        if signals.len() >= MIN_SIGNALS_TO_ADJUST {
            let acceptance_rate = new_accepts as f32 / signals.len() as f32;
            if acceptance_rate < 0.30 {
                // Too many rejects — system is too aggressive, loosen thresholds.
                auto_thresh = (auto_thresh + ADJUST_STEP).min(0.50);
                suggest_thresh = (suggest_thresh + ADJUST_STEP).min(0.75);
                tracing::info!(
                    user_id,
                    acceptance_rate,
                    auto_thresh,
                    suggest_thresh,
                    "Thresholds loosened (too many rejections)"
                );
            } else if acceptance_rate > 0.70 {
                // Mostly accepts — system is well calibrated, can be slightly stricter.
                auto_thresh = (auto_thresh - ADJUST_STEP).max(0.15);
                suggest_thresh = (suggest_thresh - ADJUST_STEP).max(0.30);
                tracing::info!(
                    user_id,
                    acceptance_rate,
                    auto_thresh,
                    suggest_thresh,
                    "Thresholds tightened (high acceptance rate)"
                );
            }
        }

        self.repo.upsert_thresholds(
            user_id,
            auto_thresh,
            suggest_thresh,
            total_accepts,
            total_rejects,
            now,
        )?;

        // ── 3. Mark signals processed ─────────────────────────────────────────
        self.repo.mark_signals_processed(user_id)?;

        // ── 4. Re-evaluate unassigned faces ───────────────────────────────────
        let result = self.reevaluate_unassigned_faces(user_id, auto_thresh, suggest_thresh, now)?;

        tracing::info!(
            user_id,
            new_signals = signals.len(),
            suggestions_created = result.suggestions_created,
            faces_auto_tagged = result.faces_auto_tagged,
            "Learning reprocessing complete"
        );

        Ok(result)
    }

    /// Process pending signals for ALL users that have unprocessed feedback.
    pub fn process_all_pending(&self) -> Result<(), ApiError> {
        let user_ids = self.repo.list_users_with_pending_signals()?;
        for user_id in &user_ids {
            if let Err(e) = self.process_pending_for_user(user_id) {
                tracing::error!(user_id, "Learning reprocessing error: {:?}", e);
            }
        }
        Ok(())
    }

    /// Find unassigned faces (embedding present, no person_id) for a user and attempt
    /// to match them against known named persons using the given thresholds.
    fn reevaluate_unassigned_faces(
        &self,
        user_id: &str,
        auto_thresh: f32,
        suggest_thresh: f32,
        now: chrono::NaiveDateTime,
    ) -> Result<ReprocessingResponse, ApiError> {
        let unassigned = self
            .persons_repo
            .list_unassigned_faces_with_embeddings(user_id)?;
        if unassigned.is_empty() {
            return Ok(ReprocessingResponse {
                suggestions_created: 0,
                faces_auto_tagged: 0,
            });
        }

        // Build average embedding per named person.
        let named_persons = self.persons_repo.list_named_persons_for_user(user_id)?;
        if named_persons.is_empty() {
            return Ok(ReprocessingResponse {
                suggestions_created: 0,
                faces_auto_tagged: 0,
            });
        }

        let person_avg_embeddings: Vec<(String, Vec<f32>)> = named_persons
            .iter()
            .filter_map(|p| {
                let face_records = self.persons_repo.list_faces_for_person(&p.id).ok()?;
                let embs: Vec<Vec<f32>> = face_records
                    .iter()
                    .filter_map(|f| serde_json::from_str::<Vec<f32>>(f.embedding.as_deref()?).ok())
                    .collect();
                if embs.is_empty() {
                    return None;
                }
                let dim = embs[0].len();
                let avg: Vec<f32> = (0..dim)
                    .map(|i| embs.iter().map(|e| e[i]).sum::<f32>() / embs.len() as f32)
                    .collect();
                Some((p.id.clone(), avg))
            })
            .collect();

        if person_avg_embeddings.is_empty() {
            return Ok(ReprocessingResponse {
                suggestions_created: 0,
                faces_auto_tagged: 0,
            });
        }

        let mut suggestions_created = 0usize;
        let mut faces_auto_tagged = 0usize;

        for face in &unassigned {
            let face_emb: Vec<f32> =
                match serde_json::from_str(face.embedding.as_deref().unwrap_or("")) {
                    Ok(e) => e,
                    Err(_) => continue,
                };

            // Find closest named person.
            let best: Option<(&str, f32)> = person_avg_embeddings
                .iter()
                .map(|(pid, avg)| {
                    let dot: f32 = face_emb.iter().zip(avg.iter()).map(|(a, b)| a * b).sum();
                    (pid.as_str(), 1.0 - dot.clamp(-1.0, 1.0))
                })
                .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

            if let Some((person_id, dist)) = best {
                if dist <= auto_thresh {
                    // High confidence: auto-assign.
                    if let Ok(photo_user) = self.persons_repo.get_photo_user_id_for_face(&face.id) {
                        if photo_user == user_id {
                            let _ = self
                                .persons_repo
                                .assign_face_to_person(&face.id, person_id, user_id, now);
                            faces_auto_tagged += 1;
                        }
                    }
                } else if dist <= suggest_thresh {
                    // Medium confidence: create suggestion.
                    let id = Uuid::new_v4().to_string();
                    let confidence = 1.0 - dist;
                    let _ = self
                        .suggestions_repo
                        .insert_if_not_rejected(&id, &face.id, person_id, confidence, now);
                    suggestions_created += 1;
                }
            }
        }

        Ok(ReprocessingResponse {
            suggestions_created,
            faces_auto_tagged,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── threshold constants ───────────────────────────────────────────────────

    #[test]
    fn default_thresholds_are_in_valid_range() {
        assert!(DEFAULT_AUTO_TAG > 0.0 && DEFAULT_AUTO_TAG < 1.0);
        assert!(DEFAULT_SUGGEST > 0.0 && DEFAULT_SUGGEST < 1.0);
    }

    #[test]
    fn auto_tag_threshold_is_stricter_than_suggest_threshold() {
        // auto_tag uses a smaller distance (higher confidence) than suggest
        assert!(DEFAULT_AUTO_TAG < DEFAULT_SUGGEST);
    }

    #[test]
    fn adjust_step_is_positive_and_small() {
        assert!(ADJUST_STEP > 0.0);
        assert!(
            ADJUST_STEP < 0.20,
            "Step should be small to avoid wild swings"
        );
    }

    #[test]
    fn min_signals_threshold_is_positive() {
        assert!(MIN_SIGNALS_TO_ADJUST > 0);
    }

    // ── threshold adjustment logic ────────────────────────────────────────────

    #[test]
    fn loosened_auto_thresh_does_not_exceed_cap() {
        let mut thresh = 0.48f32;
        for _ in 0..10 {
            thresh = (thresh + ADJUST_STEP).min(0.50);
        }
        assert!(thresh <= 0.50);
    }

    #[test]
    fn tightened_suggest_thresh_does_not_go_below_floor() {
        let mut thresh = 0.32f32;
        for _ in 0..10 {
            thresh = (thresh - ADJUST_STEP).max(0.30);
        }
        assert!(thresh >= 0.30);
    }
}
