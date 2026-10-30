with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('function spxOvFetchPart')
if pos != -1:
    print(content[pos:pos+1500])
