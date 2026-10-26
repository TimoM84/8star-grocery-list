# syntax=docker/dockerfile:1

# ---------- 1. dependencies ----------
# better-sqlite3 ships prebuilt binaries for Node 22 on linux x64/arm64 (glibc). Compiler tools
# are only installed as a fallback when no prebuilt binary can be downloaded.
# Optional: hosts behind a TLS-intercepting proxy can pass their CA bundle as a build secret:
#   docker build --secret id=ca_bundle,src=/path/to/ca.crt .
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca_bundle,required=false \
	if [ -f /run/secrets/ca_bundle ]; then \
		export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle npm_config_cafile=/run/secrets/ca_bundle; \
	fi; \
	npm ci --no-audit --no-fund \
	|| ( apt-get update \
		&& apt-get install -y --no-install-recommends python3 make g++ \
		&& rm -rf /var/lib/apt/lists/* \
		&& npm ci --no-audit --no-fund --build-from-source=better-sqlite3 )

# ---------- 2. build ----------
FROM deps AS build
WORKDIR /app
COPY . .
ARG BUILD_ID=""
ENV BUILD_ID=${BUILD_ID}
# The image tag, the Git tag and package.json must name the same version (see compose.yaml).
ARG APP_VERSION=""
RUN PKG_VERSION="$(node -p 'require("./package.json").version')"; \
	if [ -n "$APP_VERSION" ] && [ "$APP_VERSION" != "$PKG_VERSION" ]; then \
		echo "APP_VERSION is $APP_VERSION but this source is version $PKG_VERSION." \
			"Set APP_VERSION to a released version (the Git tag v<APP_VERSION> is built)." >&2; \
		exit 1; \
	fi
RUN npm run build \
	&& npm prune --omit=dev --no-audit --no-fund

# ---------- 3. runtime ----------
FROM node:22-bookworm-slim AS runtime
ARG APP_VERSION=1.5.0
LABEL org.opencontainers.image.title="8star Grocery List" \
	org.opencontainers.image.version="${APP_VERSION}" \
	org.opencontainers.image.source="https://github.com/TimoM84/8star-grocery-list"
ENV NODE_ENV=production \
	PORT=3000 \
	HOST=0.0.0.0 \
	DATA_DIR=/data \
	BODY_SIZE_LIMIT=100M
WORKDIR /app

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/scripts/backup.mjs /app/scripts/healthcheck.mjs /app/scripts/start.mjs ./scripts/

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Unprivileged user (uid 1000) provided by the official image.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "scripts/healthcheck.mjs"]

CMD ["node", "scripts/start.mjs"]
