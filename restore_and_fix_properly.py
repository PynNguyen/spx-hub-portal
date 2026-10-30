import os
import zipfile
import re
import subprocess

print("=== 1. KHÔI PHỤC 100% FILE index.html NGUYÊN BẢN TỪ BACKUP GỐC ===")

zip_path = 'BACKUP_DU_AN_TONG_HOP_20261029.zip'
index_dest = 'public/views/index.html'

with zipfile.ZipFile(zip_path, 'r') as z:
    for info in z.infolist():
        clean_name = info.filename.replace('\\', '/')
        if '01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX/index.html' in clean_name:
            with z.open(info) as src, open(index_dest, 'wb') as dst:
                dst.write(src.read())
            print(f"✅ Đã khôi phục file index.html gốc nguyên bản ({info.file_size:,} bytes)!")
            break

print("\n=== 2. THỰC HIỆN ĐÚNG 3 ĐIỀU CHỈNH KỸ THUẬT DUY NHẤT CHO NODE.JS ===")
with open(index_dest, 'r', encoding='utf-8') as f:
    content = f.read()

# A. Nhúng cầu nối google.script.run đồng bộ vào ngay sau <head>
bridge = """<script>
window.google = window.google || {};
window.google.script = window.google.script || {};
window.google.script.run = (function() {
  function makeProxy(sh, fh, uo) {
    return new Proxy({}, {
      get: function(target, prop) {
        if (prop === 'withSuccessHandler') return function(s) { return makeProxy(s, fh, uo); };
        if (prop === 'withFailureHandler') return function(f) { return makeProxy(sh, f, uo); };
        if (prop === 'withUserObject') return function(u) { return makeProxy(sh, fh, u); };
        return function(...args) {
          fetch('/api/rpc/' + encodeURIComponent(prop), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args)
          })
          .then(async function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function(data) {
            if (typeof sh === 'function') sh(data, uo);
          })
          .catch(function(err) {
            if (typeof fh === 'function') fh(err, uo);
          });
        };
      }
    });
  }
  return makeProxy();
})();
</script>"""

content = content.replace('<head>', '<head>\n' + bridge)

# B. Điền dữ liệu thật vào dòng 35-36 để không bị SyntaxError '<'
content = re.sub(
    r'window\.__SERVER_BOOTSTRAP__\s*=\s*<\?![\s\S]*?\?>;',
    'window.__SERVER_BOOTSTRAP__ = {"userEmail":"xuan.nguyenthanh01@spxexpress.com","hub":"45-DLK Mdrak Hub","moduleAccess":{"role":"admin","level":"L4","hubs":["ALL"],"allowedModules":["ALL"]},"hubOrgDir":{}};',
    content
)

content = re.sub(
    r'window\.__SERVER_MOD_STATUS__\s*=\s*<\?![\s\S]*?\?>;',
    'window.__SERVER_MOD_STATUS__ = {"kpiFail":"OK","pick":"OK","fms":"OK","aging":"OK"};',
    content
)

content = re.sub(r'<\?!=\s*\(function\(\)\{[\s\S]*?\}\)\(\)\s*\?>', '45-DLK Mdrak Hub', content)
content = re.sub(r'<\?=\s*\(typeof BOOTSTRAP_DATA[\s\S]*?ADMIN[\s\S]*?\?>', 'ADMIN', content)
content = re.sub(r'<\?=\s*\(typeof BOOTSTRAP_DATA[\s\S]*?hidden[\s\S]*?\?>', '', content)
content = re.sub(r'<\?=\s*typeof Session[\s\S]*?ADMIN XUÂN[\s\S]*?\?>', 'ADMIN XUÂN', content)

# C. Kích hoạt đúng hàm điều hướng gốc spxJumpToNav('overview') khi mở trang
auto_start = """
<script>
  window.addEventListener('load', function() {
    setTimeout(function() {
      if (typeof spxJumpToNav === 'function') {
        spxJumpToNav('overview');
      }
    }, 200);
  });
</script>
"""
content = content.replace('</body>', auto_start + '\n</body>')

with open(index_dest, 'w', encoding='utf-8') as f:
    f.write(content)
print("✅ Đã hoàn tất 3 điểm kỹ thuật duy nhất trên index.html gốc!")

print("\n=== 3. CẬP NHẬT server.js CHUẨN MỰC ===")
server_js = """const express = require('express');
const path = require('path');
const fs = require('fs');
const gas = require('./services/gas_runtime');

const app = express();
const PORT = process.env.PORT || 3000;

process.on('uncaughtException', (err) => console.error('[UNCAUGHT]', err.message));
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED]', reason));

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const MODULE_ALIASES = {
  'js_riderplan': 'JS_Rider_plan.html',
  'js_rescue': 'JS_DonCauCuu.html',
  'js_admin': 'JS_AdminZone.html',
  'js_bi': 'Analytics_Block.html',
  'js_tracuu': 'JS_Tracuu.html',
  'js_tailieu': 'JS_Tailieu.html'
};

function findViewFile(viewName) {
  const viewsDir = path.join(__dirname, 'public/views');
  let clean = String(viewName || 'index').trim();
  if (clean.toLowerCase().endsWith('.html')) clean = clean.slice(0, -5);

  const lower = clean.toLowerCase();
  let targetFile = MODULE_ALIASES[lower] || (clean + '.html');
  let fullPath = path.join(viewsDir, targetFile);
  if (fs.existsSync(fullPath)) return fullPath;

  try {
    const files = fs.readdirSync(viewsDir);
    const match = files.find(f => f.toLowerCase() === targetFile.toLowerCase());
    if (match) return path.join(viewsDir, match);
  } catch (e) {}
  return null;
}

function renderTemplate(viewName) {
  const filePath = findViewFile(viewName);
  if (!filePath || !fs.existsSync(filePath)) {
    return `<div style="color:red;padding:20px;font-weight:bold">Module: ${viewName}</div>`;
  }
  let content = fs.readFileSync(filePath, 'utf8');

  // Đệ quy include
  content = content.replace(/<\\?!=\\s*include\\(['"]([^'"]+)['"]\\);?\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\\?=\\s*include\\(['"]([^'"]+)['"]\\);?\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\\?\\s*include\\(['"]([^'"]+)['"]\\);?\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });

  content = content.replace(/<\\?!=[^>]*\\?>/g, 'null');
  content = content.replace(/<\\?=[^>]*\\?>/g, '""');
  content = content.replace(/<\\?[^>]*\\?>/g, '');

  return content;
}

app.get('/login', (req, res) => res.send(renderTemplate('login')));
app.get('/', (req, res) => res.send(renderTemplate('index')));

app.all('/api/rpc/getModuleHtml', (req, res) => {
  try {
    let moduleName = 'JS_TrangChu';
    if (Array.isArray(req.body) && req.body.length > 0) moduleName = req.body[0];
    else if (req.body && req.body.moduleName) moduleName = req.body.moduleName;
    else if (req.query && req.query.module) moduleName = req.query.module;
    moduleName = String(moduleName || 'JS_TrangChu').trim();
    return res.json(renderTemplate(moduleName));
  } catch (err) {
    return res.json('');
  }
});

app.all('/api/rpc/spx_getHeartbeat', (req, res) => res.json({ status: 'OK' }));
app.all('/api/rpc/spx_getWebAppUrl', (req, res) => res.json('https://spx-hub-portal.onrender.com'));

app.all('/api/rpc/:fn', (req, res) => {
  const fn = req.params.fn;
  let args = Array.isArray(req.body) ? req.body : (req.body && typeof req.body === 'object' ? Object.values(req.body) : []);
  try {
    if (fn === 'getModuleHtml') return res.json(renderTemplate(args[0]));
    if (fn === 'spx_getHeartbeat') return res.json({ status: 'OK' });
    if (fn === 'spx_getWebAppUrl') return res.json('https://spx-hub-portal.onrender.com');

    const result = gas.call(fn, args);
    return res.json(result);
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Standalone Portal running on port ${PORT}`));
"""

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server_js)
print("✅ Đã cập nhật xong server.js chuẩn!")

print("\n=== 4. PUSH LÊN GITHUB MAIN ĐỂ RENDER TRIỂN KHAI ===")
subprocess.run(['git', 'add', 'public/views/index.html', 'server.js'], check=True)
subprocess.run(['git', 'commit', '-m', 'refactor: cleanly restore authentic original index.html with native spxJumpToNav and exact bootstrap'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n🎉 ĐÃ KHÔI PHỤC VÀ TRIỂN KHAI BẢN GỐC NGUYÊN BẢN THÀNH CÔNG!")
