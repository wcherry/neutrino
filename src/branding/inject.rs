// ── branding::inject ──────────────────────────────────────────────────────────
//
// Writes the instance's brand and the organisation's preference defaults into every HTML page the
// static web app serves, so they are present before first paint (customization roadmap §6.1).
//
// What goes in, right after `<meta charset>` and ahead of the app's anti-FOUC script that reads it:
//
//   <script id="neutrino-instance">window.__NEUTRINO_INSTANCE__ = { brand, org }</script>
//   <style id="neutrino-brand">…the accent as custom properties, the logo…</style>  (if either is set)
//   <link rel="icon" href="…">                                                      (if a favicon is set)
//
// The logo is CSS over the app's `data-brand="logo"` boxes. The brand's text is not written into
// the markup: no branded element is prerendered (the app shell renders on hydration, sign-in behind
// its Suspense boundary), and each one's first render reads the name from `__NEUTRINO_INSTANCE__`
// (`web/apps/web/src/lib/instanceBrand.ts`), so there is no default brand to flash.
//
// `org` carries the defaults and locks, which is what lets an administrator's locked look apply on
// a device that has never loaded the app, with no flash of the product default.
//
// Caching: the HTML is revalidated on every load (`configure_web_app`), and the file's ETag no
// longer describes what is sent, so the ETag gets a suffix naming the injected snippet. A
// revalidation carrying the current suffix is passed to the file service with it stripped, so an
// unchanged page and an unchanged brand still answer 304; any other `If-None-Match`, and every
// `If-Modified-Since` (a file's mtime knows nothing about the brand), is dropped so the page is
// sent in full.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use actix_web::body::{to_bytes, BoxBody, MessageBody};
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::header::{HeaderValue, CONTENT_LENGTH, CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED};
use actix_web::http::StatusCode;
use actix_web::middleware::Next;
use actix_web::{web, Error};
use serde_json::json;

use super::color::{AccentPalette, Rgb};
use super::dto::BrandingResponse;
use super::service::BrandingService;
use crate::preferences::dto::OrgLayer;
use crate::preferences::service::PreferencesService;

/// What the middleware reads the brand and the org layer from.
pub struct InstanceHead {
    pub branding: Arc<BrandingService>,
    pub preferences: Arc<PreferencesService>,
}

impl InstanceHead {
    fn snippet(&self) -> String {
        // A database hiccup must not take the web app down with it: serve the page unbranded.
        let brand = self.branding.get().unwrap_or_else(|e| {
            tracing::warn!("branding unavailable for the served HTML: {e:?}");
            BrandingResponse::default()
        });
        let org = self.preferences.org_layer().unwrap_or_else(|e| {
            tracing::warn!("org preferences unavailable for the served HTML: {e:?}");
            OrgLayer::default()
        });
        head_snippet(&brand, &org)
    }
}

/// JSON that is safe inside a `<script>` element: nothing in it can close the element or start a
/// comment, whatever an administrator typed into the name or the sign-in message.
fn script_json(value: &serde_json::Value) -> String {
    value
        .to_string()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

fn accent_css(accent: &str) -> Option<String> {
    let p = AccentPalette::from_accent(Rgb::parse(accent)?);
    // `html:root[data-theme=…]` outranks the light and dark palettes and Drive's per-app accent
    // (`[data-app="drive"][data-theme="light"]`); the colour presets (Beach, Forest …) and a
    // user's custom theme keep their own accents, which they chose on purpose.
    let block = |theme: &str, a: Rgb, hover: Rgb, subtle: Rgb, text: Rgb| {
        format!(
            "html:root[data-theme=\"{theme}\"]{{--brand-accent:{a};--brand-accent-hover:{h};--color-accent:{a};--color-accent-hover:{h};--color-accent-subtle:{s};--color-accent-text:{t};--app-color-drive:{a}}}",
            a = a.hex(),
            h = hover.hex(),
            s = subtle.hex(),
            t = text.hex(),
        )
    };
    Some(format!(
        "{}{}",
        block("light", p.light, p.light_hover, p.light_subtle, p.light_text),
        block("dark", p.dark, p.dark_hover, p.dark_subtle, p.dark_text),
    ))
}

/// An uploaded logo, drawn over the app's `data-brand="logo"` box in place of Neutrino's mark, and
/// the name beside it hidden — a logo carries its own wordmark. The URLs are `asset_url`s: a fixed
/// path and a digits-only version, nothing that could leave the `url("…")`.
fn logo_css(brand: &BrandingResponse) -> Option<String> {
    let light = brand.logo_light_url.as_deref()?;
    let dark = brand.logo_dark_url.as_deref().unwrap_or(light);
    Some(format!(
        "[data-brand=\"logo\"]{{width:120px!important;height:30px!important;background:url(\"{light}\") left center/contain no-repeat!important;color:transparent!important;border-radius:0!important;font-size:0!important}}\
         [data-brand=\"logo\"]>*{{visibility:hidden}}\
         [data-brand=\"logo\"]~[data-brand=\"name\"]{{display:none!important}}\
         html[data-theme=\"dark\"] [data-brand=\"logo\"],html[data-theme=\"midnight\"] [data-brand=\"logo\"]{{background-image:url(\"{dark}\")!important}}"
    ))
}

/// The markup injected into `<head>`. Pure, for the tests.
pub fn head_snippet(brand: &BrandingResponse, org: &OrgLayer) -> String {
    let data = json!({ "brand": brand, "org": org });
    let mut out = format!(
        "<script id=\"neutrino-instance\">window.__NEUTRINO_INSTANCE__={};</script>",
        script_json(&data)
    );
    let css: String = [brand.accent.as_deref().and_then(accent_css), logo_css(brand)].into_iter().flatten().collect();
    if !css.is_empty() {
        out.push_str("<style id=\"neutrino-brand\">");
        out.push_str(&css);
        out.push_str("</style>");
    }
    if let Some(url) = &brand.favicon_url {
        // The URL is built by `asset_url` from a fixed kind and a digits-only version, so it needs
        // no escaping beyond what it already cannot contain.
        out.push_str(&format!("<link rel=\"icon\" href=\"{url}\"/>"));
    }
    out
}

/// `html` with `snippet` placed right after `<meta charset>` (so the charset stays within the
/// first 1024 bytes), else right after `<head …>`. Unchanged if it has neither — not a page.
pub fn inject_into(html: &str, snippet: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let anchor = lower
        .find("<meta charset")
        .or_else(|| lower.find("<head").filter(|&i| matches!(lower.as_bytes().get(i + 5), Some(b'>' | b' '))))?;
    let end = anchor + lower[anchor..].find('>')? + 1;
    let mut out = String::with_capacity(html.len() + snippet.len());
    out.push_str(&html[..end]);
    out.push_str(snippet);
    out.push_str(&html[end..]);
    Some(out)
}

fn tag_of(snippet: &str) -> String {
    let mut hasher = DefaultHasher::new();
    snippet.hash(&mut hasher);
    format!("{:012x}", hasher.finish() & 0xffff_ffff_ffff)
}

/// `"abc"` → `"abc-n<tag>"`, keeping a weak `W/` prefix.
fn tagged_etag(etag: &str, tag: &str) -> Option<String> {
    let (weak, quoted) = etag.strip_prefix("W/").map_or(("", etag), |rest| ("W/", rest));
    let inner = quoted.strip_prefix('"')?.strip_suffix('"')?;
    Some(format!("{weak}\"{inner}-n{tag}\""))
}

/// The inverse of `tagged_etag` for the current tag only.
fn untagged_etag(etag: &str, tag: &str) -> Option<String> {
    let suffix = format!("-n{tag}\"");
    etag.strip_suffix(&suffix).map(|head| format!("{head}\""))
}

/// Routes that answer with a page: a trailing slash, `.html`, or no extension at all.
fn may_be_page(path: &str) -> bool {
    let last = path.rsplit('/').next().unwrap_or("");
    last.is_empty() || last.ends_with(".html") || !last.contains('.')
}

pub async fn inject_instance(
    mut req: ServiceRequest,
    next: Next<impl MessageBody + 'static>,
) -> Result<ServiceResponse<BoxBody>, Error> {
    let head = req.app_data::<web::Data<InstanceHead>>().cloned();
    let Some(head) = head.filter(|_| may_be_page(req.path())) else {
        return Ok(next.call(req).await?.map_into_boxed_body());
    };

    let snippet = head.snippet();
    let tag = tag_of(&snippet);

    let headers = req.headers_mut();
    headers.remove(IF_MODIFIED_SINCE);
    let revalidating = headers.get(IF_NONE_MATCH).and_then(|v| v.to_str().ok()).map(str::to_owned);
    headers.remove(IF_NONE_MATCH);
    if let Some(stripped) = revalidating.as_deref().and_then(|v| untagged_etag(v.trim(), &tag)) {
        if let Ok(value) = HeaderValue::from_str(&stripped) {
            headers.insert(IF_NONE_MATCH, value);
        }
    }

    let res = next.call(req).await?;
    let is_html = res
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.starts_with("text/html"));

    let retag = |res: &mut actix_web::HttpResponse<BoxBody>| {
        let etag = res.headers().get(ETAG).and_then(|v| v.to_str().ok()).and_then(|e| tagged_etag(e, &tag));
        match etag.and_then(|e| HeaderValue::from_str(&e).ok()) {
            Some(value) => {
                res.headers_mut().insert(ETAG, value);
            }
            None => {
                res.headers_mut().remove(ETAG);
            }
        }
        res.headers_mut().remove(LAST_MODIFIED);
    };

    if res.status() == StatusCode::NOT_MODIFIED {
        let (req, res) = res.into_parts();
        let mut res = res.map_into_boxed_body();
        retag(&mut res);
        return Ok(ServiceResponse::new(req, res));
    }
    if !is_html || !res.status().is_success() {
        return Ok(res.map_into_boxed_body());
    }

    let (req, res) = res.into_parts();
    let (res, body) = res.into_parts();
    let bytes = to_bytes(body).await.map_err(|e| actix_web::error::ErrorInternalServerError(e.into()))?;
    let html = String::from_utf8_lossy(&bytes);
    let body = match inject_into(&html, &snippet) {
        Some(injected) => injected.into_bytes(),
        None => bytes.to_vec(),
    };
    let mut res = res.set_body(BoxBody::new(body));
    res.headers_mut().remove(CONTENT_LENGTH);
    retag(&mut res);
    Ok(ServiceResponse::new(req, res))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brand() -> BrandingResponse {
        BrandingResponse {
            name: Some("Acme </script><script>alert(1)</script> Cloud".into()),
            accent: Some("#13945a".into()),
            sign_in_message: Some("Use your Acme account.\nQuestions? <a href=x>".into()),
            favicon_url: Some("/api/v1/branding/assets/favicon?v=20261021".into()),
            ..BrandingResponse::default()
        }
    }

    #[test]
    fn nothing_an_admin_types_can_leave_the_script_element() {
        let snippet = head_snippet(&brand(), &OrgLayer::default());
        // One opening and one closing script tag: the ones we wrote.
        assert_eq!(snippet.matches("<script").count(), 1, "{snippet}");
        assert_eq!(snippet.matches("</script>").count(), 1, "{snippet}");
        assert!(snippet.contains("\\u003c/script\\u003e"));
    }

    #[test]
    fn the_accent_becomes_light_and_dark_custom_properties() {
        let snippet = head_snippet(&brand(), &OrgLayer::default());
        assert!(snippet.contains("html:root[data-theme=\"light\"]{--brand-accent:#13945a;"), "{snippet}");
        assert!(snippet.contains("html:root[data-theme=\"dark\"]{--brand-accent:#"), "{snippet}");
        assert!(snippet.contains("<link rel=\"icon\" href=\"/api/v1/branding/assets/favicon?v=20261021\"/>"));
    }

    #[test]
    fn an_unbranded_instance_still_carries_the_org_layer() {
        let mut org = OrgLayer::default();
        org.values.insert("appearance.look".into(), json!("precision"));
        org.locked.push("appearance.look".into());
        let snippet = head_snippet(&BrandingResponse::default(), &org);
        assert!(!snippet.contains("<style"));
        assert!(snippet.contains(r#""org":{"locked":["appearance.look"],"values":{"appearance.look":"precision"}}"#), "{snippet}");
    }

    #[test]
    fn it_goes_after_the_charset_and_before_everything_else() {
        let html = r#"<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><script>boot()</script></head><body></body></html>"#;
        let out = inject_into(html, "<!--X-->").unwrap();
        assert!(out.contains(r#"<meta charSet="utf-8"/><!--X--><script>boot()</script>"#), "{out}");
        // No charset: straight after <head>.
        let out = inject_into("<html><head><title>t</title></head></html>", "<!--X-->").unwrap();
        assert!(out.starts_with("<html><head><!--X--><title>"), "{out}");
        // `<header>` is not `<head>`, and a fragment is left alone.
        assert_eq!(inject_into("<header>hi</header>", "<!--X-->"), None);
    }

    #[test]
    fn an_uploaded_logo_is_drawn_over_the_mark() {
        let mut b = BrandingResponse::default();
        b.logo_light_url = Some("/api/v1/branding/assets/logo-light?v=1".into());
        let snippet = head_snippet(&b, &OrgLayer::default());
        assert!(snippet.contains(r#"url("/api/v1/branding/assets/logo-light?v=1")"#), "{snippet}");
        // No dark logo: the light one serves both.
        assert!(snippet.contains(r#"html[data-theme="dark"] [data-brand="logo"],html[data-theme="midnight"] [data-brand="logo"]{background-image:url("/api/v1/branding/assets/logo-light?v=1")"#), "{snippet}");
    }

    #[test]
    fn etags_round_trip_through_the_tag() {
        let tag = tag_of("snippet");
        assert_eq!(tagged_etag("\"abc:12\"", &tag).unwrap(), format!("\"abc:12-n{tag}\""));
        assert_eq!(tagged_etag("W/\"abc\"", &tag).unwrap(), format!("W/\"abc-n{tag}\""));
        assert_eq!(untagged_etag(&format!("\"abc:12-n{tag}\""), &tag).unwrap(), "\"abc:12\"");
        // A tag from before the brand changed does not strip, so the page is sent again.
        assert_eq!(untagged_etag(&format!("\"abc-n{}\"", tag_of("old")), &tag), None);
    }

    #[test]
    fn only_page_routes_are_considered() {
        for page in ["/", "/sign-in/", "/drive", "/docs/editor/index.html"] {
            assert!(may_be_page(page), "{page}");
        }
        for asset in ["/favicon.ico", "/manifest.json", "/sw.js", "/drive.txt"] {
            assert!(!may_be_page(asset), "{asset}");
        }
    }
}
