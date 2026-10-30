with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

import re
matches = re.findall(r'spxOvFetchPart\(["\'](\w+)["\']', content)
print('Các part Tổng quan yêu cầu:', set(matches))

pos = content.find('function spxOvFetchPart')
if pos != -1:
    print('\n--- Hàm spxOvFetchPart ---')
    print(content[pos:pos+500])

pos2 = content.find('function spxRenderRealOverview')
if pos2 != -1:
    print('\n--- Hàm spxRenderRealOverview ---')
    print(content[pos2:pos2+600])
