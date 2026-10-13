//! Mail going out.
//!
//! Three ways to send, chosen by `MAIL_TRANSPORT`:
//!
//! - `outbox` appends each message as a line of JSON to a file. Development and
//!   the tests use it: the message, and any link in it, can be read back without
//!   a mail server.
//! - `smtp` hands it to a relay, configured from the `SMTP_*` variables.
//! - `resend` posts it to Resend's HTTP API with `RESEND_API_KEY`, for when
//!   there is no relay to speak SMTP to.
//!
//! When `MAIL_TRANSPORT` is unset the transport is inferred from what is
//! configured — a Resend key wins, then an SMTP host, then the outbox — so an
//! existing `SMTP_*` deployment keeps working without a new variable.
use std::path::PathBuf;

use lettre::message::header::{ContentType, HeaderName, HeaderValue};
use lettre::message::MultiPart;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use serde::Serialize;

use crate::shared::get_env_or_secret;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Message {
    pub to: String,
    pub subject: String,
    /// The plain-text part, always present.
    pub body: String,
    /// An HTML alternative, when there is one.
    pub html: Option<String>,
    /// Extra headers, such as `List-Unsubscribe`.
    pub headers: Vec<(String, String)>,
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct MailError(pub String);

#[derive(Clone)]
pub enum Mailer {
    Outbox(PathBuf),
    Smtp {
        transport: AsyncSmtpTransport<Tokio1Executor>,
        from: String,
    },
    Resend {
        client: reqwest::Client,
        api_key: String,
        /// `https://api.resend.com` unless `RESEND_URL` says otherwise.
        base_url: String,
        from: String,
    },
}

/// What Resend says when it refuses a message.
#[derive(serde::Deserialize)]
struct ResendError {
    #[serde(default)]
    name: String,
    #[serde(default)]
    message: String,
}

fn env(key: &str) -> Option<String> {
    get_env_or_secret(key).ok().filter(|v| !v.trim().is_empty())
}

/// The sender. `MAIL_FROM`, or `SMTP_FROM` for deployments configured before
/// there was more than one transport.
fn from_address(transport: &str) -> Result<String, String> {
    env("MAIL_FROM")
        .or_else(|| env("SMTP_FROM"))
        .ok_or_else(|| format!("MAIL_FROM is required to send mail through {transport}"))
}

impl Mailer {
    pub fn from_env(data_dir: &std::path::Path) -> Result<Self, String> {
        let kind = env("MAIL_TRANSPORT").unwrap_or_else(|| {
            if env("RESEND_API_KEY").is_some() {
                "resend".into()
            } else if env("SMTP_HOST").is_some() {
                "smtp".into()
            } else {
                "outbox".into()
            }
        });
        match kind.as_str() {
            "outbox" => {
                let path = env("MAIL_OUTBOX")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| data_dir.join("outbox.jsonl"));
                tracing::info!(path = %path.display(), "mail goes to the outbox file, not to anyone");
                Ok(Mailer::Outbox(path))
            }
            "smtp" => {
                let host = env("SMTP_HOST").ok_or("SMTP_HOST is required for SMTP")?;
                let from = from_address("SMTP")?;
                let mut builder = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)
                    .map_err(|e| format!("SMTP_HOST {host}: {e}"))?;
                if let Some(port) = env("SMTP_PORT") {
                    builder = builder
                        .port(port.parse().map_err(|e| format!("Invalid SMTP_PORT: {e}"))?);
                }
                if let (Some(user), Some(pass)) = (env("SMTP_USER"), env("SMTP_PASS")) {
                    builder = builder.credentials(Credentials::new(user, pass));
                }
                tracing::info!(host = %host, "mail goes out through SMTP");
                Ok(Mailer::Smtp {
                    transport: builder.build(),
                    from,
                })
            }
            "resend" => {
                let api_key = env("RESEND_API_KEY").ok_or("RESEND_API_KEY is required for Resend")?;
                let from = from_address("Resend")?;
                let base_url = env("RESEND_URL")
                    .unwrap_or_else(|| "https://api.resend.com".into())
                    .trim_end_matches('/')
                    .to_string();
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(30))
                    .build()
                    .map_err(|e| format!("could not build the Resend client: {e}"))?;
                tracing::info!("mail goes out through Resend");
                Ok(Mailer::Resend {
                    client,
                    api_key,
                    base_url,
                    from,
                })
            }
            other => Err(format!(
                "MAIL_TRANSPORT must be `outbox`, `smtp` or `resend`, not `{other}`"
            )),
        }
    }

    pub async fn send(&self, message: Message) -> Result<(), MailError> {
        match self {
            Mailer::Outbox(path) => {
                use tokio::io::AsyncWriteExt;
                let fail = |e: std::io::Error| MailError(format!("could not write the outbox: {e}"));
                let mut record = serde_json::json!({
                    "at": chrono::Utc::now().to_rfc3339(),
                    "to": message.to,
                    "subject": message.subject,
                    "body": message.body,
                });
                if let Some(html) = &message.html {
                    record["html"] = html.clone().into();
                }
                if !message.headers.is_empty() {
                    record["headers"] = headers_object(message.headers);
                }
                let mut line = record.to_string();
                line.push('\n');
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(fail)?;
                }
                let mut file = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .await
                    .map_err(fail)?;
                file.write_all(line.as_bytes()).await.map_err(fail)?;
                // Tokio hands the write to a background thread; without this the
                // caller can move on before the line is in the file, and whoever
                // reads the outbox next finds the message missing.
                file.flush().await.map_err(fail)?;
                Ok(())
            }
            Mailer::Smtp { transport, from } => {
                let mut builder = lettre::Message::builder()
                    .from(
                        from.parse()
                            .map_err(|e| MailError(format!("MAIL_FROM is not an address: {e}")))?,
                    )
                    .to(message
                        .to
                        .parse()
                        .map_err(|e| MailError(format!("{} is not an address: {e}", message.to)))?)
                    .subject(message.subject);
                for (name, value) in message.headers {
                    let name = HeaderName::new_from_ascii(name)
                        .map_err(|e| MailError(format!("a bad header name: {e}")))?;
                    builder = builder.raw_header(HeaderValue::new(name, value));
                }
                let built = match message.html {
                    Some(html) => {
                        builder.multipart(MultiPart::alternative_plain_html(message.body, html))
                    }
                    None => builder.header(ContentType::TEXT_PLAIN).body(message.body),
                };
                let email =
                    built.map_err(|e| MailError(format!("could not build the message: {e}")))?;
                transport
                    .send(email)
                    .await
                    .map_err(|e| MailError(format!("the mail server refused it: {e}")))?;
                Ok(())
            }
            Mailer::Resend {
                client,
                api_key,
                base_url,
                from,
            } => {
                let mut body = serde_json::json!({
                    "from": from,
                    "to": [message.to],
                    "subject": message.subject,
                    "text": message.body,
                });
                if let Some(html) = message.html {
                    body["html"] = html.into();
                }
                if !message.headers.is_empty() {
                    body["headers"] = headers_object(message.headers);
                }
                let response = client
                    .post(format!("{base_url}/emails"))
                    .bearer_auth(api_key)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| MailError(format!("could not reach Resend: {e}")))?;
                let status = response.status();
                if status.is_success() {
                    return Ok(());
                }
                let detail = response.bytes().await.unwrap_or_default();
                let detail = serde_json::from_slice::<ResendError>(&detail)
                    .map(|e| format!("{}: {}", e.name, e.message))
                    .unwrap_or_else(|_| {
                        String::from_utf8_lossy(&detail).chars().take(300).collect()
                    });
                Err(MailError(format!("Resend refused it ({status}): {detail}")))
            }
        }
    }

    /// For the startup log and anything else that wants to say where mail goes.
    pub fn describe(&self) -> &'static str {
        match self {
            Mailer::Outbox(_) => "writing to the outbox file; nothing is sent",
            Mailer::Smtp { .. } => "sending through SMTP",
            Mailer::Resend { .. } => "sending through Resend",
        }
    }
}

fn headers_object(headers: Vec<(String, String)>) -> serde_json::Value {
    headers
        .into_iter()
        .map(|(k, v)| (k, serde_json::Value::from(v)))
        .collect::<serde_json::Map<_, _>>()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    type Seen = Arc<Mutex<Vec<(String, serde_json::Value)>>>;

    /// A stand-in for Resend that records what it was sent and answers with
    /// `status`.
    async fn fake_resend(status: u16) -> (String, Seen) {
        use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
        let seen: Seen = Default::default();
        let state = web::Data::new(seen.clone());
        let server = HttpServer::new(move || {
            App::new().app_data(state.clone()).route(
                "/emails",
                web::post().to(
                    move |req: HttpRequest,
                          body: web::Json<serde_json::Value>,
                          seen: web::Data<Seen>| async move {
                        let auth = req
                            .headers()
                            .get("authorization")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or_default()
                            .to_string();
                        seen.lock().unwrap().push((auth, body.into_inner()));
                        let code = actix_web::http::StatusCode::from_u16(status).unwrap();
                        if code.is_success() {
                            HttpResponse::build(code).json(serde_json::json!({ "id": "abc" }))
                        } else {
                            HttpResponse::build(code).json(serde_json::json!({
                                "statusCode": status,
                                "name": "validation_error",
                                "message": "The domain is not verified.",
                            }))
                        }
                    },
                ),
            )
        })
        .workers(1)
        .bind(("127.0.0.1", 0))
        .unwrap();
        let url = format!("http://{}", server.addrs()[0]);
        actix_web::rt::spawn(server.run());
        (url, seen)
    }

    fn resend(base_url: String) -> Mailer {
        Mailer::Resend {
            client: reqwest::Client::new(),
            api_key: "re_test".into(),
            base_url,
            from: "Neutrino <hello@example.com>".into(),
        }
    }

    #[actix_web::test]
    async fn resend_gets_the_whole_message() {
        let (url, seen) = fake_resend(200).await;
        resend(url)
            .send(Message {
                to: "ada@example.com".into(),
                subject: "Ada shared a file".into(),
                body: "plain".into(),
                html: Some("<p>html</p>".into()),
                headers: vec![("List-Unsubscribe".into(), "<https://x/u>".into())],
            })
            .await
            .unwrap();
        let seen = seen.lock().unwrap();
        let (auth, body) = &seen[0];
        assert_eq!(auth, "Bearer re_test");
        assert_eq!(body["from"], "Neutrino <hello@example.com>");
        assert_eq!(body["to"], serde_json::json!(["ada@example.com"]));
        assert_eq!(body["subject"], "Ada shared a file");
        assert_eq!(body["text"], "plain");
        assert_eq!(body["html"], "<p>html</p>");
        assert_eq!(body["headers"]["List-Unsubscribe"], "<https://x/u>");
    }

    #[actix_web::test]
    async fn a_refusal_says_why() {
        let (url, _) = fake_resend(403).await;
        let err = resend(url)
            .send(Message {
                to: "ada@example.com".into(),
                subject: "s".into(),
                body: "b".into(),
                ..Default::default()
            })
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("The domain is not verified."), "{err}");
    }

    #[tokio::test]
    async fn the_outbox_keeps_a_line_per_message() {
        let dir = std::env::temp_dir().join(format!("neutrino-outbox-{}", uuid::Uuid::new_v4()));
        let path = dir.join("outbox.jsonl");
        let mailer = Mailer::Outbox(path.clone());
        for subject in ["one", "two"] {
            mailer
                .send(Message {
                    to: "ada@example.com".into(),
                    subject: subject.into(),
                    body: "b".into(),
                    ..Default::default()
                })
                .await
                .unwrap();
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<serde_json::Value> =
            text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[1]["subject"], "two");
        let _ = std::fs::remove_dir_all(dir);
    }
}
