use crate::calendar::events::dto::{CreateEventRequest, EventResponse, UpdateEventRequest};
use crate::calendar::events::service::EventsService;
use crate::calendar::recurrence::{self, Completion};
use crate::calendar::tasks::model::TaskRecord;
use crate::calendar::tasks::{
    dto::{
        CreateTaskAttachmentRequest, CreateTaskListRequest, CreateTaskRequest,
        ListTaskAttachmentsResponse, ListTaskListsResponse, ReorderTasksRequest,
        ScheduleTaskRequest, TaskAttachmentResponse, TaskListResponse, TaskResponse,
        UpdateTaskRequest,
    },
    model::{
        NewTaskAttachmentRecord, NewTaskListMembershipRecord, NewTaskListRecord, NewTaskRecord,
        UpdateTaskRecord,
    },
    repository::TasksRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

pub struct TasksService {
    repo: Arc<TasksRepository>,
    /// Scheduling a task creates an ordinary calendar event, so this service owns the
    /// task's half of that link and the events service owns the event itself. Nothing in
    /// `events` knows about tasks — see the migration for why the link is one-directional.
    events: Arc<EventsService>,
}

impl TasksService {
    pub fn new(repo: Arc<TasksRepository>, events: Arc<EventsService>) -> Self {
        TasksService { repo, events }
    }

    // ── Task Lists ────────────────────────────────────────────────────────────

    pub fn list_task_lists(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListTaskListsResponse, ApiError> {
        let records = self.repo.find_by_user(&user.user_id)?;
        let task_lists = records.into_iter().map(task_list_to_response).collect();
        Ok(ListTaskListsResponse { task_lists })
    }

    pub fn create_task_list(
        &self,
        user: &AuthenticatedUser,
        req: CreateTaskListRequest,
    ) -> Result<TaskListResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let record = NewTaskListRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            name: req.name,
            color: req.color,
            created_at: now,
            updated_at: now,
        };
        let saved = self.repo.insert(record)?;
        Ok(task_list_to_response(saved))
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────

    pub fn list_tasks(
        &self,
        user: &AuthenticatedUser,
        list_id: Option<&str>,
    ) -> Result<Vec<TaskResponse>, ApiError> {
        let mut tags: HashMap<String, Vec<String>> = HashMap::new();
        for row in self.repo.find_tags_by_user(&user.user_id)? {
            tags.entry(row.task_id).or_default().push(row.tag);
        }
        let tags_of = |id: &str| tags.get(id).cloned().unwrap_or_default();
        match list_id {
            Some(lid) => {
                self.repo.find_by_id(lid, &user.user_id)?;
                let records = self.repo.find_tasks_by_list_id(&user.user_id, lid)?;
                let lid_owned = lid.to_string();
                Ok(records
                    .into_iter()
                    .map(|r| {
                        let t = tags_of(&r.id);
                        task_to_response(r, Some(lid_owned.clone()), t)
                    })
                    .collect())
            }
            None => {
                let records = self
                    .repo
                    .find_all_tasks_with_list_id_by_user(&user.user_id)?;
                Ok(records
                    .into_iter()
                    .map(|(r, lid)| {
                        let t = tags_of(&r.id);
                        task_to_response(r, lid, t)
                    })
                    .collect())
            }
        }
    }

    pub fn create_task(
        &self,
        user: &AuthenticatedUser,
        req: CreateTaskRequest,
    ) -> Result<TaskResponse, ApiError> {
        validate_priority(req.priority)?;
        validate_estimate(req.estimate_minutes)?;
        let geofence = resolve_geofence(
            Geofence::default(),
            req.geo_place_id.map(Some),
            req.geo_lat.map(Some),
            req.geo_lng.map(Some),
            req.geo_radius_m.map(Some),
        )?
        .unwrap_or_default();
        self.check_place(user, &Geofence::default(), &geofence)?;
        let now = Utc::now().naive_utc();
        let record = NewTaskRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            title: req.title,
            notes: req.notes,
            done: false,
            due_date: req.due_date.as_deref().map(parse_dt).transpose()?,
            position: req.position.unwrap_or(0),
            created_at: now,
            updated_at: now,
            due_has_time: req.due_has_time,
            start_date: req.start_date.as_deref().map(parse_dt).transpose()?,
            start_has_time: req.start_has_time,
            priority: req.priority,
            estimate_minutes: req.estimate_minutes,
            location: non_empty(req.location),
            recurrence_rule: non_empty(req.recurrence_rule),
            repeat_after_completion: req.repeat_after_completion,
            geo_place_id: geofence.place,
            geo_lat: geofence.lat,
            geo_lng: geofence.lng,
            geo_radius_m: geofence.radius,
        };
        let saved = self.repo.insert_task(record)?;
        let tags = normalize_tags(req.tags);
        if !tags.is_empty() {
            self.repo.replace_tags(&saved.id, &tags)?;
        }
        Ok(task_to_response(saved, None, tags))
    }

    pub fn update_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        req: UpdateTaskRequest,
    ) -> Result<TaskResponse, ApiError> {
        let new_title = req.title.clone();
        let timezone = match req.timezone.as_deref() {
            Some(name) => name
                .parse::<Tz>()
                .map_err(|_| ApiError::bad_request(format!("Unknown time zone: {name}")))?,
            None => Tz::UTC,
        };
        validate_priority(req.priority.flatten())?;
        validate_estimate(req.estimate_minutes.flatten())?;
        let due_date = parse_patch_dt(req.due_date)?;
        let start_date = parse_patch_dt(req.start_date)?;
        let before = self.repo.find_task_by_id(task_id, &user.user_id)?;
        // None when the request names no geo field: an older client's edit keeps the geofence.
        let current = Geofence::of(&before);
        let geofence = resolve_geofence(
            current.clone(),
            req.geo_place_id,
            req.geo_lat,
            req.geo_lng,
            req.geo_radius_m,
        )?;
        if let Some(geofence) = &geofence {
            self.check_place(user, &current, geofence)?;
        }
        let changes = UpdateTaskRecord {
            title: req.title,
            notes: req.notes,
            done: req.done,
            due_date,
            position: req.position,
            updated_at: Utc::now().naive_utc(),
            due_has_time: req.due_has_time,
            start_date,
            start_has_time: req.start_has_time,
            priority: req.priority,
            estimate_minutes: req.estimate_minutes,
            location: req.location.map(non_empty),
            recurrence_rule: req.recurrence_rule.map(non_empty),
            repeat_after_completion: req.repeat_after_completion,
            geo_place_id: geofence.as_ref().map(|g| g.place.clone()),
            geo_lat: geofence.as_ref().map(|g| g.lat),
            geo_lng: geofence.as_ref().map(|g| g.lng),
            geo_radius_m: geofence.as_ref().map(|g| g.radius),
        };

        // Completing a task that was open, not re-sending `done: true` for one already done:
        // the second must not create a second next occurrence.
        let completing = req.done == Some(true) && !before.done;

        let updated = self.repo.update_task(task_id, &user.user_id, changes)?;
        let tags = match req.tags {
            Some(tags) => {
                let tags = normalize_tags(tags);
                self.repo.replace_tags(task_id, &tags)?;
                tags
            }
            None => self.repo.find_tags_by_task(task_id)?,
        };

        // A scheduled task and its event show the same words in two places, so a
        // rename has to reach both or the calendar keeps showing the old title
        // with no way for the user to correct it — the event is not editable as
        // itself from the task editor.
        if let (Some(event_id), Some(title)) = (updated.event_id.as_deref(), new_title) {
            if let Err(e) = self.events.update_event(
                user,
                event_id,
                UpdateEventRequest {
                    title: Some(title),
                    description: None,
                    start_time: None,
                    end_time: None,
                    all_day: None,
                    location: None,
                    recurrence_rule: None,
                    attendees: None,
                    timezone: None,
                    calendar_id: None,
                },
            ) {
                // The task is already saved. An event that has been deleted out
                // from under the link is the expected case here, and failing the
                // rename over it would make the task uneditable.
                tracing::warn!("Could not retitle event {} for task {}: {:?}", event_id, task_id, e);
            }
        }

        let next_task = match completing {
            true => self.spawn_next_occurrence(user, &updated, &tags, timezone, Utc::now())?,
            false => None,
        };
        // The completed task stops repeating once its next occurrence exists, so un-ticking and
        // re-ticking it cannot spawn that occurrence twice.
        let updated = match next_task {
            Some(_) => self.repo.update_task(
                task_id,
                &user.user_id,
                UpdateTaskRecord {
                    recurrence_rule: Some(None),
                    ..UpdateTaskRecord::empty(Utc::now().naive_utc())
                },
            )?,
            None => updated,
        };

        let mut response = task_to_response(updated, None, tags);
        response.next_task = next_task.map(Box::new);
        Ok(response)
    }

    /// RTM's repeat: the completed task stays done and a new task is created for the next
    /// occurrence, carrying everything but the completion, the calendar event, attachments and
    /// reminders. `None` when the task doesn't repeat or its rule has run out.
    fn spawn_next_occurrence(
        &self,
        user: &AuthenticatedUser,
        done: &TaskRecord,
        tags: &[String],
        tz: Tz,
        now: DateTime<Utc>,
    ) -> Result<Option<TaskResponse>, ApiError> {
        let Some(rule) = done.recurrence_rule.as_deref() else {
            return Ok(None);
        };
        let Some(next) = next_occurrence(done, rule, tz, now) else {
            return Ok(None);
        };
        let created = Utc::now().naive_utc();
        let saved = self.repo.insert_task(NewTaskRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            title: done.title.clone(),
            notes: done.notes.clone(),
            done: false,
            due_date: Some(next.due),
            position: done.position,
            created_at: created,
            updated_at: created,
            due_has_time: done.due_has_time,
            start_date: next.start,
            start_has_time: done.start_has_time,
            priority: done.priority,
            estimate_minutes: done.estimate_minutes,
            location: done.location.clone(),
            recurrence_rule: Some(next.rule),
            repeat_after_completion: done.repeat_after_completion,
            // The next occurrence reminds you at the same place.
            geo_place_id: done.geo_place_id.clone(),
            geo_lat: done.geo_lat,
            geo_lng: done.geo_lng,
            geo_radius_m: done.geo_radius_m,
        })?;
        if !tags.is_empty() {
            self.repo.replace_tags(&saved.id, tags)?;
        }
        Ok(Some(task_to_response(saved, None, tags.to_vec())))
    }

    /// A newly set saved place must be the caller's; another user's is not found, as a task is.
    fn check_place(&self, user: &AuthenticatedUser, before: &Geofence, after: &Geofence) -> Result<(), ApiError> {
        match after.place.as_deref() {
            Some(id) if before.place.as_deref() != Some(id) && !self.repo.owns_place(id, &user.user_id)? => {
                Err(ApiError::not_found("Place not found"))
            }
            _ => Ok(()),
        }
    }

    pub fn reorder_tasks(
        &self,
        user: &AuthenticatedUser,
        req: ReorderTasksRequest,
    ) -> Result<(), ApiError> {
        match req.list_id.as_deref() {
            Some(list_id) => {
                // Verify the list belongs to the user
                self.repo.find_by_id(list_id, &user.user_id)?;

                // Verify all requested task IDs belong to this list
                let list_tasks = self.repo.find_tasks_by_list_id(&user.user_id, list_id)?;
                let list_task_ids: std::collections::HashSet<&str> =
                    list_tasks.iter().map(|t| t.id.as_str()).collect();
                for task_id in &req.task_ids {
                    if !list_task_ids.contains(task_id.as_str()) {
                        return Err(ApiError::bad_request(&format!(
                            "Task {} is not in list {}",
                            task_id, list_id
                        )));
                    }
                }
            }
            None => {
                // No list to check membership against, so the only thing left to
                // verify is ownership — which `bulk_update_positions` filters on
                // anyway, but silently, and a reorder naming somebody else's task
                // should say so rather than write nothing.
                for task_id in &req.task_ids {
                    self.repo.find_task_by_id(task_id, &user.user_id)?;
                }
            }
        }

        let now = Utc::now().naive_utc();
        let updates: Vec<(String, i32)> = req
            .task_ids
            .into_iter()
            .enumerate()
            .map(|(i, id)| (id, i as i32))
            .collect();

        self.repo
            .bulk_update_positions(&user.user_id, &updates, now)
    }

    // ── List Membership ───────────────────────────────────────────────────────

    pub fn add_task_to_list(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        list_id: &str,
    ) -> Result<(), ApiError> {
        // Verify ownership of both task and list
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        self.repo.find_by_id(list_id, &user.user_id)?;
        // Idempotent: if membership already exists, succeed silently
        if self.repo.membership_exists(task_id, list_id)? {
            return Ok(());
        }
        self.repo.insert_membership(NewTaskListMembershipRecord {
            task_id: task_id.to_string(),
            list_id: list_id.to_string(),
        })?;
        Ok(())
    }

    // ── Calendar scheduling ───────────────────────────────────────────────────

    /// Put a task on the calendar, or move the event it is already on.
    ///
    /// Idempotent in the sense that matters: calling it twice does not leave two events
    /// behind. The event is a plain local event with the task's title, so it renders in
    /// Month, Week and Agenda with no view needing to know a task exists.
    pub fn schedule_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        req: ScheduleTaskRequest,
    ) -> Result<EventResponse, ApiError> {
        let task = self.repo.find_task_by_id(task_id, &user.user_id)?;

        let start = parse_dt(&req.start_time)?;
        let end = parse_dt(&req.end_time)?;
        if end < start {
            return Err(ApiError::bad_request("endTime is before startTime"));
        }

        // An event id that no longer resolves means the event was deleted from
        // the calendar directly; treat the task as unscheduled and make a new
        // one rather than reporting a 404 the user cannot act on.
        if let Some(event_id) = task.event_id.as_deref() {
            let moved = self.events.update_event(
                user,
                event_id,
                UpdateEventRequest {
                    title: Some(task.title.clone()),
                    description: None,
                    start_time: Some(req.start_time.clone()),
                    end_time: Some(req.end_time.clone()),
                    all_day: Some(req.all_day),
                    location: None,
                    recurrence_rule: None,
                    attendees: None,
                    timezone: req.timezone.clone(),
                    calendar_id: None,
                },
            );
            match moved {
                Ok(event) => return Ok(event),
                Err(e) => tracing::warn!(
                    "Task {} pointed at missing event {}; rescheduling: {:?}",
                    task_id,
                    event_id,
                    e
                ),
            }
        }

        let event = self.events.create_event(
            user,
            CreateEventRequest {
                title: task.title.clone(),
                description: task.notes.clone(),
                start_time: req.start_time,
                end_time: req.end_time,
                all_day: req.all_day,
                location: None,
                recurrence_rule: None,
                attendees: Vec::new(),
                timezone: req.timezone,
                calendar_id: None,
            },
        )?;
        self.repo.set_task_event(
            task_id,
            &user.user_id,
            Some(&event.id),
            Utc::now().naive_utc(),
        )?;
        Ok(event)
    }

    /// Take a task off the calendar, deleting the event it was scheduled as.
    pub fn unschedule_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
    ) -> Result<TaskResponse, ApiError> {
        let task = self.repo.find_task_by_id(task_id, &user.user_id)?;
        if let Some(event_id) = task.event_id.as_deref() {
            // Already gone from the calendar is the outcome asked for, so a
            // missing event is success, not a 404.
            if let Err(e) = self.events.delete_event(user, event_id) {
                tracing::warn!(
                    "Could not delete event {} while unscheduling task {}: {:?}",
                    event_id,
                    task_id,
                    e
                );
            }
        }
        let updated = self
            .repo
            .set_task_event(task_id, &user.user_id, None, Utc::now().naive_utc())?;
        let tags = self.repo.find_tags_by_task(task_id)?;
        Ok(task_to_response(updated, None, tags))
    }

    // ── Attachments ───────────────────────────────────────────────────────────

    pub fn list_attachments(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
    ) -> Result<ListTaskAttachmentsResponse, ApiError> {
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        let attachments = self
            .repo
            .find_attachments_by_task(task_id)?
            .into_iter()
            .map(task_attachment_to_response)
            .collect();
        Ok(ListTaskAttachmentsResponse { attachments })
    }

    pub fn create_attachment(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        req: CreateTaskAttachmentRequest,
    ) -> Result<TaskAttachmentResponse, ApiError> {
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        if req.file_id.is_none() && req.note.is_none() {
            return Err(ApiError::bad_request("Provide either fileId or note"));
        }
        let saved = self.repo.insert_attachment(NewTaskAttachmentRecord {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            file_id: req.file_id,
            name: req.name,
            note: req.note,
        })?;
        Ok(task_attachment_to_response(saved))
    }

    pub fn delete_attachment(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        attachment_id: &str,
    ) -> Result<(), ApiError> {
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        self.repo.delete_attachment(attachment_id, task_id)
    }
}

fn parse_dt(s: &str) -> Result<NaiveDateTime, ApiError> {
    s.parse::<chrono::DateTime<chrono::Utc>>()
        .map(|dt| dt.naive_utc())
        .or_else(|_| s.parse::<NaiveDateTime>())
        .map_err(|_| ApiError::bad_request(&format!("Invalid datetime: {}", s)))
}

fn task_list_to_response(r: crate::calendar::tasks::model::TaskListRecord) -> TaskListResponse {
    TaskListResponse {
        id: r.id,
        name: r.name,
        color: r.color,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}

fn parse_patch_dt(
    patch: Option<Option<String>>,
) -> Result<Option<Option<NaiveDateTime>>, ApiError> {
    Ok(match patch {
        None => None,
        Some(None) => Some(None),
        Some(Some(ref s)) => Some(Some(parse_dt(s)?)),
    })
}

/// An empty string means "none", stored as NULL like a field that was never set.
fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|v| !v.trim().is_empty())
}

fn validate_priority(priority: Option<i32>) -> Result<(), ApiError> {
    match priority {
        Some(p) if !(1..=3).contains(&p) => {
            Err(ApiError::bad_request("priority must be 1, 2 or 3"))
        }
        _ => Ok(()),
    }
}

fn validate_estimate(minutes: Option<i32>) -> Result<(), ApiError> {
    match minutes {
        Some(m) if m < 0 => Err(ApiError::bad_request(
            "estimateMinutes must not be negative",
        )),
        _ => Ok(()),
    }
}

/// Lowercase, without the `#` Smart Add types, without blanks or repeats, sorted — so the same
/// set of tags always reads back the same way whichever client wrote it.
fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut tags: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().trim_start_matches('#').trim().to_lowercase())
        .filter(|t| !t.is_empty())
        .collect();
    tags.sort();
    tags.dedup();
    tags
}

struct NextOccurrence {
    due: NaiveDateTime,
    start: Option<NaiveDateTime>,
    /// The rule for the new task: COUNT decremented, if it had one.
    rule: String,
}

/// Where a repeating task completed at `now` comes round next.
///
/// A date-only due (`<day>T00:00:00Z`) is stepped in UTC, so it stays on its named day whatever
/// zone the user is in; a timed one is stepped in `tz`, keeping its wall-clock time across DST.
/// It steps from the due date, or — for "*after", or a task with no due date — from the day it
/// was completed, at the due's time of day. The start date keeps its distance from the due.
fn next_occurrence(
    task: &TaskRecord,
    rule: &str,
    tz: Tz,
    now: DateTime<Utc>,
) -> Option<NextOccurrence> {
    let step_tz = if task.due_has_time { tz } else { Tz::UTC };
    let today = now.with_timezone(&tz).date_naive();
    let anchor = match task.due_date {
        Some(due) if !task.repeat_after_completion => due.and_utc(),
        Some(due) if task.due_has_time => {
            let time = due.and_utc().with_timezone(&tz).time();
            tz.from_local_datetime(&today.and_time(time))
                .earliest()
                .map_or(now, |t| t.with_timezone(&Utc))
        }
        _ => today.and_hms_opt(0, 0, 0)?.and_utc(),
    };
    let Completion::Advance { due, rule } = recurrence::complete(anchor, rule, step_tz)? else {
        return None;
    };
    let due = due.naive_utc();
    let start = task.start_date.map(|start| match task.due_date {
        Some(old_due) => due - (old_due - start),
        None => start + (due - anchor.naive_utc()),
    });
    Some(NextOccurrence { due, start, rule })
}

fn task_to_response(
    r: crate::calendar::tasks::model::TaskRecord,
    list_id: Option<String>,
    tags: Vec<String>,
) -> TaskResponse {
    TaskResponse {
        id: r.id,
        title: r.title,
        notes: r.notes,
        done: r.done,
        due_date: r
            .due_date
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        position: r.position,
        list_id,
        event_id: r.event_id,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        due_has_time: r.due_has_time,
        start_date: r
            .start_date
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        start_has_time: r.start_has_time,
        priority: r.priority,
        estimate_minutes: r.estimate_minutes,
        location: r.location,
        recurrence_rule: r.recurrence_rule,
        repeat_after_completion: r.repeat_after_completion,
        tags,
        geo_place_id: r.geo_place_id,
        geo_lat: r.geo_lat,
        geo_lng: r.geo_lng,
        geo_radius_m: r.geo_radius_m,
        next_task: None,
    }
}

// ── Geofences ─────────────────────────────────────────────────────────────────

/// The radius a point gets when none is given, and the range allowed; iOS clamps to the same.
pub const DEFAULT_GEO_RADIUS_M: i32 = 150;
pub const MIN_GEO_RADIUS_M: i32 = 100;
pub const MAX_GEO_RADIUS_M: i32 = 2000;

/// A task's arrival geofence as stored: a saved place, or a point with its radius, or nothing.
#[derive(Debug, Clone, Default, PartialEq)]
struct Geofence {
    place: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    radius: Option<i32>,
}

impl Geofence {
    fn of(task: &TaskRecord) -> Self {
        Geofence {
            place: task.geo_place_id.clone(),
            lat: task.geo_lat,
            lng: task.geo_lng,
            radius: task.geo_radius_m,
        }
    }
}

/// The geofence once a request's geo fields are applied to `current`, or `None` when it names
/// none of them, so an edit from a client that doesn't know geofences leaves one alone.
///
/// Each field is absent (keep), `null` (clear) or a value. Setting a place clears the point and
/// setting a point clears the place; setting both at once is refused. Latitude and longitude come
/// together, a point gets a radius of 150 m when it has none, and a radius needs a point.
fn resolve_geofence(
    current: Geofence,
    place: Option<Option<String>>,
    lat: Option<Option<f64>>,
    lng: Option<Option<f64>>,
    radius: Option<Option<i32>>,
) -> Result<Option<Geofence>, ApiError> {
    if place.is_none() && lat.is_none() && lng.is_none() && radius.is_none() {
        return Ok(None);
    }
    if let Some(Some(v)) = lat {
        if !(-90.0..=90.0).contains(&v) {
            return Err(ApiError::bad_request("geoLat must be between -90 and 90"));
        }
    }
    if let Some(Some(v)) = lng {
        if !(-180.0..=180.0).contains(&v) {
            return Err(ApiError::bad_request("geoLng must be between -180 and 180"));
        }
    }
    if let Some(Some(v)) = radius {
        if !(MIN_GEO_RADIUS_M..=MAX_GEO_RADIUS_M).contains(&v) {
            return Err(ApiError::bad_request(format!(
                "geoRadiusM must be between {MIN_GEO_RADIUS_M} and {MAX_GEO_RADIUS_M}"
            )));
        }
    }
    let place = place.map(|p| p.filter(|id| !id.trim().is_empty()));
    let sets_place = matches!(place, Some(Some(_)));
    let sets_point = matches!(lat, Some(Some(_))) || matches!(lng, Some(Some(_)));
    if sets_place && sets_point {
        return Err(ApiError::bad_request(
            "A task's geofence is a saved place or a point, not both",
        ));
    }
    let sets_radius = matches!(radius, Some(Some(_)));

    let mut g = current;
    if let Some(v) = place {
        g.place = v;
    }
    if let Some(v) = lat {
        g.lat = v;
    }
    if let Some(v) = lng {
        g.lng = v;
    }
    if let Some(v) = radius {
        g.radius = v;
    }
    if sets_place {
        g.lat = None;
        g.lng = None;
        g.radius = None;
    }
    if sets_point {
        g.place = None;
    }
    if g.lat.is_some() != g.lng.is_some() {
        return Err(ApiError::bad_request("geoLat and geoLng come together"));
    }
    if g.lat.is_some() {
        g.radius.get_or_insert(DEFAULT_GEO_RADIUS_M);
    } else if sets_radius {
        return Err(ApiError::bad_request("geoRadiusM needs a point"));
    } else {
        g.radius = None;
    }
    Ok(Some(g))
}

fn task_attachment_to_response(
    r: crate::calendar::tasks::model::TaskAttachmentRecord,
) -> TaskAttachmentResponse {
    TaskAttachmentResponse {
        id: r.id,
        task_id: r.task_id,
        file_id: r.file_id,
        name: r.name,
        note: r.note,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::events::attendees::AttendeesRepository;
    use crate::calendar::events::repository::EventsRepository;
    use crate::shared::DbPool;
    use diesel::prelude::*;

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn insert_user(pool: &DbPool, id: &str) {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO users (id, email, name, password_hash, created_at, role, totp_enabled) \
             VALUES (?, ?, ?, 'hash', datetime('now'), 'user', 0)",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(format!("{id}@example.com"))
        .bind::<diesel::sql_types::Text, _>(id)
        .execute(&mut conn)
        .expect("insert user");
    }

    fn test_user(user_id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            token: "test-token".to_string(),
            is_admin: false,
        }
    }

    fn test_service() -> (TasksService, AuthenticatedUser, AuthenticatedUser) {
        let (service, a, b, _) = test_service_and_pool();
        (service, a, b)
    }

    fn test_service_and_pool() -> (TasksService, AuthenticatedUser, AuthenticatedUser, DbPool) {
        let pool = test_pool();
        insert_user(&pool, "user-a");
        insert_user(&pool, "user-b");
        let events = Arc::new(EventsService::new(
            Arc::new(EventsRepository::new(pool.clone())),
            Arc::new(AttendeesRepository::new(pool.clone())),
        ));
        let service = TasksService::new(Arc::new(TasksRepository::new(pool.clone())), events);
        (service, test_user("user-a"), test_user("user-b"), pool)
    }

    fn new_task(service: &TasksService, user: &AuthenticatedUser, title: &str) -> TaskResponse {
        service
            .create_task(
                user,
                CreateTaskRequest {
                    title: title.to_string(),
                    notes: None,
                    due_date: None,
                    position: None,
                    ..Default::default()
                },
            )
            .expect("create task")
    }

    fn schedule_req() -> ScheduleTaskRequest {
        ScheduleTaskRequest {
            start_time: "2026-10-01T09:00:00Z".to_string(),
            end_time: "2026-10-01T10:00:00Z".to_string(),
            all_day: false,
            timezone: Some("UTC".to_string()),
        }
    }

    // ── Scheduling ────────────────────────────────────────────────────────────

    #[test]
    fn a_new_task_is_not_on_the_calendar() {
        let (service, user, _) = test_service();
        assert_eq!(new_task(&service, &user, "Clean ceiling fans").event_id, None);
    }

    #[test]
    fn scheduling_a_task_creates_an_event_carrying_its_title() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");

        let event = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        assert_eq!(event.title, "Clean ceiling fans");
        let listed = service.list_tasks(&user, None).expect("list");
        assert_eq!(listed[0].event_id.as_deref(), Some(event.id.as_str()));
    }

    #[test]
    fn scheduling_twice_moves_the_event_rather_than_creating_a_second_one() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        let first = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        let moved = service
            .schedule_task(
                &user,
                &task.id,
                ScheduleTaskRequest {
                    start_time: "2026-10-02T14:00:00Z".to_string(),
                    end_time: "2026-10-02T15:00:00Z".to_string(),
                    all_day: false,
                    timezone: Some("UTC".to_string()),
                },
            )
            .expect("reschedule");

        assert_eq!(moved.id, first.id, "the task keeps the one event it had");
        let events = service
            .events
            .list_events(
                &user,
                crate::calendar::events::dto::ListEventsQuery {
                    from: Some("2026-09-01T00:00:00Z".to_string()),
                    to: Some("2026-11-01T00:00:00Z".to_string()),
                    ..Default::default()
                },
            )
            .expect("list events");
        assert_eq!(events.events.len(), 1);
        assert!(events.events[0].start_time.starts_with("2026-10-02T14:00"));
    }

    #[test]
    fn unscheduling_deletes_the_event_and_clears_the_link() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        let cleared = service.unschedule_task(&user, &task.id).expect("unschedule");

        assert_eq!(cleared.event_id, None);
        let events = service
            .events
            .list_events(
                &user,
                crate::calendar::events::dto::ListEventsQuery {
                    from: Some("2026-09-01T00:00:00Z".to_string()),
                    to: Some("2026-11-01T00:00:00Z".to_string()),
                    ..Default::default()
                },
            )
            .expect("list events");
        assert!(events.events.is_empty());
    }

    #[test]
    fn unscheduling_a_task_that_was_never_scheduled_succeeds() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        assert_eq!(
            service
                .unschedule_task(&user, &task.id)
                .expect("unschedule")
                .event_id,
            None
        );
    }

    #[test]
    fn an_event_deleted_from_the_calendar_leaves_the_task_reschedulable() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        let first = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        // The user deletes the event from a calendar view; the task's link is
        // now stale, which is the one row that can be.
        service
            .events
            .delete_event(&user, &first.id)
            .expect("delete event");

        let again = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("reschedule after the event went missing");
        assert_ne!(again.id, first.id);
    }

    #[test]
    fn scheduling_rejects_an_end_before_its_start() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        let err = service
            .schedule_task(
                &user,
                &task.id,
                ScheduleTaskRequest {
                    start_time: "2026-10-01T10:00:00Z".to_string(),
                    end_time: "2026-10-01T09:00:00Z".to_string(),
                    all_day: false,
                    timezone: None,
                },
            )
            .expect_err("should reject");
        assert!(format!("{err:?}").contains("before"));
    }

    #[test]
    fn renaming_a_scheduled_task_retitles_its_event() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        let event = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        service
            .update_task(
                &user,
                &task.id,
                UpdateTaskRequest {
                    title: Some("Clean the ceiling fans".to_string()),
                    notes: None,
                    done: None,
                    due_date: None,
                    position: None,
                    ..Default::default()
                },
            )
            .expect("rename");

        let refreshed = service.events.get_event(&user, &event.id).expect("get event");
        assert_eq!(refreshed.title, "Clean the ceiling fans");
    }

    #[test]
    fn a_task_cannot_be_scheduled_by_another_user() {
        let (service, user_a, user_b) = test_service();
        let task = new_task(&service, &user_a, "Clean ceiling fans");
        assert!(service.schedule_task(&user_b, &task.id, schedule_req()).is_err());
    }

    // ── Attachments ───────────────────────────────────────────────────────────

    #[test]
    fn a_note_and_a_drive_file_both_attach_to_a_task() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");

        service
            .create_attachment(
                &user,
                &task.id,
                CreateTaskAttachmentRequest {
                    file_id: None,
                    name: None,
                    note: Some("Buy a longer duster".to_string()),
                },
            )
            .expect("note");
        service
            .create_attachment(
                &user,
                &task.id,
                CreateTaskAttachmentRequest {
                    file_id: Some("file-1".to_string()),
                    name: Some("Instructions.docx".to_string()),
                    note: None,
                },
            )
            .expect("file");

        let listed = service.list_attachments(&user, &task.id).expect("list");
        assert_eq!(listed.attachments.len(), 2);
    }

    #[test]
    fn an_attachment_that_is_neither_a_file_nor_a_note_is_rejected() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        assert!(service
            .create_attachment(
                &user,
                &task.id,
                CreateTaskAttachmentRequest { file_id: None, name: None, note: None },
            )
            .is_err());
    }

    #[test]
    fn attachments_are_not_readable_or_writable_by_another_user() {
        let (service, user_a, user_b) = test_service();
        let task = new_task(&service, &user_a, "Clean ceiling fans");
        let attachment = service
            .create_attachment(
                &user_a,
                &task.id,
                CreateTaskAttachmentRequest {
                    file_id: None,
                    name: None,
                    note: Some("private".to_string()),
                },
            )
            .expect("attach");

        assert!(service.list_attachments(&user_b, &task.id).is_err());
        assert!(service
            .delete_attachment(&user_b, &task.id, &attachment.id)
            .is_err());
        assert!(service
            .delete_attachment(&user_a, &task.id, &attachment.id)
            .is_ok());
    }

    // ── Patch semantics ───────────────────────────────────────────────────────

    #[test]
    fn omitting_notes_leaves_them_alone_while_null_clears_them() {
        let (service, user, _) = test_service();
        let task = service
            .create_task(
                &user,
                CreateTaskRequest {
                    title: "Clean ceiling fans".to_string(),
                    notes: Some("Use the long duster".to_string()),
                    due_date: Some("2026-10-01T00:00:00Z".to_string()),
                    position: None,
                    ..Default::default()
                },
            )
            .expect("create");

        // Absent fields: `serde_json` gives the same request the client sends.
        let untouched: UpdateTaskRequest =
            serde_json::from_str(r#"{"done":true}"#).expect("parse patch");
        let after = service.update_task(&user, &task.id, untouched).expect("patch");
        assert_eq!(after.notes.as_deref(), Some("Use the long duster"));
        assert!(after.due_date.is_some());
        assert!(after.done);

        let cleared: UpdateTaskRequest =
            serde_json::from_str(r#"{"notes":null,"dueDate":null}"#).expect("parse patch");
        let after = service.update_task(&user, &task.id, cleared).expect("patch");
        assert_eq!(after.notes, None);
        assert_eq!(after.due_date, None);
    }

    // ── Reorder without a list ────────────────────────────────────────────────

    #[test]
    fn reorder_without_a_list_rewrites_positions_across_every_task() {
        let (service, user, _) = test_service();
        let first = new_task(&service, &user, "First");
        let second = new_task(&service, &user, "Second");
        let third = new_task(&service, &user, "Third");

        service
            .reorder_tasks(
                &user,
                ReorderTasksRequest {
                    list_id: None,
                    task_ids: vec![third.id.clone(), first.id.clone(), second.id.clone()],
                },
            )
            .expect("reorder");

        let ordered: Vec<String> = service
            .list_tasks(&user, None)
            .expect("list")
            .into_iter()
            .map(|t| t.title)
            .collect();
        assert_eq!(ordered, vec!["Third", "First", "Second"]);
    }

    #[test]
    fn reorder_without_a_list_refuses_a_task_belonging_to_someone_else() {
        let (service, user_a, user_b) = test_service();
        let mine = new_task(&service, &user_a, "Mine");
        let theirs = new_task(&service, &user_b, "Theirs");

        assert!(service
            .reorder_tasks(
                &user_a,
                ReorderTasksRequest {
                    list_id: None,
                    task_ids: vec![theirs.id, mine.id],
                },
            )
            .is_err());
    }

    // ── Smart Add fields ──────────────────────────────────────────────────────

    fn complete(service: &TasksService, user: &AuthenticatedUser, id: &str) -> TaskResponse {
        service
            .update_task(
                user,
                id,
                UpdateTaskRequest {
                    done: Some(true),
                    ..Default::default()
                },
            )
            .expect("complete")
    }

    fn repeating_task(
        service: &TasksService,
        user: &AuthenticatedUser,
        rule: &str,
    ) -> TaskResponse {
        service
            .create_task(
                user,
                CreateTaskRequest {
                    title: "Water the plants".to_string(),
                    due_date: Some("2026-10-01T00:00:00Z".to_string()),
                    start_date: Some("2026-09-30T00:00:00Z".to_string()),
                    priority: Some(2),
                    recurrence_rule: Some(rule.to_string()),
                    tags: vec!["home".to_string()],
                    ..Default::default()
                },
            )
            .expect("create")
    }

    #[test]
    fn every_smart_add_field_round_trips_and_tags_are_normalised() {
        let (service, user, _) = test_service();
        let created = service
            .create_task(
                &user,
                CreateTaskRequest {
                    title: "Buy milk".to_string(),
                    due_date: Some("2026-10-02T17:00:00Z".to_string()),
                    due_has_time: true,
                    start_date: Some("2026-10-01T00:00:00Z".to_string()),
                    priority: Some(1),
                    estimate_minutes: Some(15),
                    location: Some("Safeway".to_string()),
                    recurrence_rule: Some("FREQ=WEEKLY".to_string()),
                    repeat_after_completion: true,
                    tags: vec![
                        "#Errands".into(),
                        "errands".into(),
                        " ".into(),
                        "Food".into(),
                    ],
                    ..Default::default()
                },
            )
            .expect("create");

        let listed = service.list_tasks(&user, None).expect("list").remove(0);
        for task in [&created, &listed] {
            assert_eq!(task.due_date.as_deref(), Some("2026-10-02T17:00:00Z"));
            assert!(task.due_has_time);
            assert_eq!(task.start_date.as_deref(), Some("2026-10-01T00:00:00Z"));
            assert!(!task.start_has_time);
            assert_eq!(task.priority, Some(1));
            assert_eq!(task.estimate_minutes, Some(15));
            assert_eq!(task.location.as_deref(), Some("Safeway"));
            assert_eq!(task.recurrence_rule.as_deref(), Some("FREQ=WEEKLY"));
            assert!(task.repeat_after_completion);
            assert_eq!(task.tags, vec!["errands", "food"]);
        }
    }

    #[test]
    fn a_priority_outside_one_to_three_is_rejected() {
        let (service, user, _) = test_service();
        let req = CreateTaskRequest {
            title: "x".to_string(),
            priority: Some(4),
            ..Default::default()
        };
        assert!(service.create_task(&user, req).is_err());
    }

    #[test]
    fn tags_are_replaced_when_sent_and_kept_when_omitted() {
        let (service, user, _) = test_service();
        let task = repeating_task(&service, &user, "FREQ=DAILY");
        let renamed = service
            .update_task(
                &user,
                &task.id,
                UpdateTaskRequest {
                    title: Some("Water the ferns".to_string()),
                    ..Default::default()
                },
            )
            .expect("rename");
        assert_eq!(renamed.tags, vec!["home"]);

        let retagged = service
            .update_task(
                &user,
                &task.id,
                UpdateTaskRequest {
                    tags: Some(vec!["garden".to_string()]),
                    ..Default::default()
                },
            )
            .expect("retag");
        assert_eq!(retagged.tags, vec!["garden"]);
    }

    #[test]
    fn null_clears_priority_location_and_repeat() {
        let (service, user, _) = test_service();
        let task = repeating_task(&service, &user, "FREQ=DAILY");
        let patch: UpdateTaskRequest =
            serde_json::from_str(r#"{"priority":null,"recurrenceRule":null,"location":null}"#)
                .expect("parse patch");
        let after = service.update_task(&user, &task.id, patch).expect("patch");
        assert_eq!(after.priority, None);
        assert_eq!(after.recurrence_rule, None);
        assert_eq!(after.location, None);
    }

    #[test]
    fn completing_a_repeating_task_keeps_it_done_and_creates_the_next_one() {
        let (service, user, _) = test_service();
        let task = repeating_task(&service, &user, "FREQ=WEEKLY");

        let done = complete(&service, &user, &task.id);
        assert!(done.done);
        assert_eq!(
            done.recurrence_rule, None,
            "the completed one stops repeating"
        );

        let next = done.next_task.expect("a next occurrence");
        assert_ne!(next.id, task.id);
        assert!(!next.done);
        assert_eq!(next.title, "Water the plants");
        assert_eq!(next.due_date.as_deref(), Some("2026-10-08T00:00:00Z"));
        assert_eq!(next.start_date.as_deref(), Some("2026-10-07T00:00:00Z"));
        assert_eq!(next.priority, Some(2));
        assert_eq!(next.tags, vec!["home"]);
        assert_eq!(next.recurrence_rule.as_deref(), Some("FREQ=WEEKLY"));

        assert_eq!(service.list_tasks(&user, None).expect("list").len(), 2);
    }

    #[test]
    fn completing_a_task_already_done_does_not_create_another() {
        let (service, user, _) = test_service();
        let task = repeating_task(&service, &user, "FREQ=DAILY");
        complete(&service, &user, &task.id);
        let again = complete(&service, &user, &task.id);
        assert!(again.next_task.is_none());
        assert_eq!(service.list_tasks(&user, None).expect("list").len(), 2);
    }

    #[test]
    fn a_used_up_count_completes_without_a_next_occurrence() {
        let (service, user, _) = test_service();
        let task = repeating_task(&service, &user, "FREQ=DAILY;COUNT=2");
        let next = complete(&service, &user, &task.id)
            .next_task
            .expect("one more");
        assert_eq!(next.recurrence_rule.as_deref(), Some("FREQ=DAILY;COUNT=1"));
        assert!(complete(&service, &user, &next.id).next_task.is_none());
    }

    fn record(due: Option<&str>, due_has_time: bool, after: bool) -> TaskRecord {
        let at = |s: &str| s.parse::<DateTime<Utc>>().expect("instant").naive_utc();
        TaskRecord {
            id: "t".into(),
            user_id: "u".into(),
            title: "t".into(),
            notes: None,
            done: true,
            due_date: due.map(at),
            position: 0,
            created_at: at("2026-01-01T00:00:00Z"),
            updated_at: at("2026-01-01T00:00:00Z"),
            event_id: None,
            due_has_time,
            start_date: None,
            start_has_time: false,
            priority: None,
            estimate_minutes: None,
            location: None,
            recurrence_rule: None,
            repeat_after_completion: after,
            geo_place_id: None,
            geo_lat: None,
            geo_lng: None,
            geo_radius_m: None,
        }
    }

    fn next_due(task: &TaskRecord, rule: &str, tz: Tz, now: &str) -> Option<String> {
        let now = now.parse::<DateTime<Utc>>().expect("now");
        next_occurrence(task, rule, tz, now).map(|n| n.due.format("%Y-%m-%dT%H:%M:%SZ").to_string())
    }

    #[test]
    fn repeat_after_counts_from_the_completion_day_not_the_due_date() {
        let task = record(Some("2026-09-01T00:00:00Z"), false, true);
        assert_eq!(
            next_due(
                &task,
                "FREQ=WEEKLY;INTERVAL=2",
                Tz::UTC,
                "2026-09-25T15:00:00Z"
            )
            .as_deref(),
            Some("2026-10-09T00:00:00Z")
        );
    }

    #[test]
    fn a_timed_repeat_keeps_its_wall_clock_time_across_dst() {
        // 09:00 in New York on Oct 30 (EDT, UTC-4) → 09:00 on Nov 6 (EST, UTC-5).
        let task = record(Some("2026-10-30T13:00:00Z"), true, false);
        let tz: Tz = "America/New_York".parse().unwrap();
        assert_eq!(
            next_due(&task, "FREQ=WEEKLY", tz, "2026-10-30T14:00:00Z").as_deref(),
            Some("2026-11-06T14:00:00Z")
        );
    }

    #[test]
    fn a_date_only_repeat_stays_on_its_day_whatever_the_zone() {
        let task = record(Some("2026-10-01T00:00:00Z"), false, false);
        let tz: Tz = "Pacific/Auckland".parse().unwrap();
        assert_eq!(
            next_due(&task, "FREQ=DAILY", tz, "2026-10-01T02:00:00Z").as_deref(),
            Some("2026-10-02T00:00:00Z")
        );
    }

    #[test]
    fn a_repeating_task_with_no_due_date_steps_from_the_completion_day() {
        let task = record(None, false, false);
        let tz: Tz = "America/Los_Angeles".parse().unwrap();
        // 03:00 UTC on the 26th is still the 25th in Los Angeles.
        assert_eq!(
            next_due(&task, "FREQ=DAILY", tz, "2026-09-26T03:00:00Z").as_deref(),
            Some("2026-09-26T00:00:00Z")
        );
    }

    // ── Geofences ─────────────────────────────────────────────────────────────

    /// A saved place of `owner`'s, made directly: its payload is opaque here.
    fn place(pool: &DbPool, id: &str, owner: &str) -> String {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(format!(
            "INSERT INTO task_places (id, user_id, encrypted_payload) VALUES ('{id}', '{owner}', 'sealed')"
        ))
        .execute(&mut conn)
        .expect("place");
        id.to_string()
    }

    fn patch(json: &str) -> UpdateTaskRequest {
        serde_json::from_str(json).expect("patch")
    }

    fn create_with(service: &TasksService, user: &AuthenticatedUser, req: CreateTaskRequest) -> Result<TaskResponse, ApiError> {
        service.create_task(user, CreateTaskRequest { title: "Buy milk".into(), ..req })
    }

    #[test]
    fn a_task_is_created_with_a_point_or_a_place() {
        let (service, user, _, pool) = test_service_and_pool();
        let point = create_with(&service, &user, CreateTaskRequest {
            geo_lat: Some(51.5), geo_lng: Some(-0.14), ..Default::default()
        }).unwrap();
        assert_eq!((point.geo_lat, point.geo_lng), (Some(51.5), Some(-0.14)));
        assert_eq!(point.geo_radius_m, Some(DEFAULT_GEO_RADIUS_M), "a point gets the default radius");
        assert_eq!(point.geo_place_id, None);

        let home = place(&pool, "home", "user-a");
        let at_home = create_with(&service, &user, CreateTaskRequest {
            geo_place_id: Some(home.clone()), ..Default::default()
        }).unwrap();
        assert_eq!(at_home.geo_place_id, Some(home));
        assert_eq!((at_home.geo_lat, at_home.geo_radius_m), (None, None));

        let plain = create_with(&service, &user, CreateTaskRequest::default()).unwrap();
        assert_eq!((plain.geo_place_id, plain.geo_lat), (None, None));
    }

    #[test]
    fn out_of_range_or_half_points_are_refused() {
        let (service, user, _) = test_service();
        let refused = |req: CreateTaskRequest| create_with(&service, &user, req).unwrap_err().status;
        assert_eq!(refused(CreateTaskRequest { geo_lat: Some(91.0), geo_lng: Some(0.0), ..Default::default() }), 400);
        assert_eq!(refused(CreateTaskRequest { geo_lat: Some(0.0), geo_lng: Some(180.5), ..Default::default() }), 400);
        assert_eq!(refused(CreateTaskRequest { geo_lat: Some(10.0), ..Default::default() }), 400);
        assert_eq!(refused(CreateTaskRequest { geo_lat: Some(1.0), geo_lng: Some(1.0), geo_radius_m: Some(99), ..Default::default() }), 400);
        assert_eq!(refused(CreateTaskRequest { geo_lat: Some(1.0), geo_lng: Some(1.0), geo_radius_m: Some(2001), ..Default::default() }), 400);
        assert_eq!(refused(CreateTaskRequest { geo_radius_m: Some(300), ..Default::default() }), 400, "a radius needs a point");
        assert_eq!(
            refused(CreateTaskRequest { geo_place_id: Some("p".into()), geo_lat: Some(1.0), geo_lng: Some(1.0), ..Default::default() }),
            400,
            "a place or a point, not both"
        );
        let edges = create_with(&service, &user, CreateTaskRequest {
            geo_lat: Some(-90.0), geo_lng: Some(180.0), geo_radius_m: Some(2000), ..Default::default()
        }).unwrap();
        assert_eq!(edges.geo_radius_m, Some(2000));
    }

    #[test]
    fn another_users_place_is_not_found() {
        let (service, user, _, pool) = test_service_and_pool();
        let theirs = place(&pool, "theirs", "user-b");
        let made = create_with(&service, &user, CreateTaskRequest { geo_place_id: Some(theirs.clone()), ..Default::default() });
        assert_eq!(made.unwrap_err().status, 404);
        let task = new_task(&service, &user, "Buy milk");
        let set = service.update_task(&user, &task.id, patch(&format!(r#"{{"geoPlaceId":"{theirs}"}}"#)));
        assert_eq!(set.unwrap_err().status, 404);
    }

    #[test]
    fn setting_a_place_clears_the_point_and_the_other_way_round() {
        let (service, user, _, pool) = test_service_and_pool();
        let home = place(&pool, "home", "user-a");
        let task = create_with(&service, &user, CreateTaskRequest {
            geo_lat: Some(1.0), geo_lng: Some(2.0), geo_radius_m: Some(500), ..Default::default()
        }).unwrap();

        // What iOS sends: all four, the other kind null.
        let at_home = service.update_task(&user, &task.id, patch(&format!(
            r#"{{"geoPlaceId":"{home}","geoLat":null,"geoLng":null,"geoRadiusM":null}}"#
        ))).unwrap();
        assert_eq!(at_home.geo_place_id, Some(home.clone()));
        assert_eq!((at_home.geo_lat, at_home.geo_lng, at_home.geo_radius_m), (None, None, None));

        // A client that sends only the place gets the same.
        let back = service.update_task(&user, &task.id, patch(r#"{"geoLat":3.0,"geoLng":4.0}"#)).unwrap();
        assert_eq!(back.geo_place_id, None, "a point replaces the place");
        assert_eq!((back.geo_lat, back.geo_lng, back.geo_radius_m), (Some(3.0), Some(4.0), Some(DEFAULT_GEO_RADIUS_M)));

        let wider = service.update_task(&user, &task.id, patch(r#"{"geoRadiusM":800}"#)).unwrap();
        assert_eq!((wider.geo_lat, wider.geo_radius_m), (Some(3.0), Some(800)));

        let cleared = service.update_task(&user, &task.id, patch(
            r#"{"geoPlaceId":null,"geoLat":null,"geoLng":null,"geoRadiusM":null}"#
        )).unwrap();
        assert_eq!((cleared.geo_place_id, cleared.geo_lat, cleared.geo_lng, cleared.geo_radius_m), (None, None, None, None));
    }

    #[test]
    fn half_a_point_after_a_patch_is_refused() {
        let (service, user, _) = test_service();
        let task = create_with(&service, &user, CreateTaskRequest {
            geo_lat: Some(1.0), geo_lng: Some(2.0), ..Default::default()
        }).unwrap();
        let half = service.update_task(&user, &task.id, patch(r#"{"geoLng":null}"#));
        assert_eq!(half.unwrap_err().status, 400);
        let unchanged = service.update_task(&user, &task.id, patch("{}")).unwrap();
        assert_eq!((unchanged.geo_lat, unchanged.geo_lng), (Some(1.0), Some(2.0)));
    }

    #[test]
    fn an_edit_without_geo_fields_keeps_the_geofence() {
        let (service, user, _, pool) = test_service_and_pool();
        let home = place(&pool, "home", "user-a");
        let task = create_with(&service, &user, CreateTaskRequest {
            geo_place_id: Some(home.clone()), location: Some("Home".into()), ..Default::default()
        }).unwrap();
        // An older web or iOS build: renames and completes, knowing nothing of geofences.
        service.update_task(&user, &task.id, patch(r#"{"title":"Buy oat milk","notes":"2 cartons"}"#)).unwrap();
        let done = service.update_task(&user, &task.id, patch(r#"{"done":true}"#)).unwrap();
        assert_eq!(done.title, "Buy oat milk");
        assert_eq!(done.geo_place_id, Some(home));
        assert_eq!(done.location.as_deref(), Some("Home"));
    }

    #[test]
    fn the_next_occurrence_of_a_repeating_task_keeps_its_geofence() {
        let (service, user, _) = test_service();
        let task = create_with(&service, &user, CreateTaskRequest {
            due_date: Some("2026-10-01T00:00:00Z".into()),
            recurrence_rule: Some("FREQ=WEEKLY".into()),
            geo_lat: Some(40.7128), geo_lng: Some(-74.006), geo_radius_m: Some(300),
            ..Default::default()
        }).unwrap();
        let done = service.update_task(&user, &task.id, patch(r#"{"done":true}"#)).unwrap();
        let next = done.next_task.expect("a next occurrence");
        assert_eq!((next.geo_lat, next.geo_lng, next.geo_radius_m), (Some(40.7128), Some(-74.006), Some(300)));
    }

    #[test]
    fn deleting_a_place_clears_it_from_the_task() {
        let (service, user, _, pool) = test_service_and_pool();
        let home = place(&pool, "home", "user-a");
        let task = create_with(&service, &user, CreateTaskRequest { geo_place_id: Some(home.clone()), ..Default::default() }).unwrap();
        crate::calendar::task_places::service::TaskPlacesService::new(pool)
            .delete(&user, &home)
            .unwrap();
        let after = service.list_tasks(&user, None).unwrap().into_iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(after.geo_place_id, None);
    }
}
