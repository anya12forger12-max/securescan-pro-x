# ---- build stage: compile the typed services and the browser client ----
# Pinned to node 22.23.5 (multi-arch index digest verified from Docker Hub).
# Update tag and digest together when upgrading.
FROM node:22.23.5-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY services ./services
# The CRA client has its own lockfile and peer-dependency policy, exactly as it
# does in the reference app; keep it independent of the workspace install.
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./frontend/
# The frontend lockfile pins a vendored elliptic patch, so the tarball must be
# in the build context before npm ci runs.
COPY frontend/security-patches ./frontend/security-patches
RUN npm ci && npm cache clean --force
RUN npm --prefix frontend ci && npm --prefix frontend cache clean --force

COPY frontend/config-overrides.js frontend/tsconfig.json ./frontend/
COPY frontend/public ./frontend/public
COPY frontend/src ./frontend/src
RUN npm run build && npm --prefix frontend run build

# ---- runtime stage: production dependencies and compiled output only ----
FROM node:22.23.5-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY migrations ./migrations
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
# The gateway serves these static files from the same origin as /v1, so no
# second web server or public port is needed.
COPY --from=build /app/frontend/build ./frontend/build

RUN npm ci --omit=dev && npm cache clean --force

USER node
STOPSIGNAL SIGTERM
EXPOSE 3000

CMD ["node", "services/gateway/index.js"]
