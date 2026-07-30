FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/realtime/package.json apps/realtime/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/feature-flags/package.json packages/feature-flags/package.json
COPY packages/lastfm-provider/package.json packages/lastfm-provider/package.json
COPY packages/mailer/package.json packages/mailer/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/realtime-token/package.json packages/realtime-token/package.json
COPY packages/sensitive/package.json packages/sensitive/package.json

RUN npm ci

FROM deps AS build

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app /app

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "web", "--", "--hostname", "0.0.0.0", "--port", "3000"]
