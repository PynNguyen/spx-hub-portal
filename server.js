/**
 * ============================================================
 * SPX HUB GOOGLE CLOUD RUN SERVER
 * Hệ thống điều hành 500 Hub toàn quốc chạy trên Cloud Container
 * Sẵn sàng 24/7/365, tự động co giãn (Auto-scaling), SLA 99.95%
 * ============================================================
 */

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

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Static files (css, js, assets)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Health Check Endpoint
 */
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

/**
 * Hàm biên dịch template: Thay thế đệ quy các thẻ <?!= include('Filename'); ?>
 */
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

    console.warn(`[Template Engine] Included file not found: ${filePath}`);
    return `<!-- Missing include: ${fileName} -->`;
  });
}

/**
 * Biên dịch toàn bộ các scriptlet Apps Script còn tồn đọng trong template
 */
function processGasScriptlets(html) {
  // 1. BOOTSTRAP_JSON & MOD_STATUS_JSON
  html = html.replace(
    /<\?!\s*\(typeof BOOTSTRAP_JSON[\s\S]*?\?>/g,
    JSON.stringify(JSON.stringify(BOOTSTRAP_DATA))
  );
  html = html.replace(
    /<\?!\s*\(typeof MOD_STATUS_JSON[\s\S]*?\?>/g,
    JSON.stringify(JSON.stringify(MOD_STATUS_DATA))
  );

  // 2. Hub header label
  html = html.replace(
    /<\?!=\s*\(function\(\)\{[\s\S]*?return hub \|\| 'Chưa chọn Hub';[\s\S]*?\}\)\(\)\s*\?>/g,
    'Krông Pắc 02'
  );

  // 3. Admin preview wrap
  html = html.replace(
    /<\?=\s*\(typeof BOOTSTRAP_DATA[\s\S]*?role === 'admin'\)\s*\?\s*''\s*:\s*'hidden'\s*\?>/g,
    ''
  );

  // 4. Current user email display
  html = html.replace(
    /<\?=\s*typeof Session !== 'undefined'[\s\S]*?: 'ADMIN XUÂN'\s*\?>/g,
    'ADMIN XUÂN'
  );

  // 5. Current user level display
  html = html.replace(
    /<\?=\s*\(typeof BOOTSTRAP_DATA[\s\S]*?role === 'admin' \? 'ADMIN'[\s\S]*?: 'Đang tải\.\.\.'\s*\?>/g,
    'ADMIN'
  );

  // Dọn dẹp an toàn các thẻ <?...?> còn sót lại
  html = html.replace(/<\?[!=]?[\s\S]*?\?>/g, '');

  return html;
}

/**
 * Route Trang Chủ: Trả về index.html đã được compile và tích hợp RPC Bridge
 */
app.get('/', (req, res) => {
  try {
    const indexPath = path.join(VIEWS_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return res.status(404).send('Không tìm thấy file index.html trong public/views/');
    }

    let html = fs.readFileSync(indexPath, 'utf8');

    // 1. Biên dịch các partial view nhúng tĩnh (TailwindBuild, JS_FMS, JS_Pick...)
    html = renderTemplate(html);

    // 2. Giải quyết triệt để các thẻ Apps Script scriptlet
    html = processGasScriptlets(html);

    // 3. Tiêm bộ RPC Bridge vào phần đầu <head> để bắt các lệnh google.script.run
    const bridgeScript = `
    <!-- SPX Hub Multi-Hub RPC Bridge -->
    <script src="/js/spx_rpc_bridge.js"></script>
    `;

    if (html.includes('<head>')) {
      html = html.replace('<head>', '<head>' + bridgeScript);
    } else {
      html = bridgeScript + html;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Lỗi render trang chủ:', err);
    res.status(500).send('Lỗi máy chủ nội bộ: ' + err.message);
  }
});

/**
 * API RPC Bridge: Tiếp nhận mọi hàm gọi từ client (google.script.run)
 */
app.post('/api/rpc/:functionName', async (req, res) => {
  const functionName = req.params.functionName;
  const args = req.body.args || [];
  const userEmail = req.headers['x-spx-user-email'] || req.body.user || 'xuan.nguyenthanh01@spxexpress.com';

  try {
    const result = await rpcDispatcher.dispatch(functionName, args, userEmail);
    res.json({ success: true, result: result });
  } catch (err) {
    console.error(`Lỗi thực thi RPC [${functionName}]:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API Cloud Scheduler Webhook: Cho phép kích hoạt Trigger định kỳ
 */
app.post('/api/triggers/:triggerName', async (req, res) => {
  const triggerName = req.params.triggerName;
  console.log(`⏰ [Trigger Webhook] Triggered: ${triggerName}`);
  const result = await triggerManager.runTriggerManually(triggerName);
  res.json(result);
});

/**
 * API Trạng Thái Workspace & Hệ Thống
 */
app.get('/api/workspace/status', (req, res) => {
  const stations = Object.keys(db.data.stations || {});
  let totalOrders = 0;
  stations.forEach(s => {
    totalOrders += (db.data.stations[s].orders || []).length;
  });

  res.json({
    status: 'ONLINE',
    platform: 'RENDER_CONTAINER',
    version: '1.0.0',
    hub: db.data.meta ? db.data.meta.hubName : 'Krông Pắc 02',
    stationsCount: stations.length,
    stations: stations,
    totalOrdersInWorkspace: totalOrders,
    lastSaved: db.data.meta ? db.data.meta.lastSaved : null,
    recentTriggers: (db.data.triggerLogs || []).slice(0, 10)
  });
});

// Khởi chạy Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n============================================================');
  console.log('🚀 SPX HUB CLOUD SERVER ĐÃ SẴN SÀNG!');
  console.log('============================================================');
  console.log(`📡 Server đang lắng nghe tại cổng: ${PORT}`);
  console.log('============================================================\n');

  triggerManager.start();
});

// Xử lý đóng kết nối an toàn khi shutdown (Graceful Shutdown)
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM signal, shutting down gracefully...');
  triggerManager.stop();
  db.saveNow();
  server.close(() => {
    console.log('✅ Server closed. Exit 0.');
    process.exit(0);
  });
});
