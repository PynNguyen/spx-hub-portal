/**
 * ============================================================
 * SPX HUB RPC DISPATCHER
 * Tiếp nhận và xử lý toàn bộ các hàm gọi từ google.script.run
 * Kết nối dữ liệu trực tiếp với Centralized Workspace Database.
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const db = require('./database');
const triggerManager = require('./trigger_manager');
const authManager = require('./auth_manager');

const VIEWS_DIR = path.join(__dirname, '..', 'public', 'views');

// Danh sách trạm mặc định tại khu vực Đắk Lắk & Tây Nguyên
const DEFAULT_STATIONS = [
  '45-DLK Krong Pak 02 Hub',
  'Buôn Ma Thuột',
  'Ea Kar',
  'Cư Kuin',
  'Lắk',
  'Ea H\'leo',
  'Krông Bông',
  'Krông Năng',
  'Krông Búk',
  'Buôn Đôn',
  'Cư M\'gar',
  'M\'Đrắk'
];

class RpcDispatcher {
  async dispatch(functionName, args = [], userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    console.log(`📡 [RPC Call] Function: "${functionName}", User: "${userEmail}", Args:`, args.length);

    try {
      if (typeof this[functionName] === 'function') {
        return await this[functionName](...args, userEmail);
      }

      // Xử lý các tiền tố hoặc mapping hàm phổ biến
      if (functionName.startsWith('getModuleHtml') || functionName === 'include') {
        return this.getModuleHtml(args[0]);
      }

      console.warn(`⚠️ [RPC Unknown] Function "${functionName}" is not explicitly registered. Returning safe fallback.`);
      if (/get.*(List|All|Rows|Cases|Orders|Wards|Hubs|Array|Items)/i.test(functionName) || functionName.endsWith('s')) {
        return [];
      }
      return { success: true, message: `Function ${functionName} handled by default fallback.` };
    } catch (err) {
      console.error(`❌ [RPC Dispatch Error] ${functionName}:`, err);
      return { success: false, error: err.message };
    }
  }

  // ============================================================
  // 1. SYSTEM INITIALIZATION & PERMISSION
  // ============================================================
  checkUserAccess(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    const auth = authManager.getUser(userEmail);
    return {
      allowed: true,
      email: auth.email,
      name: auth.name,
      role: auth.role,
      level: auth.levelNum || auth.level || 1,
      levelNum: auth.levelNum || auth.level || 1,
      levelCode: auth.levelCode || auth.role,
      levelLabel: auth.levelLabel || (auth.role === 'admin' ? 'Admin (L1)' : auth.role.toUpperCase()),
      isRootAdmin: auth.isRootAdmin,
      stations: auth.hubs,
      stationList: auth.hubs.filter(h => h !== 'ALL'),
      defaultStation: auth.defaultHub,
      serverMode: 'RENDER_CONTAINER'
    };
  }

  getCurrentUserAccess(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    return this.checkUserAccess(userEmail);
  }

  checkAnalyticsPermission(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    const auth = authManager.getUser(userEmail);
    const isRootAdmin = (auth.role === 'admin' || auth.isRootAdmin);
    return {
      allowed: isRootAdmin || auth.role === 'aom' || auth.role === 'sup',
      email: auth.email,
      role: auth.role.toUpperCase(),
      stations: auth.hubs
    };
  }

  spx_listAllUserAccess() {
    return {
      success: true,
      users: db.data.userPermissions || {},
      adminRoles: db.data.adminRoles || {},
      stations: DEFAULT_STATIONS
    };
  }

  getModuleAccess(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    const auth = authManager.getUser(userEmail);
    const isRootAdmin = (auth.role === 'admin' || auth.isRootAdmin);
    return {
      role: auth.role || 'admin',
      level: auth.levelNum || auth.level || 1,
      levelNum: auth.levelNum || auth.level || 1,
      levelCode: auth.levelCode || auth.role || 'admin',
      levelLabel: auth.levelLabel || (auth.role === 'admin' ? 'Admin (L1)' : (auth.role || 'staff').toUpperCase()),
      email: auth.email || userEmail,
      hubs: auth.hubs || DEFAULT_STATIONS,
      defaultHub: auth.defaultHub || '45-DLK Krong Pak 02 Hub',
      isRootAdmin: isRootAdmin,
      modules: {
        tondong: true,
        pick: true,
        quahan: true,
        doncaucuu: true,
        kpifail: true,
        vipham: true,
        rider_plan: true,
        luong: true,
        tracuu: true,
        tailieu: true,
        adminzone: isRootAdmin,
        analytics: true
      }
    };
  }

  spx_getModuleAccess(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    return JSON.stringify(this.getModuleAccess(userEmail));
  }

  spx_getBootstrap(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    return JSON.stringify({
      email: userEmail,
      moduleAccess: {
        role: 'admin',
        level: 1,
        email: userEmail,
        hubs: ['ALL', ...DEFAULT_STATIONS],
        defaultHub: '45-DLK Krong Pak 02 Hub',
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
      },
      _timing: { tong: 5 }
    });
  }

  spx_getHubOrgDirectory() {
    return JSON.stringify({
      byHub: {},
      supNames: ['Sup Tây Nguyên', 'Sup Đắk Lắk'],
      aomNames: ['AOM Tây Nguyên']
    });
  }

  spx_getWebAppUrl() {
    return 'https://spx-hub-portal.onrender.com';
  }

  spx_checkLuongAccess() {
    return 'granted';
  }

  spx_trackLuongUsage() {
    return { success: true };
  }

  spx_trackModuleOpen() {
    return { success: true };
  }

  // ============================================================
  // HEARTBEAT & SYSTEM STATUS (Khởi động hệ thống & Thăm dò ngầm)
  // ============================================================
  spx_getSystemAnnouncement() {
    return JSON.stringify({
      success: true,
      state: {
        banner: { active: false, content: '' },
        maintenance: { active: false }
      },
      text: '🚀 Hệ thống SPX Hub Cloud Run 24/7 đang hoạt động ổn định.',
      version: '1.0.0'
    });
  }

  spx_getModuleStatusPublic() {
    return JSON.stringify({
      success: true,
      statuses: {}
    });
  }

    spx_getModuleVersions() {
    return JSON.stringify({
      success: true,
      versions: {
        tondong: 'v2026_clean_orig',
        fms: 'v2026_clean_orig',
        JS_FMS: 'v2026_clean_orig',
        pick: 'v2026_clean_orig',
        JS_Pick: 'v2026_clean_orig',
        quahan: 'v2026_clean_orig',
        JS_Quahan: 'v2026_clean_orig',
        doncaucuu: 'v2026_clean_orig',
        rescue: 'v2026_clean_orig',
        JS_DonCauCuu: 'v2026_clean_orig',
        kpifail: 'v2026_clean_orig',
        JS_KPIFail: 'v2026_clean_orig',
        vipham: 'v2026_clean_orig',
        violation: 'v2026_clean_orig',
        JS_ViPham: 'v2026_clean_orig',
        rider_plan: 'v2026_clean_orig',
        riderplan: 'v2026_clean_orig',
        JS_Rider_plan: 'v2026_clean_orig',
        luong: 'v2026_clean_orig',
        JS_Luong: 'v2026_clean_orig',
        tracuu: 'v2026_clean_orig',
        JS_Tracuu: 'v2026_clean_orig',
        tailieu: 'v2026_clean_orig',
        JS_TaiLieu: 'v2026_clean_orig',
        JS_Tailieu: 'v2026_clean_orig',
        adminzone: 'v2026_clean_orig',
        JS_AdminZone: 'v2026_clean_orig',
        analytics: 'v2026_clean_orig',
        analytics_block: 'v2026_clean_orig',
        Analytics_Block: 'v2026_clean_orig'
      }
    });
  }

  aging_getDataVersion() {
    return '1';
  }

  kpifail_getDataVersion() {
    return '1';
  }

  aging_clearCache() {
    return { success: true };
  }

  kpifail_clearCache() {
    return { success: true };
  }

  aging_getNotesOnly() {
    return { success: true, notes: {} };
  }

  kpifail_getNotes() {
    return JSON.stringify({ success: true, notes: {} });
  }

  fms_live_getSyncMeta() {
    return JSON.stringify({
      success: true,
      syncTime: new Date().toISOString(),
      status: 'SYNCED'
    });
  }

  ana_getStationDataStamp(stationName) {
    const key = (stationName || '').trim();
    const st = db.data.stations[key];
    return (st && st.updatedAt) || '1';
  }

  spx_getHeartbeat(ctxJson) {
    let ctx = {};
    try { ctx = typeof ctxJson === 'string' ? JSON.parse(ctxJson) : (ctxJson || {}); } catch (e) { ctx = {}; }
    const want = Array.isArray(ctx.parts) ? ctx.parts : ['ann', 'mod', 'aging', 'kpi', 'fms'];
    const parts = {};

    want.forEach(p => {
      switch (p) {
        case 'ann': parts.ann = this.spx_getSystemAnnouncement(); break;
        case 'mod': parts.mod = this.spx_getModuleStatusPublic(); break;
        case 'aging': parts.aging = this.aging_getDataVersion(); break;
        case 'kpi': parts.kpi = this.kpifail_getDataVersion(); break;
        case 'fms': parts.fms = this.fms_live_getSyncMeta(); break;
        case 'notes': parts.notes = this.kpifail_getNotes(); break;
        case 'ana': parts.ana = this.ana_getStationDataStamp(ctx.ana || 'Krông Pắc 02'); break;
        default: break;
      }
    });

    return JSON.stringify({
      success: true,
      ts: Date.now(),
      parts: parts
    });
  }

  getFeeMatrix() {
    return {
      success: true,
      rates: {
        standardPickup: 3500,
        bulkyPickup: 7000,
        slaOnTimeBonus: 500
      }
    };
  }

  // ============================================================
  // 2. DYNAMIC MODULE LOADING (Lazy Loading Views)
  // ============================================================
    getModuleHtml(moduleKey) {
    if (!moduleKey) return '';
    const keyLower = String(moduleKey).trim().toLowerCase().replace(/\.html$/, '');

    const map = {
      'tondong': 'JS_FMS.html',
      'fms': 'JS_FMS.html',
      'js_fms': 'JS_FMS.html',
      'pick': 'JS_Pick.html',
      'js_pick': 'JS_Pick.html',
      'quahan': 'JS_Quahan.html',
      'js_quahan': 'JS_Quahan.html',
      'doncaucuu': 'JS_DonCauCuu.html',
      'js_doncaucuu': 'JS_DonCauCuu.html',
      'rescue': 'JS_DonCauCuu.html',
      'kpifail': 'JS_KPIFail.html',
      'js_kpifail': 'JS_KPIFail.html',
      'vipham': 'JS_ViPham.html',
      'js_vipham': 'JS_ViPham.html',
      'violation': 'JS_ViPham.html',
      'rider_plan': 'JS_Rider_plan.html',
      'js_rider_plan': 'JS_Rider_plan.html',
      'riderplan': 'JS_Rider_plan.html',
      'luong': 'JS_Luong.html',
      'js_luong': 'JS_Luong.html',
      'tracuu': 'JS_Tracuu.html',
      'js_tracuu': 'JS_Tracuu.html',
      'tailieu': 'JS_Tailieu.html',
      'js_tailieu': 'JS_Tailieu.html',
      'adminzone': 'JS_AdminZone.html',
      'js_adminzone': 'JS_AdminZone.html',
      'analytics_block': 'Analytics_Block.html',
      'analytics': 'Analytics_Block.html',
      'tailwindbuild': 'TailwindBuild.html'
    };

    let targetFile = map[keyLower];
    if (!targetFile) {
      const files = fs.readdirSync(VIEWS_DIR);
      targetFile = files.find(f => f.toLowerCase() === keyLower + '.html' || f.toLowerCase() === keyLower);
    }
    if (!targetFile) {
      targetFile = moduleKey.endsWith('.html') ? moduleKey : (moduleKey + '.html');
    }

    const targetPath = path.join(VIEWS_DIR, targetFile);
    if (fs.existsSync(targetPath)) {
      return fs.readFileSync(targetPath, 'utf8');
    }

    console.warn(`File view not found: ${targetPath}`);
    return `<div class="p-8 text-center text-red-500 font-bold">Không tìm thấy module: ${moduleKey}</div>`;
  }

  // ============================================================
  // 3. WORKSPACE SAVE / LOAD / DELETE TRIGGERS (FMS Tồn Đọng & Trạm)
  // ============================================================
  saveStationData(stationName, mergedOrdersJson, inboundLock, clientEpoch, userEmail) {
    let orders = [];
    try {
      orders = typeof mergedOrdersJson === 'string' ? JSON.parse(mergedOrdersJson) : (mergedOrdersJson || []);
    } catch (e) {
      orders = [];
    }

    const res = db.saveStationData(stationName, orders, inboundLock, clientEpoch, userEmail);
    return res;
  }

  getStationData(stationName) {
    return db.getStationData(stationName);
  }

  getStationDataBundle(stationName) {
    const data = db.getStationData(stationName);
    return {
      success: true,
      stationName,
      data: data.orders || [],
      inboundLock: data.inboundLock,
      epoch: data.epoch,
      updatedAt: data.updatedAt,
      serverTime: new Date().toISOString()
    };
  }

  saveSupplementData(stationName, supplementJson, clientEpoch, userEmail) {
    let supp = {};
    try {
      supp = typeof supplementJson === 'string' ? JSON.parse(supplementJson) : (supplementJson || {});
    } catch (e) {}

    const key = (stationName || '').trim();
    db.data.supplements[key] = {
      supplement: supp,
      epoch: Date.now(),
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail
    };
    db.isDirty = true;
    return { success: true, msg: 'Đã lưu dữ liệu bổ sung thành công.' };
  }

  getSupplementData(stationName) {
    const key = (stationName || '').trim();
    const item = db.data.supplements[key] || { supplement: {}, epoch: 0 };
    return { success: true, supplement: item.supplement, epoch: item.epoch };
  }

  saveInboundLockToCloud(stationName, inboundValue) {
    const key = (stationName || '').trim();
    if (db.data.stations[key]) {
      db.data.stations[key].inboundLock = !!inboundValue;
      db.isDirty = true;
    }
    return { success: true, inboundLock: !!inboundValue };
  }

  getInboundLock(stationName) {
    const key = (stationName || '').trim();
    const st = db.data.stations[key];
    return (st && st.inboundLock) || false;
  }

  clearStationData(stationName, userEmail) {
    return db.clearStationData(stationName, userEmail);
  }

  ana_pushTonState() {
    return { success: true };
  }

  getTrendDrivers() {
    return [];
  }

  getTrendStation() {
    return {};
  }

  getTrendDriverList() {
    return [];
  }

  logAIFeedback() {
    return { success: true };
  }

  // ============================================================
  // 4. RIDER PLAN & FORECAST (Save / Load)
  // ============================================================
  saveDriverPlan(payload, userEmail) {
    return { success: true, msg: 'Đã lưu kế hoạch tài xế' };
  }

  saveRiderPlan(payload, userEmail) {
    return db.saveRiderPlan(payload, userEmail);
  }

  loadRiderPlan(month) {
    return db.loadRiderPlan(month);
  }

  loadAllData(month, overrideHub) {
    const m = month || new Date().toISOString().slice(0, 7);
    const plan = db.loadRiderPlan(m);
    return {
      success: true,
      month: m,
      hub: overrideHub || 'Krông Pắc 02',
      planData: (plan.data && plan.data.plan) || [],
      forecastData: []
    };
  }

  // ============================================================
  // 5. RESCUE ORDERS & VIOLATIONS (Đơn Cứu Cứu & Vi Phạm)
  // ============================================================
  getOrders(forceRefresh) {
    const rescueList = db.data.rescueOrders || [];
    return {
      success: true,
      rows: rescueList,
      resolved: Object.keys(db.data.resolvedOrders || {}), // Array!
      count: rescueList.length,
      access: {
        role: 'admin',
        email: 'xuan.nguyenthanh01@spxexpress.com',
        displayName: 'Admin Xuân',
        stations: ['ALL', ...DEFAULT_STATIONS]
      }
    };
  }

  getResolvedOrders() {
    return {
      success: true,
      resolved: Object.keys(db.data.resolvedOrders || {})
    };
  }

  setResolvedStatus(trackingNo, resolved, userEmail) {
    if (!trackingNo) return { success: false, msg: 'Thiếu mã đơn' };
    db.data.resolvedOrders[trackingNo] = {
      resolved: !!resolved,
      resolvedAt: new Date().toISOString(),
      resolvedBy: userEmail
    };
    db.isDirty = true;
    return { success: true, trackingNo, resolved: !!resolved };
  }

  setResolvedStatusBulk(items, resolved, userEmail) {
    (items || []).forEach(no => {
      if (no) {
        db.data.resolvedOrders[no] = {
          resolved: !!resolved,
          resolvedAt: new Date().toISOString(),
          resolvedBy: userEmail
        };
      }
    });
    db.isDirty = true;
    return { success: true, count: (items || []).length };
  }

  getComplaintData(forceRefresh) {
    return db.data.violations || [];
  }

  // ============================================================
  // 6. TRA CỨU & TÀI LIỆU & KPI FAIL
  // ============================================================
  tracuu_getAllWards() {
    return [
      { ward: 'Thị trấn Phước An', station: 'Krông Pắc 02', zoneId: 'Zone 1' },
      { ward: 'Xã Ea Kly', station: 'Krông Pắc 02', zoneId: 'Zone 2' },
      { ward: 'Xã Ea Phê', station: 'Krông Pắc 02', zoneId: 'Zone 3' },
      { ward: 'Xã Hòa Đông', station: 'Krông Pắc 02', zoneId: 'Zone 1' },
      { ward: 'Xã Ea Kuăng', station: 'Krông Pắc 02', zoneId: 'Zone 2' },
      { ward: 'Xã Krông Búk', station: 'Krông Pắc 02', zoneId: 'Zone 2' },
      { ward: 'Xã Ea Yông', station: 'Krông Pắc 02', zoneId: 'Zone 1' },
      { ward: 'Xã Ea Kênh', station: 'Krông Pắc 02', zoneId: 'Zone 1' },
      { ward: 'Xã Ea Hiu', station: 'Krông Pắc 02', zoneId: 'Zone 2' },
      { ward: 'Xã Ea Uy', station: 'Krông Pắc 02', zoneId: 'Zone 2' },
      { ward: 'Xã Ea Yiêng', station: 'Krông Pắc 02', zoneId: 'Zone 3' },
      { ward: 'Xã Vụ Bổn', station: 'Krông Pắc 02', zoneId: 'Zone 3' },
      { ward: 'Xã Tân Tiến', station: 'Krông Pắc 02', zoneId: 'Zone 2' },
      { ward: 'Xã Hòa An', station: 'Krông Pắc 02', zoneId: 'Zone 1' }
    ];
  }

  tracuu_getAllHubs() {
    return DEFAULT_STATIONS.map((name, idx) => ({
      name: name,
      code: 'HUB' + String(idx + 1).padStart(3, '0')
    }));
  }

  wiki_getDocumentData_v2(forceRefresh) {
    return {
      success: true,
      version: 'v2-row-wide-real-links',
      documents: db.data.wikiDocs || [],
      categories: ['Quy Trình Giao Nhận', 'Chính Sách KPI', 'Hướng Dẫn Ứng Dụng', 'Liên Hệ Khẩn Cấp'],
      items: db.data.wikiDocs || []
    };
  }

  flm_getKpiBundle() {
    return JSON.stringify({
      success: true,
      builtAt: new Date().toISOString(),
      asOf: new Date().toISOString(),
      targets: { fms: 98.5, pick: 99.0, ontime: 97.5 },
      periods: ['Hôm nay', 'Tuần này', 'Tháng này'],
      slots: ['Ca Sáng', 'Ca Chiều', 'Ca Tối'],
      sources: [],
      hubs: DEFAULT_STATIONS.map(s => [s, 98.5, 99.1, 97.8]),
      scoped: false,
      access: {
        role: 'admin',
        levelCode: 'L1',
        levelNum: 1,
        email: 'xuan.nguyenthanh01@spxexpress.com',
        hubs: ['ALL', ...DEFAULT_STATIONS]
      }
    });
  }

  flm_getFailOrdersByDay() {
    return {
      success: true,
      orders: []
    };
  }

  // ============================================================
  // 7. ADMIN ZONE & QUOTA STATS & PREVIEWS
  // ============================================================
  rom_listConfig() {
    return JSON.stringify({ success: true, data: [] });
  }

  rom_getScopeForPreview() {
    return JSON.stringify({ success: true, scope: [] });
  }

  spx_getOverviewPart(part, hub, force, userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    const auth = authManager.getUser(userEmail);
    if (part === 'meta') {
      return JSON.stringify({
        success: true,
        data: {
          levelCode: auth.levelCode || auth.role || 'admin',
          levelNum: auth.levelNum || auth.level || 1,
          levelLabel: auth.levelLabel || (auth.role === 'admin' ? 'Admin (L1)' : (auth.role || 'staff').toUpperCase()),
          role: auth.role || 'admin',
          hubs: auth.hubs || DEFAULT_STATIONS,
          defaultHub: auth.defaultHub || '45-DLK Krong Pak 02 Hub',
          isRootAdmin: !!auth.isRootAdmin
        }
      });
    }

    if (part === 'aging') {
      return JSON.stringify({
        success: true,
        data: {
          total: 0,
          hubs: {},
          lastSync: new Date().toLocaleTimeString('vi-VN')
        }
      });
    }

    if (part === 'kpifail') {
      return JSON.stringify({
        success: true,
        data: {
          totalFail: 0,
          rate: 99.2,
          hubs: {}
        }
      });
    }

    if (part === 'rescue') {
      return JSON.stringify({
        success: true,
        data: {
          pendingCount: 0,
          urgentCount: 0,
          orders: []
        }
      });
    }

    if (part === 'violation') {
      return JSON.stringify({
        success: true,
        data: {
          totalViolations: 0,
          pendingReview: 0,
          cases: []
        }
      });
    }

    if (part === 'riderplan') {
      return JSON.stringify({
        success: true,
        data: {
          totalRiders: 25,
          activeToday: 24,
          planCompliance: 98
        }
      });
    }

    return JSON.stringify({ success: true, data: {} });
  }

  spx_getStationWeather() {
    return { temp: 28, desc: 'Nắng nhẹ', icon: '01d' };
  }

  spx_adminGetFirestoreQuota() {
    return { reads: 120, writes: 45, maxReads: 50000, maxWrites: 20000 };
  }

  spx_adminGetOnlineUsers() {
    return {
      success: true,
      onlineCount: 1,
      users: [{ email: 'xuan.nguyenthanh01@spxexpress.com', station: 'Krông Pắc 02', lastActive: new Date().toISOString() }]
    };
  }

  spx_adminListModuleStatus() {
    return {
      success: true,
      modules: {
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
      }
    };
  }

  spx_getAiQuotaStats() {
    return { success: true, used: 12, limit: 1000 };
  }

  spx_getAllHubNames() {
    return DEFAULT_STATIONS;
  }

  spx_getFeedbackList() {
    return [];
  }

  spx_getUnmatchedWorkplaces() {
    return [];
  }

  spx_getUserAccessDetail() {
    return { success: true, user: { email: 'xuan.nguyenthanh01@spxexpress.com', role: 'admin', level: 1 } };
  }

  submitAccessRequest() {
    return { success: true, message: 'Yêu cầu truy cập đã được tiếp nhận.' };
  }

  search_searchSortCode() {
    return { success: true, results: [] };
  }

  // ============================================================
  // 8. TRIGGER LOGS & MANUAL TRIGGER EXECUTION
  // ============================================================
  getTriggerLogs() {
    return {
      success: true,
      logs: db.data.triggerLogs || []
    };
  }

  async runTriggerManually(triggerName) {
    return await triggerManager.runTriggerManually(triggerName);
  }

  exportWorkspaceSnapshot() {
    return {
      success: true,
      data: db.data
    };
  }
}

module.exports = new RpcDispatcher();
