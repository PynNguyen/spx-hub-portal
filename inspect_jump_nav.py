import re

with open('public/views/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')

# Tìm vị trí định nghĩa hàm spxJumpToNav
for i, l in enumerate(lines):
    if 'function spxJumpToNav' in l:
        print(f"Hàm spxJumpToNav bắt đầu từ dòng {i+1}:")
        for j in range(i, min(len(lines), i + 80)):
            print(f"  {j+1:5d}: {lines[j]}")
        break

print("\n=== SOI XỬ LÝ KHI CLICK TỪNG MỤC NAV ===")
for i, l in enumerate(lines):
    if 'spxBuildNav' in l and 'function' in l:
        print(f"Hàm spxBuildNav bắt đầu từ dòng {i+1}:")
        for j in range(i, min(len(lines), i + 50)):
            print(f"  {j+1:5d}: {lines[j]}")
        break
