import os
import zipfile
import subprocess

print("=== 1. KHẮC PHỤC TRIỆT ĐỂ LỖI PICK ĐÈ MÀN HÌNH BẰNG CSS !IMPORTANT ===")
index_path = 'public/views/index.html'

with open(index_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Chèn CSS bắt buộc ẩn vào ngay trong thẻ <head>
css_fix = """<style id="spx-fix-hidden-clash">
  .hidden { display: none !important; }
  [id^="view-"].hidden { display: none !important; visibility: hidden !important; }
</style>"""

if 'id="spx-fix-hidden-clash"' not in content:
    content = content.replace('<head>', '<head>\n' + css_fix)

with open(index_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("✅ Đã chèn .hidden { display: none !important; } để Pick không bao giờ đè tab khác!")

print("\n=== 2. KIỂM TRA CÁC BẢN GIAO DIỆN TRONG BACKUP GỐC ===")
zip_file = 'BACKUP_DU_AN_TONG_HOP_20261029.zip'
with zipfile.ZipFile(zip_file, 'r') as z:
    for info in z.infolist():
        clean_name = info.filename.replace('\\', '/')
        if clean_name.endswith('.html'):
            print(f"  📦 {clean_name:<60} ({info.file_size:,} bytes)")

print("\n=== 3. XEM LỊCH SỬ CÁC COMMIT GIAO DIỆN GẦN ĐÂY ===")
res = subprocess.run(['git', 'log', '-n', '8', '--oneline'], capture_output=True, text=True)
print(res.stdout)

print("\n=== 4. PUSH BẢN FIX CSS LÊN RENDER ĐỂ KIỂM CHỨNG CHUYỂN TAB ===")
subprocess.run(['git', 'add', 'public/views/index.html'], check=True)
subprocess.run(['git', 'commit', '-m', 'fix: force .hidden { display: none !important } to resolve view-pick overlay clash'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n🎉 ĐÃ ĐẨY LÊN RENDER! Hãy xem kết quả in ở trên.")
