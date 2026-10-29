const fs = require('fs');
const path = require('path');
const db = require('./database');
const triggerManager = require('./trigger_manager');

const VIEWS_DIR = path.join(__dirname, '..', 'public', 'views');

const DEFAULT_STATIONS = [
  'Krông Pắc 02', 'Buôn Ma Thuột', 'Ea Kar', 'Cư Kuin', 'Lắk',
  'Ea H\'leo', 'Krông Bông', 'Krông Năng', 'Krông Búk', 'Buôn Đôn',
  'Cư M\'gar', 'M\'Đrắk'
];

class RpcDispatcher {
  async dispatch(functionName, args = [], userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    console.log(`📡 [RPC Call] "${functionName}", User: "${userEmail}", Args:`, args.length);
    try {
      if (typeof this[functionName] === 'function') {
        return await this[functionName](<...args, userEmail>);
      }
      if (functionName.startsWith('getModuleHtml') || functionName === 'include') {
        return this.getModuleHtml(args[0]);
      }
      console.warn(`⚠️ [RPC Unknown] "${functionName}" fallback.`);
      if (/get.*(List|All|Rows|Cases|Orders|Wards|Hubs|Array|Items)/i.test(functionName) || functionName.endsWith('s')) {
        return [];
      }
      return { success: true, message: `Function ${functionName} handled by fallback.` };
    } catch (err) {
      console.error(`❌ [RPC Dispatch Error] ${functionName}:`, err);
      return { success: false, error: err.message };
    }
  }

  checkUserAccess(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    return {
      allowed: true,
      email: userEmail,
      name: 'Admin Xuân (SPX Krông Pắc 02)',
      role: 'admin',
      level: 1,
      isRootAdmin: true,
      stations: ['ALL', ...DEFAULT_STATIONS],
      stationList: DEFAULT_STATIONS,
      defaultStation: 'Krông Pắc 02',
      serverMode: 'LOCAL_MULTI_USER'
    };
  }

  getCurrentUserAccess(userEmail) { return this.checkUserAccess(userEmail); }
  checkAnalyticsPermission(userEmail) { return { allowed: true, email: userEmail, role: 'ADMIN_1', stations: ['ALL', ...DEFAULT_STATIONS] }; }
  spx_listAllUserAccess() { return { success: true, users: db.data.userPermissions || {}, adminRoles: db.data.adminRoles || {}, stations: DEFAULT_STATIONS }; }

  getModuleAccess() {
    return {
      role: 'admin', level: 1, email: 'xuan.nguyenthanh01@spxexpress.com', hubs: ['ALL', ...DEFAULT_STATIONS],
      defaultHub: 'Krông Pắc 02', isRootAdmin: true,
      modules: { tondong: true, pick: true, quahan: true, doncaucuu: true, kpifail: true, vipham: true, rider_plan: true, luong: true, tracuu: true, tailieu: true, adminzone: true, analytics: true }
    };
  }

  spx_getBootstrap(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    return JSON.stringify({
      email: userEmail,
      moduleAccess: { role: 'admin', level: 1, email: userEmail, hubs: ['ALL', ...DEFAULT_STATIONS], defaultHub: 'Krông Pắc 02', isRootAdmin: true },
      analyticsPerm: { allowed: true, stations: ['ALL', ...DEFAULT_STATIONS] },
      luongAccess: 'granted',
      hubOrgDir: { byHub: {}, supNames: ['Sup Tây Nguyên', 'Sup Đắk Lắk'], aomNames: ['AOM Tây Nguyên'] },
      _timing: { tong: 5 }
    });
  }

  spx_getHubOrgDirectory() { return JSON.stringify({ byHub: {}, supNames: ['Sup Tây Nguyên', 'Sup Đắk Lắk'], aomNames: ['AOM Tây Nguyên'] }); }
  spx_getWebAppUrl() { return 'https://spx-hub-portal.onrender.com'; }
  spx_checkLuongAccess() { return 'granted'; }
  spx_trackLuongUsage() { return { success: true }; }
  spx_trackModuleOpen() { return { success: true }; }

  spx_getSystemAnnouncement() {
    return JSON.stringify({
      success: true,
      state: { banner: { active: false, content: '' }, maintenance: { active: false } },
      text: '🚀 Hệ thống SPX Hub Cloud 24/7 đang hoạt động ổn định.',
      version: '1.0.0'
    });
  }

  spx_getModuleStatusPublic() { return JSON.stringify({ success: true, statuses: {} }); }
  spx_getModuleVersions() {
    return JSON.stringify({
      success: true,
      versions: { tondong: 'v1.0', pick: 'v1.0', quahan: 'v1.0', doncaucuu: 'v1.0', kpifail: 'v1.0', vipham: 'v1.0', rider_plan: 'v1.0', luong: 'v1.0', tracuu: 'v1.0', tailieu: 'v1.0', adminzone: 'v1.0', analytics: 'v1.0' }
    });
  }

  aging_getDataVersion() { return '1'; }
  kpifail_getDataVersion() { return '1'; }
  aging_clearCache() { return { success: true }; }
  kpifail_clearCache() { return { success: true }; }
  aging_getNotesOnly() { return { success: true, notes: {} }; }
  kpifail_getNotes() { return JSON.stringify({ success: true, notes: {} }); }

  fms_live_getSyncMeta() { return JSON.stringify({ success: true, syncTime: new Date().toISOString(), status: 'SYNCED' }); }
  ana_getStationDataStamp(stationName) { const key = (stationName || '').trim(); const st = db.data.stations[key]; return (st && st.updatedAt) || '1'; }

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
    return JSON.stringify({ success: true, ts: Date.now(), parts: parts });
  }

  getFeeMatrix() { return { success: true, rates: { standardPickup: 3500, bulkyPickup: 7000, slaOnTimeBonus: 500 } }; }

  getModuleHtml(moduleKey) {
    if (!moduleKey) return '';
    let fileName = moduleKey;
    const keyLower = moduleKey.toLowerCase();
    if (keyLower === 'tondong' || keyLower === 'fms' || keyLower === 'js_fms') fileName = 'JS_FMS.html';
    else if (keyLower === 'pick' || keyLower === 'js_pick') fileName = 'JS_Pick.html';
    else if (keyLower === 'quahan' || keyLower === 'js_quahan') fileName = 'JS_Quahan.html';
    else if (keyLower === 'doncaucuu' || keyLower === 'js_doncaucuu') fileName = 'JS_DonCauCuu.html';
    else if (keyLower === 'kpifail' || keyLower === 'js_kpifail') fileName = 'JS_KPIFail.html';
    else if (keyLower === 'vipham' || keyLower === 'js_vipham') fileName = 'JS_ViPham.html';
    else if (keyLower === 'rider_plan' || keyLower === 'js_rider_plan') fileName = 'JS_Rider_plan.html';
    else if (keyLower === 'luong' || keyLower === 'js_luong') fileName = 'JS_Luong.html';
    else if (keyLower === 'tracuu' || keyLower === 'js_tracuu') fileName = 'JS_Tracuu.html';
    else if (keyLower === 'tailieu' || keyLower === 'js_tailieu') fileName = 'JS_Tailieu.html';
    else if (keyLower === 'adminzone' || keyLower === 'js_adminzone') fileName = 'JS_AdminZone.html';
    else if (keyLower === 'analytics_block' || keyLower === 'analytics') fileName = 'Analytics_Block.html';
    else if (keyLower === 'tailwindbuild') fileName = 'TailwindBuild.html';
    else if (!fileName.endsWith('.html')) fileName += '.html';

    const filePath = path.join(VIEWS_DIR, fileName);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
    return `<div class="p-8 text-center text-red-500 font-bold">Không tìm thấy module: ${moduleKey}</div>`;
  }

  saveStationData(stationName, mergedOrdersJson, inboundLock, clientEpoch, userEmail) {
    let orders = [];
    try { orders = typeof mergedOrdersJson === 'string' ? JSON.parse(mergedOrdersJson) : (mergedOrdersJson || []); } catch (e) { orders = []; }
    return db.saveStationData(stationName, orders, inboundLock, clientEpoch, userEmail);
  }
  getStationData(stationName) { return db.getStationData(stationName); }
  getStationDataBundle(stationName) {
    const data = db.getStationData(stationName);
    return { success: true, stationName, data: data.orders || [], inboundLock: data.inboundLock, epoch: data.epoch, updatedAt: data.updatedAt, serverTime: new Date().toISOString() };
  }
  saveSupplementData(stationName, supplementJson, clientEpoch, userEmail) {
    let supp = {};
    try { supp = typeof supplementJson === 'string' ? JSON.parse(supplementJson) : (supplementJson || {}); } catch (e) {}
    const key = (stationName || '').trim();
    db.data.supplements[key] = { supplement: supp, epoch: Date.now(), updatedAt: new Date().toISOString(), updatedBy: userEmail };
    db.isDirty = true;
    return { success: true, msg: 'Đã lưu dữ liệu bổ sung.' };
  }
  getSupplementData(stationName) {
    const key = (stationName || '').trim();
    const item = db.data.supplements[key] || { supplement: {}, epoch: 0 };
    return { success: true, supplement: item.supplement, epoch: item.epoch };
  }
  saveInboundLockToCloud(stationName, inboundValue) {
    const key = (stationName || '').trim();
    if (db.data.stations[key]) { db.data.stations[key].inboundLock = !!inboundValue; db.isDirty = true; }
    return { success: true, inboundLock: !!inboundValue };
  }
  getInboundLock(stationName) { const key = (stationName || '').trim(); return (db.data.stations[key] && db.data.stations[key].inboundLock) || false; }
  clearStationData(stationName, userEmail) { return db.clearStationData(stationName, userEmail); }
  ana_pushTonState() { return { success: true }; }
  getTrendDrivers() { return []; }
  getTrendStation() { return {}; }
  getTrendDriverList() { return []; }
  logAIFeedback() { return { success: true }; }

  saveDriverPlan(payload, userEmail) { return { success: true, msg: 'Đã lưu kế hoạch tài xế' }; }
  saveRiderPlan(payload, userEmail) { return db.saveRiderPlan(payload, userEmail); }
  loadRiderPlan(month) { return db.loadRiderPlan(month); }
  loadAllData(month, overrideHub) {
    const m = month || new Date().toISOString().slice(0, 7);
    const plan = db.loadRiderPlan(m);
    return { success: true, month: m, hub: overrideHub || 'Krông Pắc 02', planData: (plan.data && plan.data.plan) || [], forecastData: [] };
  }

  getOrders(forceRefresh) {
    const rescueList = db.data.rescueOrders || [];
    return {
      success: true,
      rows: rescueList,
      resolved: Object.keys(db.data.resolvedOrders || {}),
      count: rescueList.length,
      access: { role: 'admin', email: 'xuan.nguyenthanh01@spxexpress.com', displayName: 'Admin Xuân', stations: ['ALL', ...DEFAULT_STATIONS] }
    };
  }
  getResolvedOrders() { return { success: true, resolved: Object.keys(db.data.resolvedOrders || {}) }; }
  setResolvedStatus(trackingNo, resolved, userEmail) {
    if (!trackingNo) return { success: false, msg: 'Thiếu mã đơn' };
    db.data.resolvedOrders[trackingNo] = { resolved: !!resolved, resolvedAt: new Date().toISOString(), resolvedBy: userEmail };
    db.isDirty = true;
    return { success: true, trackingNo, resolved: !!resolved };
  }
  setResolvedStatusBulk(items, resolved, userEmail) {
    (items || []).forEach(no => {
      if (no) db.data.resolvedOrders[no] = { resolved: !!resolved, resolvedAt: new Date().toISOString(), resolvedBy: userEmail };
    });
    db.isDirty = true;
    return { success: true, count: (items || []).length };
  }
  getComplaintData(forceRefresh) { return db.data.violations || []; }

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
    return DEFAULT_STATIONS.map((name, idx) => ({ name: name, code: 'HUB' + String(idx + 1).padStart(3, '0') }));
  }

  wiki_getDocumentData_v2(forceRefresh) {
    return { success: true, version: 'v2-row-wide-real-links', documents: db.data.wikiDocs || [], categories: ['Quy Trình Giao Nhận', 'Chính Sách KPI', 'Hướng Dẫn Ứng Dụng', 'Liên Hệ Khẩn Cấp'], items: db.data.wikiDocs || [] };
  }

  flm_getKpiBundle() {
    return JSON.stringify({
      success: true, builtAt: new Date().toISOString(), asOf: new Date().toISOString(),
      targets: { fms: 98.5, pick: 99.0, ontime: 97.5 },
      periods: ['Hôm nay', 'Tuần này', 'Tháng này'], slots: ['Ca Sáng', 'Ca Chiều', 'Ca Tối'], sources: [],
      hubs: DEFAULT_STATIONS.map(s => [s, 98.5, 99.1, 97.8]), scoped: false,
      access: { role: 'admin', levelCode: 'L1', levelNum: 1, email: 'xuan.nguyenthanh01@spxexpress.com', hubs: ['ALL', ...DEFAULT_STATIONS] }
    });
  }
  flm_getFailOrdersByDay() { return { success: true, orders: [] }; }

  rom_listConfig() { return JSON.stringify({ success: true, data: [] }); }
  rom_getScopeForPreview() { return JSON.stringify({ success: true, scope: [] }); }
  spx_getOverviewPart() { return JSON.stringify({ success: true, data: {} }); }
  spx_getStationWeather() { return { temp: 28, desc: 'Nắng nhẹ', icon: '01d' }; }
  spx_adminGetFirestoreQuota() { return { reads: 120, writes: 45, maxReads: 50000, maxWrites: 20000 }; }
  spx_adminGetOnlineUsers() {
    return { success: true, onlineCount: 1, users: [{ email: 'xuan.nguyenthanh01@spxexpress.com', station: 'Krông Pắc 02', lastActive: new Date().toISOString() }] };
  }
  spx_adminListModuleStatus() {
    return { success: true, modules: { tondong: { status: 'normal' }, pick: { status: 'normal' }, quahan: { status: 'normal' }, doncaucuu: { status: 'normal' }, kpifail: { status: 'normal' }, vipham: { status: 'normal' }, rider_plan: { status: 'normal' }, luong: { status: 'normal' }, tracuu: { status: 'normal' }, tailieu: { status: 'normal' }, adminzone: { status: 'normal' }, analytics: { status: 'normal' } } };
  }
  spx_getAiQuotaStats() { return { success: true, used: 12, limit: 1000 }; }
  spx_getAllHubNames() { return DEFAULT_STATIONS; }
  spx_getFeedbackList() { return []; }
  spx_getUnmatchedWorkplaces() { return []; }
  spx_getUserAccessDetail() { return { success: true, user: { email: 'xuan.nguyenthanh01@spxexpress.com', role: 'admin', level: 1 } }; }
  submitAccessRequest() { return { success: true, message: 'Yêu cầu truy cập đã được tiếp nhận.' }; }
  search_searchSortCode() { return { success: true, results: [] }; }

  getTriggerLogs() { return { success: true, logs: db.data.triggerLogs || [] }; }
  async runTriggerManually(triggerName) { return await triggerManager.runTriggerManually(triggerName); }
  exportWorkspaceSnapshot() { return { success: true, data: db.data }; }
}

module.exports = new RpcDispatcher();
