use crate::shared::{ApiError, AuthenticatedUser};
use crate::calendar::events::{
    attendees::AttendeesRepository,
    dto::{
        CreateEventRequest, EventResponse, ListEventsQuery, ListEventsResponse, UpdateEventRequest,
    },
    model::{NewEventRecord, UpdateEventRecord},
    repository::EventsRepository,
};
use chrono::{NaiveDateTime, Utc};
use std::sync::Arc;
use uuid::Uuid;

pub struct EventsService {
    repo: Arc<EventsRepository>,
    attendees_repo: Arc<AttendeesRepository>,
}

impl EventsService {
    pub fn new(repo: Arc<EventsRepository>, attendees_repo: Arc<AttendeesRepository>) -> Self {
        EventsService { repo, attendees_repo }
    }

    pub fn list_events(
        &self,
        user: &AuthenticatedUser,
        query: ListEventsQuery,
    ) -> Result<ListEventsResponse, ApiError> {
        let from = query.from.as_deref().map(parse_dt).transpose()?;
        let to = query.to.as_deref().map(parse_dt).transpose()?;
        let records = self.repo.find_by_user(&user.user_id, from, to)?;
        let events = records
            .into_iter()
            .map(|r| {
                let attendees = self.attendees_repo.find_by_event(&r.id).unwrap_or_default();
                event_to_response(r, attendees)
            })
            .collect();
        Ok(ListEventsResponse { events })
    }

    pub fn create_event(
        &self,
        user: &AuthenticatedUser,
        req: CreateEventRequest,
    ) -> Result<EventResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4().to_string();
        let record = NewEventRecord {
            id: id.clone(),
            user_id: user.user_id.clone(),
            title: req.title,
            description: req.description,
            start_time: parse_dt(&req.start_time)?,
            end_time: parse_dt(&req.end_time)?,
            all_day: req.all_day,
            location: req.location,
            recurrence_rule: req.recurrence_rule,
            external_id: None,
            source: "local".to_string(),
            created_at: now,
            updated_at: now,
            timezone: req.timezone,
        };
        let saved = self.repo.insert(record)?;
        self.attendees_repo.replace_for_event(&id, &req.attendees)?;
        let attendees = self.attendees_repo.find_by_event(&id).unwrap_or_default();
        Ok(event_to_response(saved, attendees))
    }

    pub fn get_event(
        &self,
        user: &AuthenticatedUser,
        event_id: &str,
    ) -> Result<EventResponse, ApiError> {
        let record = self.repo.find_by_id(event_id, &user.user_id)?;
        let attendees = self.attendees_repo.find_by_event(event_id).unwrap_or_default();
        Ok(event_to_response(record, attendees))
    }

    pub fn update_event(
        &self,
        user: &AuthenticatedUser,
        event_id: &str,
        req: UpdateEventRequest,
    ) -> Result<EventResponse, ApiError> {
        let changes = UpdateEventRecord {
            title: req.title,
            description: req.description.map(Some),
            start_time: req.start_time.as_deref().map(parse_dt).transpose()?,
            end_time: req.end_time.as_deref().map(parse_dt).transpose()?,
            all_day: req.all_day,
            location: req.location.map(Some),
            recurrence_rule: req.recurrence_rule.map(Some),
            updated_at: Utc::now().naive_utc(),
            timezone: req.timezone.map(Some),
        };
        let updated = self.repo.update(event_id, &user.user_id, changes)?;
        if let Some(emails) = req.attendees {
            self.attendees_repo.replace_for_event(event_id, &emails)?;
        }
        let attendees = self.attendees_repo.find_by_event(event_id).unwrap_or_default();
        Ok(event_to_response(updated, attendees))
    }

    pub fn delete_event(
        &self,
        user: &AuthenticatedUser,
        event_id: &str,
    ) -> Result<(), ApiError> {
        self.repo.delete(event_id, &user.user_id)
        // attendees are cascade-deleted by the DB constraint
    }
}

fn parse_dt(s: &str) -> Result<NaiveDateTime, ApiError> {
    s.parse::<chrono::DateTime<chrono::Utc>>()
        .map(|dt| dt.naive_utc())
        .or_else(|_| s.parse::<NaiveDateTime>())
        .map_err(|_| ApiError::bad_request(&format!("Invalid datetime: {}", s)))
}

fn event_to_response(r: crate::calendar::events::model::EventRecord, attendees: Vec<String>) -> EventResponse {
    EventResponse {
        id: r.id,
        title: r.title,
        description: r.description,
        start_time: r.start_time.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        end_time: r.end_time.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        all_day: r.all_day,
        location: r.location,
        recurrence_rule: r.recurrence_rule,
        attendees,
        source: r.source,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        timezone: r.timezone,
    }
}
