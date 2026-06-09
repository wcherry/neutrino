use crate::auth::service::AuthService;
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;

#[derive(Debug)]
#[allow(dead_code)]
pub struct AuthUserProfile {
    pub id: String,
    pub email: String,
    pub name: String,
}

#[allow(dead_code)]
pub fn fetch_auth_profile(
    user: &AuthenticatedUser,
    auth_service: &AuthService,
) -> Result<AuthUserProfile, ApiError> {
    let profile = auth_service.get_profile(&user.user_id)?;
    Ok(AuthUserProfile {
        id: profile.id,
        email: profile.email,
        name: profile.name,
    })
}
