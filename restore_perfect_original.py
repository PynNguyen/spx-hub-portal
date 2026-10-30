import os
import zipfile
import re
import subprocess

print("=== 1. TRÍCH XUẤT 100% NGUYÊN BẢN index.html TỪ FILE ZIP GỐC ===")
views_dir = 'public/views'
os.makedirs(views_dir, exist_ok=True)

zip_file = 'BACKUP_DU_AN_TONG_HOP_20261029.zip'
raw_index_bytes = None

with zipfile.ZipFile(zip_file, 'r') as z:
    for info in z.infolist():
        clean_name = info.filename.replace('\\', '/')
        # Trích xuất tất cả các file HTML gốc của bản mới nhất
        if '01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX' in clean_name and clean_name.endswith('.html'):
            fname = clean_name.split('/')[-1]
            dest = os.path.join(views_dir, fname)
            content_bytes = z.read(info)
            with open(dest, 'wb') as f:
                f.write(content_bytes)
            if fname == 'index.html':
                raw_index_bytes = content_bytes
            print(f"  📦 Đã nạp file gốc: {fname} ({len(content_bytes):,} bytes)")

# Tạo alias cho các module con
aliases = [
    ('JS_Rider_plan.html', 'JS_RiderPlan.html'),
    ('JS_DonCauCuu.html', 'JS_Rescue.html'),
    ('JS_AdminZone.html', 'JS_Admin.html'),
    ('Analytics_Block.html', 'JS_BI.html'),
    ('JS_Tracuu.html', 'JS_TraCuu.html'),
    ('JS_Tailieu.html', 'JS_TaiLieu.html')
]
for src_n, alias_n in aliases:
    s_p = os.path.join(views_dir, src_n)
    a_p = os.path.join(views_dir, alias_n)
    if os.path.exists(s_p):
        with open(s_p, 'rb') as sf, open(a_p, 'wb') as af:
            af.write(sf.read())

print("\n=== 2. ÁP DỤNG ĐÚNG 4 ĐIỀU CHỈNH KỸ THUẬT DUY NHẤT (GIỮ 100% GIAO DIỆN GỐC) ===")
content = raw_index_bytes.decode('utf-8')

# A. Thêm CSS bắt buộc ẩn .hidden để tab này không đè lên tab khác
css_rule = """<style>
  .hidden { display: none !important; }
  [id^="view-"].hidden { display: none !important; }
</style>"""

# B. Khai báo RUNTIME_CACHE và cầu nối google.script.run đồng bộ
bridge = """<script>
  window.RUNTIME_CACHE = window.RUNTIME_CACHE || {};
  var RUNTIME_CACHE = window.RUNTIME_CACHE;
  window.SPX_ACCESS = window.SPX_ACCESS || {
    role: 'admin', level: 'L4', levelCode: 'admin', levelNum: 5,
    email: 'xuan.nguyenthanh01@spxexpress.com', hubs: ['ALL'], allowedModules: ['ALL']
  };
  var SPX_ACCESS = window.SPX_ACCESS;
  var SPX_CURRENT_USER = { email: 'xuan.nguyenthanh01@spxexpress.com', role: 'admin' };
  window.CURRENT_STATION = '45-DLK Mdrak Hub';
  window.IS_PREVIEW = false;
  window.IS_DEMO = false;
  window.IS_GAS = true;

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
              // Tự động phân giải nếu backend trả về JSON string
              if (typeof data === 'string' && (data.startsWith('{') || data.startsWith('['))) {
                try { data = JSON.parse(data); } catch(e) {}
              }
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

content = content.replace('<head>', '<head>\n' + css_rule + '\n' + bridge)

# C. Điền dữ liệu thật vào dòng 35-36 để không bị SyntaxError '<'
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

# Gỡ bỏ thông báo demo ngoài Apps Script
content = content.replace('Đang mở ngoài Apps Script thật (preview/demo) — không thể gọi dữ liệu thật ở đây. Deploy thật để xem đầy đủ.', '')

index_dest = os.path.join(views_dir, 'index.html')
with open(index_dest, 'w', encoding='utf-8') as f:
    f.write(content)
print("✅ Đã cập nhật public/views/index.html gốc nguyên vẹn 100%!")

print("\n=== 3. CẬP NHẬT server.js (XỬ LÝ TRIỆT ĐỂ DOUBLE-ENCODING JSON) ===")
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
    const matchRaw = files.find(f => f.toLowerCase() === (clean + '.html').toLowerCase());
    if (matchRaw) return path.join(viewsDir, matchRaw);
  } catch (e) {}
  return null;
}

function renderTemplate(viewName, visited = new Set()) {
  const cleanKey = String(viewName || 'index').trim().toLowerCase();
  if (visited.has(cleanKey)) return '<!-- circular include -->';
  visited.add(cleanKey);

  const filePath = findViewFile(viewName);
  if (!filePath || !fs.existsSync(filePath)) {
    return `<div style="color:red;padding:20px;font-weight:bold">Module: ${viewName}</div>`;
  }
  let content = fs.readFileSync(filePath, 'utf8');

  // Đệ quy include
  content = content.replace(/<\\?!=\\s*include\\(['"]([^'"]+)['"]\\);?\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1, new Set(visited));
  });
  content = content.replace(/<\\?=\\s*include\\(['"]([^'"]+)['"]\\);?\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1, new Set(visited));
  });
  content = content.replace(/<\\?\\s*include\\(['"]([^'"]+)['"]\\);?\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1, new Set(visited));
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

// Gọi trực tiếp vào động cơ .gs gốc
app.all('/api/rpc/:fn', (req, res) => {
  const fn = req.params.fn;
  let args = Array.isArray(req.body) ? req.body : (req.body && typeof req.body === 'object' ? Object.values(req.body) : []);
  try {
    if (fn === 'getModuleHtml') return res.json(renderTemplate(args[0]));
    if (fn === 'spx_getHeartbeat') return res.json({ status: 'OK' });
    if (fn === 'spx_getWebAppUrl') return res.json('https://spx-hub-portal.onrender.com');

    let result = gas.call(fn, args);

    // GIẢI PHÁP CHỐNG DOUBLE-ENCODING: Nếu hàm gốc trả về chuỗi JSON string, parse ra object để gửi đúng JSON
    if (typeof result === 'string' && (result.startsWith('{') || result.startsWith('['))) {
      try {
        result = JSON.parse(result);
      } catch (e) {}
    }

    return res.json(result);
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Standalone Portal đang chạy tại http://localhost:${PORT}`));
"""

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server_js)
print("✅ server.js: Đã xử lý triệt để giải mã JSON!")

print("\n=== 4. COMMIT VÀ PUSH TOÀN BỘ LÊN GITHUB MAIN ĐỂ RENDER DEPLOY ===")
# Xóa file tạm trong public nếu còn sót
if os.path.exists('public/index.html'):
    os.remove('public/index.html')
    subprocess.run(['git', 'rm', '-f', 'public/index.html'], capture_output=True)

subprocess.run(['git', 'add', '-A'], check=True)
subprocess.run(['git', 'commit', '-m', 'feat: restore 100% original index.html topbar and fix double JSON encoding for all 5 overview parts'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n🎉 HOÀN TẤT 100%! Render đang triển khai bản gốc hoàn chỉnh.")
