# --- deps & build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

# better-sqlite3 needs build tools to compile its native addon on alpine
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# tzdata is required for named IANA timezones (e.g. LAIN_TIMEZONE/TZ) to
# resolve correctly on Alpine — without it, Node silently treats everything
# as UTC.
RUN apk add --no-cache tzdata

RUN addgroup -S lain && adduser -S lain -G lain

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Next's standalone output file-tracing doesn't always pull in every file
# of a dependency it detects as used (adm-zip's non-index files were
# getting dropped, leaving only its util/ subfolder) — copy it in whole
# from the full install to guarantee it works regardless of tracing quirks.
COPY --from=builder /app/node_modules/adm-zip ./node_modules/adm-zip

RUN mkdir -p /data && chown -R lain:lain /data /app
USER lain

# Baked in at build time (see deploy.sh/scripts/update.sh) so Lain can
# compare her running commit against github.com/sketch0395/lain without
# needing the local tools agent (see lib/version.js).
ARG GIT_COMMIT=unknown
ENV LAIN_GIT_COMMIT=$GIT_COMMIT

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV LAIN_DB_PATH=/data/lain.db
EXPOSE 3000

CMD ["node", "server.js"]
