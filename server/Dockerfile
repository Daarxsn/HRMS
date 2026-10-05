FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .
RUN mkdir -p /app/private-uploads && chown -R node:node /app

USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080

STOPSIGNAL SIGTERM
CMD ["node","src/index.js"]
