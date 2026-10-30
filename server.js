const express = require('express');
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
