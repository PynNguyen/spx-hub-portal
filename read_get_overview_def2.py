with open('services/rpc_dispatcher.js', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('getOverviewPart(')
pos2 = content.find('getOverviewPart(', pos + 20)
if pos2 != -1:
    print(content[pos2+600:pos2+2000])
