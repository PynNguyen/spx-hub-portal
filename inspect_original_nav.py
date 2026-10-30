import os
import re

index_path = 'public/views/index.html'
with open(index_path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
print(f"Tổng số dòng trong index.html: {len(lines):,}")

print("\n=== 1. SOI DÒNG 4860 ĐẾN 4880 (NƠI CHẠY OVERVIEW TỔNG QUAN) ===")
for i in range(max(0, 4855), min(len(lines), 4885)):
    print(f"Dòng {i+1:5d}: {lines[i]}")

print("\n=== 2. TÌM VÙNG CHỨA CỦA BẢNG PICK ===")
for i, line in enumerate(lines):
    if 'NẠP FILE TASK' in line:
        print(f"Bảng Pick nằm ở dòng {i+1}")
        # Lùi lại 25 dòng để tìm thẻ div bao ngoài bảng Pick
        for j in range(max(0, i-25), i+5):
            print(f"  Dòng {j+1:5d}: {lines[j]}")
        break

print("\n=== 3. TÌM CÁC CONTAINER MODULE TRONG TOÀN BỘ FILE ===")
containers = re.findall(r'<div[^>]*id="[^"]*(?:module|view|content|tab|pane|section)[^"]*"[^>]*>', content, re.IGNORECASE)
for c in containers[:20]:
    print("  Container:", c)

print("\n=== 4. TÌM CÁC THẺ LI / A TRONG SIDEBAR GỐC ===")
for i, line in enumerate(lines):
    if 'Đơn không đạt KPI' in line:
        print(f"Mục 'Đơn không đạt KPI' ở dòng {i+1}:")
        for j in range(max(0, i-5), min(len(lines), i+8)):
            print(f"  Dòng {j+1:5d}: {lines[j]}")
        break

print("\n=== 5. TÌM HÀM CHUYỂN MODULE GỐC CỦA DỰ ÁN ===")
matches = re.findall(r'function\s+([a-zA-Z0-9_]*(?:switch|show|open|nav|select|load)[a-zA-Z0-9_]*)\s*\([^)]*\)', content, re.IGNORECASE)
print("Danh sách các hàm điều hướng gốc tìm thấy:", set(matches))
