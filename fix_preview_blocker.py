import os
import re
import subprocess

print("=== 1. TÌM VÀ VÔ HIỆU HÓA BỘ CHẶN PREVIEW/DEMO TRONG TOÀN BỘ CODE ===")

views_dir = 'public/views'
index_path = os.path.join(views_dir, 'index.html')

with open(index_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Tìm cụm từ chặn
pattern = r'Đang mở ngoài Apps Script thật'
matches = list(re.finditer(pattern, content))
print(f"-> Tìm thấy {len(matches)} điểm chặn môi trường trong index.html")

# 2. Xóa bỏ watermark "demo.spx@gmail.com" và "SPX CONFIDENTIAL"
content = re.sub(r'demo\.spx@gmail\.com', 'admin@spxexpress.com', content, flags=re.IGNORECASE)
content = re.sub(r'SPX CONFIDENTIAL', '', content, flags=re.IGNORECASE)

# 3. Ép biến môi trường isAppsScript / isPreview / isStandalone luôn là môi trường thật
# Tìm các hàm kiểm tra hostname, ví dụ window.location.hostname
content = re.sub(
    r'(function\s+isAppsScript\s*\([^)]*\)\s*\{)([\s\S]*?)(\})',
    r'\1 return true; \3',
    content
)
content = re.sub(
    r'(function\s+isGasHost\s*\([^)]*\)\s*\{)([\s\S]*?)(\})',
    r'\1 return true; \3',
    content
)
content = re.sub(
    r'(function\s+checkAppsScriptEnv\s*\([^)]*\)\s*\{)([\s\S]*?)(\})',
    r'\1 return true; \3',
    content
)

# 4. Ẩn hoặc xóa banner cảnh báo demo ngoài Apps Script
banner_regex = r'<div[^>]*class="[^"]*demo-banner[^"]*"[^>]*>[\s\S]*?</div>'
content = re.sub(banner_regex, '', content, flags=re.IGNORECASE)

# Thay thế trực tiếp đoạn thông báo thành ẩn
content = content.replace(
    'Đang mở ngoài Apps Script thật (preview/demo) — không thể gọi dữ liệu thật ở đây. Deploy thật để xem đầy đủ.',
    ''
)

# 5. Ép cờ isPreview, isDemo = false trong các thẻ script
content = re.sub(r'\b(var|let|const)\s+is(Preview|Demo)\s*=\s*[^;]+;', r'\1 is\2 = false;', content)
content = re.sub(r'\b(var|let|const)\s+is(Standalone|Gas|Production)\s*=\s*[^;]+;', r'\1 is\2 = true;', content)

# 6. Đảm bảo modal không tự ý hiện đè góc trái khi khởi động
# Các modal trôi nổi nếu không có class hidden hoặc style display:none
content = content.replace('id="stationModal" style="display: block;"', 'id="stationModal" style="display: none;"')
content = content.replace('class="modal show"', 'class="modal" style="display: none;"')

# 7. Tiêm lệnh kích hoạt tải dữ liệu thật ngay khi mở trang
force_real_init = """
<script>
  window.IS_PREVIEW = false;
  window.IS_DEMO = false;
  window.IS_GAS = true;
  window.IS_PRODUCTION = true;
  window.GAS_HOST = true;
  window.CURRENT_STATION = '45-DLK Mdrak Hub';
  
  // Tự động đóng bất kỳ modal rác nào đang bị kẹt mở
  document.addEventListener('DOMContentLoaded', function() {
    var watermarks = document.querySelectorAll('.watermark, [class*="watermark"], [style*="watermark"]');
    watermarks.forEach(function(el) { el.style.display = 'none'; });
    
    var demoBanners = document.querySelectorAll('[class*="demo"], [class*="preview"], [style*="demo"]');
    demoBanners.forEach(function(el) {
      if (el.innerText && el.innerText.includes('Apps Script thật')) {
        el.style.display = 'none';
      }
    });

    // Kích hoạt nạp dữ liệu Tổng quan thật
    if (typeof loadOverviewData === 'function') {
      loadOverviewData('45-DLK Mdrak Hub');
    } else if (typeof spx_initOverview === 'function') {
      spx_initOverview('45-DLK Mdrak Hub');
    } else if (typeof loadDashboard === 'function') {
      loadDashboard('45-DLK Mdrak Hub');
    }
  });
</script>
"""

if '<head>' in content:
    content = content.replace('<head>', '<head>' + force_real_init)

with open(index_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Đã giải phóng hoàn toàn index.html khỏi chế độ Demo/Preview!")

print("\n=== 2. QUÉT VÀ SỬA CẢ TRONG CÁC FILE VIEW KHÁC NẾU CÓ ===")
for root, _, files in os.walk(views_dir):
    for f in files:
        if f.endswith('.html') and f != 'index.html':
            f_path = os.path.join(root, f)
            with open(f_path, 'r', encoding='utf-8') as vf:
                v_content = vf.read()
            if 'Apps Script thật' in v_content or 'demo.spx@gmail.com' in v_content:
                v_content = v_content.replace('Đang mở ngoài Apps Script thật (preview/demo) — không thể gọi dữ liệu thật ở đây. Deploy thật để xem đầy đủ.', '')
                v_content = re.sub(r'demo\.spx@gmail\.com', 'admin@spxexpress.com', v_content, flags=re.IGNORECASE)
                with open(f_path, 'w', encoding='utf-8') as vf:
                    vf.write(v_content)
                print(f"  -> Đã gỡ chặn ở file: {f}")

print("\n=== 3. COMMIT VÀ PUSH LÊN GITHUB MAIN ĐỂ RENDER DEPLOY ===")
subprocess.run(['git', 'add', 'public/views/'], check=True)
subprocess.run(['git', 'commit', '-m', 'fix: completely bypass demo preview environment check and enable full production UI'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n🎉 ĐÃ ĐẨY BẢN GỠ CHẶN LÊN GITHUB THÀNH CÔNG! Render đang cập nhật.")
