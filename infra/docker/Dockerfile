FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/scheduler/package.json apps/scheduler/package.json
COPY apps/provider-simulator/package.json apps/provider-simulator/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete \
  && npm run build -w @nplat/shared \
  && test -f packages/shared/dist/index.js \
  && test -f packages/shared/dist/index.d.ts \
  && npm run build -w @nplat/api \
  && npm run build -w @nplat/worker \
  && npm run build -w @nplat/scheduler \
  && npm run build -w @nplat/provider-simulator

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
ARG APP=api
ENV APP=${APP}
CMD ["sh", "-c", "node apps/${APP}/dist/index.js"]
