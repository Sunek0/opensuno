# syntax=docker/dockerfile:1

FROM oven/bun:latest AS builder
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:latest
WORKDIR /app
COPY package.json bun.lock ./

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y libnss3 \
    libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libxkbcommon0 libasound2 libcups2 xvfb

ARG SUNO_COOKIE
RUN if [ -z "$SUNO_COOKIE" ]; then echo "Warning: SUNO_COOKIE is not set. You will have to set the cookies in the Cookie header of your requests."; fi
ENV SUNO_COOKIE=${SUNO_COOKIE}
# Disable GPU acceleration, as with it suno-api won't work in a Docker environment
ENV BROWSER_DISABLE_GPU=true

RUN bun install --frozen-lockfile --production

# Install all supported browsers, else switching browsers requires an image rebuild
RUN bunx playwright install chromium
# RUN bunx playwright install firefox

COPY --from=builder /src/.next ./.next
EXPOSE 3000
CMD ["bun", "run", "start"]
