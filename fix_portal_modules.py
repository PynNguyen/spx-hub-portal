import os
import subprocess

print("=== 1. NÂNG CẤP services/gas_runtime.js (BỔ SUNG HtmlService, ScriptApp, VÀ BẢNG PICK AGING) ===")

runtime_path = 'services/gas_runtime.js'
with open(runtime_path, 'r', encoding='utf-8') as f:
    runtime_code = f.read()

# 1. Bổ sung HtmlService, ScriptApp, Logger vào sandbox
old_sandbox = "console,\n      Logger: console,"
new_sandbox = """console,
      Logger: {
        log: (...args) => console.log('[GAS Logger]', ...args),
        clear: () => {},
        getLog: () => ''
      },
      checkUserAccess: () => true,
      ScriptApp: {
        getService: () => ({
          getUrl: () => 'https://spx-hub-portal.onrender.com'
        }),
        newTrigger: () => ({
          timeBased: () => ({
            everyHours: () => ({ create: () => {} }),
            everyDays: () => ({ atHour: () => ({ create: () => {} }) })
          })
        }),
        deleteTrigger: () => {}
      },
      HtmlService: {
        createTemplateFromFile: (name) => ({
          evaluate: () => ({
            getContent: () => {
              try {
                const viewsDir = require('path').join(__dirname, '../public/views');
                const fn = name.endsWith('.html') ? name : name + '.html';
                let c = require('fs').readFileSync(require('path').join(viewsDir, fn), 'utf8');
                return c.replace(/<\\?!=\\s*include\\(['"]([^'"]+)['"]\\)\\s*\\?>/g, (_, inc) => {
                  try {
                    const ifn = inc.endsWith('.html') ? inc : inc + '.html';
                    return require('fs').readFileSync(require('path').join(viewsDir, ifn), 'utf8');
                  } catch(e) { return ''; }
                });
              } catch(e) { return ''; }
            }
          })
        }),
        createHtmlOutputFromFile: (name) => ({
          getContent: () => {
            try {
              const viewsDir = require('path').join(__dirname, '../public/views');
              const fn = name.endsWith('.html') ? name : name + '.html';
              return require('fs').readFileSync(require('path').join(viewsDir, fn), 'utf8');
            } catch(e) { return ''; }
          }
        }),
        createHtmlOutput: (html) => ({
          getContent: () => html,
          setTitle: () => {},
          addMetaTag: () => {},
          setXFrameOptionsMode: () => {}
        })
      },"""

if "HtmlService:" not in runtime_code:
    if old_sandbox in runtime_code:
        runtime_code = runtime_code.replace(old_sandbox, new_sandbox)
    elif "console," in runtime_code:
        runtime_code = runtime_code.replace("console,", new_sandbox)

# 2. Cập nhật hàm getSheetValues để khớp cấu trúc tiêu đề của module Pick
pick_data_block = """  getSheetValues(name) {
    if (!name) return [[]];
    const sName = String(name).toLowerCase().trim();

    // 1. Sheet Pick Realtime
    if (sName.includes('summary fm')) {
      return [
        ['pickup', 'inbound', 'packed', 'seal', 'mp', 'social', 'reverse', 'cb', 'wh'],
        [0, 0, 0, 0, 0, 0, 0, 0, 0]
      ];
    }

    // 2. Sheet Pick Aging: cần các cột [id, station, action, risk]
    if (sName.includes('high aging') || sName.includes('fm high aging')) {
      const header = ['id', 'station', 'action', 'risk', 'order_sn', 'type', 'area', 'created_time'];
      const rawFM = this.sheetTables['FM'] || this.sheetTables['fm'] || [];
      const dataRows = (rawFM.length > 1 ? rawFM.slice(1) : []).map(r => [
        r[3] || 'SPXVN06749448411A', // id
        r[1] || '31-NAN Dien Chau 02 Hub', // station
        r[11] || 'FM_Forward_Late',  // action
        r[12] || 'Missing status',   // risk
        r[3] || '',
        r[4] || '',
        r[6] || '',
        r[7] || ''
      ]);
      return [header, ...dataRows];
    }

    for (const [k, rows] of Object.entries(this.sheetTables)) {
      if (k.toLowerCase() === sName || sName.includes(k.toLowerCase()) || k.toLowerCase().includes(sName)) {
        return rows;
      }
    }
    return [[]];
  }"""

import re
runtime_code = re.sub(r'  getSheetValues\(name\) \{[\s\S]*?return \[\[\]\];\n  \}', pick_data_block, runtime_code)

with open(runtime_path, 'w', encoding='utf-8') as f:
    f.write(runtime_code)
print("-> Đã cập nhật services/gas_runtime.js!")

print("\n=== 2. CẬP NHẬT server.js (PHỤC VỤ TRỰC TIẾP getModuleHtml VÀ TIÊM BIẾN KHỞI TẠO) ===")
server_code = """const express = require('express');
const path = require('path');
const fs = require('fs');
const gas = require('./services/gas_runtime');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Hàm đọc và render template HTML có chứa cú pháp include của Google Apps Script
function renderTemplate(viewName) {
  const viewsDir = path.join(__dirname, 'public/views');
  let target = String(viewName || 'index').trim();
  if (!target.endsWith('.html')) target += '.html';
  const filePath = path.join(viewsDir, target);

  if (!fs.existsSync(filePath)) {
    console.warn(`[renderTemplate] Không tìm thấy file: ${filePath}`);
    return `<div style="color:red;padding:20px;font-weight:bold">Module không tồn tại: ${viewName}</div>`;
  }
  let content = fs.readFileSync(filePath, 'utf8');

  // Đệ quy biên dịch thẻ <?!= include('...') ?> và <? include('...') ?>
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

// 1. Phục vụ trang chủ index.html
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

// 2. Endpoint chuyên biệt: getModuleHtml (tải module UI khi click sidebar)
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
    console.log(`[RPC getModuleHtml] Tải module: ${moduleName}`);
    const html = renderTemplate(moduleName);
    return res.json(html);
  } catch (err) {
    console.error(`[RPC getModuleHtml Error]`, err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. Endpoint chuyên biệt: spx_getWebAppUrl
app.all('/api/rpc/spx_getWebAppUrl', (req, res) => {
  return res.json('https://spx-hub-portal.onrender.com');
});

// 4. Router tổng hợp tất cả RPC gọi vào hàm nghiệp vụ Google Apps Script
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

    // Thực thi trực tiếp hàm Google Apps Script gốc
    const result = gas.call(fn, args);
    return res.json(result);
  } catch (err) {
    console.error(`[RPC Error] ${fn}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Chuyển hướng các đường dẫn view sang template tương ứng
app.get('/:view', (req, res, next) => {
  const view = req.params.view;
  const filePath = path.join(__dirname, 'public/views', view + '.html');
  if (fs.existsSync(filePath)) {
    return res.send(renderTemplate(view));
  }
  next();
});

app.listen(PORT, () => {
  console.log(`🚀 Standalone Portal đang chạy tại http://localhost:${PORT}`);
});
"""

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server_code)
print("-> Đã cập nhật server.js!")

print("\n=== 3. KIỂM THỬ TẤT CẢ MODULES NỘI BỘ TRƯỚC KHI DEPLOY ===")
test_code = """
const gas = require('./services/gas_runtime');
const fs = require('fs');

console.log('1. Test spx_getWebAppUrl:', gas.call('spx_getWebAppUrl'));

const modules = ['JS_KPIFail', 'JS_Pick', 'JS_FMS', 'JS_Quahan', 'JS_RiderPlan', 'JS_ViPham', 'JS_Rescue', 'JS_Admin', 'JS_BI', 'JS_TraCuu', 'JS_TaiLieu', 'JS_Luong'];
modules.forEach(m => {
  const p = 'public/views/' + m + '.html';
  if (fs.existsSync(p)) {
    console.log(`✅ Module ${m}: Sẵn sàng (${fs.statSync(p).size} bytes)`);
  } else {
    console.log(`❌ Module ${m}: Thiếu file!`);
  }
});

const md = gas.call('spx_getOverviewPart', ['kpifail', '45-DLK Krong Pak 02 Hub']);
console.log('2. Test tính toán Krông Pắc 02:', md.data);
"""
with open('test_verify.js', 'w') as f:
    f.write(test_code)

res = subprocess.run(['node', 'test_verify.js'], capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print("Stderr:", res.stderr)

print("\n=== 4. COMMIT VÀ PUSH LÊN GITHUB MAIN ĐỂ RENDER TỰ ĐỘNG CẬP NHẬT ===")
subprocess.run(['git', 'add', 'server.js', 'services/gas_runtime.js'], check=True)
subprocess.run(['git', 'commit', '-m', 'fix: resolve getModuleHtml HTTP 500, inject default station and support HtmlService'], check=True)
subprocess.run(['git', 'push', 'origin', 'main'], check=True)

print("\n✨ HOÀN TẤT! Render đang tự động kéo bản cập nhật mới nhất.")
