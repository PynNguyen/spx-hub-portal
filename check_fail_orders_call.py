with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('flm_getFailOrdersByDay')
if pos != -1:
    print(content[pos-50:pos+500])
else:
    print("Không tìm thấy flm_getFailOrdersByDay")
