# Vercel container service (services: api). Build context = api/.
# Same runtime as docker/Dockerfile.api, adjusted for this context. Vercel sends traffic
# on PORT (80 here); the server reads PORT from the environment.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# schema must exist before `npm ci` (postinstall runs `prisma generate`).
COPY prisma ./prisma
RUN npm ci
COPY . ./
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0555 /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
