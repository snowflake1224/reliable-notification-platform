FROM node:20-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/scheduler/package.json apps/scheduler/package.json
COPY apps/provider-simulator/package.json apps/provider-simulator/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
RUN npm run build -w @nplat/web

FROM nginx:1.27-alpine
COPY infra/docker/nginx.conf /etc/nginx/nginx.conf
COPY demo/notify-demo.html /usr/share/nginx/html/notify-demo.html
COPY --from=web /app/apps/web/dist /usr/share/nginx/html
