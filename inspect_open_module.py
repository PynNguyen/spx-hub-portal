with open('public/views/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')

print("=== 1. SOI BẢN ĐỒ REAL_MODULE_MAP ===")
for i, l in enumerate(lines):
    if 'REAL_MODULE_MAP' in l and ('=' in l or '{' in l):
        print(f"REAL_MODULE_MAP ở dòng {i+1}:")
        for j in range(max(0, i-2), min(len(lines), i+30)):
            print(f"  {j+1:5d}: {lines[j]}")
        break

print("\n=== 2. SOI HÀM openModule GỐC ===")
for i, l in enumerate(lines):
    if 'function openModule' in l:
        print(f"Hàm openModule ở dòng {i+1}:")
        for j in range(max(0, i-2), min(len(lines), i+50)):
            print(f"  {j+1:5d}: {lines[j]}")
        break
