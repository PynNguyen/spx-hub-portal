#!/bin/bash
# ============================================================
# LỆNH TRIỂN KHAI 1-CLICK LÊN GOOGLE CLOUD RUN (DÙNG TRÊN CLOUD SHELL)
# ============================================================

echo "🚀 Bắt đầu build và triển khai SPX Hub lên Google Cloud Run..."

# Thiết lập region Singapore (asia-southeast1)
gcloud config set run/region asia-southeast1

# Deploy trực tiếp từ mã nguồn qua Cloud Build
gcloud run deploy spx-hub-portal \
  --source . \
  --region asia-southeast1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 1 \
  --max-instances 20

echo ""
echo "✅ HOÀN TẤT! Đường link Cloud Run HTTPS 24/7 đã được cấp ở trên."
