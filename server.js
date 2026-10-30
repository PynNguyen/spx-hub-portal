const express = require('express');
const path = require('path');
const fs = require('fs');
const gas = require('./services/gas_runtime');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 1. Phục vụ tài nguyên tĩnh
app.use(express.static(path.join(__dirname, 'public')));

// 2. Hàm render template HTML (hỗ trợ cú pháp include của Google Apps Script)
function renderTemplate(viewName) {
  const viewsDir = path.join(__dirname, 'public/views');
  let target = String(viewName || 'index').trim();
  if (!target.endsWith('.html')) target += '.html';
  const filePath = path.join(viewsDir, target);

  if (!fs.existsSync(filePath)) {
    return `<div style="color:red;padding:20px;font-weight:bold;">Không tìm thấy view: ${viewName}</div>`;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Xử lý đệ quy <?!= include('Tên_File'); ?>
  const incRegex = /<\?!=\s*include\s*\(\s*['"]([^'"]+)['"]\s*\);?\s*\?>/g;
  content = content.replace(incRegex, (m, inc) => {
    return renderTemplate(inc);
  });

  return content;
}

// 3. Trang chủ Standalone Portal
app.get(['/', '/index.html'], (req, res) => {
  let html = renderTemplate('index');
  // Đảm bảo có cầu nối spx_rpc_bridge
  const runtimeInit = `
    <script>
      var RUNTIME_CACHE = {};
      var SPX_ACCESS = { role: 'admin', level: 'L4', levelCode: 'admin', levelNum: 5, email: 'xuan.nguyenthanh01@spxexpress.com', hubs: ['ALL'] };
      var SPX_CURRENT_USER = { email: 'xuan.nguyenthanh01@spxexpress.com', role: 'admin' };
    </script>
    <script src="/js/spx_rpc_bridge.js"></script>
  `;
  html = html.replace('</head>', runtimeInit + '</head>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 4. Tuyến đường RPC Dispatcher — Gọi trực tiếp 19,469 dòng code .gs gốc
app.post('/api/rpc/:func', async (req, res) => {
  const funcName = req.params.func;
  const payload = req.body.params || [];

  if (funcName === 'spx_getWebAppUrl') {
    return res.send('https://spx-hub-portal.onrender.com');
  }

  if (funcName === 'getModuleHtml') {
    const mod = payload[0];
    const modHtml = renderTemplate(mod);
    return res.send(modHtml);
  }
  try {
    const result = gas.call(funcName, payload);
    if (result !== null && result !== undefined) {
      if (typeof result === 'string') {
        try {
          return res.json(JSON.parse(result));
        } catch (e) {
          return res.send(result);
        }
      }
      return res.json(result);
    }
    return res.json({ success: true, data: [] });
  } catch (err) {
    console.error(`❌ [RPC Error ${funcName}]:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 [SPX Standalone Portal] Đang chạy độc lập trên port ${PORT} với 100% code gốc!`);
});
