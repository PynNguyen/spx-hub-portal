# BẢN SO SÁNH TRỰC QUAN GIAO DIỆN HIỆN TẠI VS ĐỀ XUẤT MỚI (5 MODULE)

Tài liệu này tổng hợp hình ảnh hiện tại và bản mô phỏng trực quan tương tác cho 5 module vận hành:
1. **Tra Cứu HUB**
2. **SPX Wiki / Tài Liệu**
3. **Hiệu Quả Chi Phí (Lương Sản Lượng)**
4. **Tồn Đọng LastMile (FMS)**
5. **Quản Lý Pick**

> [!TIP]
> Bạn có thể mở trực tiếp bản mô phỏng tương tác hoàn chỉnh (click đổi tab, lọc thẻ, chuyển trạng thái) tại:
> 👉 [**ui_redesign_preview.html**](file:///C:/Users/xuan.nguyenthanh01/.gemini/antigravity/brain/b71d51f4-9f9c-473c-bd64-94d5616d61ea/ui_redesign_preview.html)

---

## 1. MODULE TỒN ĐỌNG LASTMILE / FMS (Ưu Tiên 1 - ✅ ĐÃ HOÀN THÀNH)

### Hiện trạng (Hình 4):
![FMS Hiện tại](file:///C:/Users/xuan.nguyenthanh01/.gemini/antigravity/brain/b71d51f4-9f9c-473c-bd64-94d5616d61ea/.user_uploaded/media_1793181102177_bc81e1c6.png)

* **Vấn đề cốt lõi:** Bị ép bởi 2 menu (Menu chính + Sidebar riêng FMS 280px). Bảng dữ liệu bị bóp nghẹt, mã đơn hàng `SPXVN0694057...`, Zone ID `EAKLY N...`, Tài khoản `NS MARKETPLACE STA...` đều bị cắt cụt.
* **Đề xuất mới (UI/UX 2.0 - Đã triển khai):**
  - **Nút bật/tắt Sidebar trên Toolbar:** Cho phép thu gọn sidebar nguồn dữ liệu 280px để mở rộng 100% diện tích cho bảng tác nghiệp.
  - **Hàng thẻ KPI ngang trên đỉnh (8 thẻ trạng thái):** `Tổng Tồn` (xem toàn bộ) + 7 nhóm trạng thái (`Đơn Mới`, `Hẹn Giao`, `Delay Khác`, `Quá 3 Ca`, `Hoàn Hàng`, `Tồn 3-5N`, `Tồn > 5N`). Bấm lần 1 để lọc nhóm, bấm lần 2 để hoàn tác về toàn bộ đơn.
  - **Bảng mở rộng `min-w-[1100px]`:** Cột Mã Đơn Hàng (`min-w-[180px]`), Zone ID (`min-w-[110px]`), Phường (`min-w-[140px]`) không bao giờ bị cắt cụt `...`.
  - **Top Lý Do Delay dạng Drawer thu gọn:** Thiết kế 3 cột nhỏ gọn, có nút thu gọn/mở rộng, không còn chiếm diện tích đẩy bảng tác nghiệp xuống dưới.

---

## 2. MODULE QUẢN LÝ PICK (Ưu Tiên 1 - ✅ ĐÃ HOÀN THÀNH)

### Hiện trạng (Hình 5):
![Pick Hiện tại](file:///C:/Users/xuan.nguyenthanh01/.gemini/antigravity/brain/b71d51f4-9f9c-473c-bd64-94d5616d61ea/.user_uploaded/media_1793181110512_53c29918.png)

* **Vấn đề cốt lõi:** Bảng Pick bị bóp nghẹt; cột `A...`, `TẤT CẢ TG PI...`, `TẤT CẢ XÃ/P...` bị co giật mất chữ. Khối "Hàng lấy theo giai đoạn" nằm phẳng đơn điệu.
* **Đề xuất mới (UI/UX 2.0 - Đã triển khai):**
  - **Quy trình dạng phễu (Pipeline Stepper 4 chặng):**
    `1. Chờ Lấy (Rose)` ➔ `2. Chờ Nhập (Amber)` ➔ `3. Chờ Đóng (Sky)` ➔ `4. Chờ Niêm (Emerald)` với huy hiệu % sản lượng và giải thích nghiệp vụ.
  - **Tương tác lọc 1 chạm (Click-to-filter):** Bấm vào bất kỳ chặng nào -> tự động lọc đơn theo trạng thái công việc tương ứng; bấm lại để bỏ lọc.
  - **Nút bật/tắt Sidebar trên Toolbar:** Nhanh chóng thu gọn sidebar quản lý file để bảng bung rộng.
  - **Bảng chống cắt chữ `min-w-[1100px]`:** Cột STT, Seller, Pickup, Mã đơn, ATT, TG Pick, Xã/Phường hiển thị đủ chữ.

---

## 3. MODULE TRA CỨU HUB

### Hiện trạng (Hình 1):
![Tra cứu Hiện tại](file:///C:/Users/xuan.nguyenthanh01/.gemini/antigravity/brain/b71d51f4-9f9c-473c-bd64-94d5616d61ea/.user_uploaded/media_1793180960922_96bda2db.png)

* **Vấn đề cốt lõi:** Placeholder "Đang sẵn sàng..." gây hiểu lầm; bắt buộc chọn tab trước khi gõ; 3 khối hướng dẫn tĩnh chiếm hết 60% màn hình.
* **Đề xuất mới (UI/UX 2.0):**
  - **Smart Universal Search:** Gõ bất kỳ xã, phường, huyện hay mã HUB -> Tự động nhận diện và xổ danh sách gợi ý (*Autocomplete*) từ ký tự thứ 2.
  - **Bổ sung Widget Lịch sử tra cứu gần đây + Bưu cục lân cận.**
  - **Thẻ kết quả thông minh:** Nút 1-Click Copy Email Hub, Copy SĐT Lead trạm, Chỉ đường Google Maps.

---

## 4. MODULE SPX WIKI / TÀI LIỆU

### Hiện trạng (Hình 2):
![Tài liệu Hiện tại](file:///C:/Users/xuan.nguyenthanh01/.gemini/antigravity/brain/b71d51f4-9f9c-473c-bd64-94d5616d61ea/.user_uploaded/media_1793180983196_1a7da648.png)

* **Vấn đề cốt lõi:** Sidebar 33 nhóm trải dài lê thê; viền cam bao quanh toàn màn hình thô cứng; các nút hành động bên phải không đồng bộ.
* **Đề xuất mới (UI/UX 2.0):**
  - **Gom 33 nhóm thành 5 phân hệ lớn có icon:** Hành chính/CCDC, Nhân sự/C&B, Vận hành Hub, Tuân thủ/Claim, Công nghệ/IT.
  - **Mục "SOP & Biểu mẫu Vận hành Thường dùng nhất" (Ghim đầu trang):** Truy cập nhanh trong 1 giây.
  - Chuẩn hóa nút hành động: `[📄 Xem SOP]`, `[🔗 Mở Tool]`, `[📥 Tải mẫu]`.

---

## 5. MODULE ĐỐI SOÁT LƯƠNG SẢN LƯỢNG

### Hiện trạng (Hình 3):
![Lương Hiện tại](file:///C:/Users/xuan.nguyenthanh01/.gemini/antigravity/brain/b71d51f4-9f9c-473c-bd64-94d5616d61ea/.user_uploaded/media_1793180992727_4f65d7b1.png)

* **Vấn đề cốt lõi:** Bày sẵn 4 card với hàng loạt ô select disabled và nút cam "LỌC & TÍNH" khi chưa có file; bảng trống mênh mông chiếm 60% màn hình.
* **Đề xuất mới (UI/UX 2.0):**
  - **Cơ chế 2 trạng thái:**
    * *Chưa có file:* Hiện **Hero Upload Box** thanh lịch ở giữa, kèm nút "Tải file CSV mẫu chuẩn" và giải thích các cột bắt buộc.
    * *Đã nạp file:* Hiện thanh điều khiển 1 hàng ngang mỏng + 4 thẻ KPI tổng hợp quỹ lương + Bảng phân bổ thứ hạng (Kim cương, Bạch kim...) kèm thanh tiến độ mini.
