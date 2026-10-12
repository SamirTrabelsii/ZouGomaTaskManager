FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY --from=build /app/dist ./dist
COPY server ./server
COPY tsconfig.json ./
EXPOSE 3001
CMD ["npx", "tsx", "server/index.ts"]
