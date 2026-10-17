# Web app (self-hosted alternative to Vercel).
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CHAINS=robinhood-testnet
ARG NEXT_PUBLIC_ENABLE_MAINNET=false
RUN npx next build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
