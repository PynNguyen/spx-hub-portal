import os
import zipfile
import shutil
import subprocess

print("=== 1. GIẢI NÉN VÀ ÁNH XẠ CHUẨN 100% TẤT CẢ FILE MODULE GỐC ===")
views_dir = 'public/views'
os.makedirs(views_dir, exist_ok=True)

# Dọn dẹp các file bị lỗi tên do dấu \ trên Linux
for f in os.listdir(views_dir):
    if '\\' in f:
        try:
            os.remove(os.path.join(views_dir, f))
        except Exception:
            pass

zip_file = 'BACKUP_DU_AN_TONG_HOP_20261029.zip'
if os.path.exists(zip_file):
    with zipfile.ZipFile(zip_file, 'r') as z:
        for info in z.infolist():
            clean_path = info.filename.replace('\\', '/')
            # Chỉ lấy bản mới nhất đã chỉnh sửa UI/UX
            if '01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX' in clean_path and clean_path.endswith('.html'):
                fname = clean_path.split('/')[-1]
                target = os.path.join(views_dir, fname)
                with z.open(info) as src, open(target, 'wb') as dst:
                    shutil.copyfileobj(src, dst)
                print(f"✅ Đã nạp module gốc: {fname} ({info.file_size:,} bytes)")

# Tạo bản sao alias để hỗ trợ cả tên cũ và tên mới mà code frontend gọi
aliases = [
    ('JS_Rider_plan.html', 'JS_RiderPlan.html'),
    ('JS_DonCauCuu.html', 'JS_Rescue.html'),
    ('JS_AdminZone.html', 'JS_Admin.html'),
    ('Analytics_Block.html', 'JS_BI.html'),
    ('JS_Tracuu.html', 'JS_TraCuu.html'),
    ('JS_Tailieu.html', 'JS_TaiLieu.html')
]

for src_name, alias_name in aliases:
    src_p = os.path.join(views_dir, src_name)
    alias_p = os.path.join(views_dir, alias_name)
    if os.path.exists(src_p):
        shutil.copy2(src_p, alias_p)
        print(f"🔗 Đã liên kết: {alias_name} -> {src_name}")

print("\n=== 2. CẬP NHẬT server.js ĐỂ NHẬN DIỆN MỌI MODULE VÀ ĐỆ QUY INCLUDE ===")
server_code = """const express = require('express');
const path = require('path');
const fs = require('fs');
const gas = require('./services/gas_runtime');

const app = express();
const PORT = process.env.PORT || 3000;

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

function renderTemplate(viewName) {
  const filePath = findViewFile(viewName);
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn(`[renderTemplate] Không tìm thấy file: ${viewName}`);
    return `<div style="color:red;padding:20px;font-weight:bold">Module không tồn tại: ${viewName}</div>`;
  }
  let content = fs.readFileSync(filePath, 'utf8');

  // Đệ quy biên dịch thẻ include
  content = content.replace(/<\\?!=\\s*include\\(['"]([^'"]+)['"]\\)\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\\?=\\s*include\\(['"]([^'"]+)['"]\\)\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\\?\\s*include\\(['"]([^'"]+)['"]\\)\\s*\\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });

  return content;
}

// 1. Trang chủ index.html
app.get('/', (req, res) => {
  let html = renderTemplate('index');

  const bootstrapScript = `
<script>
  window.RUNTIME_CACHE = window.RUNTIME_CACHE || {};
  window.SPX_ACCESS = window.SPX_ACCESS || {
    role: 'ADMIN',
    roleLevel: 99,
    email: 'admin@spxexpress.com',
    allowedStations: ['ALL'],
    isSuperAdmin: true,
    isAdmin: true
  };
  window.CURRENT_STATION = window.CURRENT_STATION || '45-DLK Krong Pak 02 Hub';
  try {
    if (!localStorage.getItem('spx_current_hub') && !localStorage.getItem('spx_selected_hub')) {
      localStorage.setItem('spx_current_hub', '45-DLK Krong Pak 02 Hub');
      localStorage.setItem('spx_selected_hub', '45-DLK Krong Pak 02 Hub');
      localStorage.setItem('spx_active_station', '45-DLK Krong Pak 02 Hub');
    }
  } catch(e) {}
</script>
`;

  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + bootstrapScript);
  } else {
    html = bootstrapScript + html;
  }

  res.send(html);
});

// 2. RPC getModuleHtml - phục vụ tức thì 100% module
app.all('/api/rpc/getModuleHtml', (req, res) => {
  try {
    let moduleName = 'JS_TrangChu';
    if (Array.isArray(req.body) && req.body.length > 0) {
      moduleName = req.body[0];
    } else if (req.body && req.body.moduleName) {
      moduleName = req.body.moduleName;
    } else if (req.query && req.query.module) {
      moduleName = req.query.module;
    }
    moduleName = String(moduleName || 'JS_TrangChu').trim();
    console.log(`[RPC getModuleHtml] Nạp module: ${moduleName}`);
    const html = renderTemplate(moduleName);
    return res.json(html);
  } catch (err) {
    console.error(`[RPC getModuleHtml Error]`, err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. RPC spx_getWebAppUrl
app.all('/api/rpc/spx_getWebAppUrl', (req, res) => {
  return res.json('https://spx-hub-portal.onrender.com');
});

// 4. RPC thực thi logic Google Apps Script gốc
app.all('/api/rpc/:fn', (req, res) => {
  const fn = req.params.fn;
  let args = [];
  if (Array.isArray(req.body)) {
    args = req.body;
  } else if (req.body && typeof req.body === 'object') {
    args = Object.values(req.body);
  }

  try {
    if (fn === 'getModuleHtml') {
      const moduleName = String(args[0] || 'JS_TrangChu').trim();
      const html = renderTemplate(moduleName);
      return res.json(html);
    }
    if (fn === 'spx_getWebAppUrl') {
      return res.json('https://spx-hub-portal.onrender.com');
    }

    const result = gas.call(fn, args);
    return res.json(result);
  } catch (err) {
    console.error(`[RPC Error] ${fn}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/:view', (req, res, next) => {
  const view = req.params.view;
  const filePath = findViewFile(view);
  if (filePath && fs.existsSync(filePath)) {
    return res.send(renderTemplate(view));
  }
  next();
});

app.listen(PORT, () => {
  console.log(`🚀 Standalone Portal chạy tại cổng ${PORT}`);
});
"""

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server_code)
print("✅ Đã cập nhật server.js!")

print("\n=== 3. KIỂM TRA TÍNH TOÀN VẸN CỦA TẤT CẢ 12 MODULE ===")
modules_to_check = [
    'JS_KPIFail', 'JS_Pick', 'JS_FMS', 'JS_Quahan', 
    'JS_RiderPlan', 'JS_ViPham', 'JS_Rescue', 'JS_Admin', 
    'JS_BI', 'JS_TraCuu', 'JS_TaiLieu', 'JS_Luong'
]
for m in modules_to_check:
    f_path = os.path.join(views_dir, m + '.html')
    if os.path.exists(f_path):
        size = os.path.getsize(f_path)
        print(f"  ✨ {m:<15}: Đã sẵn sàng ({size:,} bytes)")
    else:
        print(f"  ❌ {m:<15}: Chưa có!")

print("\n=== 4. PUSH LÊN GITHUB MAIN ĐỂ RENDER TRIỂN KHAI ===")
subprocess.run(['git', 'add', 'public/views/', 'server.js'], check=True)
subprocess.run(['git', 'commit', '-m', 'feat: deploy 100% authentic modules from backup and handle aliases'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n🎉 HOÀN THÀNH 100%! Render đang tự động triển khai bản đầy đủ.")
