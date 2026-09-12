# ---- 构建阶段：安装全部依赖并构建前端 ----
FROM node:20-alpine AS builder
WORKDIR /app
# 国内网络加速（海外环境可删除这一行）
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 运行阶段：仅生产依赖 ----
FROM node:20-alpine
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=builder /app/dist ./dist

EXPOSE 57891
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
