with open('public/views/index.html', 'r', errors='ignore') as f:
    content = f.read()

import re
matches = re.findall(r'spxOvFetchPart\([^,]+,\s*[\'"]([^\'"]+)[\'"]', content)
print("Danh sách các 'part' được gọi từ giao diện:", set(matches))
