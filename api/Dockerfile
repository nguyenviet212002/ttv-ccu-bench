FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache tini

COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --omit=dev

EXPOSE 3000

ENV NODE_ENV=production
ENV UV_THREADPOOL_SIZE=16

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/cluster.js"]
