# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package*.json ./
RUN npm ci --production
COPY server.js ./
# Do NOT copy local .env files into the image. Environment variables should be
# provided by the hosting platform (Render, Heroku, etc.) at deploy time.
# COPY .env.local ./   <-- intentionally omitted for security and portability
EXPOSE 3001
CMD ["node","server.js"]
