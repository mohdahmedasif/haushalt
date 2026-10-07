FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_HAUSHALT_API_KEY=haushalt-local
ENV VITE_HAUSHALT_API_KEY=$VITE_HAUSHALT_API_KEY
RUN npm run build

ENV HOST=0.0.0.0
ENV PORT=8787
ENV HAUSHALT_API_KEY=haushalt-local

EXPOSE 8787

VOLUME ["/app/data"]

CMD ["npx", "tsx", "server/index.ts"]
