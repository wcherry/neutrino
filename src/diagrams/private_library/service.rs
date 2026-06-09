use crate::diagrams::private_library::{
    dto::{AddLibraryRequest, LibraryContent, LibraryMeta, ListLibrariesResponse},
    model::NewThirdPartyLibraryRecord,
    repository::PrivateLibraryRepository,
};
use crate::drive::private_store::PrivateStore;
use crate::shared::{ApiError, AuthenticatedUser};
use std::sync::Arc;
use uuid::Uuid;

pub struct PrivateLibraryService {
    repo: Arc<PrivateLibraryRepository>,
    store: Arc<PrivateStore>,
    http: reqwest::Client,
}

impl PrivateLibraryService {
    pub fn new(repo: Arc<PrivateLibraryRepository>, store: Arc<PrivateStore>) -> Self {
        Self {
            repo,
            store,
            http: reqwest::Client::new(),
        }
    }

    pub async fn list(&self, _user: &AuthenticatedUser) -> Result<ListLibrariesResponse, ApiError> {
        let libraries = self
            .repo
            .list()?
            .into_iter()
            .map(|r| LibraryMeta {
                id: r.id,
                name: r.name,
                url: r.url,
                created_at: r.created_at,
            })
            .collect();
        Ok(ListLibrariesResponse { libraries })
    }

    pub async fn get_content(
        &self,
        _user: &AuthenticatedUser,
        id: &str,
    ) -> Result<LibraryContent, ApiError> {
        let rec = self.repo.get_by_id(id)?;
        let xml_content = self.store.read(&rec.private_path)?;
        Ok(LibraryContent {
            id: rec.id,
            name: rec.name,
            url: rec.url,
            xml_content,
        })
    }

    pub async fn add(
        &self,
        _user: &AuthenticatedUser,
        req: AddLibraryRequest,
    ) -> Result<LibraryMeta, ApiError> {
        if self.repo.url_exists(&req.url)? {
            return Err(ApiError::conflict("A library with this URL already exists"));
        }

        let xml_content = self
            .http
            .get(&req.url)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| {
                tracing::warn!("fetch drawio library {}: {:?}", req.url, e);
                ApiError::bad_request("Could not fetch library from the given URL")
            })?
            .error_for_status()
            .map_err(|e| {
                tracing::warn!("fetch drawio library {} bad status: {:?}", req.url, e);
                ApiError::bad_request("Library URL returned an error response")
            })?
            .text()
            .await
            .map_err(|_| ApiError::bad_request("Library URL did not return text content"))?;

        if !xml_content.contains("<mxlibrary") {
            return Err(ApiError::bad_request(
                "URL does not appear to be a valid drawio library (missing <mxlibrary> tag)",
            ));
        }

        let id = Uuid::new_v4().to_string();
        let private_path = format!("diagrams/third_party/{}.xml", id);

        self.store.write(&private_path, &xml_content)?;

        let rec = self.repo.insert(NewThirdPartyLibraryRecord {
            id: &id,
            name: &req.name,
            url: &req.url,
            private_path: &private_path,
        })?;

        Ok(LibraryMeta {
            id: rec.id,
            name: rec.name,
            url: rec.url,
            created_at: rec.created_at,
        })
    }

    pub async fn remove(&self, _user: &AuthenticatedUser, id: &str) -> Result<(), ApiError> {
        let rec = self.repo.get_by_id(id)?;
        self.store.delete(&rec.private_path)?;
        self.repo.delete(id)
    }
}
