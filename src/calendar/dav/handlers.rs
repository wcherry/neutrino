//! The CalDAV methods. One entry point (`dispatch`) takes every request under `/dav`, signs the
//! caller in with an app password, works out what the path names and runs the method.
//!
//! Paths:
//!
//! | Path | Resource |
//! |---|---|
//! | `/dav/` | root |
//! | `/dav/principals/{userId}/` | the user's principal |
//! | `/dav/calendars/{userId}/` | the calendar home: one collection per calendar and task list |
//! | `/dav/calendars/{userId}/{collection}/` | a calendar (VEVENT) or a task list (VTODO) |
//! | `/dav/calendars/{userId}/{collection}/{name}.ics` | an event series or a task |

use actix_web::http::{header, Method, StatusCode};
use actix_web::{web, HttpRequest, HttpResponse};
use base64::Engine;
use chrono::NaiveDateTime;
use sha2::{Digest, Sha256};

use super::store::{self, Collection, KIND_EVENT, KIND_TASK};
use super::vevent::{self, iso};
use super::xml::{self, qname, Element, PropResponse, QName, CALDAV, CS, DAV, ICAL};
use super::{vtodo, DavState};
use crate::auth::app_passwords::service::{BasicAuthError, SCOPE_CALDAV};
use crate::calendar::calendars::dto::{CreateCalendarRequest, UpdateCalendarRequest};
use crate::calendar::events::dto::{CreateEventRequest, UpdateEventRequest};
use crate::calendar::tasks::dto::{
    CreateTaskListRequest, CreateTaskRequest, UpdateTaskListRequest, UpdateTaskRequest,
};
use crate::shared::{ApiError, AuthenticatedUser};

const SYNC_TOKEN_PREFIX: &str = "https://getneutrino.app/ns/sync/";
const ALLOW: &str = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MOVE";

/// RFC 6764: where a client looks first when given only the host.
pub async fn well_known() -> HttpResponse {
    HttpResponse::MovedPermanently()
        .insert_header((header::LOCATION, "/dav/"))
        .finish()
}

pub async fn dispatch(req: HttpRequest, body: web::Bytes, state: web::Data<DavState>) -> HttpResponse {
    if req.method() == Method::OPTIONS {
        return options();
    }
    let user = match authenticate(&req, &state) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let body = String::from_utf8_lossy(&body).into_owned();
    let target = match Target::parse(req.path(), &user.user_id) {
        Some(t) => t,
        None => return status(StatusCode::NOT_FOUND),
    };
    let result = match req.method().as_str() {
        "PROPFIND" => propfind(&state, &user, &req, &target, &body),
        "REPORT" => report(&state, &user, &target, &body),
        "GET" | "HEAD" => get(&state, &user, &target, req.method() == Method::HEAD),
        "PUT" => put(&state, &user, &req, &target, &body),
        "DELETE" => delete(&state, &user, &req, &target),
        "MKCALENDAR" => mkcalendar(&state, &user, &target, &body),
        "PROPPATCH" => proppatch(&state, &user, &target, &body),
        "MOVE" => move_object(&state, &user, &req, &target),
        _ => Ok(HttpResponse::MethodNotAllowed()
            .insert_header((header::ALLOW, ALLOW))
            .finish()),
    };
    result.unwrap_or_else(|e| error_response(&e))
}

fn options() -> HttpResponse {
    HttpResponse::Ok()
        .insert_header(("DAV", "1, 3, calendar-access"))
        .insert_header((header::ALLOW, ALLOW))
        .finish()
}

fn authenticate(req: &HttpRequest, state: &DavState) -> Result<AuthenticatedUser, HttpResponse> {
    let challenge = || {
        HttpResponse::Unauthorized()
            .insert_header((header::WWW_AUTHENTICATE, "Basic realm=\"Neutrino\", charset=\"UTF-8\""))
            .finish()
    };
    let Some((email, password)) = basic_credentials(req) else {
        return Err(challenge());
    };
    let client = state.client_ip.client_ip(req);
    match state
        .app_passwords
        .verify_basic(&email, &password, SCOPE_CALDAV, &client)
    {
        Ok(user) => Ok(user),
        Err(BasicAuthError::Invalid) => Err(challenge()),
        Err(BasicAuthError::TooManyAttempts) => Err(HttpResponse::TooManyRequests()
            .insert_header((header::RETRY_AFTER, "900"))
            .finish()),
    }
}

fn basic_credentials(req: &HttpRequest) -> Option<(String, String)> {
    let value = req.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    let encoded = value
        .strip_prefix("Basic ")
        .or_else(|| value.strip_prefix("basic "))?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    let (user, pass) = decoded.split_once(':')?;
    Some((user.to_string(), pass.to_string()))
}

// ── Paths ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum Target {
    Root,
    Principal,
    Home,
    Collection(String),
    Object(String, String),
}

impl Target {
    /// What `path` names for `user_id`. Another user's principal or home is `None`: not found,
    /// the same answer the rest of the API gives for what isn't yours.
    pub fn parse(path: &str, user_id: &str) -> Option<Target> {
        let rest = path.strip_prefix("/dav")?;
        let segments: Vec<String> = rest
            .split('/')
            .filter(|s| !s.is_empty())
            .map(percent_decode)
            .collect();
        let segs: Vec<&str> = segments.iter().map(String::as_str).collect();
        match segs.as_slice() {
            [] => Some(Target::Root),
            ["principals"] | ["calendars"] => Some(Target::Root),
            ["principals", u] if *u == user_id => Some(Target::Principal),
            ["calendars", u] if *u == user_id => Some(Target::Home),
            ["calendars", u, c] if *u == user_id => Some(Target::Collection(c.to_string())),
            ["calendars", u, c, n] if *u == user_id => Some(Target::Object(c.to_string(), n.to_string())),
            _ => None,
        }
    }
}

fn principal_href(user_id: &str) -> String {
    format!("/dav/principals/{}/", percent_encode(user_id))
}

fn home_href(user_id: &str) -> String {
    format!("/dav/calendars/{}/", percent_encode(user_id))
}

fn collection_href(user_id: &str, segment: &str) -> String {
    format!("{}{}/", home_href(user_id), percent_encode(segment))
}

fn object_href(user_id: &str, segment: &str, name: &str) -> String {
    format!("{}{}", collection_href(user_id, segment), percent_encode(name))
}

pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~@".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The path part of a `Destination` header or `<d:href>`, absolute URL or not.
fn path_of(href: &str) -> String {
    let href = href.trim();
    match href.find("://") {
        Some(i) => match href[i + 3..].find('/') {
            Some(j) => href[i + 3 + j..].to_string(),
            None => "/".to_string(),
        },
        None => href.to_string(),
    }
}

// ── Objects ───────────────────────────────────────────────────────────────────

struct Object {
    id: String,
    name: String,
    ics: String,
    /// For calendar-query: the instants the object covers (None for a task).
    span: Option<(NaiveDateTime, NaiveDateTime, bool)>,
    /// For a task query.
    done: bool,
    updated_at: NaiveDateTime,
}

impl Object {
    fn etag(&self) -> String {
        etag(&self.ics)
    }
}

fn etag(ics: &str) -> String {
    let digest = Sha256::digest(ics.as_bytes());
    format!("\"{}\"", hex::encode(&digest[..12]))
}

type Conn = diesel::SqliteConnection;

fn conn(state: &DavState) -> Result<diesel::r2d2::PooledConnection<diesel::r2d2::ConnectionManager<Conn>>, ApiError> {
    state.pool.get().map_err(|e| {
        tracing::error!("DAV pool error: {:?}", e);
        ApiError::internal("Database error")
    })
}

fn series_object(s: &store::Series, meta: Option<&store::Meta>) -> Object {
    let id = s.master.id.clone();
    let ics = vevent::render(s, &store::uid_of(meta, &id), meta.and_then(|m| m.extra.as_deref()));
    let start = s
        .exceptions
        .iter()
        .map(|e| e.start_time)
        .chain(std::iter::once(s.master.start_time))
        .min()
        .unwrap_or(s.master.start_time);
    let end = s
        .exceptions
        .iter()
        .map(|e| e.end_time)
        .chain(std::iter::once(s.master.end_time))
        .max()
        .unwrap_or(s.master.end_time);
    Object {
        name: store::name_of(meta, &id),
        id,
        ics,
        span: Some((start, end, s.master.is_recurring())),
        done: false,
        updated_at: s.master.updated_at,
    }
}

fn task_object(t: &store::TaskObject, meta: Option<&store::Meta>) -> Object {
    let id = t.task.id.clone();
    Object {
        name: store::name_of(meta, &id),
        ics: vtodo::render(t, &store::uid_of(meta, &id), meta.and_then(|m| m.extra.as_deref())),
        id,
        span: None,
        done: t.task.done,
        updated_at: t.task.updated_at,
    }
}

/// Every object in a collection.
fn objects_in(c: &mut Conn, user_id: &str, coll: &Collection) -> Result<Vec<Object>, ApiError> {
    match coll {
        Collection::Calendar(cal) => {
            let metas = store::metas(c, user_id, KIND_EVENT)?;
            Ok(store::series_in(c, user_id, &cal.id)?
                .iter()
                .map(|s| series_object(s, metas.get(&s.master.id)))
                .collect())
        }
        _ => {
            let metas = store::metas(c, user_id, KIND_TASK)?;
            let here = coll.id();
            Ok(store::tasks_with_home(c, user_id)?
                .iter()
                .filter(|(home, _)| *home == here)
                .map(|(_, t)| task_object(t, metas.get(&t.task.id)))
                .collect())
        }
    }
}

/// The object named `name` in a collection.
fn object_named(c: &mut Conn, user_id: &str, coll: &Collection, name: &str) -> Result<Option<Object>, ApiError> {
    let kind = coll.kind();
    let meta = store::find_by_name(c, user_id, kind, name)?;
    let id = match &meta {
        Some(m) => m.object_id.clone(),
        None => match name.strip_suffix(".ics") {
            // Served under `<id>.ics` until a client names it; a name a client took over
            // belongs to that client's object.
            Some(id) if store::meta(c, kind, id)?.is_none() => id.to_string(),
            _ => return Ok(None),
        },
    };
    object_by_id(c, user_id, coll, &id, meta.as_ref())
}

fn object_by_id(
    c: &mut Conn,
    user_id: &str,
    coll: &Collection,
    id: &str,
    meta: Option<&store::Meta>,
) -> Result<Option<Object>, ApiError> {
    match coll {
        Collection::Calendar(cal) => {
            let meta = match meta {
                Some(m) => Some(m.clone()),
                None => store::meta(c, KIND_EVENT, id)?,
            };
            Ok(store::series(c, user_id, &cal.id, id)?.map(|s| series_object(&s, meta.as_ref())))
        }
        _ => {
            let here = coll.id();
            let metas = store::metas(c, user_id, KIND_TASK)?;
            Ok(store::tasks_with_home(c, user_id)?
                .into_iter()
                .find(|(home, t)| t.task.id == id && *home == here)
                .map(|(_, t)| task_object(&t, metas.get(&t.task.id))))
        }
    }
}

// ── Properties ────────────────────────────────────────────────────────────────

/// What a resource answers for a property: its value as XML, or `None` (404 in the response).
enum Resource<'a> {
    Root,
    Principal,
    Home,
    Collection {
        coll: &'a Collection,
        order: usize,
        seq: i32,
    },
    Object(&'a Object),
}

fn property(r: &Resource, name: &QName, user: &AuthenticatedUser) -> Option<String> {
    let (ns, local) = (name.0.as_str(), name.1.as_str());
    let href = |p: &str| xml::href(p);
    let principal = || href(&principal_href(&user.user_id));
    match (ns, local) {
        (DAV, "current-user-principal") => Some(principal()),
        (DAV, "principal-URL") if matches!(r, Resource::Principal) => Some(principal()),
        (DAV, "owner") if !matches!(r, Resource::Root) => Some(principal()),
        (CALDAV, "calendar-home-set") if matches!(r, Resource::Principal | Resource::Root) => {
            Some(href(&home_href(&user.user_id)))
        }
        (CALDAV, "calendar-user-address-set") if matches!(r, Resource::Principal) => {
            Some(href(&format!("mailto:{}", user.email)))
        }
        (DAV, "resourcetype") => Some(match r {
            Resource::Root | Resource::Home => xml::d("collection", ""),
            Resource::Principal => xml::d("principal", ""),
            Resource::Collection { .. } => xml::d("collection", "") + &xml::el(&qname(CALDAV, "calendar"), ""),
            Resource::Object(_) => String::new(),
        }),
        (DAV, "displayname") => match r {
            Resource::Principal => Some(xml::escape(&user.email)),
            Resource::Home => Some("Calendars".to_string()),
            Resource::Collection { coll, .. } => Some(xml::escape(&coll.display_name())),
            _ => None,
        },
        (DAV, "current-user-privilege-set") => {
            let privs: &[&str] = match r {
                Resource::Collection { coll: Collection::Inbox, .. } => {
                    &["read", "write", "write-content", "write-properties", "bind", "read-current-user-privilege-set"]
                }
                Resource::Collection { .. } | Resource::Home => &[
                    "read",
                    "write",
                    "write-content",
                    "write-properties",
                    "bind",
                    "unbind",
                    "read-current-user-privilege-set",
                ],
                Resource::Object(_) => &["read", "write", "write-content", "read-current-user-privilege-set"],
                _ => &["read", "read-current-user-privilege-set"],
            };
            Some(
                privs
                    .iter()
                    .map(|p| xml::d("privilege", &xml::d(p, "")))
                    .collect(),
            )
        }
        (DAV, "supported-report-set") => match r {
            Resource::Collection { .. } => Some(
                [
                    qname(CALDAV, "calendar-multiget"),
                    qname(CALDAV, "calendar-query"),
                    qname(DAV, "sync-collection"),
                ]
                .iter()
                .map(|n| xml::d("supported-report", &xml::d("report", &xml::el(n, ""))))
                .collect(),
            ),
            _ => None,
        },
        (CALDAV, "supported-calendar-component-set") => match r {
            Resource::Collection { coll, .. } => {
                let comp = if coll.is_tasks() { "VTODO" } else { "VEVENT" };
                Some(format!("<c:comp name=\"{comp}\"/>"))
            }
            _ => None,
        },
        (CALDAV, "supported-calendar-data") => match r {
            Resource::Collection { .. } => {
                Some("<c:calendar-data content-type=\"text/calendar\" version=\"2.0\"/>".to_string())
            }
            _ => None,
        },
        (CS, "getctag") => match r {
            Resource::Collection { seq, .. } => Some(seq.to_string()),
            _ => None,
        },
        (DAV, "sync-token") => match r {
            Resource::Collection { seq, .. } => Some(xml::escape(&format!("{SYNC_TOKEN_PREFIX}{seq}"))),
            _ => None,
        },
        (ICAL, "calendar-color") => match r {
            Resource::Collection { coll, .. } => coll.color().map(|c| xml::escape(&c)),
            _ => None,
        },
        (ICAL, "calendar-order") => match r {
            Resource::Collection { order, .. } => Some(order.to_string()),
            _ => None,
        },
        (DAV, "getetag") => match r {
            Resource::Object(o) => Some(xml::escape(&o.etag())),
            _ => None,
        },
        (DAV, "getcontenttype") => match r {
            Resource::Object(o) => {
                let comp = if o.span.is_some() { "vevent" } else { "vtodo" };
                Some(format!("text/calendar; charset=utf-8; component={comp}"))
            }
            _ => None,
        },
        (CALDAV, "calendar-data") => match r {
            Resource::Object(o) => Some(xml::escape(&o.ics)),
            _ => None,
        },
        _ => None,
    }
}

fn prop_response(href: String, r: &Resource, names: &[QName], user: &AuthenticatedUser) -> String {
    let mut found = Vec::new();
    let mut missing = Vec::new();
    for n in names {
        match property(r, n, user) {
            Some(v) => found.push((n.clone(), v)),
            None => missing.push(n.clone()),
        }
    }
    PropResponse { href, found, missing }.to_xml()
}

/// The properties a body asks for, or the defaults for `allprop` / an empty body.
fn requested(body: Option<&Element>, defaults: &[QName]) -> Vec<QName> {
    match body.and_then(|b| b.child(DAV, "prop")) {
        Some(prop) => prop.children.iter().map(Element::qname).collect(),
        None => defaults.to_vec(),
    }
}

fn default_props() -> Vec<QName> {
    vec![
        qname(DAV, "resourcetype"),
        qname(DAV, "displayname"),
        qname(DAV, "current-user-principal"),
        qname(DAV, "getetag"),
        qname(DAV, "getcontenttype"),
        qname(CS, "getctag"),
        qname(DAV, "sync-token"),
        qname(CALDAV, "supported-calendar-component-set"),
        qname(ICAL, "calendar-color"),
    ]
}

// ── PROPFIND ──────────────────────────────────────────────────────────────────

fn propfind(
    state: &DavState,
    user: &AuthenticatedUser,
    req: &HttpRequest,
    target: &Target,
    body: &str,
) -> Result<HttpResponse, ApiError> {
    let parsed = if body.trim().is_empty() { None } else { Some(xml::parse(body).ok_or_else(bad_xml)?) };
    let names = requested(parsed.as_ref(), &default_props());
    let depth_one = req
        .headers()
        .get("Depth")
        .and_then(|d| d.to_str().ok())
        .map(|d| d.trim() != "0")
        .unwrap_or(true);
    let mut c = conn(state)?;
    let uid = &user.user_id;
    let mut responses = Vec::new();
    match target {
        Target::Root => responses.push(prop_response("/dav/".into(), &Resource::Root, &names, user)),
        Target::Principal => responses.push(prop_response(principal_href(uid), &Resource::Principal, &names, user)),
        Target::Home => {
            responses.push(prop_response(home_href(uid), &Resource::Home, &names, user));
            if depth_one {
                let seq = store::latest_seq(&mut c, uid)?;
                for (i, (segment, coll)) in store::collections(&mut c, uid)?.iter().enumerate() {
                    let r = Resource::Collection { coll, order: i + 1, seq };
                    responses.push(prop_response(collection_href(uid, segment), &r, &names, user));
                }
            }
        }
        Target::Collection(segment) => {
            let (segment, coll) = store::resolve_collection(&mut c, uid, segment)?.ok_or_else(not_found)?;
            let order = store::collections(&mut c, uid)?
                .iter()
                .position(|(s, _)| *s == segment)
                .map(|i| i + 1)
                .unwrap_or(1);
            let seq = store::latest_seq(&mut c, uid)?;
            let r = Resource::Collection { coll: &coll, order, seq };
            responses.push(prop_response(collection_href(uid, &segment), &r, &names, user));
            if depth_one {
                for o in objects_in(&mut c, uid, &coll)? {
                    responses.push(prop_response(
                        object_href(uid, &segment, &o.name),
                        &Resource::Object(&o),
                        &names,
                        user,
                    ));
                }
            }
        }
        Target::Object(segment, name) => {
            let (segment, coll) = store::resolve_collection(&mut c, uid, segment)?.ok_or_else(not_found)?;
            let o = object_named(&mut c, uid, &coll, name)?.ok_or_else(not_found)?;
            responses.push(prop_response(object_href(uid, &segment, &o.name), &Resource::Object(&o), &names, user));
        }
    }
    Ok(multistatus(&responses, ""))
}

// ── REPORT ────────────────────────────────────────────────────────────────────

fn report(state: &DavState, user: &AuthenticatedUser, target: &Target, body: &str) -> Result<HttpResponse, ApiError> {
    let (Target::Collection(segment) | Target::Object(segment, _)) = target else {
        return Err(ApiError::forbidden("Reports run on a calendar"));
    };
    let root = xml::parse(body).ok_or_else(bad_xml)?;
    let names = requested(Some(&root), &[qname(DAV, "getetag")]);
    let uid = &user.user_id;
    let mut c = conn(state)?;
    let (segment, coll) = store::resolve_collection(&mut c, uid, segment)?.ok_or_else(not_found)?;
    let href_of = |name: &str| object_href(uid, &segment, name);

    if root.is(CALDAV, "calendar-multiget") {
        let mut responses = Vec::new();
        for h in root.children_named(DAV, "href") {
            let path = path_of(&percent_decode_path(&h.text));
            let name = path.rsplit('/').next().unwrap_or_default().to_string();
            match object_named(&mut c, uid, &coll, &name)? {
                Some(o) => responses.push(prop_response(href_of(&o.name), &Resource::Object(&o), &names, user)),
                None => responses.push(xml::gone_response(&h.text)),
            }
        }
        return Ok(multistatus(&responses, ""));
    }

    if root.is(CALDAV, "calendar-query") {
        let filter = QueryFilter::from(&root, &coll);
        let responses: Vec<String> = objects_in(&mut c, uid, &coll)?
            .iter()
            .filter(|o| filter.matches(o))
            .map(|o| prop_response(href_of(&o.name), &Resource::Object(o), &names, user))
            .collect();
        return Ok(multistatus(&responses, ""));
    }

    if root.is(DAV, "sync-collection") {
        let token = root.child(DAV, "sync-token").map(|t| t.text.trim().to_string()).unwrap_or_default();
        let latest = store::latest_seq(&mut c, uid)?;
        let mut responses = Vec::new();
        if token.is_empty() {
            for o in objects_in(&mut c, uid, &coll)? {
                responses.push(prop_response(href_of(&o.name), &Resource::Object(&o), &names, user));
            }
        } else {
            let since = token
                .strip_prefix(SYNC_TOKEN_PREFIX)
                .and_then(|n| n.parse::<i32>().ok())
                .filter(|n| *n <= latest)
                .ok_or_else(invalid_sync_token)?;
            // Nothing of the user's since the token is always answerable, or a user idle past
            // the log's retention would be told to resync in full on every sync, forever.
            if since < latest && !store::token_valid(&mut c, since)? {
                return Err(invalid_sync_token());
            }
            let kind = coll.kind();
            for id in store::changed_since(&mut c, uid, kind, since)? {
                let meta = store::meta(&mut c, kind, &id)?;
                match object_by_id(&mut c, uid, &coll, &id, meta.as_ref())? {
                    Some(o) => responses.push(prop_response(href_of(&o.name), &Resource::Object(&o), &names, user)),
                    // Gone, or now in another collection: removed from this one. An id this
                    // client never held here is harmless; it ignores it.
                    None => responses.push(xml::gone_response(&href_of(&store::name_of(meta.as_ref(), &id)))),
                }
            }
        }
        let extra = xml::d("sync-token", &xml::escape(&format!("{SYNC_TOKEN_PREFIX}{latest}")));
        return Ok(multistatus(&responses, &extra));
    }

    Ok(HttpResponse::Forbidden()
        .content_type("application/xml; charset=utf-8")
        .body(xml::error_body(&qname(DAV, "supported-report"))))
}

fn percent_decode_path(href: &str) -> String {
    href.split('/').map(percent_decode).collect::<Vec<_>>().join("/")
}

/// The part of a `calendar-query` filter this server applies: the component asked for, a time
/// range on events, and open or completed on tasks. Anything finer is left to the client, which
/// filters what it is sent: a superset is allowed, a subset is not.
#[derive(Debug, Default)]
struct QueryFilter {
    wrong_component: bool,
    range: Option<(Option<NaiveDateTime>, Option<NaiveDateTime>)>,
    open_only: bool,
    completed_since: Option<Option<NaiveDateTime>>,
}

impl QueryFilter {
    fn from(root: &Element, coll: &Collection) -> QueryFilter {
        let mut f = QueryFilter::default();
        let Some(filter) = root.child(CALDAV, "filter") else {
            return f;
        };
        let mut comps = Vec::new();
        filter.find_all(CALDAV, "comp-filter", &mut comps);
        let want = if coll.is_tasks() { "VTODO" } else { "VEVENT" };
        let inner: Vec<&&Element> = comps
            .iter()
            .filter(|c| c.attr("name").is_some_and(|n| !n.eq_ignore_ascii_case("VCALENDAR")))
            .collect();
        if inner.iter().any(|c| !c.attr("name").unwrap_or_default().eq_ignore_ascii_case(want)) {
            f.wrong_component = true;
        }
        let time = |el: &Element| -> (Option<NaiveDateTime>, Option<NaiveDateTime>) {
            let read = |a: Option<&str>| a.and_then(|v| super::ical::read_time_value(v, None, None)).map(|(t, _)| t);
            (read(el.attr("start")), read(el.attr("end")))
        };
        for comp in inner {
            if let Some(tr) = comp.child(CALDAV, "time-range") {
                f.range = Some(time(tr));
            }
            for pf in comp.children_named(CALDAV, "prop-filter") {
                let name = pf.attr("name").unwrap_or_default().to_ascii_uppercase();
                match name.as_str() {
                    "COMPLETED" if pf.child(CALDAV, "is-not-defined").is_some() => f.open_only = true,
                    "COMPLETED" => f.completed_since = Some(pf.child(CALDAV, "time-range").and_then(|t| time(t).0)),
                    "STATUS" => {
                        if let Some(tm) = pf.child(CALDAV, "text-match") {
                            let negate = tm.attr("negate-condition").is_some_and(|v| v == "yes");
                            if tm.text.trim().eq_ignore_ascii_case("COMPLETED") {
                                if negate {
                                    f.open_only = true;
                                } else {
                                    f.completed_since = Some(None);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        f
    }

    fn matches(&self, o: &Object) -> bool {
        if self.wrong_component {
            return false;
        }
        if self.open_only && o.done {
            return false;
        }
        if let Some(since) = self.completed_since {
            if !o.done || since.is_some_and(|s| o.updated_at < s) {
                return false;
            }
        }
        match (self.range, o.span) {
            (Some((start, end)), Some((s, e, recurring))) => {
                // A series is always sent: its occurrences are the client's to expand.
                recurring || (start.map_or(true, |start| e >= start) && end.map_or(true, |end| s < end))
            }
            _ => true,
        }
    }
}

// ── GET ───────────────────────────────────────────────────────────────────────

fn get(state: &DavState, user: &AuthenticatedUser, target: &Target, head: bool) -> Result<HttpResponse, ApiError> {
    let Target::Object(segment, name) = target else {
        return Ok(HttpResponse::MethodNotAllowed().insert_header((header::ALLOW, ALLOW)).finish());
    };
    let mut c = conn(state)?;
    let (_, coll) = store::resolve_collection(&mut c, &user.user_id, segment)?.ok_or_else(not_found)?;
    let o = object_named(&mut c, &user.user_id, &coll, name)?.ok_or_else(not_found)?;
    let mut res = HttpResponse::Ok();
    res.content_type("text/calendar; charset=utf-8")
        .insert_header((header::ETAG, o.etag()));
    Ok(if head { res.finish() } else { res.body(o.ics) })
}

// ── PUT ───────────────────────────────────────────────────────────────────────

/// Checks `If-Match` / `If-None-Match` against what is there now.
fn preconditions(req: &HttpRequest, existing: Option<&Object>) -> Result<(), ApiError> {
    let header_str = |name: &str| req.headers().get(name).and_then(|v| v.to_str().ok()).map(str::trim);
    if let Some(inm) = header_str("If-None-Match") {
        if inm == "*" && existing.is_some() {
            return Err(precondition_failed());
        }
    }
    if let Some(im) = header_str("If-Match") {
        match existing {
            None => return Err(precondition_failed()),
            Some(o) if im != "*" && !im.split(',').any(|t| t.trim().trim_start_matches("W/") == o.etag()) => {
                return Err(precondition_failed())
            }
            _ => {}
        }
    }
    Ok(())
}

fn put(
    state: &DavState,
    user: &AuthenticatedUser,
    req: &HttpRequest,
    target: &Target,
    body: &str,
) -> Result<HttpResponse, ApiError> {
    let Target::Object(segment, name) = target else {
        return Ok(HttpResponse::MethodNotAllowed().insert_header((header::ALLOW, ALLOW)).finish());
    };
    let mut c = conn(state)?;
    let (_, coll) = store::resolve_collection(&mut c, &user.user_id, segment)?.ok_or_else(not_found)?;
    let existing = object_named(&mut c, &user.user_id, &coll, name)?;
    preconditions(req, existing.as_ref())?;
    drop(c);
    let created = existing.is_none();
    match &coll {
        Collection::Calendar(cal) => put_event(state, user, &coll, &cal.id, name, existing.map(|o| o.id), body)?,
        _ => put_task(state, user, &coll, name, existing.map(|o| o.id), body)?,
    }
    // No ETag: what is stored is Neutrino's rendering, not the bytes sent, so the client must
    // read it back (RFC 4791 §5.3.4).
    Ok(if created { HttpResponse::Created().finish() } else { HttpResponse::NoContent().finish() })
}

fn uid_conflict(c: &mut Conn, user_id: &str, kind: &str, uid: &str, existing: Option<&str>) -> Result<(), ApiError> {
    let Some(holder) = store::find_by_uid(c, user_id, kind, uid)? else {
        return Ok(());
    };
    if Some(holder.object_id.as_str()) == existing {
        return Ok(());
    }
    // A UID held by an object that is gone is free to reuse.
    let live = match kind {
        KIND_EVENT => crate::schema::events::table
            .filter(crate::schema::events::id.eq(&holder.object_id))
            .filter(crate::schema::events::deleted_at.is_null())
            .count()
            .get_result::<i64>(c)?,
        _ => crate::schema::tasks::table
            .filter(crate::schema::tasks::id.eq(&holder.object_id))
            .count()
            .get_result::<i64>(c)?,
    };
    if live > 0 {
        return Err(ApiError::new(409, "no-uid-conflict", "Another object already has that UID"));
    }
    Ok(())
}

use diesel::prelude::*;

#[allow(clippy::too_many_arguments)]
fn put_event(
    state: &DavState,
    user: &AuthenticatedUser,
    coll: &Collection,
    calendar_id: &str,
    name: &str,
    existing: Option<String>,
    body: &str,
) -> Result<(), ApiError> {
    let parsed = vevent::parse_series(body).map_err(|e| invalid_data(&e.0))?;
    {
        let mut c = conn(state)?;
        uid_conflict(&mut c, &user.user_id, KIND_EVENT, &parsed.uid, existing.as_deref())?;
    }
    let m = &parsed.master;
    let rule = parsed.rrule.clone();
    let id = match &existing {
        None => {
            state
                .events
                .create_event(
                    user,
                    CreateEventRequest {
                        title: m.title.clone(),
                        description: m.description.clone(),
                        start_time: iso(m.start),
                        end_time: iso(m.end),
                        all_day: m.all_day,
                        location: m.location.clone(),
                        recurrence_rule: rule.clone(),
                        attendees: m.attendees.clone(),
                        timezone: m.timezone.clone(),
                        calendar_id: Some(calendar_id.to_string()),
                    },
                )?
                .id
        }
        Some(id) => {
            let mut changes = whole(m);
            changes.recurrence_rule = Some(rule.clone().unwrap_or_default());
            state.events.update_event(user, id, changes)?;
            id.clone()
        }
    };

    if rule.is_some() {
        let mut c = conn(state)?;
        let current = store::series(&mut c, &user.user_id, calendar_id, &id)?
            .map(|s| s.exceptions)
            .unwrap_or_default();
        drop(c);
        let near = |a: NaiveDateTime, b: NaiveDateTime| (a - b).num_seconds().abs() < 60;
        for (original, fields) in &parsed.overrides {
            state.events.edit_occurrence(user, &id, &iso(*original), whole(fields))?;
        }
        for original in &parsed.exdates {
            state.events.cancel_occurrence(user, &id, &iso(*original))?;
        }
        for ex in current {
            let Some(original) = ex.original_start_time else { continue };
            let kept = parsed.overrides.iter().any(|(o, _)| near(*o, original))
                || parsed.exdates.iter().any(|o| near(*o, original));
            if !kept {
                state.events.restore_occurrence(user, &id, &ex.id)?;
            }
        }
    }

    let mut c = conn(state)?;
    store::upsert_meta(
        &mut c,
        &user.user_id,
        KIND_EVENT,
        &id,
        &parsed.uid,
        name,
        &coll.id(),
        parsed.extras.to_json().as_deref(),
    )
}

/// Every field of an event, as a whole replacement: absent text is sent as `""`, which the
/// events service stores as none.
fn whole(f: &vevent::EventFields) -> UpdateEventRequest {
    UpdateEventRequest {
        title: Some(f.title.clone()),
        description: Some(f.description.clone().unwrap_or_default()),
        start_time: Some(iso(f.start)),
        end_time: Some(iso(f.end)),
        all_day: Some(f.all_day),
        location: Some(f.location.clone().unwrap_or_default()),
        recurrence_rule: None,
        attendees: Some(f.attendees.clone()),
        timezone: Some(f.timezone.clone().unwrap_or_default()),
        calendar_id: None,
    }
}

fn put_task(
    state: &DavState,
    user: &AuthenticatedUser,
    coll: &Collection,
    name: &str,
    existing: Option<String>,
    body: &str,
) -> Result<(), ApiError> {
    let f = vtodo::parse_task(body).map_err(|e| invalid_data(&e.0))?;
    {
        let mut c = conn(state)?;
        uid_conflict(&mut c, &user.user_id, KIND_TASK, &f.uid, existing.as_deref())?;
    }
    let date = |d: Option<(NaiveDateTime, bool)>| d.map(|(t, _)| iso(t));
    let has_time = |d: Option<(NaiveDateTime, bool)>| d.is_some_and(|(_, timed)| timed);
    let id = match &existing {
        None => {
            let created = state.tasks.create_task(
                user,
                CreateTaskRequest {
                    title: f.title.clone(),
                    notes: f.notes.clone(),
                    due_date: date(f.due),
                    position: None,
                    due_has_time: has_time(f.due),
                    start_date: date(f.start),
                    start_has_time: has_time(f.start),
                    priority: f.priority,
                    estimate_minutes: None,
                    location: f.location.clone(),
                    // A reminder that arrives already done does not repeat: completing it here
                    // would make its next occurrence, which the client didn't ask for.
                    recurrence_rule: if f.done { None } else { f.rrule.clone() },
                    repeat_after_completion: false,
                    tags: f.tags.clone(),
                    geo_place_id: None,
                    geo_lat: f.geofence.map(|g| g.0),
                    geo_lng: f.geofence.map(|g| g.1),
                    geo_radius_m: f.geofence.map(|g| g.2),
                },
            )?;
            if let Some(list) = coll.list_id() {
                state.tasks.add_task_to_list(user, &created.id, list)?;
            }
            if f.done {
                state.tasks.update_task(
                    user,
                    &created.id,
                    UpdateTaskRequest {
                        done: Some(true),
                        ..Default::default()
                    },
                )?;
            }
            created.id
        }
        Some(id) => {
            let before = {
                let mut c = conn(state)?;
                crate::schema::tasks::table
                    .filter(crate::schema::tasks::id.eq(id))
                    .select(crate::calendar::tasks::model::TaskRecord::as_select())
                    .first(&mut c)?
            };
            // An arrival alarm sets the point; none clears a point. A saved place can't be
            // shown to the client (its coordinates are encrypted), so its absence clears nothing.
            let (place, lat, lng, radius) = match f.geofence {
                Some((la, ln, r)) => (Some(None), Some(Some(la)), Some(Some(ln)), Some(Some(r))),
                None if before.geo_lat.is_some() => (Some(None), Some(None), Some(None), Some(None)),
                None => (None, None, None, None),
            };
            let updated = state.tasks.update_task(
                user,
                id,
                UpdateTaskRequest {
                    title: Some(f.title.clone()),
                    notes: Some(f.notes.clone()),
                    done: Some(f.done),
                    due_date: Some(date(f.due)),
                    position: None,
                    due_has_time: Some(has_time(f.due)),
                    start_date: Some(date(f.start)),
                    start_has_time: Some(has_time(f.start)),
                    priority: Some(f.priority),
                    estimate_minutes: None,
                    location: Some(f.location.clone()),
                    recurrence_rule: Some(f.rrule.clone()),
                    repeat_after_completion: None,
                    tags: Some(f.tags.clone()),
                    geo_place_id: place,
                    geo_lat: lat,
                    geo_lng: lng,
                    geo_radius_m: radius,
                    timezone: f.timezone.clone(),
                },
            )?;
            // Completing a repeating task made its next occurrence; it belongs in this list too.
            if let (Some(next), Some(list)) = (updated.next_task.as_ref(), coll.list_id()) {
                state.tasks.add_task_to_list(user, &next.id, list)?;
            }
            id.clone()
        }
    };
    let mut c = conn(state)?;
    store::upsert_meta(&mut c, &user.user_id, KIND_TASK, &id, &f.uid, name, &coll.id(), f.extra.as_deref())
}

// ── DELETE ────────────────────────────────────────────────────────────────────

fn delete(state: &DavState, user: &AuthenticatedUser, req: &HttpRequest, target: &Target) -> Result<HttpResponse, ApiError> {
    let mut c = conn(state)?;
    match target {
        Target::Object(segment, name) => {
            let (_, coll) = store::resolve_collection(&mut c, &user.user_id, segment)?.ok_or_else(not_found)?;
            let o = object_named(&mut c, &user.user_id, &coll, name)?.ok_or_else(not_found)?;
            preconditions(req, Some(&o))?;
            drop(c);
            match coll {
                Collection::Calendar(_) => state.events.delete_event(user, &o.id)?,
                _ => state.tasks.delete_task(user, &o.id)?,
            }
        }
        Target::Collection(segment) => {
            let (_, coll) = store::resolve_collection(&mut c, &user.user_id, segment)?.ok_or_else(not_found)?;
            drop(c);
            match coll {
                Collection::Calendar(cal) => state.calendars.delete(user, &cal.id)?,
                Collection::List(list) => state.tasks.delete_task_list(user, &list.id)?,
                Collection::Inbox => return Err(ApiError::forbidden("The Tasks list can't be deleted")),
            }
        }
        _ => return Err(ApiError::forbidden("This can't be deleted")),
    }
    Ok(HttpResponse::NoContent().finish())
}

// ── MOVE ──────────────────────────────────────────────────────────────────────

/// Moves an object to another collection of the same kind: a reminder to another list, an
/// event to another calendar.
fn move_object(state: &DavState, user: &AuthenticatedUser, req: &HttpRequest, target: &Target) -> Result<HttpResponse, ApiError> {
    let Target::Object(from_segment, name) = target else {
        return Err(ApiError::forbidden("Only calendar objects can be moved"));
    };
    let destination = req
        .headers()
        .get("Destination")
        .and_then(|d| d.to_str().ok())
        .map(path_of)
        .ok_or_else(|| ApiError::bad_request("MOVE needs a Destination"))?;
    let Some(Target::Object(to_segment, to_name)) = Target::parse(&destination, &user.user_id) else {
        return Err(ApiError::forbidden("Objects can only move between your calendars"));
    };
    let uid = &user.user_id;
    let mut c = conn(state)?;
    let (_, from) = store::resolve_collection(&mut c, uid, from_segment)?.ok_or_else(not_found)?;
    let (_, to) = store::resolve_collection(&mut c, uid, &to_segment)?.ok_or_else(not_found)?;
    if from.kind() != to.kind() {
        return Err(ApiError::forbidden("An event can't become a reminder, or a reminder an event"));
    }
    let o = object_named(&mut c, uid, &from, name)?.ok_or_else(not_found)?;
    let kind = from.kind();
    let meta = store::meta(&mut c, kind, &o.id)?;
    drop(c);
    match (&from, &to) {
        (_, Collection::Calendar(cal)) => {
            state.events.update_event(
                user,
                &o.id,
                UpdateEventRequest {
                    calendar_id: Some(cal.id.clone()),
                    ..Default::default()
                },
            )?;
        }
        _ => {
            if let Some(list) = from.list_id() {
                state.tasks.remove_task_from_list(user, &o.id, list)?;
            }
            if let Some(list) = to.list_id() {
                state.tasks.add_task_to_list(user, &o.id, list)?;
            }
        }
    }
    let mut c = conn(state)?;
    store::upsert_meta(
        &mut c,
        uid,
        kind,
        &o.id,
        &store::uid_of(meta.as_ref(), &o.id),
        &to_name,
        &to.id(),
        meta.as_ref().and_then(|m| m.extra.as_deref()),
    )?;
    Ok(HttpResponse::Created().finish())
}

// ── MKCALENDAR and PROPPATCH ──────────────────────────────────────────────────

/// The properties a MKCALENDAR or PROPPATCH body sets.
#[derive(Default)]
struct Settings {
    name: Option<String>,
    color: Option<String>,
    components: Vec<String>,
    names: Vec<QName>,
}

fn settings(root: Option<&Element>) -> Settings {
    let mut s = Settings::default();
    let Some(root) = root else { return s };
    for set in root.children_named(DAV, "set") {
        let Some(prop) = set.child(DAV, "prop") else { continue };
        for p in &prop.children {
            s.names.push(p.qname());
            if p.is(DAV, "displayname") {
                s.name = Some(p.text.trim().to_string()).filter(|n| !n.is_empty());
            } else if p.is(ICAL, "calendar-color") {
                s.color = normalize_color(&p.text);
            } else if p.is(CALDAV, "supported-calendar-component-set") {
                s.components = p
                    .children_named(CALDAV, "comp")
                    .filter_map(|c| c.attr("name"))
                    .map(|n| n.to_ascii_uppercase())
                    .collect();
            }
        }
    }
    s
}

/// `#RRGGBB` or Apple's `#RRGGBBAA` as Neutrino's `#rrggbb`.
fn normalize_color(text: &str) -> Option<String> {
    let t = text.trim();
    let hex = t.strip_prefix('#')?;
    if hex.len() < 6 || !hex[..6].chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", hex[..6].to_ascii_lowercase()))
}

fn mkcalendar(state: &DavState, user: &AuthenticatedUser, target: &Target, body: &str) -> Result<HttpResponse, ApiError> {
    let Target::Collection(segment) = target else {
        return Err(ApiError::forbidden("Calendars are made in the calendar home"));
    };
    let uid = &user.user_id;
    {
        let mut c = conn(state)?;
        if store::resolve_collection(&mut c, uid, segment)?.is_some() {
            return Ok(HttpResponse::MethodNotAllowed().finish());
        }
    }
    let parsed = if body.trim().is_empty() { None } else { Some(xml::parse(body).ok_or_else(bad_xml)?) };
    let set = settings(parsed.as_ref());
    let tasks = set.components.iter().any(|c| c == "VTODO");
    let events = set.components.is_empty() || set.components.iter().any(|c| c == "VEVENT");
    if tasks && events && !set.components.is_empty() {
        return Ok(HttpResponse::Forbidden()
            .content_type("application/xml; charset=utf-8")
            .body(xml::error_body(&qname(CALDAV, "supported-calendar-component"))));
    }
    let canonical = if tasks {
        let list = state.tasks.create_task_list(
            user,
            CreateTaskListRequest {
                name: set.name.clone().unwrap_or_else(|| "Reminders".to_string()),
                color: set.color.clone(),
            },
        )?;
        format!("list-{}", list.id)
    } else {
        let cal = state.calendars.create(
            user,
            CreateCalendarRequest {
                name: set.name.clone(),
                color: set.color.clone(),
                kind: Some("local".to_string()),
                ..Default::default()
            },
        )?;
        format!("cal-{}", cal.id)
    };
    if canonical != *segment {
        let mut c = conn(state)?;
        store::set_alias(&mut c, uid, &canonical, segment)?;
    }
    Ok(HttpResponse::Created().finish())
}

fn proppatch(state: &DavState, user: &AuthenticatedUser, target: &Target, body: &str) -> Result<HttpResponse, ApiError> {
    let Target::Collection(segment) = target else {
        return Err(ApiError::forbidden("Only a calendar's properties can be changed"));
    };
    let root = xml::parse(body).ok_or_else(bad_xml)?;
    let set = settings(Some(&root));
    let uid = &user.user_id;
    let mut c = conn(state)?;
    let (segment, coll) = store::resolve_collection(&mut c, uid, segment)?.ok_or_else(not_found)?;
    drop(c);
    let mut refused = Vec::new();
    match &coll {
        Collection::Calendar(cal) => {
            if set.name.is_some() || set.color.is_some() {
                state.calendars.update(
                    user,
                    &cal.id,
                    UpdateCalendarRequest {
                        name: set.name.clone(),
                        color: set.color.clone(),
                        ..Default::default()
                    },
                )?;
            }
        }
        Collection::List(list) => {
            if set.name.is_some() || set.color.is_some() {
                state.tasks.update_task_list(
                    user,
                    &list.id,
                    UpdateTaskListRequest {
                        name: set.name.clone(),
                        color: set.color.clone().map(Some),
                    },
                )?;
            }
        }
        Collection::Inbox => {
            if set.name.is_some() {
                refused.push(qname(DAV, "displayname"));
            }
        }
    }
    // Every other property (calendar-order, a description) is accepted and not stored: a
    // refusal makes Apple Calendar undo the whole change it was making.
    let ok: Vec<(QName, String)> = set
        .names
        .iter()
        .filter(|n| !refused.contains(n))
        .map(|n| (n.clone(), String::new()))
        .collect();
    let mut inner = xml::href(&collection_href(uid, &segment));
    if !ok.is_empty() {
        let props: String = ok.iter().map(|(n, _)| xml::el(n, "")).collect();
        inner.push_str(&xml::d("propstat", &(xml::d("prop", &props) + &xml::d("status", "HTTP/1.1 200 OK"))));
    }
    if !refused.is_empty() {
        let props: String = refused.iter().map(|n| xml::el(n, "")).collect();
        inner.push_str(&xml::d("propstat", &(xml::d("prop", &props) + &xml::d("status", "HTTP/1.1 403 Forbidden"))));
    }
    Ok(multistatus(&[xml::d("response", &inner)], ""))
}

// ── Responses ─────────────────────────────────────────────────────────────────

fn multistatus(responses: &[String], extra: &str) -> HttpResponse {
    HttpResponse::build(StatusCode::MULTI_STATUS)
        .content_type("application/xml; charset=utf-8")
        .body(xml::multistatus(responses, extra))
}

fn status(code: StatusCode) -> HttpResponse {
    HttpResponse::build(code).finish()
}

fn not_found() -> ApiError {
    ApiError::not_found("Not found")
}

fn bad_xml() -> ApiError {
    ApiError::bad_request("The request body isn't valid XML")
}

fn precondition_failed() -> ApiError {
    ApiError::new(412, "precondition_failed", "The resource has changed")
}

fn invalid_sync_token() -> ApiError {
    ApiError::new(403, "valid-sync-token", "The sync token has expired")
}

fn invalid_data(why: &str) -> ApiError {
    ApiError::new(400, "valid-calendar-data", why)
}

/// An error as a DAV client reads it: the status, and for the preconditions RFC 4791 and 6578
/// name, the `<d:error>` element that says which.
fn error_response(e: &ApiError) -> HttpResponse {
    let code = StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let precondition = match e.code.as_str() {
        "valid-sync-token" => Some(qname(DAV, "valid-sync-token")),
        "valid-calendar-data" => Some(qname(CALDAV, "valid-calendar-data")),
        "no-uid-conflict" => Some(qname(CALDAV, "no-uid-conflict")),
        _ => None,
    };
    if code.is_server_error() {
        tracing::error!("CalDAV request failed: {:?}", e);
    }
    match precondition {
        Some(name) => HttpResponse::build(code)
            .content_type("application/xml; charset=utf-8")
            .body(xml::error_body(&name)),
        None => HttpResponse::build(code)
            .content_type("text/plain; charset=utf-8")
            .body(e.message.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_name_resources_and_only_your_own() {
        assert_eq!(Target::parse("/dav", "u1"), Some(Target::Root));
        assert_eq!(Target::parse("/dav/", "u1"), Some(Target::Root));
        assert_eq!(Target::parse("/dav/principals/u1/", "u1"), Some(Target::Principal));
        assert_eq!(Target::parse("/dav/calendars/u1/", "u1"), Some(Target::Home));
        assert_eq!(
            Target::parse("/dav/calendars/u1/cal-x/", "u1"),
            Some(Target::Collection("cal-x".into()))
        );
        assert_eq!(
            Target::parse("/dav/calendars/u1/cal-x/A%20B.ics", "u1"),
            Some(Target::Object("cal-x".into(), "A B.ics".into()))
        );
        assert_eq!(Target::parse("/dav/calendars/u2/", "u1"), None);
        assert_eq!(Target::parse("/dav/principals/u2/", "u1"), None);
        assert_eq!(Target::parse("/api/v1/x", "u1"), None);
    }

    #[test]
    fn percent_encoding_round_trips() {
        let name = "Ünïcode name+1.ics";
        assert_eq!(percent_decode(&percent_encode(name)), name);
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn destinations_are_read_as_paths() {
        assert_eq!(path_of("https://neutrino.example.com/dav/calendars/u1/list-a/x.ics"), "/dav/calendars/u1/list-a/x.ics");
        assert_eq!(path_of("/dav/calendars/u1/list-a/x.ics"), "/dav/calendars/u1/list-a/x.ics");
    }

    #[test]
    fn colours_are_normalised() {
        assert_eq!(normalize_color("#FF2968FF").as_deref(), Some("#ff2968"));
        assert_eq!(normalize_color("#abcdef").as_deref(), Some("#abcdef"));
        assert_eq!(normalize_color("red"), None);
    }
}
