use crate::photos::persons::{
    dto::{
        ClusterEntry, FaceEmbeddingEntry, FaceEmbeddingsResponse, ListPersonsResponse,
        MergePersonsRequest, PersonFaceThumbnail, PersonRelationship, PersonRelationshipsResponse,
        PersonResponse, PersonTimelineResponse, ReassignFaceRequest, RenamePersonRequest,
        SaveClustersRequest, TimelineGroup, UsersWithFacesResponse,
    },
    repository::PersonsRepository,
};
use crate::photos::suggestions::repository::SuggestionsRepository;
use chrono::Datelike;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

/// Cosine distance below which a face is auto-tagged to a named person.
const AUTO_TAG_THRESHOLD: f32 = 0.30;
/// Cosine distance below which a suggestion is created (but not auto-tagged).
const SUGGEST_THRESHOLD: f32 = 0.55;

pub struct PersonsService {
    repo: Arc<PersonsRepository>,
    suggestions_repo: Arc<SuggestionsRepository>,
}

impl PersonsService {
    pub fn new(repo: Arc<PersonsRepository>, suggestions_repo: Arc<SuggestionsRepository>) -> Self {
        PersonsService { repo, suggestions_repo }
    }

    fn person_response_from_record(
        &self,
        p: crate::photos::persons::model::PersonRecord,
        faces: Vec<PersonFaceThumbnail>,
    ) -> PersonResponse {
        PersonResponse {
            id: p.id,
            name: p.name,
            cover_face_id: p.cover_face_id,
            cover_thumbnail: p.cover_thumbnail,
            cover_thumbnail_mime_type: p.cover_thumbnail_mime_type,
            face_count: p.face_count,
            faces,
            created_at: p.created_at.and_utc().to_rfc3339(),
            updated_at: p.updated_at.and_utc().to_rfc3339(),
        }
    }

    pub fn list_persons(&self, user_id: &str) -> Result<ListPersonsResponse, ApiError> {
        let records = self.repo.list_persons_for_user(user_id)?;
        let total = records.len();

        let person_ids: Vec<String> = records.iter().map(|p| p.id.clone()).collect();
        let all_faces = if person_ids.is_empty() {
            vec![]
        } else {
            self.repo.list_faces_for_persons(&person_ids)?
        };

        use std::collections::HashMap;
        let mut faces_by_person: HashMap<String, Vec<PersonFaceThumbnail>> = HashMap::new();
        for face in all_faces {
            if let Some(pid) = &face.person_id {
                faces_by_person.entry(pid.clone()).or_default().push(PersonFaceThumbnail {
                    id: face.id,
                    thumbnail: face.thumbnail,
                    thumbnail_mime_type: face.thumbnail_mime_type,
                });
            }
        }

        let persons = records
            .into_iter()
            .map(|p| {
                let faces = faces_by_person.remove(&p.id).unwrap_or_default();
                self.person_response_from_record(p, faces)
            })
            .collect();
        Ok(ListPersonsResponse { persons, total })
    }

    /// Rename a person; checks that the caller owns the person.
    pub fn rename_person(
        &self,
        person_id: &str,
        user_id: &str,
        req: RenamePersonRequest,
    ) -> Result<PersonResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::new(400, "INVALID_NAME", "Name must not be empty"));
        }
        let now = chrono::Utc::now().naive_utc();
        let record = self.repo.update_person_name(person_id, user_id, &name, now)?;
        let faces = self.repo.list_faces_for_person(person_id)?.into_iter().map(|f| PersonFaceThumbnail {
            id: f.id,
            thumbnail: f.thumbnail,
            thumbnail_mime_type: f.thumbnail_mime_type,
        }).collect();
        Ok(self.person_response_from_record(record, faces))
    }

    /// Merge source person into target person (target absorbs all faces).
    pub fn merge_persons(
        &self,
        target_id: &str,
        user_id: &str,
        req: MergePersonsRequest,
    ) -> Result<PersonResponse, ApiError> {
        if req.source_id == target_id {
            return Err(ApiError::new(400, "INVALID_MERGE", "Cannot merge a person with themselves"));
        }
        let now = chrono::Utc::now().naive_utc();
        let record = self.repo.merge_persons(&req.source_id, target_id, user_id, now)?;
        let faces = self.repo.list_faces_for_person(target_id)?.into_iter().map(|f| PersonFaceThumbnail {
            id: f.id,
            thumbnail: f.thumbnail,
            thumbnail_mime_type: f.thumbnail_mime_type,
        }).collect();
        Ok(self.person_response_from_record(record, faces))
    }

    /// Move a face from one person to another.
    pub fn reassign_face(
        &self,
        person_id: &str,
        face_id: &str,
        user_id: &str,
        req: ReassignFaceRequest,
    ) -> Result<(), ApiError> {
        if req.target_person_id == person_id {
            return Ok(());
        }
        let now = chrono::Utc::now().naive_utc();
        self.repo.reassign_face(face_id, person_id, &req.target_person_id, user_id, now)
    }

    /// Remove a face from a person (unassigns it). Deletes the person if now empty.
    pub fn remove_face_from_person(
        &self,
        person_id: &str,
        face_id: &str,
        user_id: &str,
    ) -> Result<(), ApiError> {
        let now = chrono::Utc::now().naive_utc();
        self.repo.remove_face_from_person(face_id, person_id, user_id, now)
    }

    /// Returns all user_ids that have at least one face embedding (called by the worker to trigger cluster-all).
    pub fn list_users_with_face_embeddings(&self) -> Result<UsersWithFacesResponse, ApiError> {
        let user_ids = self.repo.list_users_with_face_embeddings()?;
        Ok(UsersWithFacesResponse { user_ids })
    }

    /// Returns all face embeddings for a user (called by the worker before clustering).
    pub fn get_face_embeddings(&self, user_id: &str) -> Result<FaceEmbeddingsResponse, ApiError> {
        let face_records = self.repo.list_face_embeddings_for_user(user_id)?;
        let faces = face_records
            .into_iter()
            .filter_map(|f| {
                let embedding_json = f.embedding?;
                let embedding: Vec<f32> = serde_json::from_str(&embedding_json).ok()?;
                Some(FaceEmbeddingEntry {
                    face_id: f.id,
                    photo_id: f.photo_id,
                    embedding,
                    thumbnail: f.thumbnail,
                    thumbnail_mime_type: f.thumbnail_mime_type,
                })
            })
            .collect();
        Ok(FaceEmbeddingsResponse { faces })
    }

    /// Save clustering results from the worker.
    ///
    /// Enhanced behaviour:
    /// 1. Named persons whose faces still appear in a cluster keep their ID and name (identity preserved).
    /// 2. Unmatched new clusters are compared against named persons by embedding similarity:
    ///    - ≤ AUTO_TAG_THRESHOLD: auto-assign the name to the new cluster.
    ///    - ≤ SUGGEST_THRESHOLD: create a face_suggestion for user review.
    pub fn save_clusters(&self, req: SaveClustersRequest) -> Result<(), ApiError> {
        let now = chrono::Utc::now().naive_utc();

        // ── 1. Load existing named persons + their face_ids ──────────────────
        let named_persons = self.repo.list_named_persons_for_user(&req.user_id)?;

        // face_id → (person_id, name)
        let mut face_to_named: std::collections::HashMap<String, (String, String)> =
            std::collections::HashMap::new();
        for person in &named_persons {
            if let Some(name) = &person.name {
                let face_records = self.repo.list_faces_for_person(&person.id)?;
                for face in face_records {
                    face_to_named.insert(face.id, (person.id.clone(), name.clone()));
                }
            }
        }

        // ── 2. Load all embeddings for embedding-based matching ──────────────
        // face_id → embedding
        let all_embeddings: std::collections::HashMap<String, Vec<f32>> = {
            self.repo
                .list_face_embeddings_for_user(&req.user_id)?
                .into_iter()
                .filter_map(|f| {
                    let emb: Vec<f32> = serde_json::from_str(f.embedding.as_deref()?).ok()?;
                    Some((f.id, emb))
                })
                .collect()
        };

        // Compute average embedding per named person.
        let person_avg_embeddings: std::collections::HashMap<String, Vec<f32>> = named_persons
            .iter()
            .filter_map(|p| {
                let face_records = self.repo.list_faces_for_person(&p.id).ok()?;
                let embs: Vec<Vec<f32>> = face_records
                    .iter()
                    .filter_map(|f| {
                        let e: Vec<f32> = serde_json::from_str(f.embedding.as_deref()?).ok()?;
                        Some(e)
                    })
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

        // ── 3. Resolve each cluster: assign person_id + optional name ────────
        type ClusterRow = (String, Vec<String>, Option<String>, Option<String>, Option<String>, Option<String>);
        let mut resolved: Vec<ClusterRow> = Vec::with_capacity(req.clusters.len());
        // person_id of named persons that have been "claimed" by a cluster (so each named
        // person is assigned to at most one cluster).
        let mut claimed_named_persons: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        // Pending suggestions: (face_id, person_id, confidence)
        let mut pending_suggestions: Vec<(String, String, f32)> = Vec::new();

        for cluster in req.clusters {
            // Count face overlap with each named person.
            let mut votes: std::collections::HashMap<String, (usize, String, String)> =
                std::collections::HashMap::new(); // person_id → (count, person_id, name)
            for fid in &cluster.face_ids {
                if let Some((pid, name)) = face_to_named.get(fid) {
                    let e = votes.entry(pid.clone()).or_insert((0, pid.clone(), name.clone()));
                    e.0 += 1;
                }
            }

            // Best named-person match by face overlap (unclaimed).
            let best_by_faces = votes
                .into_values()
                .filter(|(_, pid, _)| !claimed_named_persons.contains(pid))
                .max_by_key(|(count, _, _)| *count);

            if let Some((_, pid, name)) = best_by_faces {
                // Reuse the existing named person's ID so it survives re-clustering.
                claimed_named_persons.insert(pid.clone());
                resolved.push((
                    pid,
                    cluster.face_ids,
                    Some(cluster.cover_face_id),
                    cluster.cover_thumbnail,
                    cluster.cover_thumbnail_mime_type,
                    Some(name),
                ));
                continue;
            }

            // No face overlap with any named person — try embedding similarity.
            let cluster_embs: Vec<&Vec<f32>> = cluster
                .face_ids
                .iter()
                .filter_map(|fid| all_embeddings.get(fid))
                .collect();

            let best_emb_match: Option<(String, f32)> = if !cluster_embs.is_empty()
                && !person_avg_embeddings.is_empty()
            {
                let dim = cluster_embs[0].len();
                let cluster_avg: Vec<f32> = (0..dim)
                    .map(|i| cluster_embs.iter().map(|e| e[i]).sum::<f32>() / cluster_embs.len() as f32)
                    .collect();

                person_avg_embeddings
                    .iter()
                    .filter(|(pid, _)| !claimed_named_persons.contains(*pid))
                    .map(|(pid, avg)| {
                        let dot: f32 = cluster_avg.iter().zip(avg.iter()).map(|(a, b)| a * b).sum();
                        (pid.clone(), 1.0 - dot.clamp(-1.0, 1.0))
                    })
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            } else {
                None
            };

            let (person_id, name) = match best_emb_match {
                Some((pid, dist)) if dist <= AUTO_TAG_THRESHOLD => {
                    if let Some(p) = named_persons.iter().find(|p| p.id == pid) {
                        if !claimed_named_persons.contains(&pid) {
                            claimed_named_persons.insert(pid.clone());
                            (pid, p.name.clone())
                        } else {
                            (Uuid::new_v4().to_string(), None)
                        }
                    } else {
                        (Uuid::new_v4().to_string(), None)
                    }
                }
                Some((pid, dist)) if dist <= SUGGEST_THRESHOLD => {
                    // Medium confidence: create suggestion using cover face.
                    pending_suggestions.push((
                        cluster.cover_face_id.clone(),
                        pid.clone(),
                        1.0 - dist,
                    ));
                    (Uuid::new_v4().to_string(), None)
                }
                _ => (Uuid::new_v4().to_string(), None),
            };

            resolved.push((
                person_id,
                cluster.face_ids,
                Some(cluster.cover_face_id),
                cluster.cover_thumbnail,
                cluster.cover_thumbnail_mime_type,
                name,
            ));
        }

        // ── 4. Apply clusters ────────────────────────────────────────────────
        self.repo.apply_clusters(&req.user_id, &resolved, now)?;

        // ── 5. Persist suggestions ────────────────────────────────────────────
        for (face_id, person_id, confidence) in pending_suggestions {
            let id = Uuid::new_v4().to_string();
            let _ = self.suggestions_repo.insert_if_not_rejected(
                &id, &face_id, &person_id, confidence, now,
            );
        }

        Ok(())
    }

    /// Return a person record, verifying it belongs to the user.
    pub fn get_person_for_user(
        &self,
        person_id: &str,
        user_id: &str,
    ) -> Result<PersonResponse, ApiError> {
        let person = self.repo.get_person(person_id)?;
        if person.user_id != user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let faces = self
            .repo
            .list_faces_for_person(person_id)?
            .into_iter()
            .map(|f| PersonFaceThumbnail {
                id: f.id,
                thumbnail: f.thumbnail,
                thumbnail_mime_type: f.thumbnail_mime_type,
            })
            .collect();
        Ok(self.person_response_from_record(person, faces))
    }

    /// Returns distinct photo IDs for photos that contain this person's faces.
    pub fn get_photo_ids_for_person(
        &self,
        person_id: &str,
        user_id: &str,
    ) -> Result<Vec<String>, ApiError> {
        let person = self.repo.get_person(person_id)?;
        if person.user_id != user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let face_records = self.repo.list_faces_for_person(person_id)?;
        let mut photo_ids: Vec<String> =
            face_records.into_iter().map(|f| f.photo_id).collect();
        photo_ids.sort();
        photo_ids.dedup();
        Ok(photo_ids)
    }

    /// Build a chronological timeline for a person, grouping photos by year-month.
    /// The caller must supply a resolved `photos` list (already fetched from Drive).
    pub fn build_timeline(
        &self,
        person_id: &str,
        user_id: &str,
        resolved_photos: Vec<crate::photos::photos::dto::PhotoResponse>,
    ) -> Result<PersonTimelineResponse, ApiError> {
        let person = self.repo.get_person(person_id)?;
        if person.user_id != user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }

        // Get dates for each photo from the DB (capture_date or created_at).
        let photo_dates = self
            .repo
            .list_photo_ids_for_person_with_dates(user_id, person_id)?;
        let date_map: std::collections::HashMap<String, chrono::NaiveDateTime> =
            photo_dates.into_iter().collect();

        // Sort resolved photos by their date.
        let mut sorted = resolved_photos;
        sorted.sort_by_key(|p| {
            date_map
                .get(&p.id)
                .copied()
                .unwrap_or_else(|| chrono::NaiveDateTime::MIN)
        });

        // Group by year-month.
        use std::collections::BTreeMap;
        let mut groups: BTreeMap<String, Vec<crate::photos::photos::dto::PhotoResponse>> = BTreeMap::new();
        for photo in sorted {
            let date = date_map
                .get(&photo.id)
                .copied()
                .unwrap_or_else(|| chrono::NaiveDateTime::MIN);
            let key = format!("{}-{:02}", date.format("%Y"), date.month());
            groups.entry(key).or_default().push(photo);
        }

        let timeline_groups: Vec<TimelineGroup> = groups
            .into_iter()
            .map(|(month, photos)| {
                // Build human-readable label from the month key "YYYY-MM".
                let label = if let Ok(d) = chrono::NaiveDate::parse_from_str(
                    &format!("{}-01", month),
                    "%Y-%m-%d",
                ) {
                    format!("{} {}", month_name(d.month()), d.year())
                } else {
                    month.clone()
                };
                TimelineGroup { label, month, photos }
            })
            .collect();

        Ok(PersonTimelineResponse { groups: timeline_groups })
    }

    /// Compute co-occurrence relationships: persons who frequently appear together.
    pub fn get_relationships(
        &self,
        user_id: &str,
    ) -> Result<PersonRelationshipsResponse, ApiError> {
        let pairs = self.repo.list_person_photo_pairs_for_user(user_id)?;

        // Build photo_id → Vec<person_id> map.
        let mut photo_persons: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for (photo_id, person_id) in pairs {
            photo_persons.entry(photo_id).or_default().push(person_id);
        }

        // Count co-occurrences for each ordered pair.
        let mut cooccurrence: std::collections::HashMap<(String, String), usize> =
            std::collections::HashMap::new();
        for persons in photo_persons.values() {
            let mut sorted = persons.clone();
            sorted.sort();
            sorted.dedup();
            for i in 0..sorted.len() {
                for j in (i + 1)..sorted.len() {
                    let key = (sorted[i].clone(), sorted[j].clone());
                    *cooccurrence.entry(key).or_insert(0) += 1;
                }
            }
        }

        if cooccurrence.is_empty() {
            return Ok(PersonRelationshipsResponse { relationships: vec![] });
        }

        // Load all persons for this user to get names and thumbnails.
        let all_persons = self.repo.list_persons_for_user(user_id)?;
        let person_map: std::collections::HashMap<String, crate::photos::persons::model::PersonRecord> =
            all_persons.into_iter().map(|p| (p.id.clone(), p)).collect();

        let mut relationships: Vec<PersonRelationship> = cooccurrence
            .into_iter()
            .filter(|(_, count)| *count >= 1)
            .map(|((a_id, b_id), count)| {
                let a = person_map.get(&a_id);
                let b = person_map.get(&b_id);
                PersonRelationship {
                    person_a_id: a_id,
                    person_a_name: a.and_then(|p| p.name.clone()),
                    person_a_thumbnail: a.and_then(|p| p.cover_thumbnail.clone()),
                    person_a_thumbnail_mime_type: a.and_then(|p| p.cover_thumbnail_mime_type.clone()),
                    person_b_id: b_id,
                    person_b_name: b.and_then(|p| p.name.clone()),
                    person_b_thumbnail: b.and_then(|p| p.cover_thumbnail.clone()),
                    person_b_thumbnail_mime_type: b.and_then(|p| p.cover_thumbnail_mime_type.clone()),
                    photo_count: count,
                }
            })
            .collect();

        // Sort by frequency descending.
        relationships.sort_by(|a, b| b.photo_count.cmp(&a.photo_count));

        Ok(PersonRelationshipsResponse { relationships })
    }
}

fn month_name(month: u32) -> &'static str {
    match month {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => "Unknown",
    }
}
