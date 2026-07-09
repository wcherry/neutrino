# =============================================================================
# neutrino — unified service Dockerfile
# =============================================================================

# ── Web Build Stage ───────────────────────────────────────────────────────────
FROM node:23-alpine AS web-builder

WORKDIR /app

RUN corepack enable

# Copy workspace manifests first (for layer caching)
COPY web/pnpm-lock.yaml web/pnpm-workspace.yaml web/package.json ./
COPY web/.npmrc .npmrc
COPY web/apps/web/package.json apps/web/package.json
COPY web/packages/api-admin/package.json packages/api-admin/package.json
COPY web/packages/api-calendar/package.json packages/api-calendar/package.json
COPY web/packages/api-core/package.json packages/api-core/package.json
COPY web/packages/api-docs/package.json packages/api-docs/package.json
COPY web/packages/api-drive/package.json packages/api-drive/package.json
COPY web/packages/api-notes/package.json packages/api-notes/package.json
COPY web/packages/api-photos/package.json packages/api-photos/package.json
COPY web/packages/api-sheets/package.json packages/api-sheets/package.json
COPY web/packages/api-slides/package.json packages/api-slides/package.json
COPY web/packages/api-diagrams/package.json packages/api-diagrams/package.json
COPY web/packages/api-drawing/package.json packages/api-drawing/package.json
COPY web/packages/sheet-embed/package.json packages/sheet-embed/package.json
COPY web/packages/e2e-crypto/package.json packages/e2e-crypto/package.json
COPY web/packages/auth/package.json packages/auth/package.json
COPY web/packages/hooks/package.json packages/hooks/package.json
COPY web/packages/layout/package.json packages/layout/package.json
COPY web/packages/tokens/package.json packages/tokens/package.json
COPY web/packages/ui/package.json packages/ui/package.json
COPY web/packages/utils/package.json packages/utils/package.json
COPY web/packages/search/package.json packages/search/package.json
COPY web/packages/collab-core/package.json packages/collab-core/package.json
RUN pnpm install --prod=false

# Copy the rest of the web source and build
COPY web/ .

WORKDIR /app/apps/web
RUN pnpm build

# ── Rust Build Stage ──────────────────────────────────────────────────────────
FROM rust:1.93 AS rust-builder

WORKDIR /app

COPY Cargo.toml ./
COPY Cargo.lock* ./

RUN mkdir src && echo "fn main(){}" > src/main.rs && \
    mkdir -p xtask/src && echo "fn main(){}" > xtask/src/main.rs && \
    mkdir -p worker/src && echo "fn main(){}" > worker/src/main.rs
COPY xtask/Cargo.toml xtask/Cargo.toml
COPY worker/Cargo.toml worker/Cargo.toml

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
COPY xtask/src xtask/src
COPY worker/src worker/src
COPY migrations migrations
RUN touch src/main.rs xtask/src/main.rs worker/src/main.rs && cargo build --release

# ── Runtime Stage ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN useradd -m appuser

WORKDIR /app

RUN mkdir -p /usr/local/data /usr/local/logs \
    && chown -R appuser:appuser /usr/local/data /usr/local/logs

RUN apt-get update \
    && apt-get install -y openssl libssl3 curl gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --from=rust-builder /app/target/release/neutrino /usr/local/bin/service
COPY --from=rust-builder /app/target/release/worker /usr/local/bin/worker
COPY --from=web-builder /app/apps/web/out /app/web
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Facial-recognition model for the background worker.
ARG FACE_MODEL_URL=https://github.com/atomashpolskiy/rustface/raw/master/model/seeta_fd_frontal_v1.0.bin
RUN mkdir -p /usr/local/models \
    && curl -fsSL -o /usr/local/models/seeta_fd_frontal_v1.0.bin "$FACE_MODEL_URL" \
    && chown -R appuser:appuser /usr/local/models
ENV FACE_MODEL_PATH=/usr/local/models/seeta_fd_frontal_v1.0.bin

ENV WEB_DIR=/app/web

EXPOSE 8080

VOLUME ["/usr/local/data", "/usr/local/logs"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/local/bin/service"]
