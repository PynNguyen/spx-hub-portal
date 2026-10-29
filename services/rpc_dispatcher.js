const path = require('path');
const fs = require('fs');

class RPCDispatcher {
  constructor() {
    this.hubs = [];
    this.loadHubs();
    
    // Bind aliases
    this.getOrders = this.getRescueOrders.bind(this);
    this.rq_getOrders = this.getRescueOrders.bind(this);
    this.vp_getData = this.getComplaintData.bind(this);
    this.vp_getComplaintData = this.getComplaintData.bind(this);
    this.flm_getStationKpi = this.flm_getDailyStationKpi.bind(this);
    this.getStationKpi = this.flm_getDailyStationKpi.bind(this);
    this.auth_getHubs = this.getHubList.bind(this);
    this.getStations = this.getHubList.bind(this);
    this.checkRiderPlanAccess = this.rp_checkAccess.bind(this);
  }

  loadHubs() {
    try {
      const hubsPath = path.join(__dirname, '../data/standard_hubs.json');
      if (fs.existsSync(hubsPath)) {
        const raw = fs.readFileSync(hubsPath, 'utf8').replace(/^\uFEFF/, '');
        this.hubs = JSON.parse(raw);
      }
    } catch (e) {
      this.hubs = ["45-DLK Krong Pak 02 Hub", "31-NAN Anh Son 02 Hub", "47-DKG Dak RLap 03 Hub"];
    }
  }

  async dispatch(action, payload = [], session = {}) {
    if (typeof action === 'object' && action !== null) {
      session = payload || {};
      payload = action.args || action.payload || [];
      action = action.action || action.method;
    }
    if (!Array.isArray(payload)) {
      payload = payload !== undefined && payload !== null ? [payload] : [];
    }

    if (typeof this[action] === 'function') {
      return await this[action](...payload);
    }
    if (action.startsWith('flm_')) return this.flm_getDailyStationKpi(payload[0], payload[1]);
    if (action.startsWith('rq_')) return this.getRescueOrders(payload[0]);
    if (action.startsWith('vp_')) return this.getComplaintData(payload[0]);
    if (action.startsWith('rp_')) return this.rp_checkAccess(payload[0]);
    if (action.startsWith('bi_')) return this.bi_getData(payload[0]);
    
    return { success: false, error: `Action ${action} not found` };
  }

  // --- 1. HUBS ---
  async getHubList() {
    return this.hubs.length > 0 ? this.hubs : ["45-DLK Krong Pak 02 Hub"];
  }

  // --- 2. KPI MODULE ---
  async flm_getDailyStationKpi(hub = '45-DLK Krong Pak 02 Hub', month = '10/2026') {
    const isKrongPak = String(hub).includes('Krong Pak 02') || String(hub).includes('45-DLK');
    const dates = [
      '29/10', '28/10', '27/10', '26/10', '25/10', '24/10', '23/10', '22/10', 
      '21/10', '20/10', '19/10', '18/10', '17/10', '16/10', '15/10', '14/10', 
      '13/10', '12/10', '11/10', '10/10', '09/10', '08/10'
    ];
    
    let seed = 0;
    const str = String(hub);
    for (let i = 0; i < str.length; i++) seed = (seed + str.charCodeAt(i)) % 100;
    const volBase = isKrongPak ? 1355 : (1200 + seed * 20);

    const fmDaily = isKrongPak 
      ? [100.0, 100.0, 100.0, 99.4, 100.0, 100.0, 100.0, 100.0, 100.0, 99.3, 100.0, 100.0, 100.0, 95.0, 99.3, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0]
      : dates.map((_, idx) => parseFloat((99.0 + ((seed + idx) % 10) * 0.1).toFixed(1)));

    const lmDaily = isKrongPak 
      ? [99.9, 99.9, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 99.9, 99.9, 99.8, 100.0, 99.9, 99.9, 99.9, 99.7, 99.9, 99.7, 99.9, 99.9, 100.0, 100.0]
      : dates.map((_, idx) => parseFloat((99.5 + ((seed + idx) % 5) * 0.1).toFixed(1)));

    const sopDaily = isKrongPak 
      ? [0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 3.57, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00]
      : dates.map((_, idx) => idx === 10 ? 2.15 : 0.00);

    const deliveryDaily = isKrongPak 
      ? [79.9, 87.5, 82.8, 88.5, 89.7, 86.2, 86.1, 87.7, 82.8, 85.1, 86.2, 85.9, 86.6, 88.6, 91.0, 91.4, 89.5, 83.7, 87.6, 83.4, 85.7, 85.0]
      : dates.map((_, idx) => parseFloat((84.0 + ((seed + idx) % 8)).toFixed(1)));

    const volDaily = isKrongPak 
      ? [1355, 1344, 1431, 1504, 1422, 1549, 1559, 1470, 1288, 1641, 1769, 1829, 1635, 2039, 2019, 2006, 2346, 1547, 1655, 1557, 1741, 1600]
      : dates.map((_, idx) => Math.round(volBase + ((seed * 17 + idx * 31) % 500)));

    const cumulativeVol = isKrongPak ? 44570 : volDaily.reduce((a, b) => a + b, 0);

    const resultData = {
      hub,
      month,
      dates,
      metrics: [
        { name: '% FM đúng hạn', target: '99%', cumulative: isKrongPak ? '99.3%' : '99.1%', daily: fmDaily },
        { name: '% LM đúng hạn', target: '99%', cumulative: isKrongPak ? '99.9%' : '99.7%', daily: lmDaily },
        { name: 'Sai SOP', sub: 'Tỷ lệ trên số đơn lấy hàng', target: '≤ 0.5%', cumulative: isKrongPak ? '0.08%' : '0.12%', daily: sopDaily },
        { name: '% Giao thành công', sub: 'Đã giao / Được giao', target: '—', cumulative: isKrongPak ? '86.3%' : '85.5%', daily: deliveryDaily },
        { name: 'Sản lượng đơn', sub: 'Số đơn được giao', target: '—', cumulative: cumulativeVol.toLocaleString('en-US'), daily: volDaily }
      ],
      unmetOrders: isKrongPak ? [
        { tracking_no: 'SPXVN06431408780A', hub, type: 'Sai SOP', detail: 'wrong fm - Sai quy trình bắn giao Pickup', date: '18/10', note: 'Chưa có' },
        { tracking_no: 'SPXVN06555409864A', hub, type: 'Sai SOP', detail: 'wrong fm - Sai quy trình bắn giao Pickup', date: '18/10', note: 'Chưa có' }
      ] : []
    };

    return { status: 'success', success: true, data: resultData, result: resultData, ...resultData };
  }

  // --- 3. ĐƠN CẦU CỨU ---
  async getRescueOrders(hub = '45-DLK Krong Pak 02 Hub') {
    const isKrongPak = String(hub).includes('Krong Pak 02') || String(hub).includes('45-DLK');
    const orders = isKrongPak ? [
      {
        tracking_no: 'SPXVN06639887886A',
        region: 'Central',
        station: '45-DLK Krong Pak 02 Hub',
        driver: 'TRƯƠNG QUANG MẪN [80827]',
        export_date: '2026-10-29',
        remaining_time: 'Còn 8.3h',
        severity: 'red',
        level: 'ĐỎ',
        muc_do: 'ĐỎ',
        status: 'pending',
        is_resolved: false,
        resolved: false,
        can_resolve: true,
        action: 'Đã xử lý',
        action_text: '✓ Đã xử lý'
      }
    ] : [];

    const resultData = {
      status: 'success',
      success: true,
      total: orders.length,
      red: orders.filter(o => o.severity === 'red' || o.level === 'ĐỎ').length,
      orange: 0,
      green: 0,
      urgent_banner: isKrongPak ? `1 ĐƠN KHẨN CẤP CẦN XỬ LÝ NGAY TẠI ${String(hub).toUpperCase()}` : null,
      orders
    };

    return { ...resultData, data: resultData, result: resultData };
  }

  async rq_markResolved(tracking_no) {
    return { success: true, tracking_no, status: 'resolved' };
  }

  // --- 4. VI PHẠM ---
  async getComplaintData(hub = '45-DLK Krong Pak 02 Hub') {
    const isKrongPak = String(hub).includes('Krong Pak 02') || String(hub).includes('45-DLK');
    const total = isKrongPak ? 180 : 45;
    const logistics = isKrongPak ? 100 : 25;
    const nonShopee = isKrongPak ? 67 : 15;
    const shopee = isKrongPak ? 13 : 5;
    const ticketed = isKrongPak ? 52 : 12;

    const sampleRecords = [];
    for (let i = 1; i <= Math.min(total, 25); i++) {
      sampleRecords.push({
        id: `VP-202610-${1000 + i}`,
        station: hub,
        type: i % 3 === 0 ? 'Shopee' : (i % 2 === 0 ? 'Non-Shopee' : 'Logistics'),
        category: i % 4 === 0 ? 'Thái độ giao hàng' : (i % 3 === 0 ? 'Giao trễ hẹn' : 'Không gọi trước khi giao'),
        rider: `Rider ${100 + i} - Nguyễn Văn ${(i % 10) + 1}`,
        date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        status: i <= ticketed ? 'Đã lên vé' : 'Chờ xác nhận',
        punishment: i % 5 === 0 ? 'Trừ điểm thưởng' : 'Nhắc nhở'
      });
    }

    const resultData = {
      status: 'success',
      success: true,
      total,
      summary: { logistics, nonShopee, shopee, ticketed },
      records: sampleRecords
    };

    return { ...resultData, data: resultData, result: resultData };
  }

  // --- 5. RIDER PLAN ---
  async rp_checkAccess(email = '') {
    return {
      success: true,
      allowed: true,
      isAdmin: true,
      role: 'admin',
      level: 1,
      email: email || 'admin@spxexpress.com',
      permissions: ['view', 'edit', 'admin', 'export']
    };
  }

  async rp_init(station = '45-DLK Krong Pak 02 Hub') {
    return {
      success: true,
      allowed: true,
      station,
      shifts: ['Ca Sáng (07:00 - 15:00)', 'Ca Chiều (13:00 - 21:00)', 'Ca Tối (18:00 - 22:00)'],
      rosterCount: 28,
      planStatus: 'active'
    };
  }

  async rp_getData(station = '45-DLK Krong Pak 02 Hub') {
    return this.rp_init(station);
  }

  // --- 6. BI / FORWARD ORDER ---
  async bi_getData(hub = '45-DLK Krong Pak 02 Hub') {
    return {
      status: 'success',
      success: true,
      hub,
      hasData: false,
      message: 'BƯU CỤC CHƯA CÓ DỮ LIỆU CA HÔM NAY',
      promptUpload: true
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
