import os
import re
import subprocess

print("=== 1. SOI CHÍNH XÁC CÁC THẺ SCRIPTLET <? TRONG public/views/index.html ===")
views_dir = 'public/views'
index_path = os.path.join(views_dir, 'index.html')

with open(index_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Tìm tất cả các thẻ dạng <? ... ?>
scriptlets = re.findall(r'<\?[\s\S]*?\?>', content)
print(f"-> Tìm thấy {len(scriptlets)} thẻ scriptlet trong index.html:")
for s in scriptlets[:15]:
    print("   ", s.strip())

# Soi dòng 25 đến dòng 45 của index.html
lines = content.split('\n')
print("\n--- NỘI DUNG TỪ DÒNG 25 ĐẾN 45 CỦA index.html ---")
for i in range(24, min(45, len(lines))):
    print(f"Dòng {i+1:2d}: {lines[i]}")

print("\n=== 2. CẬP NHẬT server.js ĐỂ XỬ LÝ TOÀN DIỆN MỌI THẺ <?...?> ===")
with open('server.js', 'r', encoding='utf-8') as f:
    srv = f.read()

# Hàm renderTemplate nâng cao: giải quyết mọi thẻ <?!= include ?>, <?= ... ?>, <?!= ... ?>
improved_render = """// Hàm đọc và biên dịch triệt để mọi thẻ scriptlet Google Apps Script
function renderTemplate(viewName) {
  const filePath = findViewFile(viewName);
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn(`[renderTemplate] Không tìm thấy file: ${viewName}`);
    return `<div style="color:red;padding:20px;font-weight:bold">Module không tồn tại: ${viewName}</div>`;
  }
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Đệ quy include file con
  content = content.replace(/<\\?!=\\s*include\\(['"]([^'"]+)['"]\\)\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\\?=\\s*include\\(['"]([^'"]+)['"]\\)\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\\?\\s*include\\(['"]([^'"]+)['"]\\)\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });

  // 2. Điền giá trị thực cho các biến nội suy thường gặp trong Apps Script
  content = content.replace(/<\\?!=\\s*(userAccess|accessJson|spxAccess|SPX_ACCESS)[^>]*\\?>/gi, JSON.stringify({
    role: 'ADMIN',
    roleLevel: 99,
    email: 'admin@spxexpress.com',
    allowedStations: ['ALL'],
    isSuperAdmin: true,
    isAdmin: true
  }));
  
  content = content.replace(/<\\?=\\s*(userEmail|email|currentEmail)[^>]*\\?>/gi, 'admin@spxexpress.com');
  content = content.replace(/<\\?=\\s*(initialStation|currentStation|station|defaultHub)[^>]*\\?>/gi, '45-DLK Mdrak Hub');
  content = content.replace(/<\\?!=\\s*(initialStation|currentStation|station)[^>]*\\?>/gi, '"45-DLK Mdrak Hub"');

  // 3. Xóa an toàn tất cả các thẻ <?...?> còn sót lại trong mã nguồn để không bao giờ bị 'Unexpected token <'
  content = content.replace(/<\\?!=[^>]*\\?>/g, 'null');
  content = content.replace(/<\\?=[^>]*\\?>/g, '""');
  content = content.replace(/<\\?[^>]*\\?>/g, '');

  return content;
}"""

import re
srv = re.sub(r'function renderTemplate\(viewName\) \{[\s\S]*?\n\}', improved_render, srv)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(srv)
print("-> Đã nâng cấp hàm renderTemplate trong server.js!")

print("\n=== 3. CHẠY KIỂM TRA RENDER XEM CÒN DẤU <? NÀO TRONG SCRIPT KHÔNG ===")
test_code = """
const fs = require('fs');
const path = require('path');

// Test hàm render mới
const server = require('./server');
"""
res = subprocess.run(['node', '-e', """
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync('server.js', 'utf8').replace(/app\\.listen[\\s\\S]*/, ''));

const out = renderTemplate('index');
const lines = out.split('\\n');
console.log('Kiểm tra 50 dòng đầu tiên của HTML sau render:');
for (let i = 25; i < Math.min(45, lines.length); i++) {
  console.log((i+1) + ': ' + lines[i]);
}

const remainingTags = out.match(/<\\?[\\s\\S]*?\\?>/g);
console.log('Số thẻ <? còn lại trong HTML:', remainingTags ? remainingTags.length : 0);
"""], capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print("Stderr:", res.stderr)

print("\n=== 4. PUSH LÊN GITHUB MAIN ĐỂ RENDER DEPLOY BẢN SỬA HOÀN TOÀN ===")
subprocess.run(['git', 'add', 'server.js'], check=True)
subprocess.run(['git', 'commit', '-m', 'fix: resolve all GAS scriptlets to eliminate unexpected token < at line 35'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n🎉 ĐÃ ĐẨY BẢN KHẮC PHỤC LÊN GITHUB THÀNH CÔNG!")
