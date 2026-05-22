# syntax=docker/dockerfile:1.4
# =============================================================================
# neutrino — unified service Dockerfile
# =============================================================================

# ── Build Stage ──────────────────────────────────────────────────────────────
FROM rust:1.93 AS builder

WORKDIR /app

COPY Cargo.toml ./
COPY Cargo.lock* ./

RUN mkdir src && echo "fn main(){}" > src/main.rs

RUN mkdir -p -m 0700 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
ARG GITHUB_TOKEN

RUN mkdir -p /root/.cargo && \
    echo '[net]\ngit-fetch-with-cli = true' > /root/.cargo/config.toml

RUN echo "machine github.com login x-access-token password ${GITHUB_TOKEN}" > /root/.netrc && \
    chmod 600 /root/.netrc

RUN git config --global credential.helper store

RUN cargo fetch
RUN cargo build --release
RUN rm -rf src

COPY src src
COPY migrations migrations
RUN touch src/main.rs && cargo build --release

# ── Runtime Stage ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN useradd -m appuser

WORKDIR /app

RUN mkdir -p /usr/local/data /usr/local/logs \
    && chown -R appuser:appuser /usr/local/data /usr/local/logs

RUN apt-get update \
    && apt-get install -y openssl libssl3 curl gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/neutrino /usr/local/bin/service
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

VOLUME ["/usr/local/data", "/usr/local/logs"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/local/bin/service"]
