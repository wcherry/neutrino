use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable, AsChangeset)]
#[diesel(table_name = crate::schema::service_registrations)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ServiceRegistrationRecord {
    pub name: String,
    pub endpoint: String,
    pub version: String,
    pub health_check_url: String,
    pub registered_at: NaiveDateTime,
    pub enabled: i32,
    pub auto_update: i32,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::service_registrations)]
pub struct NewServiceRegistration<'a> {
    pub name: &'a str,
    pub endpoint: &'a str,
    pub version: &'a str,
    pub health_check_url: &'a str,
    pub registered_at: NaiveDateTime,
    pub enabled: i32,
    pub auto_update: i32,
}
