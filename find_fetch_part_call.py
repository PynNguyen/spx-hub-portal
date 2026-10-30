with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('function spxOvFetchPart')
if pos != -1:
    pos2 = content.find('.spx_getOverviewPart(', pos)
    if pos2 != -1:
        print("--- Lời gọi trong spxOvFetchPart: ---")
        print(content[pos2-100:pos2+300])
