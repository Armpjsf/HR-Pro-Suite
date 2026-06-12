# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Run stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
# ข้อมูลทั้งหมดอยู่ใน /app/data — ต้อง mount volume เพื่อไม่ให้หายตอน redeploy
VOLUME ["/app/data"]
CMD ["npm", "start"]
