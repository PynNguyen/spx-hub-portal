import os
import re

src_dir = "gas_source/01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX"

print("=== 1. TÀI LIỆU HƯỚNG DẪN DỰ ÁN ===")
doc_path = "gas_source/HUONG_DAN_VA_DANH_MUC_FILE.md"
if os.path.exists(doc_path):
    with open(doc_path, 'r', encoding='utf-8') as f:
        print(f.read()[:1500])

print("\n=== 2. CÁC DỊCH VỤ GOOGLE APPS SCRIPT ĐƯỢC DÙNG TRONG CODE .GS ===")
google_services = set()
for fname in os.listdir(src_dir):
    if fname.endswith('.gs'):
        with open(os.path.join(src_dir, fname), 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            found = re.findall(r'\b([A-Z][a-zA-Z]+(?:App|Service))\b', content)
            google_services.update(found)

print("Các dịch vụ Google cần Adapter trong Node.js:")
for s in sorted(list(google_services)):
    print(f"  ⚡ {s}")
