# ---- build stage: compile the typed services from their source of truth ----
FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY services ./services
RUN npm ci && npm run build && npm cache clean --force

# ---- runtime stage: production dependencies and compiled output only ----
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY migrations ./migrations
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services

RUN npm ci --omit=dev && npm cache clean --force

USER node
STOPSIGNAL SIGTERM
EXPOSE 3000

CMD ["node", "services/gateway/index.js"]
