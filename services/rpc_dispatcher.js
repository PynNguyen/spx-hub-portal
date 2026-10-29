const path = require('path');
const fs = require('fs');

class RPCDispatcher {
  constructor() {
    this.hubs = [];
    this.loadHubs();

    // Ánh xạ phương thức RPC gọi từ client
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
    if (action.startsWith('vp_')) return this.getComplaintData(...payload);

    return JSON.stringify({ success: true, data: [] });
  }

  getHubsList() {
    return this.hubs;
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
  // ==========================================================
  getKpiBundle() {
    const dates = [
      '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17',
      '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
      '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'
    ];

    const hubEntries = this.hubs.map((hItem, hIdx) => {
      const hubName = typeof hItem === 'string' ? hItem : (hItem.name || String(hItem));
      const isKrongPak = hubName.includes('Krong Pak 02') || hubName.includes('45-DLK');
      const daily = dates.map(() => [1500, 1500, 1500, 1500, 0, 100, 1300, 1500]);
      return [
        hubName,
        hubName.slice(0, 6),
        isKrongPak ? 'Trần Hữu Danh' : `AOM ${(hIdx % 4) + 1}`,
        isKrongPak ? 'Trương Lê Uy Trí' : `SUP ${(hIdx % 8) + 1}`,
        daily,
        [[45000, 45000, 45000, 45000, 0, 1000, 39000, 45000]],
        [[45000, 45000, 45000, 45000, 0, 1000, 39000, 45000]]
      ];
    });

    return JSON.stringify({
      success: true,
      builtAt: new Date().toISOString(),
      asOf: '2026-10-28',
      targets: { fm: 0.99, lm: 0.99, sopMax: 0.005 },
      periods: { d: dates, w: ['2026-W43'], m: ['2026-10'] },
      sources: {
        FM: { lastDate: '2026-10-28' },
        LM: { lastDate: '2026-10-28' },
        SOP: { lastDate: '2026-10-28' },
        SUC: { lastDate: '2026-10-28' }
      },
      hubs: hubEntries,
      access: {
        role: 'admin',
        levelCode: 'L1',
        levelNum: 1,
        email: 'xuan.nguyenthanh01@spxexpress.com',
        hubs: ['ALL', ...this.hubs]
      }
    });
  }

  getMasterDataLite(hub = '45-DLK Krong Pak 02 Hub', days = 31) {
    const isKrongPak = String(hub).includes('Krong Pak 02') || String(hub).includes('45-DLK');
    let records = [];

    if (isKrongPak) {
      records = [
        {
          id: 'SPXVN06419283711A',
          spxId: 'SPXVN06419283711A',
          hub: hub,
          category: 'FM',
          type: 'late fm',
          reason: 'FM Late - Lấy hàng trễ SLA',
          date: '28/10',
          rider: 'Rider 108',
          status: 'Chưa xử lý'
        },
        {
          id: 'SPXVN06528193822A',
          spxId: 'SPXVN06528193822A',
          hub: hub,
          category: 'LM',
          type: 'late lm',
          reason: 'LM Late - Giao hàng trễ hạn',
          date: '28/10',
          rider: 'Rider 110',
          status: 'Chưa xử lý'
        }
      ];
    } else {
      records = [
        {
          id: 'SPXVN06419283711A',
          spxId: 'SPXVN06419283711A',
          hub: hub,
          category: 'FM',
          type: 'late fm',
          reason: 'FM Late - Lấy hàng trễ SLA',
          date: '28/10',
          rider: 'Rider 108',
          status: 'Chưa xử lý'
        },
        {
          id: 'SPXVN06528193822A',
          spxId: 'SPXVN06528193822A',
          hub: hub,
          category: 'LM',
          type: 'late lm',
          reason: 'LM Late - Giao hàng trễ hạn',
          date: '28/10',
          rider: 'Rider 110',
          status: 'Chưa xử lý'
        }
      ];
    }

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
        { id: 'SPXVN06419283711A', hub: '45-DLK Krong Pak 02 Hub', category: 'FM', type: 'late fm', reason: 'FM Late - Lấy hàng trễ SLA', date: '28/10', rider: 'Rider 108' },
        { id: 'SPXVN06528193822A', hub: '45-DLK Krong Pak 02 Hub', category: 'LM', type: 'late lm', reason: 'LM Late - Giao hàng trễ hạn', date: '28/10', rider: 'Rider 110' }
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
  // 4. VI PHẠM
  // ==========================================================
  getComplaintData() {
    const records = [];
    for (let i = 1; i <= 25; i++) {
      records.push({
        id: `VP-202610-${1000 + i}`,
        station: '45-DLK Krong Pak 02 Hub',
        type: i % 3 === 0 ? 'Shopee' : (i % 2 === 0 ? 'Non-Shopee' : 'Logistics'),
        category: i % 4 === 0 ? 'Thái độ giao hàng' : 'Giao trễ hẹn',
        rider: `Trương Quang Mẫn [80827]`,
        date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        status: i <= 15 ? 'Đã lên vé' : 'Chờ xác nhận'
      });
    }
    return {
      success: true,
      total: 128,
      summary: { logistics: 80, nonShopee: 35, shopee: 13, ticketed: 52 },
      records
    };
  }

  // ==========================================================
  // 5. RIDER PLAN — loadAllData & loadForecastData
  // ==========================================================
  loadRiderPlanAllData(monthStr = '2026-10', hub = '45-DLK Krong Pak 02 Hub') {
    const targetHub = hub || '45-DLK Krong Pak 02 Hub';
    const dates = [];
    for (let d = 1; d <= 31; d++) {
      dates.push(`2026-10-${String(d).padStart(2, '0')}`);
    }

    const riders = [];
    for (let r = 1; r <= 28; r++) {
      riders.push({
        name: `Rider ${String(r).padStart(2, '0')} - Krông Pắc`,
        id: `R${80800 + r}`,
        days: Array(31).fill(true)
      });
    }

    const forecastRows = [
      {
        station: targetHub,
        date: '2026-10-29',
        inbound: 1725,
        forecast: 1836,
        fc: 1836,
        pct: 94,
        lm: 1650,
        fm: 75,
        riders_plan: 28,
        target: 65
      }
    ];

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
    return {
      success: true,
      rows: [
        {
          station: '45-DLK Krong Pak 02 Hub',
          date: '2026-10-29',
          inbound: 1725,
          forecast: 1836,
          fc: 1836,
          pct: 94,
          riders_plan: 28,
          target: 65
        }
      ]
    };
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
