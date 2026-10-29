# ============================================================
# DOCKERFILE CHO GOOGLE CLOUD RUN - SPX HUB MANAGEMENT
# Tối ưu hóa hiệu năng, bảo mật và hỗ trợ múi giờ Việt Nam
# ============================================================

FROM node:22-slim

# Múi giờ Việt Nam
ENV TZ=Asia/Ho_Chi_Minh
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /app

# Biến môi trường
ENV NODE_ENV=production

# Cài đặt dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy toàn bộ mã nguồn
COPY . .

# Port Cloud Run
EXPOSE 8080

# Khởi chạy server
CMD ["node", "server.js"]
