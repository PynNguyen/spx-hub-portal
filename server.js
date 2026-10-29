const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const db = require('./services/database');
const triggerManager = require('./services/trigger_manager');
const rpcDispatcher = require('./services/rpc_dispatcher');

const app = express();
const PORT = process.env.PORT || 8080;
const VIEWS_DIR = path.join(__dirname, 'public', 'views');

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/_healthz', (req, res) => {
  res.status(200).send('OK');
});

const DEFAULT_STATIONS = [
  'Krông Pắc 02', 'Buôn Ma Thuột', 'Ea Kar', 'Cư Kuin', 'Lắk',
  'Ea H\'leo', 'Krông Bông', 'Krông Năng', 'Krông Búk', 'Buôn Đôn',
  'Cư M\'gar', 'M\'Đrắk'
];

const BOOTSTRAP_DATA = {
  email: 'xuan.nguyenthanh01@spxexpress.com',
  name: 'Admin Xuân',
  moduleAccess: {
    role: 'admin',
    level: 1,
    email: 'xuan.nguyenthanh01@spxexpress.com',
    hubs: ['ALL', ...DEFAULT_STATIONS],
    defaultHub: 'Krông Pắc 02',
    isRootAdmin: true
  },
  analyticsPerm: {
    allowed: true,
    stations: ['ALL', ...DEFAULT_STATIONS]
  },
  luongAccess: 'granted',
  hubOrgDir: {
    byHub: {},
    supNames: ['Sup Tây Nguyên', 'Sup Đắk Lắk'],
    aomNames: ['AOM Tây Nguyên']
  }
};

const MOD_STATUS_DATA = {
  tondong: { status: 'normal' },
  pick: { status: 'normal' },
  quahan: { status: 'normal' },
  doncaucuu: { status: 'normal' },
  kpifail: { status: 'normal' },
  vipham: { status: 'normal' },
  rider_plan: { status: 'normal' },
  luong: { status: 'normal' },
  tracuu: { status: 'normal' },
  tailieu: { status: 'normal' },
  adminzone: { status: 'normal' },
  analytics: { status: 'normal' }
};

function renderTemplate(htmlContent, depth = 0) {
  if (depth > 5) return htmlContent;
  const includeRegex = /<\?!(?:=)?\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g;
  return htmlContent.replace(includeRegex, (match, fileName) => {
    let target = fileName.trim();
    if (!target.endsWith('.html')) target += '.html';
    const filePath = path.join(VIEWS_DIR, target);
    if (fs.existsSync(filePath)) {
      const subContent = fs.readFileSync(filePath, 'utf8');
      return renderTemplate(subContent, depth + 1);
    }
    return `<!-- Missing include: ${fileName} -->`;
  });
}

function processGasScriptlets(html) {
  html = html.replace(/<\?!\s*\(typeof BOOTSTRAP_JSON[\s\S]*?\?>/g, JSON.stringify(JSON.stringify(BOOTSTRAP_DATA)));
  html = html.replace(/<\?!\s*\(typeof MOD_STATUS_JSON[\s\S]*?\?>/g, JSON.stringify(JSON.stringify(MOD_STATUS_DATA)));
  html = html.replace(/<\?!=\s*\(function\(\)\{[\s\S]*?return hub \|\| 'Chưa chọn Hub';[\s\S]*?\}\)\(\)\s*\?>/g, 'Krông Pắc 02');
  html = html.replace(/<\?=\s*\(typeof BOOTSTRAP_DATA[\s\S]*?role === 'admin'\)\s*\?\s*''\s*:\s*'hidden'\s*\?>/g, '');
  html = html.replace(/<\?=\s*typeof Session !== 'undefined'[\s\S]*?: 'ADMIN XUÂN'\s*\?>/g, 'ADMIN XUÂN');
  html = html.replace(/<\?=\s*\(typeof BOOTSTRAP_DATA[\s\S]*?role === 'admin' \? 'ADMIN'[\s\S]*?: 'Đang tải\.\.\.'\s*\?>/g, 'ADMIN');
  html = html.replace(/<\?[!=]?[\s\S]*?\?>/g, '');
  return html;
}

app.get('/', (req, res) => {
  try {
    const indexPath = path.join(VIEWS_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) return res.status(404).send('Không tìm thấy index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    html = renderTemplate(html);
    html = processGasScriptlets(html);
    const bridgeScript = `\n    <!-- SPX Hub RPC Bridge -->\n    <script src="/js/spx_rpc_bridge.js"></script>\n    `;
    if (html.includes('<head>')) html = html.replace('<head>', '<head>' + bridgeScript);
    else html = bridgeScript + html;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send('Lỗi máy chủ: ' + err.message);
  }
});

app.post('/api/rpc/:functionName', async (req, res) => {
  const functionName = req.params.functionName;
  const args = req.body.args || [];
  const userEmail = req.headers['x-spx-user-email'] || req.body.user || 'xuan.nguyenthanh01@spxexpress.com';
  try {
    const result = await rpcDispatcher.dispatch(functionName, args, userEmail);
    res.json({ success: true, result: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/triggers/:triggerName', async (req, res) => {
  const result = await triggerManager.runTriggerManually(req.params.triggerName);
  res.json(result);
});

app.get('/api/workspace/status', (req, res) => {
  const stations = Object.keys(db.data.stations || {});
  let totalOrders = 0;
  stations.forEach(s => { totalOrders += (db.data.stations[s].orders || []).length; });
  res.json({
    status: 'ONLINE',
    platform: 'RENDER_CONTAINER',
    version: '1.0.0',
    hub: db.data.meta ? db.data.meta.hubName : 'Krông Pắc 02',
    stationsCount: stations.length,
    stations: stations,
    totalOrdersInWorkspace: totalOrders,
    lastSaved: db.data.meta ? db.data.meta.lastSaved : null
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SPX HUB SERVER ĐANG LẮNG NGHE TẠI CỔNG: ${PORT}`);
  triggerManager.start();
});

process.on('SIGTERM', () => {
  triggerManager.stop();
  db.saveNow();
  server.close(() => process.exit(0));
});
