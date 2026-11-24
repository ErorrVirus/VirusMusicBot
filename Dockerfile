FROM node:24-alpine

WORKDIR /app

# Install production dependencies using lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY src ./src

# Prepare writable persistent directories for non-root user
RUN mkdir -p /app/data /app/logs && chown -R node:node /app

USER node

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "src/healthcheck.js"]

CMD ["node", "src/index.js"]
