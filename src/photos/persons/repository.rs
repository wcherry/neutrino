use crate::photos::faces::model::FaceRecord;
use crate::photos::persons::model::{NewPersonRecord, PersonRecord};
use crate::schema::{faces, persons};
use crate::shared::ApiError;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct PersonsRepository {
    pool: DbPool,
}

impl PersonsRepository {
    pub fn new(pool: DbPool) -> Self {
        PersonsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn list_persons_for_user(&self, user_id: &str) -> Result<Vec<PersonRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        persons::table
            .filter(persons::user_id.eq(user_id))
            .order(persons::face_count.desc())
            .select(PersonRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list persons error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_person(&self, person_id: &str) -> Result<PersonRecord, ApiError> {
        let mut conn = self.get_conn()?;
        persons::table
            .filter(persons::id.eq(person_id))
            .select(PersonRecord::as_select())
            .first(&mut conn)
            .map_err(|_| ApiError::not_found("Person not found"))
    }

    /// Update the display name of a person; returns the updated record.
    pub fn update_person_name(
        &self,
        person_id: &str,
        user_id: &str,
        name: &str,
        now: NaiveDateTime,
    ) -> Result<PersonRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(
            persons::table
                .filter(persons::id.eq(person_id))
                .filter(persons::user_id.eq(user_id)),
        )
        .set((persons::name.eq(name), persons::updated_at.eq(now)))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update person name error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        self.get_person(person_id)
    }

    /// Move all faces from `source_id` into `target_id`, then delete the source person.
    /// The target's face_count is updated; the source is removed.
    pub fn merge_persons(
        &self,
        source_id: &str,
        target_id: &str,
        user_id: &str,
        now: NaiveDateTime,
    ) -> Result<PersonRecord, ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<PersonRecord, diesel::result::Error, _>(|conn| {
            // Verify both persons exist and belong to the user.
            let source = persons::table
                .filter(persons::id.eq(source_id))
                .filter(persons::user_id.eq(user_id))
                .select(PersonRecord::as_select())
                .first(conn)?;
            let target = persons::table
                .filter(persons::id.eq(target_id))
                .filter(persons::user_id.eq(user_id))
                .select(PersonRecord::as_select())
                .first(conn)?;

            // Reassign all faces from source → target.
            diesel::update(faces::table.filter(faces::person_id.eq(source_id)))
                .set(faces::person_id.eq(target_id))
                .execute(conn)?;

            // Update target face_count.
            let new_count = target.face_count + source.face_count;
            diesel::update(
                persons::table
                    .filter(persons::id.eq(target_id))
                    .filter(persons::user_id.eq(user_id)),
            )
            .set((
                persons::face_count.eq(new_count),
                persons::updated_at.eq(now),
            ))
            .execute(conn)?;

            // Delete the source person.
            diesel::delete(
                persons::table
                    .filter(persons::id.eq(source_id))
                    .filter(persons::user_id.eq(user_id)),
            )
            .execute(conn)?;

            // Return updated target.
            persons::table
                .filter(persons::id.eq(target_id))
                .select(PersonRecord::as_select())
                .first(conn)
        })
        .map_err(|e| {
            tracing::error!("DB merge persons error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Move a single face to a different person; updates both persons' face_counts.
    pub fn reassign_face(
        &self,
        face_id: &str,
        from_person_id: &str,
        target_person_id: &str,
        user_id: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<(), diesel::result::Error, _>(|conn| {
            // Verify target belongs to user.
            persons::table
                .filter(persons::id.eq(target_person_id))
                .filter(persons::user_id.eq(user_id))
                .select(persons::id)
                .first::<String>(conn)?;

            // Reassign the face.
            diesel::update(
                faces::table
                    .filter(faces::id.eq(face_id))
                    .filter(faces::person_id.eq(from_person_id)),
            )
            .set(faces::person_id.eq(target_person_id))
            .execute(conn)?;

            // Decrement source face_count (delete if it reaches 0).
            let source = persons::table
                .filter(persons::id.eq(from_person_id))
                .filter(persons::user_id.eq(user_id))
                .select(PersonRecord::as_select())
                .first(conn)?;
            if source.face_count <= 1 {
                diesel::delete(
                    persons::table
                        .filter(persons::id.eq(from_person_id))
                        .filter(persons::user_id.eq(user_id)),
                )
                .execute(conn)?;
            } else {
                diesel::update(
                    persons::table
                        .filter(persons::id.eq(from_person_id))
                        .filter(persons::user_id.eq(user_id)),
                )
                .set((
                    persons::face_count.eq(source.face_count - 1),
                    persons::updated_at.eq(now),
                ))
                .execute(conn)?;
            }

            // Increment target face_count.
            let target = persons::table
                .filter(persons::id.eq(target_person_id))
                .filter(persons::user_id.eq(user_id))
                .select(PersonRecord::as_select())
                .first(conn)?;
            diesel::update(
                persons::table
                    .filter(persons::id.eq(target_person_id))
                    .filter(persons::user_id.eq(user_id)),
            )
            .set((
                persons::face_count.eq(target.face_count + 1),
                persons::updated_at.eq(now),
            ))
            .execute(conn)?;

            Ok(())
        })
        .map_err(|e| {
            tracing::error!("DB reassign face error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Remove a face from a person (sets person_id = NULL). Deletes the person if empty.
    pub fn remove_face_from_person(
        &self,
        face_id: &str,
        person_id: &str,
        user_id: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<(), diesel::result::Error, _>(|conn| {
            // Verify person belongs to user.
            let person = persons::table
                .filter(persons::id.eq(person_id))
                .filter(persons::user_id.eq(user_id))
                .select(PersonRecord::as_select())
                .first(conn)?;

            // Clear the face's person_id.
            diesel::update(
                faces::table
                    .filter(faces::id.eq(face_id))
                    .filter(faces::person_id.eq(person_id)),
            )
            .set(faces::person_id.eq::<Option<&str>>(None))
            .execute(conn)?;

            // Decrement or delete the person.
            if person.face_count <= 1 {
                diesel::delete(
                    persons::table
                        .filter(persons::id.eq(person_id))
                        .filter(persons::user_id.eq(user_id)),
                )
                .execute(conn)?;
            } else {
                diesel::update(
                    persons::table
                        .filter(persons::id.eq(person_id))
                        .filter(persons::user_id.eq(user_id)),
                )
                .set((
                    persons::face_count.eq(person.face_count - 1),
                    persons::updated_at.eq(now),
                ))
                .execute(conn)?;
            }

            Ok(())
        })
        .map_err(|e| {
            tracing::error!("DB remove face from person error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Return all distinct user_ids that have at least one face with an embedding.
    pub fn list_users_with_face_embeddings(&self) -> Result<Vec<String>, ApiError> {
        use crate::schema::photos;
        let mut conn = self.get_conn()?;
        faces::table
            .inner_join(photos::table.on(faces::photo_id.eq(photos::id)))
            .filter(faces::embedding.is_not_null())
            .select(photos::user_id)
            .distinct()
            .load::<String>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list users with faces error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Return all face records (with embeddings) for photos owned by a user.
    pub fn list_face_embeddings_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<FaceRecord>, ApiError> {
        use crate::schema::photos;
        let mut conn = self.get_conn()?;
        faces::table
            .inner_join(photos::table.on(faces::photo_id.eq(photos::id)))
            .filter(photos::user_id.eq(user_id))
            .filter(faces::embedding.is_not_null())
            .select(FaceRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list face embeddings error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Return face records for a set of persons in one query (avoids N+1).
    pub fn list_faces_for_persons(
        &self,
        person_ids: &[String],
    ) -> Result<Vec<FaceRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        faces::table
            .filter(faces::person_id.eq_any(person_ids))
            .select(FaceRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list faces for persons error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Return face records for photos of a specific person (for the People detail view).
    pub fn list_faces_for_person(&self, person_id: &str) -> Result<Vec<FaceRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        faces::table
            .filter(faces::person_id.eq(person_id))
            .select(FaceRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list faces for person error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Atomically replace all persons for a user with the new cluster set.
    /// Clusters may carry a preserved name (e.g. when a named person's faces are still in the cluster).
    /// `clusters` tuples: (person_id, face_ids, cover_face_id, cover_thumbnail, cover_thumbnail_mime_type, name)
    pub fn apply_clusters(
        &self,
        user_id: &str,
        clusters: &[(
            String,
            Vec<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )],
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<(), diesel::result::Error, _>(|conn| {
            // 1. Clear existing person assignments on faces for this user.
            let photo_ids: Vec<String> = {
                use crate::schema::photos;
                photos::table
                    .filter(photos::user_id.eq(user_id))
                    .select(photos::id)
                    .load::<String>(conn)?
            };
            if !photo_ids.is_empty() {
                diesel::update(faces::table.filter(faces::photo_id.eq_any(&photo_ids)))
                    .set(faces::person_id.eq::<Option<&str>>(None))
                    .execute(conn)?;
            }

            // 2. Delete all existing persons for this user (they are fully replaced by the new cluster set).
            diesel::delete(persons::table.filter(persons::user_id.eq(user_id))).execute(conn)?;

            // 3. Insert new persons and assign face person_ids.
            for (person_id, face_ids, cover_face_id, cover_thumb, cover_thumb_mime, name) in
                clusters
            {
                let new_person = NewPersonRecord {
                    id: person_id,
                    user_id,
                    cover_face_id: cover_face_id.as_deref(),
                    cover_thumbnail: cover_thumb.as_deref(),
                    cover_thumbnail_mime_type: cover_thumb_mime.as_deref(),
                    face_count: face_ids.len() as i32,
                    name: name.as_deref(),
                    created_at: now,
                    updated_at: now,
                };
                diesel::insert_into(persons::table)
                    .values(&new_person)
                    .execute(conn)?;

                if !face_ids.is_empty() {
                    diesel::update(faces::table.filter(faces::id.eq_any(face_ids)))
                        .set(faces::person_id.eq(person_id.as_str()))
                        .execute(conn)?;
                }
            }

            Ok(())
        })
        .map_err(|e| {
            tracing::error!("DB apply clusters error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Assign a single face to a person, incrementing the person's face_count.
    pub fn assign_face_to_person(
        &self,
        face_id: &str,
        person_id: &str,
        user_id: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<(), diesel::result::Error, _>(|conn| {
            // Verify person belongs to user.
            let person = persons::table
                .filter(persons::id.eq(person_id))
                .filter(persons::user_id.eq(user_id))
                .select(PersonRecord::as_select())
                .first(conn)?;

            // Assign face.
            diesel::update(faces::table.filter(faces::id.eq(face_id)))
                .set(faces::person_id.eq(person_id))
                .execute(conn)?;

            // Increment count.
            diesel::update(
                persons::table
                    .filter(persons::id.eq(person_id))
                    .filter(persons::user_id.eq(user_id)),
            )
            .set((
                persons::face_count.eq(person.face_count + 1),
                persons::updated_at.eq(now),
            ))
            .execute(conn)?;

            Ok(())
        })
        .map_err(|e| {
            tracing::error!("DB assign face to person error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Return all named persons (name IS NOT NULL) for a user.
    pub fn list_named_persons_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<PersonRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        persons::table
            .filter(persons::user_id.eq(user_id))
            .filter(persons::name.is_not_null())
            .select(PersonRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list named persons error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Return faces that have an embedding but are not yet assigned to any person.
    pub fn list_unassigned_faces_with_embeddings(
        &self,
        user_id: &str,
    ) -> Result<Vec<FaceRecord>, ApiError> {
        use crate::schema::photos;
        let mut conn = self.get_conn()?;
        faces::table
            .inner_join(photos::table.on(faces::photo_id.eq(photos::id)))
            .filter(photos::user_id.eq(user_id))
            .filter(faces::embedding.is_not_null())
            .filter(faces::person_id.is_null())
            .select(FaceRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list unassigned faces error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Return the user_id of the photo that contains a given face (for ownership checks).
    pub fn get_photo_user_id_for_face(&self, face_id: &str) -> Result<String, ApiError> {
        use crate::schema::photos;
        let mut conn = self.get_conn()?;
        faces::table
            .inner_join(photos::table.on(faces::photo_id.eq(photos::id)))
            .filter(faces::id.eq(face_id))
            .select(photos::user_id)
            .first::<String>(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Face not found"),
                _ => {
                    tracing::error!("DB get photo user_id for face error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    /// Return photo_ids for a person with their date information for timeline grouping.
    /// Returns (photo_id, capture_date_or_created_at) sorted chronologically.
    pub fn list_photo_ids_for_person_with_dates(
        &self,
        user_id: &str,
        person_id: &str,
    ) -> Result<Vec<(String, chrono::NaiveDateTime)>, ApiError> {
        use crate::schema::photos;
        let mut conn = self.get_conn()?;
        // Join faces → photos, get photo_id + date, deduplicate by photo_id.
        let rows: Vec<(String, Option<chrono::NaiveDateTime>, chrono::NaiveDateTime)> =
            faces::table
                .inner_join(photos::table.on(faces::photo_id.eq(photos::id)))
                .filter(photos::user_id.eq(user_id))
                .filter(photos::deleted_at.is_null())
                .filter(photos::is_archived.eq(false))
                .filter(faces::person_id.eq(person_id))
                .select((photos::id, photos::capture_date, photos::created_at))
                .distinct()
                .load::<(String, Option<chrono::NaiveDateTime>, chrono::NaiveDateTime)>(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB list photo ids for person with dates error: {:?}", e);
                    ApiError::internal("Database error")
                })?;

        let mut result: Vec<(String, chrono::NaiveDateTime)> = rows
            .into_iter()
            .map(|(id, capture_date, created_at)| {
                let date = capture_date.unwrap_or(created_at);
                (id, date)
            })
            .collect();
        result.sort_by_key(|(_, d)| *d);
        Ok(result)
    }

    /// Find all photos containing multiple persons (for co-occurrence detection).
    /// Returns (photo_id, person_id) pairs.
    pub fn list_person_photo_pairs_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<(String, String)>, ApiError> {
        use crate::schema::photos;
        let mut conn = self.get_conn()?;
        faces::table
            .inner_join(photos::table.on(faces::photo_id.eq(photos::id)))
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .filter(faces::person_id.is_not_null())
            .select((photos::id, faces::person_id))
            .distinct()
            .load::<(String, Option<String>)>(&mut conn)
            .map(|rows| {
                rows.into_iter()
                    .filter_map(|(photo_id, person_id)| person_id.map(|pid| (photo_id, pid)))
                    .collect()
            })
            .map_err(|e| {
                tracing::error!("DB list person photo pairs error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Batch-fetch persons by a list of IDs (for suggestion enrichment).
    pub fn get_persons_by_ids(&self, ids: &[String]) -> Result<Vec<PersonRecord>, ApiError> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let mut conn = self.get_conn()?;
        persons::table
            .filter(persons::id.eq_any(ids))
            .select(PersonRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get persons by ids error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
