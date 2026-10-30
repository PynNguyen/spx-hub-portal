with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('function spxOvBuildPriorityCards_')
if pos != -1:
    print(content[pos+1000:pos+3000])
