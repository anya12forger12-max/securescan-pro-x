FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# The image is self-contained: source, migrations and operational scripts are
# all baked in so the same digest can be deployed without a host bind mount.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
COPY scripts ./scripts
COPY migrations ./migrations

RUN npm ci --omit=dev && npm cache clean --force

USER node
STOPSIGNAL SIGTERM
EXPOSE 3000

CMD ["node", "services/gateway/index.js"]
