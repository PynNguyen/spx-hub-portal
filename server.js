const express = require('express');
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
  content = content.replace(/<\?!=\s*include\(['"]([^'"]+)['"]\)\s*\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\?=\s*include\(['"]([^'"]+)['"]\)\s*\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\?\s*include\(['"]([^'"]+)['"]\)\s*\?>/g, (match, p1) => {
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
