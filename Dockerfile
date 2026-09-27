# syntax=docker/dockerfile:1
FROM node:22-slim AS build

WORKDIR /app
ENV NODE_ENV=development

RUN apt-get update -qq \
    && apt-get install --no-install-recommends -y build-essential python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY . .

RUN npm run build -w @blinkscore/core \
    && npm run build -w @blinkscore/server \
    && npm run build -w @blinkscore/web

FROM node:22-slim AS run

WORKDIR /app
ENV NODE_ENV=production PORT=4000

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY data/ppsa.db ./baked/ppsa.db

EXPOSE 4000
CMD ["sh", "-c", "mkdir -p data && [ -f data/ppsa.db ] || cp baked/ppsa.db data/ppsa.db; exec node apps/server/dist/index.js"]