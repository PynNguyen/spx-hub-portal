const path = require('path');
const fs = require('fs');

class RPCDispatcher {
  constructor() {
    this.hubs = [];
    this.loadHubs();

    // Map methods
    this.getOrders = this.getRescueOrders.bind(this);
    this.rq_getOrders = this.getRescueOrders.bind(this);
    this.flm_getKpiBundle = this.getKpiBundle.bind(this);
    this.flm_getDailyStationKpi = this.getKpiBundle.bind(this);
    this.kpifail_getMasterDataLite = this.getMasterDataLite.bind(this);
    this.flm_getFailOrdersByDay = this.getFailOrdersByDay.bind(this);
    this.kpifail_getNotes = this.getNotes.bind(this);
    this.vp_getData = this.getComplaintData.bind(this);
    this.getComplaintData = this.getComplaintData.bind(this);
    this.getHubList = this.getHubsList.bind(this);
    this.auth_getHubs = this.getHubsList.bind(this);
    this.spx_getOverviewPart = this.getOverviewPart.bind(this);
    this.spx_getHeartbeat = this.getHeartbeat.bind(this);

    // Tra cứu autocomplete handlers
    this.tracuu_getAllWards = this.getAllWards.bind(this);
    this.tracuu_getAllHubs = this.getAllHubs.bind(this);

    // Rider Plan Data Handlers
    this.loadAllData = this.loadRiderPlanAllData.bind(this);
    this.loadForecastData = this.loadRiderPlanForecastData.bind(this);
    this.getModuleHtml = this.getModuleHtml.bind(this);
    this.spx_getModuleVersions = this.getModuleVersions.bind(this);
  }

  loadHubs() {
    try {
      const hubsPath = path.join(__dirname, '../data/standard_hubs.json');
      if (fs.existsSync(hubsPath)) {
        const raw = fs.readFileSync(hubsPath, 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        this.hubs = Array.isArray(parsed) ? parsed.map(h => typeof h === 'string' ? h : (h.name || h.station || String(h))) : [];
      }
    } catch (e) {
      this.hubs = [];
    }
    if (!this.hubs || this.hubs.length === 0) {
      this.hubs = ["45-DLK Krong Pak 02 Hub", "31-NAN Anh Son 02 Hub", "47-DKG Dak RLap 03 Hub", "47-DKG Dak Glong Hub"];
    }
  }

  async dispatch(action, payload = [], userEmail = '') {
    if (typeof action === 'object' && action !== null) {
      payload = action.args || action.payload || [];
      action = action.action || action.method;
    }
    if (!Array.isArray(payload)) {
      payload = payload !== undefined && payload !== null ? [payload] : [];
    }

    if (typeof this[action] === 'function') {
      return await this[action](...payload);
    }
    if (action === 'getModuleHtml') return this.getModuleHtml(...payload);
    if (action === 'spx_getModuleVersions') return this.getModuleVersions();
    if (action === 'tracuu_getAllWards') return this.getAllWards();
    if (action === 'tracuu_getAllHubs') return this.getAllHubs();
    if (action === 'loadAllData') return this.loadRiderPlanAllData(...payload);
    if (action === 'loadForecastData') return this.loadRiderPlanForecastData(...payload);
    if (action === 'spx_getOverviewPart') return this.getOverviewPart(...payload);
    if (action === 'kpifail_getMasterDataLite') return this.getMasterDataLite(...payload);
    if (action === 'flm_getKpiBundle') return this.getKpiBundle();
    if (action === 'getOrders' || action === 'rq_getOrders') return this.getRescueOrders(...payload);
    if (action === 'flm_getFailOrdersByDay') return this.getFailOrdersByDay(...payload);
    if (action === 'kpifail_getNotes') return this.getNotes();
    if (action === 'spx_getHeartbeat') return this.getHeartbeat();
    if (action.startsWith('rp_')) return this.rp_checkAccess(userEmail);
    if (action.startsWith('vp_') || action === 'getComplaintData') return this.getComplaintData(...payload);

    return JSON.stringify({ success: true, data: [] });
  }

  getHubsList() {
    return this.hubs;
  }

  getAllHubs() {
    return this.hubs.map(h => ({
      name: h,
      code: h.slice(0, 6)
    }));
  }

  getAllWards() {
    return [
      { ward: 'Thị trấn Phước An', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Z-DLK-01' },
      { ward: 'Xã Ea Kly', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Z-DLK-02' },
      { ward: 'Xã Ea Phê', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Z-DLK-03' },
      { ward: 'Xã Ea Kuăng', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Z-DLK-04' },
      { ward: 'Xã Krông Búk', station: '45-DLK Krong Pak 02 Hub', zoneId: 'Z-DLK-05' }
    ];
  }

  getModuleHtml(viewName) {
    const viewsDir = path.join(__dirname, '../public/views');
    let target = String(viewName || '').trim();
    if (!target.endsWith('.html')) target += '.html';
    const filePath = path.join(viewsDir, target);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      const includeRegex = /<\?!(?:=)?\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g;
      content = content.replace(includeRegex, (match, fileName) => {
        let inc = fileName.trim();
        if (!inc.endsWith('.html')) inc += '.html';
        let incPath = path.join(viewsDir, inc);
        return fs.existsSync(incPath) ? fs.readFileSync(incPath, 'utf8') : '';
      });
      return content;
    }
    return `<div class="p-6 text-red-500 font-bold">Không tìm thấy giao diện module: ${viewName}</div>`;
  }

  getModuleVersions() {
    return JSON.stringify({
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
    });
  }

  // ==========================================================
  // 1. TỔNG QUAN — spx_getOverviewPart
  // ==========================================================
  getOverviewPart(part = 'aging', hub = '45-DLK Krong Pak 02 Hub', force = false) {
    const isKrongPak = String(hub).includes('Krong Pak 02') || String(hub).includes('45-DLK');
    let partData = {};

    if (part === 'aging') {
      partData = {
        overdueCount: 0,
        closedLostCount: 0,
        otherFlaggedCount: 0
      };
    } else if (part === 'kpifail') {
      partData = {
        totalFM: isKrongPak ? 1 : 2,
        totalLM: isKrongPak ? 1 : 1,
        totalSOP: 0,
        fm: isKrongPak ? 1 : 2,
        lm: isKrongPak ? 1 : 1,
        sop: 0
      };
    } else if (part === 'rescue') {
      partData = {
        redCount: 0
      };
    } else if (part === 'violation') {
      partData = {
        noTicketCount: isKrongPak ? 128 : 45
      };
    } else if (part === 'riderplan') {
      partData = {
        missingCount: 0,
        single: {
          entered: true,
          inbound: isKrongPak ? 1725 : 1450,
          fc: isKrongPak ? 1836 : 1500,
          pct: isKrongPak ? 94 : 97,
          riders: 28,
          ridersFc: 28
        }
      };
    }

    return JSON.stringify({
      success: true,
      data: partData,
      generatedAt: Date.now()
    });
  }

  getHeartbeat() {
    return JSON.stringify({
      success: true,
      timestamp: Date.now(),
      asOf: '2026-10-28',
      modules: {
        kpifail: { status: 'normal' },
        doncaucuu: { status: 'normal' },
        vipham: { status: 'normal' },
        rider_plan: { status: 'normal' }
      }
    });
  }

  // ==========================================================
  // 2. KPI MODULE — flm_getKpiBundle & kpifail_getMasterDataLite
  // (Khớp 100% Hệ thống thật Hình 4)
  // ==========================================================
  getKpiBundle() {
    // 22 ngày hiển thị theo cột từ 07/10 đến 28/10
    const dates = [
      '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
      '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21',
      '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26',
      '2026-10-27', '2026-10-28'
    ];

    // Số liệu sản lượng thực tế trạm Krông Pắc 02 theo ngày (Hình 4)
    const kpVols = [1600, 1741, 1557, 1655, 1547, 2346, 2006, 2019, 2039, 1635, 1829, 1769, 1641, 1288, 1470, 1559, 1549, 1422, 1504, 1431, 1344, 1355];
    const kpSucs = [0.850, 0.857, 0.834, 0.876, 0.837, 0.895, 0.914, 0.910, 0.886, 0.866, 0.859, 0.862, 0.851, 0.828, 0.877, 0.861, 0.862, 0.897, 0.885, 0.828, 0.875, 0.799];
    const kpLms  = [1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 0.997, 0.999, 0.999, 1.000, 0.998, 0.999, 0.999, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 0.999];
    const kpFms  = [1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 0.993, 0.950, 1.000, 1.000, 0.993, 1.000, 1.000, 1.000, 1.000, 1.000, 0.994, 1.000, 1.000, 1.000];

    const hubEntries = this.hubs.map((hItem, hIdx) => {
      const hubName = typeof hItem === 'string' ? hItem : (hItem.name || String(hItem));
      const isKrongPak = hubName.includes('Krong Pak 02') || hubName.includes('45-DLK');

      const daily = dates.map((dateStr, dIdx) => {
        let vol, sucPct, lmPct, fmPct, sopErr = 0, sopTot = 100;

        if (isKrongPak) {
          vol = kpVols[dIdx];
          sucPct = kpSucs[dIdx];
          lmPct = kpLms[dIdx];
          fmPct = kpFms[dIdx];
          if (dateStr === '2026-10-18') {
            sopErr = 2;
            sopTot = 56; // 3.57% Sai SOP
          }
        } else {
          vol = 1400 + (dIdx * 37) % 500;
          sucPct = 0.85;
          lmPct = 0.998;
          fmPct = 0.997;
        }

        const duocGiao = vol;
        const daGiao = Math.round(duocGiao * sucPct);
        const lmDat = Math.round(duocGiao * lmPct);
        const lmTong = duocGiao;
        const fmDat = Math.round(duocGiao * fmPct);
        const fmTong = duocGiao;

        return [fmDat, fmTong, lmDat, lmTong, sopErr, sopTot, daGiao, duocGiao];
      });

      // Lũy kế tháng Krông Pắc: 44.570 đơn, 38.464 đã giao (86.3%), FM 99.3%, LM 99.9%, SOP 0.08%
      const mtdVol = isKrongPak ? 44570 : 35000;
      const mtdDaGiao = isKrongPak ? 38464 : 30000;
      const mtdFmDat = isKrongPak ? Math.round(mtdVol * 0.993) : Math.round(mtdVol * 0.99);
      const mtdLmDat = isKrongPak ? Math.round(mtdVol * 0.999) : Math.round(mtdVol * 0.99);
      const mtdSopErr = isKrongPak ? 2 : 1;
      const mtdSopTot = isKrongPak ? 2500 : 2000;

      const monthly = [[mtdFmDat, mtdVol, mtdLmDat, mtdVol, mtdSopErr, mtdSopTot, mtdDaGiao, mtdVol]];
      const weekly = [[mtdFmDat, mtdVol, mtdLmDat, mtdVol, mtdSopErr, mtdSopTot, mtdDaGiao, mtdVol]];

      return [
        hubName,
        hubName.slice(0, 6),
        isKrongPak ? 'Trần Hữu Danh' : `AOM ${(hIdx % 4) + 1}`,
        isKrongPak ? 'Trương Lê Uy Trí' : `SUP ${(hIdx % 8) + 1}`,
        daily,
        weekly,
        monthly
      ];
    });

    return JSON.stringify({
      success: true,
      builtAt: new Date().toISOString(),
      asOf: '2026-10-28',
      targets: { fm: 0.99, lm: 0.99, sopMax: 0.005 },
      periods: {
        d: dates,
        w: ['2026-W40', '2026-W41', '2026-W42', '2026-W43'],
        m: ['2026-10']
      },
      sources: {
        FM: { lastDate: '2026-10-28' },
        LM: { lastDate: '2026-10-28' },
        SOP: { lastDate: '2026-10-28' },
        SUC: { lastDate: '2026-10-28' }
      },
      hubs: hubEntries,
      access: {
        role: 'lead',
        levelCode: 'L4',
        levelNum: 4,
        email: 'xuan.nguyenthanh01@spxexpress.com',
        hubs: ['ALL', ...this.hubs]
      }
    });
  }

  // Danh sách 2 đơn không đạt KPI thật của trạm Krông Pắc (Khớp 100% Hình 4)
  getMasterDataLite(hub = '45-DLK Krong Pak 02 Hub', days = 31) {
    const isKrongPak = String(hub).includes('Krong Pak 02') || String(hub).includes('45-DLK');
    const records = [
      {
        id: 'SPXVN06139221025A',
        hub: hub || '45-DLK Krong Pak 02 Hub',
        category: 'LM',
        type: 'late lm',
        reason: 'chiều hoàn',
        date: '2026-10-28',
        riderId: 'Rider 110',
        status: 'Chưa có'
      },
      {
        id: 'SPXVN06976485056A',
        hub: hub || '45-DLK Krong Pak 02 Hub',
        category: 'FM',
        type: 'late fm',
        reason: 'FM - Lỗi xe tuyến',
        delayHours: 6.6,
        date: '2026-10-25',
        riderId: 'Rider 108',
        status: 'Chưa có'
      }
    ];

    return JSON.stringify({
      success: true,
      records: records
    });
  }

  getFailOrdersByDay(payloadStr = '{}') {
    return JSON.stringify({
      success: true,
      page: 1,
      total: 2,
      rows: [
        { id: 'SPXVN06139221025A', hub: '45-DLK Krong Pak 02 Hub', category: 'LM', type: 'late lm', reason: 'LM trễ - chiều hoàn', date: '2026-10-28', rider: 'Rider 110' },
        { id: 'SPXVN06976485056A', hub: '45-DLK Krong Pak 02 Hub', category: 'FM', type: 'late fm', reason: 'FM - Lỗi xe tuyến - trễ 6.6 giờ', date: '2026-10-25', rider: 'Rider 108' }
      ]
    });
  }

  getNotes() {
    return JSON.stringify({ success: true, notes: {} });
  }

  // ==========================================================
  // 3. ĐƠN CẦU CỨU — getOrders
  // ==========================================================
  getRescueOrders(force = false) {
    return {
      success: true,
      resolved: [],
      access: {
        role: 'admin',
        stations: ['ALL', ...this.hubs],
        email: 'xuan.nguyenthanh01@spxexpress.com'
      },
      rows: []
    };
  }

  // ==========================================================
  // 4. VI PHẠM — Trả về đúng Mảng (Array) 128 vụ (Khớp Hình 2 & Tổng quan)
  // ==========================================================
  getComplaintData() {
    const list = [];
    for (let i = 1; i <= 128; i++) {
      const d = (i % 28) + 1;
      const dateStr = `2026-10-${String(d).padStart(2, '0')}`;
      list.push({
        case_id: `VP-202610-${1000 + i}`,
        case_create_date: dateStr,
        case_create_time: `${dateStr} 09:30:00`,
        station_name: '45-DLK Krong Pak 02 Hub',
        station: '45-DLK Krong Pak 02 Hub',
        driver_name: `Tài xế Krông Pắc ${(i % 20) + 1}`,
        driver_id: `808${String(i).padStart(2, '0')}`,
        type: i % 3 === 0 ? 'Shopee' : (i % 2 === 0 ? 'Non-Shopee' : 'Logistics'),
        category: i % 4 === 0 ? 'Thái độ giao hàng' : (i % 4 === 1 ? 'Giao trễ hẹn' : (i % 4 === 2 ? 'Không liên hệ' : 'Thất lạc hàng')),
        reason: 'Khách hàng phản ánh tiến độ giao hàng',
        ticket_id: '', // Chưa gắn ticket -> Khớp 128 vụ chưa xử lý
        status: 'Chờ xử lý'
      });
    }
    return list;
  }

  // ==========================================================
  // 5. RIDER PLAN — Đầy đủ 31 ngày (Khớp Inbound 1.725 / FC 1.836 94%)
  // ==========================================================
  loadRiderPlanAllData(monthStr = '2026-10', hub = '45-DLK Krong Pak 02 Hub') {
    const targetHub = hub || '45-DLK Krong Pak 02 Hub';
    const dates = [];
    const forecastRows = [];

    for (let d = 1; d <= 31; d++) {
      const dateStr = `2026-10-${String(d).padStart(2, '0')}`;
      dates.push(dateStr);

      const isInboundToday = d === 29;
      forecastRows.push({
        station: targetHub,
        date: dateStr,
        inbound: isInboundToday ? 1725 : 1600 + (d * 17) % 250,
        forecast: isInboundToday ? 1836 : 1700 + (d * 19) % 200,
        fc: isInboundToday ? 1836 : 1700 + (d * 19) % 200,
        pct: isInboundToday ? 94 : 95,
        lm: 1650,
        fm: 75,
        riders_plan: 28,
        target: 65
      });
    }

    const riders = [];
    for (let r = 1; r <= 28; r++) {
      riders.push({
        name: `Rider ${String(r).padStart(2, '0')} - Krông Pắc`,
        id: `R808${String(r).padStart(2, '0')}`,
        days: Array(31).fill(true)
      });
    }

    const planData = {};
    planData[targetHub] = {
      riders: riders,
      inbound: 1725,
      fc: 1836,
      pct: 94
    };

    const driversData = {};
    driversData[targetHub] = riders.map(r => ({ name: r.name, driver: r.name }));

    return {
      success: true,
      access: {
        role: 'admin',
        level: 'L1',
        email: 'xuan.nguyenthanh01@spxexpress.com',
        hubs: ['ALL', targetHub, ...this.hubs]
      },
      forecast: {
        success: true,
        rows: forecastRows,
        dates: dates
      },
      plan: {
        success: true,
        data: planData
      },
      drivers: {
        success: true,
        data: driversData
      }
    };
  }

  loadRiderPlanForecastData(monthStr = '2026-10') {
    const rows = [];
    for (let d = 1; d <= 31; d++) {
      rows.push({
        station: '45-DLK Krong Pak 02 Hub',
        date: `2026-10-${String(d).padStart(2, '0')}`,
        inbound: d === 29 ? 1725 : 1600,
        forecast: d === 29 ? 1836 : 1700,
        fc: d === 29 ? 1836 : 1700,
        pct: d === 29 ? 94 : 95,
        riders_plan: 28,
        target: 65
      });
    }
    return { success: true, rows };
  }

  rp_checkAccess(email = '') {
    return {
      success: true,
      allowed: true,
      isAdmin: true,
      role: 'admin',
      level: 1,
      email: email || 'xuan.nguyenthanh01@spxexpress.com',
      permissions: ['view', 'edit', 'admin', 'export']
    };
  }
}

const defaultInstance = new RPCDispatcher();

function DispatcherExport(...args) {
  return new RPCDispatcher(...args);
}
Object.setPrototypeOf(DispatcherExport, defaultInstance);
Object.assign(DispatcherExport, defaultInstance);
DispatcherExport.prototype = RPCDispatcher.prototype;
DispatcherExport.RPCDispatcher = RPCDispatcher;
DispatcherExport.dispatch = defaultInstance.dispatch.bind(defaultInstance);

module.exports = DispatcherExport;
