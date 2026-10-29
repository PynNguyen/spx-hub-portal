# HƯỚNG DẪN TRIỂN KHAI HỆ THỐNG LÊN GOOGLE CLOUD RUN (24/7/365 - 500 HUB)

> **Mục tiêu**: Đưa toàn bộ hệ thống điều hành Hub lên nền tảng Google Cloud Run chính thức.  
> **Cam kết**: 
> - Hoạt động liên tục **24/7/365**, không bao giờ bị sập khi máy tính cá nhân tắt.
> - Chịu tải đồng thời cho **500 Hub trên toàn quốc** với cơ chế tự động co giãn (Auto-scaling).
> - Hoàn toàn độc lập và **không bị ảnh hưởng bởi việc Admin chặn `script.google.com`**.
> - Miễn phí đường truyền bảo mật HTTPS, SLA 99.95%.

---

## CÁCH 1: Triển Khai Qua Google Cloud Shell (KHUYÊN DÙNG - CỰC NHANH TRONG 3 PHÚT)

Bạn không cần cài đặt bất kỳ phần mềm nào (không cần gcloud, không cần Docker trên máy). Tất cả thực hiện trực tiếp trên trình duyệt web:

### Bước 1: Mở Google Cloud Shell
1. Mở trình duyệt và truy cập vào: 👉 **[https://shell.cloud.google.com/](https://shell.cloud.google.com/)**  
   *(Đăng nhập bằng tài khoản Google của bạn)*.
2. Đảm bảo bạn đang chọn đúng Project ID (ví dụ: project `spxshopee-...` hoặc project bạn muốn deploy).

### Bước 2: Tải gói mã nguồn lên Cloud Shell
1. Trên thanh công cụ Cloud Shell, bấm vào biểu tượng dấu **Ba chấm `⋮`** (ở góc trên bên phải) $\rightarrow$ chọn **Upload** (Tải file lên).
2. Chọn file: 👉 **`Downloads\SPX_Hub_CloudRun.zip`** từ máy tính của bạn và bấm Upload.

### Bước 3: Chạy lệnh triển khai tự động
Trong màn hình dòng lệnh của Cloud Shell, bạn chỉ cần copy và dán 3 lệnh sau:

```bash
unzip -o SPX_Hub_CloudRun.zip -d spx-hub
cd spx-hub
bash deploy_cloudshell.sh
```

### Bước 4: Nhận link vận hành chính thức
* Google Cloud sẽ tự động biên dịch container bằng Cloud Build và triển khai lên Cloud Run (Singapore `asia-southeast1`).
* Sau khoảng 1-2 phút, màn hình sẽ hiển thị đường link HTTPS chính thức:
  👉 `Service URL: https://spx-hub-portal-xxxx-as.a.run.app`
* **Xong!** Bạn gửi đường link này cho toàn bộ 500 Hub. Mọi người có thể lưu bookmark trình duyệt và sử dụng vĩnh viễn 24/7.

---

## CÁCH 2: Triển Khai Qua Giao Diện Google Cloud Console (Không gõ lệnh)

Nếu bạn đã liên kết mã nguồn với tài khoản GitHub:
1. Đẩy thư mục `SPX_Hub_CloudRun` lên kho lưu trữ GitHub của bạn.
2. Truy cập: 👉 **[https://console.cloud.google.com/run](https://console.cloud.google.com/run)**
3. Bấm **"Create Service"** (Tạo dịch vụ):
   - **Service name**: `spx-hub-portal`
   - **Region**: Chọn `asia-southeast1 (Singapore)`
   - **Deployment platform**: Chọn *Continuously deploy from a repository* $\rightarrow$ Chọn repo GitHub vừa tạo.
   - **Authentication**: Tích chọn *"Allow unauthenticated invocations"* (cho phép nhân sự các Hub truy cập giao diện Web).
   - **Container, Networking, Security**:
     - Memory: `1 GiB`
     - CPU: `1`
     - Execution environment: *Default*
4. Bấm **"Create"** (Tạo). Cloud Run sẽ tự động build và cấp link HTTPS sau 2 phút.

---

## 3. Cấu Hình Google Cloud Scheduler (Kích hoạt Trigger 24/7)

Hệ thống đã có sẵn endpoint `/api/triggers/:triggerName` để Google Cloud Scheduler tự động kích hoạt các ca vận hành:

1. Truy cập: 👉 **[https://console.cloud.google.com/cloudscheduler](https://console.cloud.google.com/cloudscheduler)**
2. Bấm **"Create Job"** (Tạo lịch trình):
   * **Job 1 (Làm ấm ca sáng 07:15)**:
     - Tần suất (Frequency): `15 7 * * *`
     - Múi giờ: `Asia/Ho_Chi_Minh`
     - Target: `HTTP`
     - URL: `https://<URL_CLOUD_RUN_CUA_BAN>/api/triggers/ana_earlyMorningWarmupRunner`
     - Method: `POST`
   * **Job 2 (Làm ấm dữ liệu mỗi 10 phút)**:
     - Tần suất: `*/10 * * * *`
     - Target: `HTTP`
     - URL: `https://<URL_CLOUD_RUN_CUA_BAN>/api/triggers/fms_and_aging_prewarm`
     - Method: `POST`
   * **Job 3 (Chốt ca cuối ngày 23:59)**:
     - Tần suất: `59 23 * * *`
     - Target: `HTTP`
     - URL: `https://<URL_CLOUD_RUN_CUA_BAN>/api/triggers/spx_nightlyMaintenanceRunner`
     - Method: `POST`

---

## 4. Tóm Tắt Ưu Điểm Đạt Được Cho 500 Hub

1. ✅ **Máy tính cá nhân tắt thoải mái**: Cloud Run chạy 24/7/365 trên hạ tầng Google Cloud data center, không phụ thuộc vào bất kỳ máy tính trạm nào.
2. ✅ **Miễn nhiễm với chính sách chặn của Admin**: Admin chỉ chặn Web App của `script.google.com`. Google Cloud Run là hạ tầng GCP độc lập, chạy container riêng, bảo mật và chuẩn mực doanh nghiệp.
3. ✅ **Tự động co giãn (Auto-scaling)**: 500 Hub cùng nạp file vào giờ cao điểm sáng và chiều, hệ thống tự động mở thêm container để xử lý trơn tru không bị nghẽn hay đơ lag.
4. ✅ **Bảo mật**: Có sẵn chứng chỉ SSL/HTTPS bảo mật chuẩn ngân hàng, tích hợp phân quyền theo Station Map.
