import re

with open("public/views/JS_Tongquan.html", "r", errors="ignore") as f:
    content = f.read()

# Tìm các chỗ gọi spx_getOverviewPart hoặc render thẻ
matches = re.findall(r'spxOvFetchPart\(["\'](\w+)["\']', content)
print("Các 'part' mà Tổng quan gọi:", set(matches))

# Xem hàm cập nhật DOM tương ứng
for part in ['violation', 'kpi', 'rescue', 'aging', 'plan', 'kpifail']:
    pos = content.find(f"part === '{part}'")
    if pos == -1:
        pos = content.find(f"'{part}'")
    if pos != -1:
        print(f"\n--- Đoạn code xử lý '{part}' trong JS_Tongquan.html ---")
        print(content[pos:pos+350])
