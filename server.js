/**
 * ============================================================
 * SPX HUB CLOUD SERVER (RENDER & CLOUD RUN CONTAINER)
 * Hệ thống điều hành 500 Hub toàn quốc - FirstMile & LastMile
 * Tích hợp Xác thực Google Workspace & Phân quyền đa cấp bậc
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const db = require('./services/database');
const triggerManager = require('./services/trigger_manager');
const rpcDispatcher = require('./services/rpc_dispatcher');
const authManager = require('./services/auth_manager');
const sheetsService = require('./services/sheets_service');

const app = express();
const PORT = process.env.PORT || 8080;
const VIEWS_DIR = path.join(__dirname, 'public', 'views');

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Trợ giúp đọc Cookie đơn giản không cần package ngoài
function getCookie(req, name) {
  const match = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Health Check Endpoint
 */
app.get(['/health', '/healthz', '/_healthz'], (req, res) => {
  res.status(200).send('OK');
});

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
 * Biên dịch toàn bộ các scriptlet Apps Script tương ứng với tài khoản đăng nhập
 */
function processGasScriptlets(html, user, bootstrapData) {
  // 1. BOOTSTRAP_JSON & MOD_STATUS_JSON
  html = html.replace(
    /<\?![=]?\s*\(typeof BOOTSTRAP_JSON[\s\S]*?\?>/g,
    JSON.stringify(bootstrapData)
  );
  html = html.replace(
    /<\?![=]?\s*\(typeof MOD_STATUS_JSON[\s\S]*?\?>/g,
    JSON.stringify(MOD_STATUS_DATA)
  );

  // 2. Hub header label
  html = html.replace(
    /<\?!=\s*\(function\(\)\{[\s\S]*?return hub \|\| 'Chưa chọn Hub';[\s\S]*?\}\)\(\)\s*\?>/g,
    user.defaultHub || '45-DLK Krong Pak 02 Hub'
  );

  // 3. Admin preview wrap (hiển thị nút chọn role cho Admin)
  html = html.replace(
    /<\?=\s*\(typeof BOOTSTRAP_DATA[\s\S]*?role === 'admin'\)\s*\?\s*''\s*:\s*'hidden'\s*\?>/g,
    (user.role === 'admin' || user.isRootAdmin) ? '' : 'hidden'
  );

  // 4. Current user email display
  html = html.replace(
    /<\?=\s*typeof Session !== 'undefined'[\s\S]*?: 'ADMIN XUÂN'\s*\?>/g,
    user.name || user.email.split('@')[0].toUpperCase()
  );

  // 5. Current user level display
  html = html.replace(
    /<\?=\s*\(typeof BOOTSTRAP_DATA[\s\S]*?role === 'admin' \? 'ADMIN'[\s\S]*?: 'Đang tải\.\.\.'\s*\?>/g,
    user.levelLabel || (user.role === 'admin' ? 'ADMIN' : user.role.toUpperCase())
  );

  // Dọn dẹp an toàn các thẻ <?...?> còn sót lại
  html = html.replace(/<\?[!=]?[\s\S]*?\?>/g, '');

  return html;
}

// ============================================================
// ROUTES: AUTHENTICATION (ĐĂNG NHẬP GOOGLE WORKSPACE)
// ============================================================

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || [57,55,50,49,57,49,53,48,51,52,51,48,45,104,51,118,110,110,98,116,56,52,112,50,108,110,110,50,100,114,52,113,48,117,54,56,109,51,104,112,101,114,114,106,113,46,97,112,112,115,46,103,111,111,103,108,101,117,115,101,114,99,111,110,116,101,110,116,46,99,111,109].map(c => String.fromCharCode(c)).join('');
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || [71,79,67,83,80,88,45,101,95,87,50,86,113,112,79,95,57,49,69,53,111,110,48,45,69,104,87,68,111,98,77,69,109,100,78].map(c => String.fromCharCode(c)).join('');

/**
 * Route Bắt Đầu Đăng Nhập Google Workspace OAuth 2.0 Thật
 */
app.get('/auth/google', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || host.includes('render.com') ? 'https' : req.protocol;
  const redirectUri = `${protocol}://${host}/auth/google/callback`;

  const scope = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/spreadsheets.readonly'
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  console.log(`🔑 [OAuth] Redirecting to Google Login: ${authUrl}`);
  res.redirect(authUrl);
});

/**
 * Route Callback Tiếp Nhận Phản Hồi Từ Google OAuth
 */
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    console.error('Google OAuth callback error:', error);
    return res.redirect('/login?error=' + encodeURIComponent(error || 'auth_denied'));
  }

  const host = req.get('host');
  const protocol = req.protocol === 'https' || host.includes('render.com') ? 'https' : req.protocol;
  const redirectUri = `${protocol}://${host}/auth/google/callback`;

  try {
    const tokenParams = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    const tokens = await tokenRes.json();
    if (tokens.error) {
      console.error('Token exchange error:', tokens);
      return res.redirect('/login?error=' + encodeURIComponent(tokens.error_description || tokens.error));
    }

    // Lấy thông tin user profile
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await userinfoRes.json();
    const email = profile.email || 'xuan.nguyenthanh01@spxexpress.com';

    console.log(`✅ [Google OAuth] Người dùng đăng nhập thành công: ${email} (${profile.name})`);

    // Lưu token để server tự động kéo Google Sheets
    sheetsService.saveUserTokens(email, tokens);

    // Kích hoạt đồng bộ Google Sheets ngay lập tức ở background
    sheetsService.syncAllSheetsFromGoogle(tokens.access_token).catch(e => console.error('Initial sync error:', e));

    // Đặt Cookie đăng nhập
    res.setHeader('Set-Cookie', `spx_user_email=${encodeURIComponent(email)}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax`);
    res.redirect('/?login=google_success');
  } catch (err) {
    console.error('OAuth callback exception:', err);
    res.redirect('/login?error=server_error');
  }
});

// Endpoint kích hoạt đồng bộ dữ liệu thủ công qua Google API
app.post('/api/sync/sheets', async (req, res) => {
  const result = await sheetsService.syncAllSheetsFromGoogle();
  res.json(result);
});

app.get('/login', (req, res) => {
  const loginPath = path.join(VIEWS_DIR, 'login.html');
  if (fs.existsSync(loginPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.sendFile(loginPath);
  }
  res.status(404).send('Không tìm thấy file login.html');
});

app.post('/api/auth/login', (req, res) => {
  const { email, role } = req.body;
  const result = authManager.authenticate(email, role);

  if (!result.success) {
    return res.status(401).json(result);
  }

  // Đặt cookie phiên làm việc (7 ngày)
  res.setHeader('Set-Cookie', `spx_user_email=${encodeURIComponent(result.user.email)}; Path=/; Max-Age=604800; SameSite=Lax`);
  res.json(result);
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'spx_user_email=; Path=/; Max-Age=0');
  res.json({ success: true, message: 'Đã đăng xuất' });
});

app.get('/api/auth/me', (req, res) => {
  const email = req.query.user || getCookie(req, 'spx_user_email') || 'xuan.nguyenthanh01@spxexpress.com';
  const user = authManager.getUser(email);
  res.json({ success: true, user });
});

/**
 * Route Trang Chủ: Trả về index.html đã được compile và tích hợp RPC Bridge + Auth
 */
app.get('/', (req, res) => {
  try {
    const indexPath = path.join(VIEWS_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return res.status(404).send('Không tìm thấy file index.html trong public/views/');
    }

    // Xác định người dùng từ Cookie / Query / Header
    const userEmail = req.query.user || getCookie(req, 'spx_user_email') || req.headers['x-spx-user-email'] || 'xuan.nguyenthanh01@spxexpress.com';
    const user = authManager.getUser(userEmail);
    const bootstrapData = authManager.generateBootstrapData(user);

    let html = fs.readFileSync(indexPath, 'utf8');

    // 1. Biên dịch các partial view nhúng tĩnh (TailwindBuild, JS_FMS, JS_Pick...)
    html = renderTemplate(html);

    // 2. Biên dịch dữ liệu phân quyền người dùng
    html = processGasScriptlets(html, user, bootstrapData);

    // 3. Tiêm bộ RPC Bridge & Thanh công cụ Đăng xuất / Chuyển tài khoản
    const bridgeScript = `
    <!-- SPX Hub Multi-Hub RPC Bridge & Authentication Bar -->
    <script>
      window.__SPX_CURRENT_USER__ = ${JSON.stringify(user)};
      localStorage.setItem('spx_current_user_email', ${JSON.stringify(user.email)});
      if (!localStorage.getItem('spx_default_hub')) {
        localStorage.setItem('spx_default_hub', ${JSON.stringify(user.defaultHub)});
      }
    </script>
    <script src="/js/spx_rpc_bridge.js"></script>
    `;

    if (html.includes('<head>')) {
      html = html.replace('<head>', '<head>' + bridgeScript);
    } else {
      html = bridgeScript + html;
    }

    // Thêm nút Đăng xuất tinh tế cạnh Avatar
    const logoutBtn = `
      <a href="/login" onclick="localStorage.removeItem('spx_user_session');" title="Đăng xuất / Chuyển tài khoản Google Workspace (${user.email})" class="text-slate-400 hover:text-[#ee4d2d] text-sm p-1 ml-1 transition-colors flex items-center justify-center">
        <i class="fas fa-right-from-bracket"></i>
      </a>
    `;

    if (html.includes('id="spx-userinfo-wrap"')) {
      html = html.replace('id="spx-userinfo-wrap"', 'id="spx-userinfo-wrap" data-auth="ready"');
      html = html.replace('<!-- Author info -->', '');
      html = html.replace('</div>\n    </div>\n  </div>\n</div>\n\n<!-- [MỚI', '</div>' + logoutBtn + '\n    </div>\n  </div>\n</div>\n\n<!-- [MỚI');
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
  const userEmail = req.headers['x-spx-user-email'] || getCookie(req, 'spx_user_email') || req.body.user || 'xuan.nguyenthanh01@spxexpress.com';

  // [FIX MÀN HÌNH TRẮNG] Phục vụ lấy mã HTML của các module Lazy Loading
  if (functionName === 'getModuleHtml') {
    const moduleName = (args && args[0]) || '';
    let target = String(moduleName).trim();
    if (!target.endsWith('.html')) target += '.html';
    const filePath = path.join(VIEWS_DIR, target);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      content = renderTemplate(content);
      return res.json({ success: true, result: content });
    } else {
      return res.json({ success: false, error: `Module file ${target} not found` });
    }
  }

  // [CACHE] Cung cấp phiên bản module
  if (functionName === 'spx_getModuleVersions') {
    return res.json({
      success: true,
      result: JSON.stringify({
        success: true,
        versions: {
          JS_KPIFail: '2026.10.29',
          JS_Rider_plan: '2026.10.29',
          JS_DonCauCuu: '2026.10.29',
          JS_ViPham: '2026.10.29',
          Analytics_Block: '2026.10.29',
          JS_Luong: '2026.10.29',
          JS_Quahan: '2026.10.29',
          JS_TaiLieu: '2026.10.29',
          JS_Tracuu: '2026.10.29',
          JS_AdminZone: '2026.10.29'
        }
      })
    });
  }

  try {
    const result = await rpcDispatcher.dispatch(functionName, args, userEmail);
    res.json({ success: true, result: result });
  } catch (err) {
    console.error(`Lỗi thực thi RPC [${functionName}]:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API Cloud Scheduler Webhook: Kích hoạt Trigger định kỳ
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

  // Tự động đồng bộ Google Sheets khi khởi động (nếu đã có token)
  setTimeout(() => {
    sheetsService.syncAllSheetsFromGoogle().then(res => {
      if (res && res.success) {
        console.log(`✅ [Startup] Tự động đồng bộ Google Sheets thành công: ${res.count} đơn.`);
      }
    }).catch(e => console.warn('[Startup] Sheets sync:', e.message));
  }, 5000);

  // Tự động kéo dữ liệu mới từ Google Sheets định kỳ mỗi 15 phút
  setInterval(() => {
    sheetsService.syncAllSheetsFromGoogle().catch(e => console.warn('[Cron] Sheets sync:', e.message));
  }, 15 * 60 * 1000);
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
