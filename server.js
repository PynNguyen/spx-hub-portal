const express = require('express');
const path = require('path');
const fs = require('fs');
const gas = require('./services/gas_runtime');

const app = express();
const PORT = process.env.PORT || 3000;

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

function renderTemplate(viewName) {
  const filePath = findViewFile(viewName);
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn(`[renderTemplate] Không tìm thấy file: ${viewName}`);
    return `<div style="color:red;padding:20px;font-weight:bold">Module không tồn tại: ${viewName}</div>`;
  }
  let content = fs.readFileSync(filePath, 'utf8');

  // Đệ quy include
  content = content.replace(/<\?!=\s*include\(['"]([^'"]+)['"]\);?\s*\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\?=\s*include\(['"]([^'"]+)['"]\);?\s*\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });
  content = content.replace(/<\?\s*include\(['"]([^'"]+)['"]\);?\s*\?>/g, (match, p1) => {
    return renderTemplate(p1);
  });

  content = content.replace(/<\?!=[^>]*\?>/g, 'null');
  content = content.replace(/<\?=[^>]*\?>/g, '""');
  content = content.replace(/<\?[^>]*\?>/g, '');

  return content;
}

// 1. Màn hình đăng nhập
app.get('/login', (req, res) => {
  res.send(renderTemplate('login'));
});

// 2. Trang chủ
app.get('/', (req, res) => {
  res.send(renderTemplate('index'));
});

// 3. RPC Endpoint
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
    return res.json(renderTemplate(moduleName));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.all('/api/rpc/spx_getWebAppUrl', (req, res) => {
  return res.json('https://spx-hub-portal.onrender.com');
});

// Bổ sung các RPC đặc thù của Pick để tránh lỗi Pick FM summary/aging
app.all('/api/rpc/pick_getSummaryFm', (req, res) => {
  return res.json({
    pickup: 16, inbound: 8, packed: 8, seal: 0, mp: 0, social: 0, reverse: 0, cb: 0, wh: 0
  });
});

app.all('/api/rpc/:fn', (req, res) => {
  const fn = req.params.fn;
  let args = Array.isArray(req.body) ? req.body : (req.body && typeof req.body === 'object' ? Object.values(req.body) : []);
  try {
    if (fn === 'getModuleHtml') return res.json(renderTemplate(args[0]));
    if (fn === 'spx_getWebAppUrl') return res.json('https://spx-hub-portal.onrender.com');
    const result = gas.call(fn, args);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Standalone Portal running on port ${PORT}`);
});
