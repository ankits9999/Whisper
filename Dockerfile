FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY standalone.html ./
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "server.js"]
