with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('.spx_getOverviewPart(')
if pos != -1:
    print("--- Lời gọi .spx_getOverviewPart: ---")
    print(content[pos-100:pos+300])
else:
    print("Không tìm thấy .spx_getOverviewPart")
