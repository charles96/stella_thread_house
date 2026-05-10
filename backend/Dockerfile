FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# Playwright 브라우저 다운로드 스킵 (별도 컨테이너에서 실행)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN npm ci --legacy-peer-deps

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build


FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4100
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 4100
CMD ["node", "dist/main.js"]
