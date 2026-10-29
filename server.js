/**
 * ============================================================
 * SPX HUB GOOGLE CLOUD RUN SERVER
 * Hệ thống điều hành 500 Hub toàn quốc chạy trên Google Cloud Run
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
// Google Cloud Run tự động inject cổng qua biến môi trường PORT (mặc định 8080)
const PORT = process.env.PORT || 8080;
const VIEWS_DIR = path.join(__dirname, 'public', 'views');

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Static files (css, js, assets)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Health Check Endpoint cho Google Cloud Run Ingress Load Balancer
 */
app.get('/_healthz', (req, res) => {
  res.status(200).send('OK');
});

/**
 * Hàm biên dịch template: Thay thế đệ quy các thẻ <?!= include('Filename'); ?>
 */
function renderTemplate(htmlContent, depth = 0) {
  if (depth > 5) return htmlContent;

  const includeRegex = /<\?!\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;\s*\?>/g;

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

    // 2. Tiêm bộ RPC Bridge vào phần đầu <head> để bắt các lệnh google.script.run
    const bridgeScript = `
    <!-- SPX Hub Cloud Run Multi-Hub RPC Bridge -->
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
 * API Cloud Scheduler Webhook: Cho phép Google Cloud Scheduler kích hoạt Trigger định kỳ
 */
app.post('/api/triggers/:triggerName', async (req, res) => {
  const triggerName = req.params.triggerName;
  console.log(`⏱️ [Cloud Scheduler] Webhook triggered: ${triggerName}`);
  const result = await triggerManager.runTriggerManually(triggerName);
  res.json(result);
});

/**
 * API Trạng Thái Workspace & Hệ Thống
 */
app.get('/api/workspace/status', (req, res) => {
  const stations = Object.keys(db.data.stations);
  let totalOrders = 0;
  stations.forEach(s => {
    totalOrders += (db.data.stations[s].orders || []).length;
  });

  res.json({
    status: 'ONLINE',
    platform: 'GOOGLE_CLOUD_RUN',
    version: '1.0.0',
    hub: db.data.meta.hubName,
    stationsCount: stations.length,
    stations: stations,
    totalOrdersInWorkspace: totalOrders,
    lastSaved: db.data.meta.lastSaved,
    recentTriggers: (db.data.triggerLogs || []).slice(0, 10)
  });
});

// Khởi chạy Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n============================================================');
  console.log('🚀 SPX HUB GOOGLE CLOUD RUN SERVER ĐÃ SẴN SÀNG!');
  console.log('============================================================');
  console.log(`🌐 Server đang lắng nghe tại cổng: ${PORT}`);
  console.log('============================================================\n');

  // Khởi động các tiến trình chạy ngầm tự động (Triggers)
  triggerManager.start();
});

// Xử lý đóng kết nối an toàn khi Cloud Run dừng instance (Graceful Shutdown)
process.on('SIGTERM', () => {
  console.log('🛑 [Cloud Run] Received SIGTERM signal, shutting down gracefully...');
  triggerManager.stop();
  db.saveNow();
  server.close(() => {
    console.log('✅ [Cloud Run] Server closed. Exit 0.');
    process.exit(0);
  });
});
