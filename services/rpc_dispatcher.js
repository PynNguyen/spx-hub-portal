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

const VIEWS_DIR = path.join(__dirname, '..', 'public', 'views');

// Danh sách trạm mặc định tại khu vực Đắk Lắk & Tây Nguyên
const DEFAULT_STATIONS = [
  'Krông Pắc 02',
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
    return {
      allowed: true,
      email: userEmail,
      name: 'Admin Xuân (SPX Krông Pắc 02)',
      role: 'ADMIN_1',
      level: 1,
      isRootAdmin: true,
      stations: ['ALL', ...DEFAULT_STATIONS],
      stationList: DEFAULT_STATIONS,
      defaultStation: 'Krông Pắc 02',
      serverMode: 'LOCAL_MULTI_USER'
    };
  }

  getCurrentUserAccess(userEmail) {
    return this.checkUserAccess(userEmail);
  }

  checkAnalyticsPermission(userEmail) {
    return {
      allowed: true,
      email: userEmail,
      role: 'ADMIN_1',
      stations: ['ALL', ...DEFAULT_STATIONS]
    };
  }

  spx_listAllUserAccess() {
    return {
      success: true,
      users: db.data.userPermissions,
      adminRoles: db.data.adminRoles,
      stations: DEFAULT_STATIONS
    };
  }

  getModuleAccess() {
    return {
      success: true,
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
        adminzone: true
      }
    };
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

    // Chuẩn hóa tên file view
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
    else if (keyLower === 'analytics_block') fileName = 'Analytics_Block.html';
    else if (keyLower === 'tailwindbuild') fileName = 'TailwindBuild.html';
    else if (!fileName.endsWith('.html')) fileName += '.html';

    const filePath = path.join(VIEWS_DIR, fileName);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }

    console.warn(`File view not found: ${filePath}`);
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

  // ============================================================
  // 4. RIDER PLAN & FORECAST (Save / Load)
  // ============================================================
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
    return {
      success: true,
      rows: db.data.rescueOrders || [],
      resolved: db.data.resolvedOrders || {},
      count: (db.data.rescueOrders || []).length
    };
  }

  getResolvedOrders() {
    return {
      success: true,
      resolved: db.data.resolvedOrders || {}
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

  // ============================================================
  // 6. TRIGGER LOGS & MANUAL TRIGGER EXECUTION
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

  // ============================================================
  // 7. EXPORT WORKSPACE DATABASE
  // ============================================================
  exportWorkspaceSnapshot() {
    return {
      success: true,
      data: db.data
    };
  }
}

module.exports = new RpcDispatcher();
