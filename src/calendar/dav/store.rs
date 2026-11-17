//! What the CalDAV layer reads: its collections, the objects in each, and the change log.
//! Writes go through the events, tasks and calendars services, so their rules (read-only
//! calendars, series and exceptions, repeating tasks) apply to CalDAV exactly as to the API.

use std::collections::{HashMap, HashSet};

use chrono::NaiveDateTime;
use diesel::prelude::*;

use crate::calendar::calendars::model::{CalendarRecord, LOCAL};
use crate::calendar::events::model::EventRecord;
use crate::calendar::tasks::model::{TaskListRecord, TaskRecord};
use crate::schema::{
    calendars, dav_changes, dav_objects, event_attendees, events, task_list_memberships, task_lists,
    task_tags, tasks,
};
use crate::shared::ApiError;

pub const KIND_EVENT: &str = "event";
pub const KIND_TASK: &str = "task";
pub const KIND_COLLECTION: &str = "collection";

/// The collection that holds tasks in no list. It has no row: "Tasks" in Apple Reminders.
pub const INBOX: &str = "list-inbox";
pub const INBOX_NAME: &str = "Tasks";

#[derive(Debug, Clone)]
pub enum Collection {
    /// A `local` calendar: VEVENT.
    Calendar(CalendarRecord),
    /// A task list: VTODO.
    List(TaskListRecord),
    /// Tasks in no list: VTODO.
    Inbox,
}

impl Collection {
    /// The canonical id, `cal-…`, `list-…` or `list-inbox`, which is also what the change log
    /// and `dav_objects.collection` hold.
    pub fn id(&self) -> String {
        match self {
            Collection::Calendar(c) => format!("cal-{}", c.id),
            Collection::List(l) => format!("list-{}", l.id),
            Collection::Inbox => INBOX.to_string(),
        }
    }

    pub fn is_tasks(&self) -> bool {
        !matches!(self, Collection::Calendar(_))
    }

    pub fn kind(&self) -> &'static str {
        if self.is_tasks() {
            KIND_TASK
        } else {
            KIND_EVENT
        }
    }

    pub fn display_name(&self) -> String {
        match self {
            Collection::Calendar(c) => c.name.clone(),
            Collection::List(l) => l.name.clone(),
            Collection::Inbox => INBOX_NAME.to_string(),
        }
    }

    pub fn color(&self) -> Option<String> {
        match self {
            Collection::Calendar(c) => Some(c.color.clone()),
            Collection::List(l) => l.color.clone(),
            Collection::Inbox => None,
        }
    }

    /// The list a task in this collection is a member of; `None` for the inbox.
    pub fn list_id(&self) -> Option<&str> {
        match self {
            Collection::List(l) => Some(&l.id),
            _ => None,
        }
    }
}

/// What a client knows an object by, from `dav_objects`.
#[derive(Debug, Clone)]
pub struct Meta {
    pub object_id: String,
    pub uid: String,
    pub name: String,
    pub collection: String,
    pub extra: Option<String>,
}

type Conn = SqliteConnection;

// ── Collections ───────────────────────────────────────────────────────────────

/// The user's collections, each with the path segment it is served at: local calendars (the
/// default first), task lists, then the inbox.
pub fn collections(conn: &mut Conn, user_id: &str) -> Result<Vec<(String, Collection)>, ApiError> {
    let aliases = aliases(conn, user_id)?;
    let segment = |id: String| aliases.get(&id).cloned().unwrap_or(id);
    let mut cals: Vec<CalendarRecord> = calendars::table
        .filter(calendars::user_id.eq(user_id))
        .filter(calendars::kind.eq(LOCAL))
        .order(calendars::created_at.asc())
        .select(CalendarRecord::as_select())
        .load(conn)?;
    cals.sort_by_key(|c| !c.is_default);
    let lists: Vec<TaskListRecord> = task_lists::table
        .filter(task_lists::user_id.eq(user_id))
        .order((task_lists::created_at.asc(), task_lists::id.asc()))
        .select(TaskListRecord::as_select())
        .load(conn)?;
    let mut out: Vec<(String, Collection)> = cals
        .into_iter()
        .map(Collection::Calendar)
        .chain(lists.into_iter().map(Collection::List))
        .chain(std::iter::once(Collection::Inbox))
        .map(|c| (segment(c.id()), c))
        .collect();
    out.dedup_by(|a, b| a.0 == b.0);
    Ok(out)
}

/// The collection served at `segment`: its canonical id, or the name a client gave it when it
/// made it with MKCALENDAR.
pub fn resolve_collection(conn: &mut Conn, user_id: &str, segment: &str) -> Result<Option<(String, Collection)>, ApiError> {
    let canonical = dav_objects::table
        .filter(dav_objects::user_id.eq(user_id))
        .filter(dav_objects::kind.eq(KIND_COLLECTION))
        .filter(dav_objects::name.eq(segment))
        .select(dav_objects::object_id)
        .first::<String>(conn)
        .optional()?
        .unwrap_or_else(|| segment.to_string());
    Ok(collections(conn, user_id)?
        .into_iter()
        .find(|(_, c)| c.id() == canonical))
}

/// Canonical collection id → the segment a client chose for it.
fn aliases(conn: &mut Conn, user_id: &str) -> Result<HashMap<String, String>, ApiError> {
    Ok(dav_objects::table
        .filter(dav_objects::user_id.eq(user_id))
        .filter(dav_objects::kind.eq(KIND_COLLECTION))
        .select((dav_objects::object_id, dav_objects::name))
        .load::<(String, String)>(conn)?
        .into_iter()
        .collect())
}

/// Serves the collection `canonical` at `segment` from now on (MKCALENDAR).
pub fn set_alias(conn: &mut Conn, user_id: &str, canonical: &str, segment: &str) -> Result<(), ApiError> {
    upsert_meta(conn, user_id, KIND_COLLECTION, canonical, segment, segment, "", None)
}

// ── Object metadata ───────────────────────────────────────────────────────────

pub fn metas(conn: &mut Conn, user_id: &str, kind: &str) -> Result<HashMap<String, Meta>, ApiError> {
    Ok(dav_objects::table
        .filter(dav_objects::user_id.eq(user_id))
        .filter(dav_objects::kind.eq(kind))
        .select((
            dav_objects::object_id,
            dav_objects::uid,
            dav_objects::name,
            dav_objects::collection,
            dav_objects::extra,
        ))
        .load::<(String, String, String, String, Option<String>)>(conn)?
        .into_iter()
        .map(|(object_id, uid, name, collection, extra)| {
            (
                object_id.clone(),
                Meta {
                    object_id,
                    uid,
                    name,
                    collection,
                    extra,
                },
            )
        })
        .collect())
}

pub fn meta(conn: &mut Conn, kind: &str, object_id: &str) -> Result<Option<Meta>, ApiError> {
    Ok(dav_objects::table
        .filter(dav_objects::kind.eq(kind))
        .filter(dav_objects::object_id.eq(object_id))
        .select((
            dav_objects::object_id,
            dav_objects::uid,
            dav_objects::name,
            dav_objects::collection,
            dav_objects::extra,
        ))
        .first::<(String, String, String, String, Option<String>)>(conn)
        .optional()?
        .map(|(object_id, uid, name, collection, extra)| Meta {
            object_id,
            uid,
            name,
            collection,
            extra,
        }))
}

/// The object a client named `name` (`<something>.ics`), of any collection.
pub fn find_by_name(conn: &mut Conn, user_id: &str, kind: &str, name: &str) -> Result<Option<Meta>, ApiError> {
    let id = dav_objects::table
        .filter(dav_objects::user_id.eq(user_id))
        .filter(dav_objects::kind.eq(kind))
        .filter(dav_objects::name.eq(name))
        .select(dav_objects::object_id)
        .first::<String>(conn)
        .optional()?;
    match id {
        Some(id) => meta(conn, kind, &id),
        None => Ok(None),
    }
}

pub fn find_by_uid(conn: &mut Conn, user_id: &str, kind: &str, uid: &str) -> Result<Option<Meta>, ApiError> {
    let id = dav_objects::table
        .filter(dav_objects::user_id.eq(user_id))
        .filter(dav_objects::kind.eq(kind))
        .filter(dav_objects::uid.eq(uid))
        .select(dav_objects::object_id)
        .first::<String>(conn)
        .optional()?;
    match id {
        Some(id) => meta(conn, kind, &id),
        None => Ok(None),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_meta(
    conn: &mut Conn,
    user_id: &str,
    kind: &str,
    object_id: &str,
    uid: &str,
    name: &str,
    collection: &str,
    extra: Option<&str>,
) -> Result<(), ApiError> {
    // A name or UID another object held (one deleted, kept for its removal to be reported) is
    // handed over: the client has reused it, so the old object is no longer what it means.
    diesel::delete(
        dav_objects::table
            .filter(dav_objects::user_id.eq(user_id))
            .filter(dav_objects::kind.eq(kind))
            .filter(dav_objects::uid.eq(uid).or(dav_objects::name.eq(name)))
            .filter(dav_objects::object_id.ne(object_id)),
    )
    .execute(conn)?;
    diesel::insert_into(dav_objects::table)
        .values((
            dav_objects::kind.eq(kind),
            dav_objects::object_id.eq(object_id),
            dav_objects::user_id.eq(user_id),
            dav_objects::uid.eq(uid),
            dav_objects::name.eq(name),
            dav_objects::collection.eq(collection),
            dav_objects::extra.eq(extra),
        ))
        .on_conflict((dav_objects::kind, dav_objects::object_id))
        .do_update()
        .set((
            dav_objects::uid.eq(uid),
            dav_objects::name.eq(name),
            dav_objects::collection.eq(collection),
            dav_objects::extra.eq(extra),
        ))
        .execute(conn)?;
    Ok(())
}

/// The name an object is served under: the one its client gave it, or `<id>.ics`.
pub fn name_of(meta: Option<&Meta>, object_id: &str) -> String {
    meta.map(|m| m.name.clone())
        .unwrap_or_else(|| format!("{object_id}.ics"))
}

/// The UID an object is known by: its client's, or its own id.
pub fn uid_of(meta: Option<&Meta>, object_id: &str) -> String {
    meta.map(|m| m.uid.clone()).unwrap_or_else(|| object_id.to_string())
}

// ── Events ────────────────────────────────────────────────────────────────────

/// One CalDAV object: a series (or one-off) with its live exceptions and the attendees of each.
#[derive(Debug, Clone)]
pub struct Series {
    pub master: EventRecord,
    pub exceptions: Vec<EventRecord>,
    pub attendees: HashMap<String, Vec<String>>,
}

/// The live series in a calendar, by master id.
pub fn series_in(conn: &mut Conn, user_id: &str, calendar_id: &str) -> Result<Vec<Series>, ApiError> {
    let masters: Vec<EventRecord> = events::table
        .filter(events::user_id.eq(user_id))
        .filter(events::calendar_id.eq(calendar_id))
        .filter(events::deleted_at.is_null())
        .filter(events::recurring_event_id.is_null())
        .order(events::start_time.asc())
        .select(EventRecord::as_select())
        .load(conn)?;
    assemble(conn, masters)
}

/// One live series, if it is the user's and in `calendar_id`.
pub fn series(conn: &mut Conn, user_id: &str, calendar_id: &str, master_id: &str) -> Result<Option<Series>, ApiError> {
    let master: Option<EventRecord> = events::table
        .filter(events::id.eq(master_id))
        .filter(events::user_id.eq(user_id))
        .filter(events::calendar_id.eq(calendar_id))
        .filter(events::deleted_at.is_null())
        .filter(events::recurring_event_id.is_null())
        .select(EventRecord::as_select())
        .first(conn)
        .optional()?;
    Ok(assemble(conn, master.into_iter().collect())?.pop())
}

fn assemble(conn: &mut Conn, masters: Vec<EventRecord>) -> Result<Vec<Series>, ApiError> {
    let ids: Vec<String> = masters.iter().map(|m| m.id.clone()).collect();
    let exceptions: Vec<EventRecord> = events::table
        .filter(events::recurring_event_id.eq_any(&ids))
        .filter(events::deleted_at.is_null())
        .order(events::original_start_time.asc())
        .select(EventRecord::as_select())
        .load(conn)?;
    let all_ids: Vec<String> = ids
        .iter()
        .cloned()
        .chain(exceptions.iter().map(|e| e.id.clone()))
        .collect();
    let mut attendees: HashMap<String, Vec<String>> = HashMap::new();
    for (event_id, email) in event_attendees::table
        .filter(event_attendees::event_id.eq_any(&all_ids))
        .select((event_attendees::event_id, event_attendees::email))
        .load::<(String, String)>(conn)?
    {
        attendees.entry(event_id).or_default().push(email);
    }
    let mut by_master: HashMap<String, Vec<EventRecord>> = HashMap::new();
    for e in exceptions {
        if let Some(m) = e.recurring_event_id.clone() {
            by_master.entry(m).or_default().push(e);
        }
    }
    Ok(masters
        .into_iter()
        .map(|master| {
            let exceptions = by_master.remove(&master.id).unwrap_or_default();
            let mine: HashMap<String, Vec<String>> = std::iter::once(master.id.clone())
                .chain(exceptions.iter().map(|e| e.id.clone()))
                .filter_map(|id| attendees.get(&id).map(|a| (id, a.clone())))
                .collect();
            Series {
                master,
                exceptions,
                attendees: mine,
            }
        })
        .collect())
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct TaskObject {
    pub task: TaskRecord,
    pub tags: Vec<String>,
}

/// Every task of the user with the collection it is served in.
///
/// A task belongs to as many lists as it likes, and a reminder to exactly one, so each task is
/// served in one: its **home list**. That is the collection a client last put it in, while it
/// is still a member of that list; otherwise its oldest list; otherwise the inbox.
pub fn tasks_with_home(conn: &mut Conn, user_id: &str) -> Result<Vec<(String, TaskObject)>, ApiError> {
    let all: Vec<TaskRecord> = tasks::table
        .filter(tasks::user_id.eq(user_id))
        .order((tasks::position.asc(), tasks::created_at.asc()))
        .select(TaskRecord::as_select())
        .load(conn)?;
    let mut lists_of: HashMap<String, Vec<String>> = HashMap::new();
    for (task_id, list_id) in task_list_memberships::table
        .inner_join(task_lists::table)
        .filter(task_lists::user_id.eq(user_id))
        .order((task_lists::created_at.asc(), task_lists::id.asc()))
        .select((task_list_memberships::task_id, task_list_memberships::list_id))
        .load::<(String, String)>(conn)?
    {
        lists_of.entry(task_id).or_default().push(list_id);
    }
    let mut tags_of: HashMap<String, Vec<String>> = HashMap::new();
    let ids: Vec<String> = all.iter().map(|t| t.id.clone()).collect();
    for (task_id, tag) in task_tags::table
        .filter(task_tags::task_id.eq_any(&ids))
        .order(task_tags::tag.asc())
        .select((task_tags::task_id, task_tags::tag))
        .load::<(String, String)>(conn)?
    {
        tags_of.entry(task_id).or_default().push(tag);
    }
    let metas = metas(conn, user_id, KIND_TASK)?;
    Ok(all
        .into_iter()
        .map(|task| {
            let lists = lists_of.get(&task.id).cloned().unwrap_or_default();
            let home = home_of(metas.get(&task.id).map(|m| m.collection.as_str()), &lists);
            let tags = tags_of.remove(&task.id).unwrap_or_default();
            (home, TaskObject { task, tags })
        })
        .collect())
}

/// The collection a task with `lists` (oldest first) is served in, given where a client last
/// put it.
pub fn home_of(last_put: Option<&str>, lists: &[String]) -> String {
    let member = |c: &str| c.strip_prefix("list-").is_some_and(|id| lists.iter().any(|l| l == id));
    match last_put {
        Some(c) if c == INBOX && lists.is_empty() => INBOX.to_string(),
        Some(c) if member(c) => c.to_string(),
        _ => lists
            .first()
            .map(|l| format!("list-{l}"))
            .unwrap_or_else(|| INBOX.to_string()),
    }
}

// ── Change log ────────────────────────────────────────────────────────────────

/// The newest change of the user's, `0` before any: the collection tag and sync token.
pub fn latest_seq(conn: &mut Conn, user_id: &str) -> Result<i32, ApiError> {
    Ok(dav_changes::table
        .filter(dav_changes::user_id.eq(user_id))
        .select(diesel::dsl::max(dav_changes::seq))
        .first::<Option<i32>>(conn)?
        .unwrap_or(0))
}

/// Whether a sync from `since` can still be answered: nothing after it has been purged. The
/// log starts at 1 and is only ever trimmed from the front, so the oldest row left says what
/// is missing.
pub fn token_valid(conn: &mut Conn, since: i32) -> Result<bool, ApiError> {
    let oldest = dav_changes::table
        .select(diesel::dsl::min(dav_changes::seq))
        .first::<Option<i32>>(conn)?;
    Ok(match oldest {
        None | Some(1) => true,
        Some(oldest) => since + 1 >= oldest,
    })
}

/// The objects of `kind` changed after `since`, each once.
pub fn changed_since(conn: &mut Conn, user_id: &str, kind: &str, since: i32) -> Result<Vec<String>, ApiError> {
    let rows: Vec<String> = dav_changes::table
        .filter(dav_changes::user_id.eq(user_id))
        .filter(dav_changes::kind.eq(kind))
        .filter(dav_changes::seq.gt(since))
        .order(dav_changes::seq.asc())
        .select(dav_changes::object_id)
        .load(conn)?;
    let mut seen = HashSet::new();
    Ok(rows.into_iter().filter(|id| seen.insert(id.clone())).collect())
}

/// Forgets changes older than `cutoff`, and the names of deleted objects nothing will ask about
/// again. Run with the purge of deleted events.
pub fn purge(conn: &mut Conn, cutoff: NaiveDateTime) -> Result<usize, ApiError> {
    let changes = diesel::delete(dav_changes::table.filter(dav_changes::changed_at.lt(cutoff))).execute(conn)?;
    let orphans = diesel::sql_query(
        "DELETE FROM dav_objects WHERE \
           (kind = 'task' AND object_id NOT IN (SELECT id FROM tasks) \
              AND object_id NOT IN (SELECT object_id FROM dav_changes WHERE kind = 'task')) \
        OR (kind = 'event' AND object_id NOT IN (SELECT id FROM events) \
              AND object_id NOT IN (SELECT object_id FROM dav_changes WHERE kind = 'event'))",
    )
    .execute(conn)?;
    Ok(changes + orphans)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tasks_home_is_where_it_was_put_while_it_is_still_there() {
        let lists = vec!["a".to_string(), "b".to_string()];
        assert_eq!(home_of(Some("list-b"), &lists), "list-b");
        // Removed from b since: back to its oldest list.
        assert_eq!(home_of(Some("list-c"), &lists), "list-a");
        assert_eq!(home_of(None, &lists), "list-a");
        assert_eq!(home_of(None, &[]), INBOX);
        // Put in the inbox, then added to a list in Neutrino: it is in the list now.
        assert_eq!(home_of(Some(INBOX), &lists), "list-a");
        assert_eq!(home_of(Some(INBOX), &[]), INBOX);
    }
}
