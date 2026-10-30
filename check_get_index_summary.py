with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('kpifail_getIndexSummary')
if pos != -1:
    print(content[pos-100:pos+600])
else:
    print("Không tìm thấy")
