FROM node:22-slim

WORKDIR /app

# Install once from the lockfile. The anonymous /app/node_modules volume in
# docker-compose.yml keeps this layer even when the source is bind-mounted.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
RUN npm ci --omit=dev && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "services/gateway/index.js"]
