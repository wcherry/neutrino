use chrono::Utc;
use diesel::prelude::*;
use crate::shared::DbPool;
use crate::schema::diagram_yjs_state;

#[derive(Queryable, Insertable, AsChangeset)]
#[diesel(table_name = diagram_yjs_state)]
struct DiagramYjsStateRow {
    file_id: String,
    state: Vec<u8>,
    updated_at: chrono::NaiveDateTime,
}

pub struct DiagramCollabRepository {
    pool: DbPool,
}

impl DiagramCollabRepository {
    pub fn new(pool: DbPool) -> Self {
        DiagramCollabRepository { pool }
    }

    pub fn load_state(&self, file_id: &str) -> Option<Vec<u8>> {
        let mut conn = self.pool.get().ok()?;
        diagram_yjs_state::table
            .find(file_id)
            .select(diagram_yjs_state::state)
            .first::<Vec<u8>>(&mut conn)
            .ok()
    }

    pub fn save_state(&self, file_id: &str, state_bytes: Vec<u8>) -> Result<(), String> {
        let mut conn = self.pool.get().map_err(|e| e.to_string())?;
        let row = DiagramYjsStateRow {
            file_id: file_id.to_string(),
            state: state_bytes,
            updated_at: Utc::now().naive_utc(),
        };
        diesel::replace_into(diagram_yjs_state::table)
            .values(&row)
            .execute(&mut conn)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
