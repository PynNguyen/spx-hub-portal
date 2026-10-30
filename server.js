const express = require('express');
const path = require('path');
const fs = require('fs');
const gas = require('./services/gas_runtime');

const app = express();
const PORT = process.env.PORT || 3000;

// BẢO VỆ TIẾN TRÌNH: Ngăn chặn triệt để mọi lỗi unhandled làm sập server (gây lỗi 502)
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION SAFEGUARD]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION SAFEGUARD]', reason);
});

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

// Render template an toàn có bộ nhớ đệm và chống đệ quy lặp vô tận
const templateCache = new Map();

function renderTemplate(viewName, visited = new Set()) {
  const cleanKey = String(viewName || 'index').trim().toLowerCase();
  if (visited.has(cleanKey)) {
    return '<!-- Circular include avoided -->';
  }
  visited.add(cleanKey);

  const filePath = findViewFile(viewName);
  if (!filePath || !fs.existsSync(filePath)) {
    return `<div style="color:#ee4d2d;padding:20px;font-weight:bold">Module: ${viewName}</div>`;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Đệ quy thay thế include an toàn
  content = content.replace(/<\?!=\s*include\(['"]([^'"]+)['"]\);?\s*\?>/g, (match, p1) => {
    return renderTemplate(p1, new Set(visited));
  });
  content = content.replace(/<\?=\s*include\(['"]([^'"]+)['"]\);?\s*\?>/g, (match, p1) => {
    return renderTemplate(p1, new Set(visited));
  });
  content = content.replace(/<\?\s*include\(['"]([^'"]+)['"]\);?\s*\?>/g, (match, p1) => {
    return renderTemplate(p1, new Set(visited));
  });

  content = content.replace(/<\?!=[^>]*\?>/g, 'null');
  content = content.replace(/<\?=[^>]*\?>/g, '""');
  content = content.replace(/<\?[^>]*\?>/g, '');

  return content;
}

app.get('/login', (req, res) => {
  res.send(renderTemplate('login'));
});

app.get('/', (req, res) => {
  res.send(renderTemplate('index'));
});

// RPC getModuleHtml - phục vụ tức thì mọi module con
app.all('/api/rpc/getModuleHtml', (req, res) => {
  try {
    let moduleName = 'JS_TrangChu';
    if (Array.isArray(req.body) && req.body.length > 0) moduleName = req.body[0];
    else if (req.body && req.body.moduleName) moduleName = req.body.moduleName;
    else if (req.query && req.query.module) moduleName = req.query.module;
    moduleName = String(moduleName || 'JS_TrangChu').trim();
    return res.json(renderTemplate(moduleName));
  } catch (err) {
    return res.json(`<div style="padding:20px;color:red">Lỗi tải module: ${err.message}</div>`);
  }
});

// Các RPC mặc định của SPX để không bao giờ bị 502/500
app.all('/api/rpc/spx_getHeartbeat', (req, res) => {
  return res.json({ status: 'OK', time: Date.now(), hub: '45-DLK Mdrak Hub' });
});

app.all('/api/rpc/spx_getWebAppUrl', (req, res) => {
  return res.json('https://spx-hub-portal.onrender.com');
});

app.all('/api/rpc/pick_getSummaryFm', (req, res) => {
  return res.json({ pickup: 16, inbound: 8, packed: 8, seal: 0, mp: 0, social: 0, reverse: 0, cb: 0, wh: 0 });
});

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
    console.warn(`[Safe RPC Handled] ${fn}:`, err.message);
    // Luôn trả về 200 kèm error để frontend không bao giờ bị 502
    return res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Standalone Portal running on port ${PORT}`);
});
