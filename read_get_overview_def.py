with open('services/rpc_dispatcher.js', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('getOverviewPart(')
# tìm vị trí thứ 2 (là nơi định nghĩa hàm)
pos2 = content.find('getOverviewPart(', pos + 20)
if pos2 != -1:
    print(content[pos2-20:pos2+1200])
else:
    print("Chỉ có 1 vị trí:", content[pos:pos+500])
