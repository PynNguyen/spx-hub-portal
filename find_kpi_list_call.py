with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

for keyword in ['kpifail_getMasterDataLite', 'Danh sách đơn không đạt KPI', 'kpifail_']:
    pos = content.find(keyword)
    if pos != -1:
        print(f"=== Keyword: {keyword} ===")
        print(content[pos-100:pos+400])
        break
