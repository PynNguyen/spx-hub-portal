with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('function spxRenderRealOverview')
if pos != -1:
    print(content[pos+300:pos+1200])
