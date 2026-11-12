FROM node:20-bookworm-slim

# Instalar Chromium, git (necesario para whatsapp-web.js desde GitHub) y fuentes básicas
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    git \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Indicar a Puppeteer que use el Chromium del sistema y no descargue otro en npm install
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
