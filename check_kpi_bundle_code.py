with open('services/rpc_dispatcher.js', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('getKpiBundle(')
if pos != -1:
    print(content[pos:pos+1500])
else:
    print("Không tìm thấy getKpiBundle")
