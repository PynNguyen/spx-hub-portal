with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

pos = content.find('function spxOvPaintCards')
if pos != -1:
    print(content[pos:pos+1500])
else:
    print("Không tìm thấy hàm spxOvPaintCards")
