FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

VOLUME ["/app/data"]

CMD ["npx", "tsx", "server/index.ts"]
