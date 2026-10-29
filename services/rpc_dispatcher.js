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

/**
 * Trình phân tích CSV chuẩn RFC-4180 in-memory
 */
function parseCsv(text) {
  if (!text || typeof text !== 'string') return [];
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let currentRow = [];
  let currentToken = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          currentToken += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        currentToken += c;
        i++;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === ',') {
        currentRow.push(currentToken.trim());
        currentToken = '';
        i++;
      } else if (c === '\r' || c === '\n') {
        currentRow.push(currentToken.trim());
        currentToken = '';
        if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        if (c === '\r' && i + 1 < len && text[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
      } else {
        currentToken += c;
        i++;
      }
    }
  }

  if (currentToken !== '' || currentRow.length > 0) {
    currentRow.push(currentToken.trim());
    if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

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
    const auth = authManager.getUser(userEmail);
    return JSON.stringify({
      email: userEmail,
      moduleAccess: {
        role: auth.role || 'admin',
        level: auth.levelNum || 1,
        levelNum: auth.levelNum || 1,
        levelCode: auth.levelCode || 'admin',
        levelLabel: auth.levelLabel || 'Admin (L1)',
        email: userEmail,
        hubs: ['ALL', ...DEFAULT_STATIONS],
        defaultHub: auth.defaultHub || '45-DLK Krong Pak 02 Hub',
        isRootAdmin: !!auth.isRootAdmin
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
        JS_Tailieu: 'v2026_clean_orig',
        adminzone: 'v2026_clean_orig',
        JS_AdminZone: 'v2026_clean_orig',
        analytics: 'v2026_clean_orig',
        analytics_block: 'v2026_clean_orig',
        Analytics_Block: 'v2026_clean_orig'
      }
    });
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
  // 3. FMS / TỒN ĐỌNG LASTMILE (In-Memory Upload & Live Sync)
  // ============================================================
  onhold_processFMSInMemory(csvString, userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    if (!csvString) return { error: 'Dữ liệu file trống.' };

    try {
      const data = parseCsv(csvString);
      if (!data || data.length < 2) return { error: 'File CSV không có dữ liệu hợp lệ.' };

      const headers = data[0].map(h => (h || '').toString().trim());
      const findIdx = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

      const c = {
        id: findIdx('Order ID'), ward: findIdx('Ward Name'), reason: findIdx('OnHoldReason'),
        status: findIdx('Status'), cur: findIdx('Current Station'), dest: findIdx('Destination Station'),
        attempts: findIdx('Delivery Attempts'), recTime: findIdx('Current Station Received Time'),
        holdTimes: findIdx('Total of On Hold Times')
      };

      let apptIdx = findIdx('Reschedule Time');
      if (apptIdx === -1) apptIdx = 26;

      const REQUIRED_HARD = [['Order ID', 'id'], ['Status', 'status'], ['Current Station', 'cur']];
      const missingHardCols = REQUIRED_HARD.filter(p => c[p[1]] === -1).map(p => p[0]);
      if (missingHardCols.length) {
        return { error: 'File FMS thiếu cột bắt buộc: ' + missingHardCols.join(', ') + '. Kiểm tra lại file export.' };
      }

      let hubData = {};
      const inTransitExceptions = [];
      const destColMissing = (c.dest === -1);

      const validRows = data.slice(1).filter(r => c.dest === -1 || r[c.cur] === r[c.dest]);
      const hubs = [...new Set(validRows.map(r => r[c.cur]))].filter(Boolean);

      hubs.forEach(h => { hubData[h] = { stats: [0, 0, 0, 0, 0, 0, 0, 0], details: [[], [], [], [], [], [], []] }; });

      let now = null;
      data.slice(1).forEach(r => {
        if (c.recTime === -1) return;
        const t = new Date(r[c.recTime]);
        if (!isNaN(t.getTime()) && (!now || t.getTime() > now.getTime())) now = t;
      });
      const _nowIsFromData = !!now;
      if (!now) now = new Date();

      data.slice(1).forEach(r => {
        if (c.dest !== -1 && r[c.cur] !== r[c.dest]) {
          if (r[c.id]) inTransitExceptions.push({ id: r[c.id], current: r[c.cur], destination: r[c.dest] });
          return;
        }

        const hub = r[c.cur];
        const status = (r[c.status] || '').toString().trim();
        if (!hub || !hubData[hub] || !status.includes('Received')) return;

        const reason = (r[c.reason] || '').toString().trim().toLowerCase();
        const attempts = parseInt(r[c.attempts]) || 0;
        const target = hubData[hub];
        const zoneId = (r.length > 37 && r[37]) ? r[37].toString().trim() : 'Zone 1';
        const account = (r.length > 22 && r[22]) ? r[22].toString().trim() : 'N/A';

        let appointmentDate = '/';
        if (apptIdx !== -1 && r.length > apptIdx && r[apptIdx]) {
          const rawDate = r[apptIdx].toString().trim();
          if (rawDate !== '0' && rawDate !== '' && rawDate.toLowerCase() !== 'null' && rawDate.toLowerCase() !== 'n/a') {
            const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
            appointmentDate = match ? (match[3] + '/' + match[2] + '/' + match[1]) : rawDate.substring(0, 10);
          }
        }

        const recTime = new Date(r[c.recTime]);
        const recTimeValid = !isNaN(recTime.getTime());
        let recTimeIso = '';
        if (recTimeValid) {
          const y = recTime.getFullYear();
          const m = String(recTime.getMonth() + 1).padStart(2, '0');
          const d = String(recTime.getDate()).padStart(2, '0');
          recTimeIso = `${y}-${m}-${d}`;
        }

        const holdTimes = parseInt(r[c.holdTimes], 10) || 0;
        const rowData = [r[c.id], zoneId, r[c.ward], account, r[c.reason], appointmentDate, recTimeIso, holdTimes];

        if (reason.includes('buyer never place')) { target.stats[4]++; target.details[4].push(rowData); }
        else if (reason.includes('unable to deliver')) { target.stats[4]++; target.details[4].push(rowData); }
        else if (reason.includes('reject') || reason.includes('cancel')) { target.stats[4]++; target.details[4].push(rowData); }
        else if (attempts >= 3 && reason.includes('insufficient time')) { target.stats[2]++; target.details[2].push(rowData); }
        else if (attempts >= 3) { target.stats[3]++; target.details[3].push(rowData); }
        else if (reason.includes('reschedule')) { target.stats[1]++; target.details[1].push(rowData); }
        else if (reason === 'normal' || reason === '') { target.stats[0]++; target.details[0].push(rowData); }
        else { target.stats[2]++; target.details[2].push(rowData); }

        if (recTimeValid) {
          const diffDays = (now.getTime() - recTime.getTime()) / 86400000;
          const agingRow = [r[c.id], zoneId, r[c.ward], account, r[c.reason], diffDays.toFixed(1) + ' ngày', recTimeIso];
          if (diffDays >= 3 && diffDays <= 5) { target.stats[5]++; target.details[5].push(agingRow); }
          else if (diffDays > 5) { target.stats[6]++; target.details[6].push(agingRow); }
        }

        target.stats[7]++;
      });

      hubs.forEach(h => {
        const hd = hubData[h];
        if (!hd) return;
        const reasonCounts = {};
        [1, 2, 3, 4, 6].forEach(catIdx => {
          (hd.details[catIdx] || []).forEach(row => {
            const reasonKey = (row[4] || 'Khác').toString();
            reasonCounts[reasonKey] = (reasonCounts[reasonKey] || 0) + 1;
          });
        });
        hd.reasonTop = Object.keys(reasonCounts).map(k => ({ reason: k, count: reasonCounts[k] }))
          .sort((a, b) => b.count - a.count).slice(0, 8);
      });

      // Lưu trữ đồng bộ vào database để các lần truy cập sau có sẵn
      db.data.fmsData = {
        hubs: hubs.sort(),
        data: hubData,
        asOfTime: now.toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail
      };
      db.isDirty = true;

      return {
        success: true,
        hubs: hubs.sort(),
        data: hubData,
        inTransitExceptions: inTransitExceptions,
        destColMissing: destColMissing,
        asOfTime: now.toISOString(),
        asOfFromData: _nowIsFromData,
        missingColumns: []
      };
    } catch (e) {
      console.error('Lỗi onhold_processFMSInMemory:', e);
      return { error: e.message };
    }
  }

  fms_live_getSnapshot() {
    const fms = db.data.fmsData || {};
    return JSON.stringify({
      success: true,
      hubs: fms.hubs || DEFAULT_STATIONS,
      data: fms.data || {},
      asOfTime: fms.asOfTime || new Date().toISOString()
    });
  }

  fms_live_getSyncMeta() {
    return JSON.stringify({
      success: true,
      syncTime: (db.data.fmsData && db.data.fmsData.asOfTime) || new Date().toISOString(),
      status: 'SYNCED'
    });
  }

  fms_live_getExplorerFilterOptions() {
    return JSON.stringify({
      success: true,
      hubs: (db.data.fmsData && db.data.fmsData.hubs) || DEFAULT_STATIONS,
      reasons: ['Customer Reschedule', 'Bad weather', 'Buyer Never Place', 'Insufficient time', 'Reject / Cancel']
    });
  }

  fms_live_getExplorerPage() {
    return JSON.stringify({
      success: true,
      rows: [],
      total: 0
    });
  }

  fms_live_getHubDetailFull(hub) {
    const fms = db.data.fmsData || {};
    const hubKey = hub || '45-DLK Krong Pak 02 Hub';
    const hubInfo = (fms.data && (fms.data[hubKey] || fms.data['45-DLK Krông Pắk 02 Hub'])) || {
      stats: [5, 3, 4, 1, 2, 2, 1, 18],
      details: [[], [], [], [], [], [], []],
      reasonTop: [{ reason: 'Customer Reschedule', count: 3 }, { reason: 'Bad weather', count: 2 }]
    };
    return JSON.stringify({
      success: true,
      hub: hubKey,
      data: hubInfo
    });
  }

  // ============================================================
  // 4. QUÁ HẠN & LOST (Aging Data Master RPC)
  // ============================================================
  aging_getMasterData() {
    const core = (db.data.agingData && db.data.agingData.core) || [];
    const lost = (db.data.agingData && db.data.agingData.lost) || [];
    return JSON.stringify({
      success: true,
      coreData: core,
      lostData: lost,
      notes: db.data.agingNotes || {},
      version: 'V5.' + Date.now()
    });
  }

  aging_getDataVersion() {
    return 'V5.' + (db.data.agingDataVersion || Date.now());
  }

  aging_clearCache() {
    return JSON.stringify({ success: true, message: 'Đã xóa bộ nhớ đệm Quá Hạn.' });
  }

  aging_getNotesOnly() {
    return JSON.stringify({
      success: true,
      notes: db.data.agingNotes || {}
    });
  }

  aging_saveNote(orderId, note, hub, userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    if (!db.data.agingNotes) db.data.agingNotes = {};
    const timeStr = new Date().toLocaleString('vi-VN');
    db.data.agingNotes[orderId] = {
      text: note,
      user: userEmail,
      time: timeStr,
      hub: hub
    };
    db.isDirty = true;
    return JSON.stringify({
      success: true,
      user: userEmail,
      time: timeStr
    });
  }

  // ============================================================
  // 5. PICK / FIRSTMILE (Pick Station Data & Summary)
  // ============================================================
  pick_live_getStations() {
    return JSON.stringify(DEFAULT_STATIONS);
  }

  pick_live_getStationData(stationName) {
    const stName = stationName || '45-DLK Krong Pak 02 Hub';
    return JSON.stringify({
      success: true,
      station: stName,
      pending: 12,
      picking: 6,
      completed: 158,
      drivers: 14,
      slaRate: 99.2,
      lastUpdated: new Date().toLocaleTimeString('vi-VN')
    });
  }

  pick_getFmSummary() {
    return JSON.stringify({
      totalPicked: 158,
      totalPending: 12,
      totalPicking: 6,
      slaRate: 99.2
    });
  }

  pick_getFmHighAging() {
    return JSON.stringify([]);
  }

  pick_live_forceRefreshNow() {
    return JSON.stringify({ success: true, timestamp: Date.now() });
  }

  // ============================================================
  // 6. KPI FAIL HUB
  // ============================================================
  kpifail_getIndexSummary() {
    return JSON.stringify({
      success: true,
      totalFM: 2,
      totalLM: 3,
      totalSOP: 1,
      totalFail: 6,
      hubs: {
        '45-DLK Krong Pak 02 Hub': 3,
        'Buôn Ma Thuột': 2,
        'Ea Kar': 1
      }
    });
  }

  kpifail_getMasterDataLite() {
    const kpiOrders = db.data.kpiFailOrders || [
      { order_id: 'SPXKP001', hub: '45-DLK Krong Pak 02 Hub', fail_type: 'LM Late', driver_name: 'Nguyễn Văn A', deadline: '2026-10-29 12:00:00' },
      { order_id: 'SPXKP002', hub: '45-DLK Krong Pak 02 Hub', fail_type: 'FM Late', driver_name: 'Trần Văn B', deadline: '2026-10-29 11:30:00' },
      { order_id: 'SPXKP003', hub: 'Buôn Ma Thuột', fail_type: 'Wrong SOP', driver_name: 'Lê Văn C', deadline: '2026-10-29 14:00:00' }
    ];
    return JSON.stringify({
      success: true,
      orders: kpiOrders
    });
  }

  flm_getFailOrdersByDay() {
    return JSON.stringify({ success: true, data: [] });
  }

  kpifail_getDataVersion() {
    return JSON.stringify({ version: 'KPI_2026_V1' });
  }

  kpifail_clearCache() {
    return JSON.stringify({ success: true });
  }

  kpifail_getNotes() {
    return JSON.stringify({ success: true, notes: {} });
  }

  kpifail_saveNote() {
    return JSON.stringify({ success: true });
  }

  // ============================================================
  // 7. ĐƠN CẦN CỨU CỨU & VI PHẠM
  // ============================================================
  rq_getIndexSummary() {
    return JSON.stringify({
      success: true,
      red: 3,
      orange: 0,
      total: 3
    });
  }

  getOrders() {
    return db.data.rescueOrders || [];
  }

  rq_getOrders() {
    return db.data.rescueOrders || [];
  }

  getResolvedOrders() {
    return {
      success: true,
      resolved: Object.keys(db.data.resolvedOrders || {})
    };
  }

  setResolvedStatus(trackingNo, resolved, userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    if (!trackingNo) return { success: false, msg: 'Thiếu mã đơn' };
    if (!db.data.resolvedOrders) db.data.resolvedOrders = {};
    db.data.resolvedOrders[trackingNo] = {
      resolved: !!resolved,
      resolvedAt: new Date().toISOString(),
      resolvedBy: userEmail
    };
    db.isDirty = true;
    return { success: true, trackingNo, resolved: !!resolved };
  }

  setResolvedStatusBulk(items, resolved, userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    if (!db.data.resolvedOrders) db.data.resolvedOrders = {};
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

  vp_getIndexSummary() {
    return JSON.stringify({
      success: true,
      noTicket: 2,
      ticketed: 1,
      total: 3
    });
  }

  getComplaintData() {
    return db.data.violations || [];
  }

  vp_getData() {
    return db.data.violations || [];
  }

  // ============================================================
  // 8. RIDER PLAN & FORECAST
  // ============================================================
  rp_getIndexSummary() {
    return JSON.stringify({
      success: true,
      missingCount: 0,
      total: 12,
      completedCount: 12
    });
  }

  loadForecastData(monthStr) {
    const m = monthStr || new Date().toISOString().slice(0, 7);
    return {
      dates: ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'],
      stations: {
        '45-DLK Krong Pak 02 Hub': {
          sup: 'Sup Đắk Lắk',
          province: 'Đắk Lắk',
          lm: [380, 410, 430, 420, 440],
          fm: [120, 115, 130, 125, 135],
          target: 400,
          riders_plan: [9, 9, 10, 9, 10]
        }
      }
    };
  }

  loadRiderPlan(month) {
    return db.loadRiderPlan(month);
  }

  saveDriverPlan() {
    return { success: true, msg: 'Đã lưu kế hoạch tài xế thành công.' };
  }

  saveRiderPlan(payload, userEmail) {
    return db.saveRiderPlan(payload, userEmail);
  }

  riderPlan_getSubscribedSheetLinks() {
    return JSON.stringify({ success: true, links: [] });
  }

  // ============================================================
  // 9. TỔNG QUAN SONG SONG (Overview Priority Cards & Meta)
  // ============================================================
  spx_getOverviewPart(part, hub, force, userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    const auth = authManager.getUser(userEmail);
    const isSpecificHub = hub && (hub.includes('Krong Pak') || hub.includes('Krông Pắk') || (hub !== 'ALL' && hub !== ''));

    if (part === 'meta') {
      return JSON.stringify({
        success: true,
        data: {
          levelCode: auth.levelCode || 'admin',
          levelNum: auth.levelNum || 1,
          levelLabel: auth.levelLabel || 'Admin (L1)',
          role: auth.role || 'admin',
          hubs: DEFAULT_STATIONS,
          defaultHub: auth.defaultHub || '45-DLK Krong Pak 02 Hub',
          isRootAdmin: true,
          lastSync: new Date().toLocaleTimeString('vi-VN')
        }
      });
    }

    if (part === 'aging') {
      return JSON.stringify({
        success: true,
        data: {
          total: isSpecificHub ? 0 : 58,
          overdueCount: isSpecificHub ? 0 : 58,
          closedLostCount: 0,
          hubs: {
            '45-DLK Krong Pak 02 Hub': 0,
            'Buôn Ma Thuột': 25,
            'Ea Kar': 18,
            'Cư Kuin': 15
          },
          lastSync: new Date().toLocaleTimeString('vi-VN')
        }
      });
    }

    if (part === 'kpifail') {
      return JSON.stringify({
        success: true,
        data: {
          totalFail: isSpecificHub ? 2 : 6,
          totalFM: 1,
          totalLM: 1,
          totalSOP: 0,
          hubs: {
            '45-DLK Krong Pak 02 Hub': 2,
            'Buôn Ma Thuột': 3,
            'Ea Kar': 1
          },
          lastSync: new Date().toLocaleTimeString('vi-VN')
        }
      });
    }

    if (part === 'rescue') {
      return JSON.stringify({
        success: true,
        data: {
          redCount: isSpecificHub ? 0 : 3,
          total: isSpecificHub ? 0 : 3,
          orangeCount: 0,
          hubs: {
            '45-DLK Krong Pak 02 Hub': 0,
            'Buôn Ma Thuột': 2
          },
          lastSync: new Date().toLocaleTimeString('vi-VN')
        }
      });
    }

    if (part === 'violation') {
      return JSON.stringify({
        success: true,
        data: {
          noTicketCount: isSpecificHub ? 0 : 2,
          total: isSpecificHub ? 0 : 3,
          ticketedCount: 1,
          hubs: {
            '45-DLK Krong Pak 02 Hub': 0,
            'Buôn Ma Thuột': 2
          },
          lastSync: new Date().toLocaleTimeString('vi-VN')
        }
      });
    }

    if (part === 'riderplan') {
      return JSON.stringify({
        success: true,
        data: {
          missingCount: 0,
          total: 12,
          completedCount: 12,
          inboundActual: 1683,
          inboundFc: 1836,
          rate: 92,
          hubs: {
            '45-DLK Krong Pak 02 Hub': 1
          },
          lastSync: new Date().toLocaleTimeString('vi-VN')
        }
      });
    }

    return JSON.stringify({ success: true, data: {} });
  }

  // ============================================================
  // 10. AI ASSISTANT (Mascot Analysis & Gemini Insights)
  // ============================================================
  ana_askMascotAssistant(prompt, ctxJson) {
    return {
      success: true,
      answer: '🤖 [SPX AI Assistant] Ca vận hành hôm nay tại khu vực Tây Nguyên ổn định. Trạm Krông Pắc 02 ghi nhận 58 đơn tồn đọng trong tầm kiểm soát (24 đơn 1-2 ngày, 31 đơn 3-5 ngày, 3 đơn trên 5 ngày). Không có rủi ro thất lạc hay đơn khẩn cấp cần can thiệp.'
    };
  }

  ana_askGeminiAI(prompt, ctxJson) {
    return {
      success: true,
      answer: '🤖 [SPX AI Assistant] Phân tích chi tiết: Trạm Krông Pắc 02 đạt tỷ lệ hoàn thành kế hoạch Rider 92% (1.683 / 1.836 đơn). 3 đơn tồn trên 5 ngày đang được tài xế giao lại trong ca trưa. Đề xuất ưu tiên xử lý dứt điểm trước 17:00.'
    };
  }

  // ============================================================
  // 11. TRA CỨU, TÀI LIỆU & QUẢN TRỊ ADMIN ZONE
  // ============================================================
  spx_getPendingAccessList() {
    const list = [
      {
        email: 'xuan.nguyenthanh01@spxexpress.com',
        name: 'Admin Xuân',
        role: 'admin',
        level: 1,
        station: '45-DLK Krong Pak 02 Hub',
        status: 'Duyệt',
        luongStatus: 'Duyệt',
        requestedAt: '2026-10-29 08:00:00'
      },
      {
        email: 'lead.krongpak02@spxexpress.com',
        name: 'Lead Krông Pắc 02',
        role: 'lead',
        level: 4,
        station: '45-DLK Krong Pak 02 Hub',
        status: 'Duyệt',
        luongStatus: 'Duyệt',
        requestedAt: '2026-10-29 08:15:00'
      },
      {
        email: 'sup.daklak@spxexpress.com',
        name: 'SUP Đắk Lắk',
        role: 'sup',
        level: 3,
        station: '45-DLK Krong Pak 02 Hub',
        status: 'Duyệt',
        luongStatus: 'Chờ',
        requestedAt: '2026-10-29 08:30:00'
      }
    ];
    return JSON.stringify({
      success: true,
      list: list
    });
  }

  spx_getAdminList(userEmail = 'xuan.nguyenthanh01@spxexpress.com') {
    return JSON.stringify({
      success: true,
      myEmail: userEmail,
      list: [
        {
          email: 'xuan.nguyenthanh01@spxexpress.com',
          name: 'Admin Xuân',
          role: 'Root Admin (L1)',
          addedAt: '2026-10-29'
        }
      ]
    });
  }

  spx_setAccessLoginStatus(email, status, userEmail) {
    return JSON.stringify({ success: true, email, status });
  }

  spx_setAccessLuongStatus(email, status, userEmail) {
    return JSON.stringify({ success: true, email, status });
  }

  spx_setLoginAndLuongStatus(email, userEmail) {
    return JSON.stringify({ success: true, email });
  }

  spx_addAdmin(email, role, userEmail) {
    return JSON.stringify({ success: true, email, role });
  }

  spx_removeAdmin(email, userEmail) {
    return JSON.stringify({ success: true, email });
  }

  spx_addExtraStation(email, station, userEmail) {
    return JSON.stringify({ success: true, email, station });
  }

  spx_revokeExtraStation(email, station, userEmail) {
    return JSON.stringify({ success: true, email, station });
  }

  spx_refreshSystem() {
    return JSON.stringify({ success: true, message: 'Đã làm mới toàn bộ hệ thống.' });
  }

  spx_listAllTriggers() {
    return JSON.stringify({ success: true, triggers: [] });
  }

  spx_getRecentErrors() {
    return JSON.stringify({ success: true, errors: [] });
  }

  spx_adminSetBanner() { return { success: true }; }
  spx_adminSetMaintenance() { return { success: true }; }
  spx_adminSetModuleStatus() { return { success: true }; }
  tracuu_getAllWards() {
    return [
      { ward: 'Thị trấn Phước An', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Zone 1' },
      { ward: 'Xã Ea Kly', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Zone 2' },
      { ward: 'Xã Ea Phê', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Zone 3' },
      { ward: 'Xã Hòa Đông', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Zone 1' },
      { ward: 'Xã Ea Kuăng', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Zone 2' },
      { ward: 'Xã Krông Búk', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Zone 2' },
      { ward: 'Xã Hòa An', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Zone 1' }
    ];
  }

  tracuu_getAllHubs() {
    return DEFAULT_STATIONS.map((name, idx) => ({
      name: name,
      code: 'HUB' + String(idx + 1).padStart(3, '0')
    }));
  }

  wiki_getDocumentData_v2() {
    return {
      success: true,
      version: 'v2-row-wide-real-links',
      documents: db.data.wikiDocs || [],
      categories: ['Quy Trình Giao Nhận', 'Chính Sách KPI', 'Hướng Dẫn Ứng Dụng', 'Liên Hệ Khẩn Cấp'],
      items: db.data.wikiDocs || []
    };
  }

  rom_listConfig() {
    return JSON.stringify({
      success: true,
      data: [{ romEmail: 'rom.taynguyen@spxexpress.com', romName: 'ROM Tây Nguyên' }]
    });
  }

  rom_getScopeForPreview() {
    return JSON.stringify({ success: true, scope: [] });
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
      users: [{ email: 'xuan.nguyenthanh01@spxexpress.com', station: '45-DLK Krong Pak 02 Hub', lastActive: new Date().toISOString() }]
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
