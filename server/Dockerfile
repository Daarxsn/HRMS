FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/private-uploads && chown node:node /app/private-uploads

USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080

STOPSIGNAL SIGTERM
CMD ["node","dist/src/index.js"]
