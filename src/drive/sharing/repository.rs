use crate::drive::sharing::model::{
    key_subject_for, NewShareLinkRecord, ShareLinkRecord, UpdateShareLinkRecord,
};
use crate::schema::{file_key_refs, files, folders, share_links, user_public_keys};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::dsl::{exists, not};
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct SharingRepository {
    pool: DbPool,
}

impl SharingRepository {
    pub fn new(pool: DbPool) -> Self {
        SharingRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn upsert_share_link(
        &self,
        record: &NewShareLinkRecord,
    ) -> Result<ShareLinkRecord, ApiError> {
        let mut conn = self.get_conn()?;

        // A replaced link is a different link: its key refs go with it, so the old fragment key
        // opens nothing.
        let old_ids: Vec<String> = share_links::table
            .filter(share_links::resource_type.eq(record.resource_type))
            .filter(share_links::resource_id.eq(record.resource_id))
            .select(share_links::id)
            .load(&mut conn)
            .map_err(db_err("find old share link"))?;
        for old in &old_ids {
            diesel::delete(file_key_refs::table.filter(file_key_refs::user_id.eq(key_subject_for(old))))
                .execute(&mut conn)
                .map_err(db_err("delete old link key refs"))?;
        }

        // Remove any existing link for this resource
        diesel::delete(
            share_links::table
                .filter(share_links::resource_type.eq(record.resource_type))
                .filter(share_links::resource_id.eq(record.resource_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete old share link error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        diesel::insert_into(share_links::table)
            .values(record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert share link error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        share_links::table
            .filter(share_links::id.eq(record.id))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query share link after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_resource(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<ShareLinkRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        share_links::table
            .filter(share_links::resource_type.eq(resource_type))
            .filter(share_links::resource_id.eq(resource_id))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find share link error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_token(&self, token: &str) -> Result<Option<ShareLinkRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        share_links::table
            .filter(share_links::token.eq(token))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find share link by token error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_share_link(
        &self,
        resource_type: &str,
        resource_id: &str,
        changeset: UpdateShareLinkRecord,
    ) -> Result<ShareLinkRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            share_links::table
                .filter(share_links::resource_type.eq(resource_type))
                .filter(share_links::resource_id.eq(resource_id)),
        )
        .set(&changeset)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update share link error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        share_links::table
            .filter(share_links::resource_type.eq(resource_type))
            .filter(share_links::resource_id.eq(resource_id))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query share link after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_share_link(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        let ids: Vec<String> = share_links::table
            .filter(share_links::resource_type.eq(resource_type))
            .filter(share_links::resource_id.eq(resource_id))
            .select(share_links::id)
            .load(&mut conn)
            .map_err(db_err("find share link"))?;
        for id in &ids {
            diesel::delete(file_key_refs::table.filter(file_key_refs::user_id.eq(key_subject_for(id))))
                .execute(&mut conn)
                .map_err(db_err("delete link key refs"))?;
        }
        diesel::delete(
            share_links::table
                .filter(share_links::resource_type.eq(resource_type))
                .filter(share_links::resource_id.eq(resource_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete share link error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Returns the MIME type of a file resource (None if not a file or not found).
    pub fn get_file_mime_type(&self, file_id: &str) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;
        files::table
            .filter(files::id.eq(file_id))
            .select(files::mime_type)
            .first::<String>(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get file mime_type error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Resolve resource name for a given resource_type and resource_id.
    pub fn get_resource_name(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;
        match resource_type {
            "file" => files::table
                .filter(files::id.eq(resource_id))
                .select(files::name)
                .first::<String>(&mut conn)
                .optional()
                .map_err(|e| {
                    tracing::error!("DB get file name error: {:?}", e);
                    ApiError::internal("Database error")
                }),
            "folder" => folders::table
                .filter(folders::id.eq(resource_id))
                .select(folders::name)
                .first::<String>(&mut conn)
                .optional()
                .map_err(|e| {
                    tracing::error!("DB get folder name error: {:?}", e);
                    ApiError::internal("Database error")
                }),
            _ => Ok(None),
        }
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<ShareLinkRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        share_links::table
            .filter(share_links::id.eq(id))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("find share link by id"))
    }

    /// A live, personal (not team) folder's parent: `Some(parent)` for a folder that exists,
    /// `None` for one that does not or is trashed.
    pub fn folder_parent(&self, folder_id: &str) -> Result<Option<Option<String>>, ApiError> {
        let mut conn = self.get_conn()?;
        folders::table
            .filter(folders::id.eq(folder_id))
            .filter(folders::deleted_at.is_null())
            .filter(folders::team_id.is_null())
            .select(folders::parent_id)
            .first::<Option<String>>(&mut conn)
            .optional()
            .map_err(db_err("folder parent"))
    }

    /// The owner of a live, personal folder.
    pub fn folder_owner(&self, folder_id: &str) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;
        folders::table
            .filter(folders::id.eq(folder_id))
            .filter(folders::deleted_at.is_null())
            .filter(folders::team_id.is_null())
            .select(folders::user_id)
            .first::<String>(&mut conn)
            .optional()
            .map_err(db_err("folder owner"))
    }

    /// A live, personal file's folder: `Some(folder)` for a file that exists, `None` otherwise.
    pub fn file_folder(&self, file_id: &str) -> Result<Option<Option<String>>, ApiError> {
        let mut conn = self.get_conn()?;
        files::table
            .filter(files::id.eq(file_id))
            .filter(files::deleted_at.is_null())
            .filter(files::team_id.is_null())
            .select(files::folder_id)
            .first::<Option<String>>(&mut conn)
            .optional()
            .map_err(db_err("file folder"))
    }

    /// Whether `folder_id` is `root` or a live descendant of it. Walks up at most 64 levels.
    pub fn folder_in_subtree(&self, root: &str, folder_id: &str) -> Result<bool, ApiError> {
        let mut current = folder_id.to_string();
        for _ in 0..64 {
            let Some(parent) = self.folder_parent(&current)? else {
                return Ok(false);
            };
            if current == root {
                return Ok(true);
            }
            match parent {
                Some(p) => current = p,
                None => return Ok(false),
            }
        }
        Ok(false)
    }

    /// Every live folder id in the subtree rooted at `root`, `root` included.
    pub fn subtree_folder_ids(&self, root: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        let mut all = vec![root.to_string()];
        let mut frontier = vec![root.to_string()];
        // Bounded like every other walk here, so corrupt parent data cannot spin forever.
        for _ in 0..64 {
            if frontier.is_empty() {
                break;
            }
            let children: Vec<String> = folders::table
                .filter(folders::parent_id.eq_any(&frontier))
                .filter(folders::deleted_at.is_null())
                .filter(folders::team_id.is_null())
                .select(folders::id)
                .load(&mut conn)
                .map_err(db_err("subtree folders"))?;
            frontier = children
                .into_iter()
                .filter(|c| !all.contains(c))
                .collect();
            all.extend(frontier.iter().cloned());
        }
        Ok(all)
    }

    /// Encrypted files in `folder_ids` with no key sealed to `subject` yet, up to `limit`.
    ///
    /// "Encrypted" means some key ref exists: a plaintext file has none and needs nothing.
    pub fn unkeyed_files(
        &self,
        folder_ids: &[String],
        subject: &str,
        limit: i64,
    ) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        let mut out = Vec::new();
        // SQLite caps bound parameters; chunk the folder list.
        for chunk in folder_ids.chunks(500) {
            if out.len() as i64 >= limit {
                break;
            }
            let ids: Vec<String> = files::table
                .filter(files::folder_id.eq_any(chunk))
                .filter(files::deleted_at.is_null())
                .filter(exists(
                    file_key_refs::table.filter(file_key_refs::file_id.eq(files::id)),
                ))
                .filter(not(exists(
                    file_key_refs::table
                        .filter(file_key_refs::file_id.eq(files::id))
                        .filter(file_key_refs::user_id.eq(subject)),
                )))
                .select(files::id)
                .order(files::id.asc())
                .limit(limit - out.len() as i64)
                .load(&mut conn)
                .map_err(db_err("unkeyed files"))?;
            out.extend(ids);
        }
        Ok(out)
    }

    /// Live folder links with a link key on `folder_id` or any of its ancestors.
    pub fn keyed_links_covering_folder(
        &self,
        folder_id: &str,
    ) -> Result<Vec<ShareLinkRecord>, ApiError> {
        let now = chrono::Utc::now().naive_utc();
        let mut out = Vec::new();
        let mut current = folder_id.to_string();
        for _ in 0..64 {
            let Some(parent) = self.folder_parent(&current)? else {
                break;
            };
            if let Some(link) = self.find_by_resource("folder", &current)? {
                if link.public_key.is_some() && link.is_live(now) {
                    out.push(link);
                }
            }
            match parent {
                Some(p) => current = p,
                None => break,
            }
        }
        Ok(out)
    }

    /// A user's active public key and its version.
    pub fn active_public_key(&self, user_id: &str) -> Result<Option<(String, i32)>, ApiError> {
        let mut conn = self.get_conn()?;
        user_public_keys::table
            .filter(user_public_keys::user_id.eq(user_id))
            .filter(user_public_keys::retired_at.is_null())
            .select((user_public_keys::public_key, user_public_keys::version))
            .order(user_public_keys::version.desc())
            .first::<(String, i32)>(&mut conn)
            .optional()
            .map_err(db_err("active public key"))
    }
}

fn db_err(what: &'static str) -> impl Fn(diesel::result::Error) -> ApiError {
    move |e| {
        tracing::error!("DB {} error: {:?}", what, e);
        ApiError::internal("Database error")
    }
}
