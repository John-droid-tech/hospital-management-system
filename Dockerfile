FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/server.js ./server.js
WORKDIR /app
COPY index.html app.js styles.css ./

EXPOSE 3000
CMD ["node", "backend/server.js"]
