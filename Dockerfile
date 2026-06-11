# Productie-image voor de Auto Taxatie app.
FROM node:20-bookworm-slim

WORKDIR /app

# Eerst alleen de manifesten kopiëren voor betere build-caching.
COPY package.json ./
RUN npm install --omit=dev

# Daarna de rest van de app.
COPY . .

# SQLite-data komt in /app/data; mount hier een persistent volume.
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
