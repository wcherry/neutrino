use crate::notes::model::{NewNoteLinkRecord, NewNoteRecord, NoteRecord, UpdateNoteRecord};
use crate::schema::{note_links, notes};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct NotesRepository {
    pool: DbPool,
}

impl NotesRepository {
    pub fn new(pool: DbPool) -> Self {
        NotesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_note(&self, new_note: NewNoteRecord) -> Result<NoteRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(notes::table)
            .values(&new_note)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert note error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        notes::table
            .filter(notes::file_id.eq(new_note.file_id))
            .select(NoteRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after note insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_note(
        &self,
        file_id: &str,
        changes: UpdateNoteRecord,
    ) -> Result<NoteRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(notes::table.filter(notes::file_id.eq(file_id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update note error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        notes::table
            .filter(notes::file_id.eq(file_id))
            .select(NoteRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get note after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_note(&self, file_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(notes::table.filter(notes::file_id.eq(file_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete note error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    /// Replace all outgoing links from `source_id` with the given `target_ids`.
    /// Deletes existing links first, then inserts new ones.
    pub fn replace_links(&self, source_id: &str, target_ids: &[String]) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(note_links::table.filter(note_links::source_note_id.eq(source_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete note_links error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        for target_id in target_ids {
            let new_link = NewNoteLinkRecord {
                source_note_id: source_id,
                target_note_id: target_id.as_str(),
            };
            diesel::insert_or_ignore_into(note_links::table)
                .values(&new_link)
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB insert note_link error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        }
        Ok(())
    }

    /// Return the IDs of all notes that contain a link pointing to `target_id`.
    pub fn get_backlink_source_ids(&self, target_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        note_links::table
            .filter(note_links::target_note_id.eq(target_id))
            .select(note_links::source_note_id)
            .load::<String>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get backlinks error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Delete all links where `note_id` is either source or target (called on note deletion).
    pub fn delete_links_for_note(&self, note_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            note_links::table.filter(
                note_links::source_note_id
                    .eq(note_id)
                    .or(note_links::target_note_id.eq(note_id)),
            ),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete links for note error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }
}
