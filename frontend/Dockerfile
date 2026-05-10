FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# next.config.js 의 output: 'standalone' 으로 .next/standalone 에 self-contained 번들 생성.
RUN npm run build


FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

# standalone 번들엔 server.js + 최소 node_modules 만 포함 → 이미지 사이즈 대폭 축소.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3100
CMD ["node", "server.js"]
