with open('services/rpc_dispatcher.js', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('getKpiBundle(')
pos2 = content.find('getKpiBundle(', pos + 20)
if pos2 != -1:
    print(content[pos2-20:pos2+1800])
else:
    print("Chỉ có 1 vị trí")
