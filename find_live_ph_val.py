with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('function spxRenderRealOverview')
if pos != -1:
    print(content[pos+1100:pos+2000])
