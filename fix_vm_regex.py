# 1. Cập nhật _spx_findCols_ trong 03_Pick_Operations.gs để nhận diện RegExp an toàn
pick_path = "gas_source/01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX/03_Pick_Operations.gs"
with open(pick_path, 'r', encoding='utf-8') as f:
    content = f.read()

old_hit = "var hit = (cands[ci] instanceof RegExp) ? cands[ci].test(norm[c2]) : (norm[c2] === cands[ci]);"
new_hit = "var hit = (cands[ci] instanceof RegExp || (cands[ci] && typeof cands[ci].test === 'function')) ? cands[ci].test(norm[c2]) : (norm[c2] === cands[ci]);"

content = content.replace(old_hit, new_hit)
with open(pick_path, 'w', encoding='utf-8') as f:
    f.write(content)

# 2. Thêm chuỗi string 'lh arrived time finalized for kpi' vào 04_KPIFail_Analytics.gs
kpi_path = "gas_source/01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX/04_KPIFail_Analytics.gs"
with open(kpi_path, 'r', encoding='utf-8') as f:
    kpi_content = f.read()

old_kpi = "lhArrivedFinal: [/^lh arrived time finali[sz]e/]"
new_kpi = "lhArrivedFinal: ['lh arrived time finalized for kpi', 'lh arrived time finalize', /^lh arrived time finali[sz]e/]"

kpi_content = kpi_content.replace(old_kpi, new_kpi)
with open(kpi_path, 'w', encoding='utf-8') as f:
    f.write(kpi_content)

print("✅ Đã hoàn tất vá lỗi nhận diện RegExp trong Node.js!")
