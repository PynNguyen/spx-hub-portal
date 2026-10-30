with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('function spxOvBuildPriorityCards_')
if pos != -1:
    print(content[pos:pos+2000])
else:
    print("Không tìm thấy hàm spxOvBuildPriorityCards_")
