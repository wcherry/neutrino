# ---------- Build Stage ----------
FROM node:23-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable

# Copy workspace manifests first (for caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api-admin/package.json packages/api-admin/package.json
COPY packages/api-calendar/package.json packages/api-calendar/package.json
COPY packages/api-core/package.json packages/api-core/package.json
COPY packages/api-docs/package.json packages/api-docs/package.json
COPY packages/api-drive/package.json packages/api-drive/package.json
COPY packages/api-notes/package.json packages/api-notes/package.json
COPY packages/api-photos/package.json packages/api-photos/package.json
COPY packages/api-sheets/package.json packages/api-sheets/package.json
COPY packages/api-slides/package.json packages/api-slides/package.json
COPY packages/sheet-embed/package.json packages/sheet-embed/package.json
COPY packages/e2e-crypto/package.json packages/e2e-crypto/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/hooks/package.json packages/hooks/package.json
COPY packages/layout/package.json packages/layout/package.json
COPY packages/tokens/package.json packages/tokens/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/utils/package.json packages/utils/package.json

# Install dependencies
RUN pnpm install --prod=false

# Copy the rest of the repository
COPY . .

# Build the web app
WORKDIR /app/apps/web
RUN pnpm build
# RUN pnpm export

# ---------- Runtime Stage ----------
FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY neutrino-proxy.conf /etc/nginx/conf.d/default.conf

# Copy static output
COPY --from=builder /app/apps/web/out /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
