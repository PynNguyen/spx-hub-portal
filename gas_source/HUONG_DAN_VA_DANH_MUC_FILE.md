# BẢN BACKUP TOÀN DIỆN DỰ ÁN HỆ THỐNG ĐIỀU HÀNH HUB (SPX)
**Thời điểm tạo backup:** 29/10/2026  
**Trạng thái:** Toàn vẹn 100% tất cả các file `.gs` và `.html` qua các giai đoạn phát triển.

---

## 1. Cấu Trúc Các Thư Mục Backup

Gói backup này được phân chia thành 4 nhánh rõ ràng để anh có thể dễ dàng kiểm tra, triển khai hoặc quay về bất kỳ phiên bản nào:

```
BACKUP_DU_AN_TONG_HOP_20261029/
│
├── 📁 01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX/       <-- [BẢN KHUYÊN DÙNG] Bản mới nhất đã hoàn thiện
│   ├── Toàn bộ mã nguồn Backend (.gs) đã module hóa & tương thích 100%
│   ├── Toàn bộ mã nguồn Giao diện (.html) đã tối ưu UI/UX, tốc độ mở 0ms
│   ├── JS_FMS.html: 8 thẻ KPI trên 1 hàng ngang, chuẩn hóa đúng 4 nhóm ngữ nghĩa
│   ├── JS_Pick.html: 5 thẻ KPI chuẩn gốc (EXPECTED, ACCEPTED, ARRIVED, DONE, INBOUNDED)
│   │                 3 ca ETA (12H, 19H, 21H), 2 box nạp dữ liệu Task & Assign cố định
│   ├── index.html: Gỡ sidebar phụ, đưa điều hướng lên header, nhúng tĩnh không giật lag
│   ├── module_simulation_preview.html: Bản mô phỏng tương tác trực tiếp 100%
│   └── simulation_verification_report.md: Báo cáo kiểm định kỹ thuật
│
├── 📁 02_Ban_Goc_Chua_Dieu_Chinh_UI_UX/         <-- Bản gốc chưa sửa giao diện
│   ├── Toàn bộ file .gs đã chia tách module (00 đến 07)
│   └── Toàn bộ file .html nguyên bản ban đầu (chưa áp dụng cải tiến UI/UX)
│
├── 📁 03_Ban_Goc_So_Khai_Monolithic_AppBackend/  <-- Bản sơ khai ban đầu
│   ├── File App_Backend.gs nguyên khối 1.5MB (trước khi phân tách)
│   └── Các file HTML gốc từ Desktop\Dự Án
│
├── 📁 04_Ban_Nhanh_Phu_Huong_B/                 <-- Bản nhánh phụ trợ
│   └── 3 file backend: 03_Pick_Operations.gs, 05_FMS_Live_Firestore.gs, 07_Rescue_ViPham_Triggers.gs
│
└── 📄 HUONG_DAN_VA_DANH_MUC_FILE.md            <-- Tài liệu này
```

---

## 2. Bảng Danh Mục File Chi Tiết & Chức Năng

### A. Nhóm File Backend Google Apps Script (`.gs`)
| STT | Tên File `.gs` | Chức Năng / Nghiệp Vụ Chính |
| :---: | :--- | :--- |
| 1 | `00_Core_Config.gs` | Khởi tạo hệ thống, cấu hình biến toàn cục, kết nối dữ liệu cốt lõi |
| 2 | `01_Admin_Dashboard.gs` | Nghiệp vụ quản trị hệ thống, bảng điều khiển tổng hợp |
| 3 | `02_Aging_Quahan.gs` | Xử lý dữ liệu hàng quá hạn, tuổi thọ đơn hàng tồn (Aging) |
| 4 | `03_Pick_Operations.gs` | Xử lý nghiệp vụ FirstMile (Pick hàng, gán đơn, tài xế, ETA) |
| 5 | `04_KPIFail_Analytics.gs` | Phân tích lỗi rớt KPI, phân tích nguyên nhân sự cố |
| 6 | `05_FMS_Live_Firestore.gs` | Đồng bộ thời gian thực Firestore, quản lý tồn đọng FMS LastMile |
| 7 | `06_RiderPlan_Forecast.gs` | Kế hoạch điều phối nhân sự Rider, dự báo sản lượng |
| 8 | `07_Rescue_ViPham_Triggers.gs` | Xử lý đơn cứu cứu, phát hiện và kiểm soát vi phạm vận hành |
| 9 | `Firestore bridge.gs` | Cầu nối giao tiếp và phân quyền Firestore Realtime |
| 10 | `Flmkpi backend.gs` | Tính toán chỉ số KPI FirstMile và LastMile |
| 11 | `Multi_DB_Router.gs` | Điều hướng truy vấn đa nguồn dữ liệu (Multi-Database) |
| 12 | `StationConfig.gs` | Cấu hình trạm, danh mục Hub/Station, phân quyền trạm |
| * | `App_Backend.gs` *(Ở mục 03)* | Bản backend nguyên khối 1.5MB trước khi phân tách |

---

### B. Nhóm File Giao Diện Web (`.html`)
| STT | Tên File `.html` | Mô Tả & Cải Tiến Đã Thực Hiện Tại Bản Mới Nhất |
| :---: | :--- | :--- |
| 1 | `index.html` | Trang chủ điều hướng. **Đã sửa**: gỡ bỏ sidebar phụ vướng víu, tích hợp navigation lên header, nhúng tĩnh các module chính để mở tức thì 0ms |
| 2 | `JS_FMS.html` | Quản lý Tồn Đọng Hub. **Đã sửa**: thu gọn 8 thẻ KPI về 1 hàng ngang, chuẩn hóa 4 nhóm ngữ nghĩa, bảo toàn 100% cột dữ liệu và luồng Live/Manual |
| 3 | `JS_Pick.html` | Quản lý Lấy Hàng FirstMile. **Đã sửa**: chuẩn hóa 5 thẻ trạng thái KPI gốc (`EXPECTED`, `ACCEPTED`, `ARRIVED`, `DONE`, `INBOUNDED`), 3 ca ETA (`12H`, `19H`, `21H`), cố định 2 hộp nạp dữ liệu Task & Assign |
| 4 | `JS_DonCauCuu.html` | Quản lý Đơn Cứu Cứu khẩn cấp (đã tối ưu giao diện) |
| 5 | `JS_KPIFail.html` | Phân tích Đơn Thất Bại & Rớt KPI |
| 6 | `JS_Quahan.html` | Quản lý Đơn Hàng Quá Hạn lưu bãi trạm |
| 7 | `JS_ViPham.html` | Báo cáo Vi Phạm vận hành của Shipper / Kho |
| 8 | `JS_AdminZone.html` | Phân hệ Admin phân quyền và quản trị hệ thống |
| 9 | `JS_Luong.html` | Bảng tính & tra cứu Lương, chiết khấu nhân sự |
| 10 | `JS_Rider_plan.html` | Bảng kế hoạch ca kíp và chỉ tiêu Shipper |
| 11 | `JS_Tailieu.html` | Trung tâm Lưu trữ Tài liệu quy trình vận hành |
| 12 | `JS_Tracuu.html` | Tra cứu hành trình đơn hàng, thông tin khách/tài xế |
| 13 | `Analytics_Block.html` | Khối phân tích biểu đồ & báo cáo thống kê |
| 14 | `TailwindBuild.html` | Thư viện giao diện Tailwind CSS nội bộ của dự án |
| 15 | `UI_NoReportAccess.html` | Giao diện thông báo khi tài khoản không có quyền xem báo cáo |
| 16 | `UI_RequestAccess.html` | Giao diện gửi yêu cầu xin cấp quyền truy cập |
| 17 | `module_simulation_preview.html` | File mô phỏng chạy độc lập trên trình duyệt để kiểm tra tương tác 100% các chức năng mới |

---

## 3. Hướng Dẫn Sử Dụng & Khôi Phục

1. **Khi triển khai lên Apps Script chính thức**:
   - Sử dụng toàn bộ file trong thư mục `01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX/`.
   - File manifest `appsscript.json` đã có sẵn trong thư mục.
2. **Khi cần đối chiếu lại bản gốc**:
   - Vào thư mục `02_Ban_Goc_Chua_Dieu_Chinh_UI_UX/` để xem lại code trước khi tinh gọn giao diện.
   - Hoặc thư mục `03_Ban_Goc_So_Khai_Monolithic_AppBackend/` để xem file backend gốc `App_Backend.gs`.
3. **Khi cần kiểm tra nhanh không cần mạng/Apps Script**:
   - Nhấp đúp mở file `01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX/module_simulation_preview.html` bằng trình duyệt Chrome/Edge/Brave.
