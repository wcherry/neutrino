//! Which address a request came from, for the per-IP sign-up limits.
//!
//! Trusting a forwarding header the server does not sit behind would let a
//! script put any address it likes in it and walk around every per-IP limit,
//! so headers are read only when `CLIENT_IP_HEADER` names one. Unset, the TCP
//! peer address is used — correct when the server is exposed directly, and
//! when it sits behind a proxy every request shares the proxy's address, which
//! makes the per-IP limit act as a server-wide one: stricter, never weaker.

use actix_web::HttpRequest;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};

/// Where the client address is read from (`CLIENT_IP_HEADER`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ClientIpSource {
    /// The TCP peer address. The default.
    #[default]
    Peer,
    /// The last entry of `X-Forwarded-For`: the one the proxy in front of the
    /// server appended, which the client cannot forge.
    XForwardedFor,
    /// A header holding a single address, set by the proxy (`CF-Connecting-IP`,
    /// `X-Real-IP`, `Fly-Client-IP`, …).
    Header(String),
}

impl ClientIpSource {
    /// Reads `CLIENT_IP_HEADER`: unset or `peer` for the TCP peer, otherwise a
    /// header name (`x-forwarded-for` is treated specially, see above).
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            None | Some("") | Some("peer") => Self::Peer,
            Some("x-forwarded-for") => Self::XForwardedFor,
            Some(other) => Self::Header(other.to_string()),
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Self::Peer => "TCP peer address".into(),
            Self::XForwardedFor => "last X-Forwarded-For entry".into(),
            Self::Header(h) => format!("{h} header"),
        }
    }

    /// The client address, normalised; `"unknown"` when there is none.
    pub fn client_ip(&self, req: &HttpRequest) -> String {
        let header = |name: &str| {
            req.headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        };
        let peer = req.peer_addr().map(|a| a.ip());
        let raw = match self {
            Self::Peer => {
                warn_if_behind_proxy(peer, req);
                peer.map(|ip| ip.to_string())
            }
            Self::XForwardedFor => header("x-forwarded-for")
                .and_then(|v| v.rsplit(',').next().map(|s| s.trim().to_string())),
            Self::Header(name) => header(name),
        };
        raw.as_deref()
            .and_then(normalise)
            .or_else(|| peer.map(|ip| ip.to_string()))
            .unwrap_or_else(|| "unknown".into())
    }
}

/// Parses an address and gives its canonical text. IPv6 addresses are cut to
/// their /64, since one machine typically holds a whole /64 and could
/// otherwise take a fresh address per sign-up.
fn normalise(raw: &str) -> Option<String> {
    let ip: IpAddr = raw.trim().parse().ok()?;
    Some(match ip {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => v4.to_string(),
            None => {
                let s = v6.segments();
                format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
            }
        },
    })
}

static WARNED: AtomicBool = AtomicBool::new(false);

/// Says once, loudly, when the peer is a private address and the request
/// carries a forwarding header: the server is behind a proxy and
/// `CLIENT_IP_HEADER` should be set, or every sign-up shares one address.
fn warn_if_behind_proxy(peer: Option<IpAddr>, req: &HttpRequest) {
    let private = match peer {
        Some(IpAddr::V4(v4)) => v4.is_private() || v4.is_loopback(),
        Some(IpAddr::V6(v6)) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
        None => false,
    };
    let forwarded = ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"]
        .iter()
        .find(|h| req.headers().contains_key(**h));
    if let (true, Some(h)) = (private, forwarded) {
        if !WARNED.swap(true, Ordering::Relaxed) {
            tracing::warn!(
                "sign-up arrived from private address {:?} with a {} header: the server looks to be \
                 behind a proxy. Set CLIENT_IP_HEADER (e.g. `x-forwarded-for` or `cf-connecting-ip`), \
                 or every sign-up counts against the proxy's address.",
                peer,
                h
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    #[test]
    fn peer_is_the_default_and_ignores_forwarding_headers() {
        let req = TestRequest::default()
            .peer_addr("203.0.113.9:5000".parse().unwrap())
            .insert_header(("x-forwarded-for", "198.51.100.1"))
            .to_http_request();
        assert_eq!(ClientIpSource::parse(None).client_ip(&req), "203.0.113.9");
    }

    #[test]
    fn x_forwarded_for_takes_the_entry_the_proxy_appended() {
        let req = TestRequest::default()
            .peer_addr("10.0.0.2:5000".parse().unwrap())
            .insert_header(("x-forwarded-for", "1.1.1.1, 198.51.100.7"))
            .to_http_request();
        let src = ClientIpSource::parse(Some("X-Forwarded-For"));
        assert_eq!(src.client_ip(&req), "198.51.100.7");
    }

    #[test]
    fn a_named_header_is_read_and_garbage_falls_back_to_the_peer() {
        let src = ClientIpSource::parse(Some("cf-connecting-ip"));
        let good = TestRequest::default()
            .peer_addr("10.0.0.2:5000".parse().unwrap())
            .insert_header(("cf-connecting-ip", "198.51.100.8"))
            .to_http_request();
        assert_eq!(src.client_ip(&good), "198.51.100.8");
        let bad = TestRequest::default()
            .peer_addr("10.0.0.2:5000".parse().unwrap())
            .insert_header(("cf-connecting-ip", "not-an-ip"))
            .to_http_request();
        assert_eq!(src.client_ip(&bad), "10.0.0.2");
    }

    #[test]
    fn ipv6_is_grouped_by_its_slash_64() {
        assert_eq!(normalise("2001:db8:1:2:aaaa::1").unwrap(), "2001:db8:1:2::/64");
        assert_eq!(normalise("2001:db8:1:2:bbbb::9").unwrap(), "2001:db8:1:2::/64");
        assert_eq!(normalise("::ffff:203.0.113.4").unwrap(), "203.0.113.4");
    }
}
