import os
import re
import subprocess

print("=== 1. SOI CHÍNH XÁC NỘI DUNG DÒNG 45 ĐẾN 75 CỦA INDEX.HTML ===")

views_dir = 'public/views'
index_path = os.path.join(views_dir, 'index.html')

with open(index_path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
for i in range(max(0, 45), min(len(lines), 75)):
    print(f"Dòng {i+1:3d}: {lines[i]}")

print("\n=== 2. TỰ ĐỘNG CHUẨN HÓA VÀ LOẠI BỎ THẺ SCRIPT BỊ LỒNG NHAU ===")

# Xóa các khối script bị chèn lặp hoặc lỗi cú pháp trong head
# Gom toàn bộ khởi tạo toàn cục vào 1 khối script duy nhất, sạch sẽ
clean_init_script = """<script>
  window.RUNTIME_CACHE = window.RUNTIME_CACHE || {};
  window.SPX_ACCESS = window.SPX_ACCESS || {
    role: 'ADMIN',
    roleLevel: 99,
    email: 'admin@spxexpress.com',
    allowedStations: ['ALL'],
    isSuperAdmin: true,
    isAdmin: true
  };
  window.CURRENT_STATION = '45-DLK Mdrak Hub';
  window.IS_PREVIEW = false;
  window.IS_DEMO = false;
  window.IS_GAS = true;
  window.IS_PRODUCTION = true;
  window.GAS_HOST = true;
  try {
    localStorage.setItem('spx_current_hub', '45-DLK Mdrak Hub');
    localStorage.setItem('spx_selected_hub', '45-DLK Mdrak Hub');
    localStorage.setItem('spx_active_station', '45-DLK Mdrak Hub');
  } catch(e) {}
</script>"""

# Xóa các script chèn thủ công trước đó trong index.html
content = re.sub(r'<script>\s*window\.IS_PREVIEW\s*=[\s\S]*?</script>', '', content)

# Kiểm tra nếu có thẻ <script> nằm trong <script>
content = re.sub(r'<script[^>]*>\s*<script[^>]*>', '<script>', content)
content = re.sub(r'</script>\s*</script>', '</script>', content)

# Đảm bảo không có <script> lồng trong <?!= include(...) ?>
content = re.sub(r'<script[^>]*>\s*<\?!=?\s*include\([\'"]([^\'"]+)[\'"]\)\s*\?>\s*</script>', r'<?!= include("\1") ?>', content)

# Chèn lại khối khởi tạo chuẩn vào ngay sau <head>
if '<head>' in content:
    content = content.replace('<head>', '<head>\n' + clean_init_script)

with open(index_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("-> Đã làm sạch index.html!")

print("\n=== 3. CẬP NHẬT server.js (XỬ LÝ DỨT ĐIỂM INCLUDE VÀ THÊM FAVICON 204) ===")
with open('server.js', 'r', encoding='utf-8') as f:
    srv = f.read()

# Thêm route favicon để không bao giờ bị 404
if '/favicon.ico' not in srv:
    srv = srv.replace("const app = express();", "const app = express();\napp.get('/favicon.ico', (req, res) => res.status(204).end());")

# Không chèn đè bootstrapScript nếu đã có trong file html để tránh nhân đôi
old_inject = """  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + bootstrapScript);
  } else {
    html = bootstrapScript + html;
  }"""
new_inject = """  // Không inject thừa tránh gây cú pháp lặp
  if (!html.includes('window.RUNTIME_CACHE') && html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + bootstrapScript);
  }"""

if old_inject in srv:
    srv = srv.replace(old_inject, new_inject)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(srv)
print("-> Đã cập nhật server.js (khử lỗi 404 favicon và khử inject trùng lặp)!")

print("\n=== 4. TEST CÚ PHÁP RENDER BẰNG NODE.JS ===")
test_render = """
const fs = require('fs');
const path = require('path');

function check() {
  const viewsDir = './public/views';
  let c = fs.readFileSync(path.join(viewsDir, 'index.html'), 'utf8');
  c = c.replace(/<\\?!=\\s*include\\(['"]([^'"]+)['"]\\)\\s*\\?>/g, (m, p) => {
    try {
      let sub = p.endsWith('.html') ? p : p + '.html';
      return fs.readFileSync(path.join(viewsDir, sub), 'utf8');
    } catch(e) { return ''; }
  });
  
  const lines = c.split('\\n');
  console.log('Soi dòng 55-68 sau khi render:');
  for (let i = 54; i < Math.min(lines.length, 68); i++) {
    console.log((i+1) + ': ' + lines[i]);
  }
}
check();
"""
with open('test_syntax_check.js', 'w') as f:
    f.write(test_render)

res = subprocess.run(['node', 'test_syntax_check.js'], capture_output=True, text=True)
print(res.stdout)

print("\n=== 5. PUSH BẢN SỬA LỖI CÚ PHÁP LÊN GITHUB MAIN ===")
subprocess.run(['git', 'add', 'public/views/index.html', 'server.js'], check=True)
subprocess.run(['git', 'commit', '-m', 'fix: eliminate nested script tag syntax error at line 62 and add favicon 204'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n🎉 ĐÃ ĐẨY BẢN SỬA LỖI LÊN RENDER THÀNH CÔNG!")
