const path = require('path');
const fs = require('fs');

class RPCDispatcher {
  constructor() {
    this.hubs = [];
    this.loadHubs();

    // Bind methods
    this.getOrders = this.getRescueOrders.bind(this);
    this.rq_getOrders = this.getRescueOrders.bind(this);
    this.flm_getKpiBundle = this.getKpiBundle.bind(this);
    this.flm_getDailyStationKpi = this.getKpiBundle.bind(this);
    this.flm_getFailOrdersByDay = this.getFailOrdersByDay.bind(this);
    this.vp_getData = this.getComplaintData.bind(this);
    this.getComplaintData = this.getComplaintData.bind(this);
    this.getHubList = this.getHubsList.bind(this);
    this.auth_getHubs = this.getHubsList.bind(this);
    this.spx_getOverviewPart = this.getOverviewPart.bind(this);
    this.spx_getHeartbeat = this.getHeartbeat.bind(this);
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
    if (action === 'flm_getKpiBundle') return this.getKpiBundle();
    if (action === 'getOrders' || action === 'rq_getOrders') return this.getRescueOrders(...payload);
    if (action === 'flm_getFailOrdersByDay') return this.getFailOrdersByDay(...payload);
    if (action === 'spx_getOverviewPart') return this.getOverviewPart();
    if (action === 'spx_getHeartbeat') return this.getHeartbeat();
    if (action.startsWith('rp_')) return this.rp_checkAccess(userEmail);
    if (action.startsWith('vp_')) return this.getComplaintData(...payload);

    return JSON.stringify({ success: true, data: [] });
  }

  getHubsList() {
    return this.hubs;
  }

  // ==========================================================
  // 1. KPI MODULE — flm_getKpiBundle
  // ==========================================================
  getKpiBundle() {
    const dates = [
      '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17',
      '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
      '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'
    ];

    const kpVols = [1600, 1741, 1557, 1655, 1547, 2346, 2006, 2019, 2039, 1635, 1829, 1769, 1641, 1288, 1470, 1559, 1549, 1422, 1504, 1431, 1344, 1355];
    const kpSucs = [0.850, 0.857, 0.834, 0.876, 0.837, 0.895, 0.914, 0.910, 0.886, 0.866, 0.859, 0.862, 0.851, 0.828, 0.877, 0.861, 0.862, 0.897, 0.885, 0.828, 0.875, 0.799];
    const kpLms  = [1.000, 0.999, 0.999, 0.997, 0.999, 0.997, 0.999, 0.999, 0.999, 1.000, 0.998, 0.999, 0.999, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 0.999, 0.999];
    const kpFms  = [1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 1.000, 0.993, 0.950, 1.000, 1.000, 1.000, 0.993, 1.000, 1.000, 1.000, 1.000, 1.000, 0.994, 1.000, 1.000, 1.000];

    const hubEntries = this.hubs.map((hItem, hIdx) => {
      const hubName = typeof hItem === 'string' ? hItem : (hItem.name || String(hItem));
      const isKrongPak = hubName.includes('Krong Pak 02') || hubName.includes('45-DLK');
      let seed = 0;
      for (let i = 0; i < hubName.length; i++) seed = (seed + hubName.charCodeAt(i)) % 100;

      const daily = dates.map((dateStr, dIdx) => {
        let vol, sucPct, lmPct, fmPct, sopErr = 0, sopTot = 100;

        if (isKrongPak) {
          vol = kpVols[dIdx % kpVols.length];
          sucPct = kpSucs[dIdx % kpSucs.length];
          lmPct = kpLms[dIdx % kpLms.length];
          fmPct = kpFms[dIdx % kpFms.length];
          if (dateStr === '2026-10-18') {
            sopErr = 2;
            sopTot = 56; // 3.57%
          }
        } else {
          vol = Math.round(1100 + ((seed * 17 + dIdx * 29) % 800));
          sucPct = 0.84 + ((seed + dIdx) % 8) * 0.01;
          lmPct = 0.995 + ((seed + dIdx) % 5) * 0.001;
          fmPct = 0.990 + ((seed + dIdx) % 10) * 0.001;
        }

        const duocGiao = vol;
        const daGiao = Math.round(duocGiao * sucPct);
        const lmDat = Math.round(duocGiao * lmPct);
        const lmTong = duocGiao;
        const fmDat = Math.round(duocGiao * fmPct);
        const fmTong = duocGiao;

        return [fmDat, fmTong, lmDat, lmTong, sopErr, sopTot, daGiao, duocGiao];
      });

      const mtdVol = isKrongPak ? 44570 : daily.reduce((a, b) => a + b[7], 0);
      const mtdDaGiao = Math.round(mtdVol * (isKrongPak ? 0.863 : 0.855));
      const mtdFmDat = Math.round(mtdVol * (isKrongPak ? 0.993 : 0.991));
      const mtdLmDat = Math.round(mtdVol * (isKrongPak ? 0.999 : 0.997));
      const mtdSopErr = isKrongPak ? 2 : 5;
      const mtdSopTot = isKrongPak ? 2500 : 3000;

      const monthly = [[mtdFmDat, mtdVol, mtdLmDat, mtdVol, mtdSopErr, mtdSopTot, mtdDaGiao, mtdVol]];
      const weekly = [[mtdFmDat, mtdVol, mtdLmDat, mtdVol, mtdSopErr, mtdSopTot, mtdDaGiao, mtdVol]];

      const aomName = isKrongPak ? 'Trần Hữu Danh' : `AOM Khu Vực ${(hIdx % 4) + 1}`;
      const supName = isKrongPak ? 'Trương Lê Uy Trí' : `SUP Cụm ${(hIdx % 8) + 1}`;

      return [
        hubName,
        hubName.slice(0, 6),
        aomName,
        supName,
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
        role: 'admin',
        levelCode: 'L1',
        levelNum: 1,
        email: 'xuan.nguyenthanh01@spxexpress.com',
        hubs: ['ALL', ...this.hubs]
      }
    });
  }

  // ==========================================================
  // 2. TỔNG QUAN & HEARTBEAT (Tránh lỗi phân tích dữ liệu)
  // ==========================================================
  getOverviewPart() {
    return JSON.stringify({
      success: true,
      data: {
        station: '45-DLK Krong Pak 02 Hub',
        asOf: '2026-10-28',
        kpi: { fm: 99.3, lm: 99.9, sop: 0.08, volume: 44570, deliveryRate: 86.3 },
        rescue: { total: 1, red: 1, orange: 0, green: 0 },
        violations: { total: 180, logistics: 100, nonShopee: 67, shopee: 13, ticketed: 52 }
      }
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
  // 3. ĐƠN CẦU CỨU — getOrders
  // ==========================================================
  getRescueOrders(force = false) {
    const exportTime = new Date(Date.now() - 3600000 * 15.7).toISOString(); // còn 8.3h
    return {
      success: true,
      resolved: [],
      access: {
        role: 'admin',
        stations: ['ALL', ...this.hubs],
        email: 'xuan.nguyenthanh01@spxexpress.com'
      },
      rows: [
        {
          tracking_no: 'SPXVN06639887886A',
          region: 'Central',
          station: '45-DLK Krong Pak 02 Hub',
          station_name: '45-DLK Krong Pak 02 Hub',
          driver: 'TRƯƠNG QUANG MẪN [80827]',
          export_date: exportTime,
          status: 'ĐỎ',
          urgency: 'red',
          level: 'ĐỎ',
          reason: 'Đơn khẩn cấp quá hạn xử lý SLA',
          recipient_name: 'Khách hàng Krông Pắc',
          recipient_phone: '0905123456'
        }
      ]
    };
  }

  getFailOrdersByDay(payloadStr = '{}') {
    return {
      success: true,
      page: 1,
      total: 2,
      rows: [
        { id: 'SPXVN06431408780A', hub: '45-DLK Krong Pak 02 Hub', category: 'SOP', type: 'wrong fm', reason: 'Sai quy trình bắn giao Pickup', date: '18/10', rider: 'Rider 102' },
        { id: 'SPXVN06555409864A', hub: '45-DLK Krong Pak 02 Hub', category: 'SOP', type: 'wrong fm', reason: 'Sai quy trình bắn giao Pickup', date: '18/10', rider: 'Rider 105' }
      ]
    };
  }

  // ==========================================================
  // 4. VI PHẠM & RIDER PLAN
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
      total: 180,
      summary: { logistics: 100, nonShopee: 67, shopee: 13, ticketed: 52 },
      records
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
