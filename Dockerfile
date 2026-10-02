# Single service: builds the web app, then serves it and the API from one Node process.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force
COPY backend backend
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/index.js"]
