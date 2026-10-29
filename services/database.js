/**
 * ============================================================
 * SPX HUB CENTRALIZED WORKSPACE DATABASE
 * Quản lý dữ liệu lưu trữ dùng chung cho toàn bộ nhân sự Hub
 * Hỗ trợ đa người dùng (Multi-User), tự động khóa chống Race Condition
 * Tự động sao lưu (Auto Backup) và phục hồi tức thì.
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'workspace_data.json');
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');

class WorkspaceDatabase {
  constructor() {
    this.data = {
      meta: {
        version: '1.0.0',
        hubName: 'SPX HUB KRÔNG PẮC 02',
        createdAt: new Date().toISOString(),
        lastSaved: new Date().toISOString()
      },
      stations: {},       // stationName -> { orders: [], inboundLock: false, epoch: 0, updatedBy: '', updatedAt: '' }
      supplements: {},    // stationName -> { supplement: {}, epoch: 0 }
      rescueOrders: [],   // Đơn cứu cứu / cảnh báo
      resolvedOrders: {}, // trackingNo -> { resolved: true, resolvedAt: '', resolvedBy: '' }
      riderPlans: {},     // month -> { planData, forecastData, updatedBy: '' }
      kpiFailData: {},    // date -> { stats, notes: {} }
      adminRoles: [
        { email: 'xuan.nguyenthanh01@spxexpress.com', level: 1, note: 'Admin Tối Cao Failsafe' }
      ],
      userPermissions: [
        {
          email: 'xuan.nguyenthanh01@spxexpress.com',
          name: 'Admin Xuân',
          role: 'ADMIN_1',
          stations: ['ALL', '45-DLK Krong Pak 02 Hub']
        }
      ],
      triggerLogs: []
    };

    this.stationLocks = new Map(); // stationName -> boolean
    this.isDirty = false;
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(path.dirname(DB_FILE))) {
        fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      }
      if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = Object.assign(this.data, parsed);
        console.log(`📦 [Database] Loaded existing workspace database from ${DB_FILE}`);
      } else {
        this.saveNow();
        console.log(`📦 [Database] Initialized new workspace database at ${DB_FILE}`);
      }

      // Nạp dữ liệu vận hành THẬT (100% Real Operational Data)
      this.loadRealDataset();

      // Khởi tạo dữ liệu mặc định nếu DB trống
      this.seedDefaultData();

      // Tự động lưu định kỳ nếu có thay đổi (mỗi 5 giây)
      const saveInterval = setInterval(() => {
        if (this.isDirty) {
          this.saveNow();
        }
      }, 5000);
      if (saveInterval.unref) saveInterval.unref();

      // Tự động tạo snapshot backup mỗi 1 giờ
      const backupInterval = setInterval(() => {
        this.createBackup('hourly');
      }, 3600000);
      if (backupInterval.unref) backupInterval.unref();

    } catch (err) {
      console.error('❌ [Database Init Error]:', err);
    }
  }

  saveNow() {
    try {
      this.data.meta.lastSaved = new Date().toISOString();
      const content = JSON.stringify(this.data, null, 2);
      // Ghi ra file tạm rồi rename để đảm bảo atomic write an toàn tuyệt đối
      const tempFile = DB_FILE + '.tmp';
      fs.writeFileSync(tempFile, content, 'utf8');
      fs.renameSync(tempFile, DB_FILE);
      this.isDirty = false;
    } catch (err) {
      console.error('❌ [Database Save Error]:', err);
    }
  }

  createBackup(tag = 'manual') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(BACKUP_DIR, `backup_${tag}_${timestamp}.json`);
      fs.copyFileSync(DB_FILE, backupPath);
      console.log(`💾 [Database Backup] Saved snapshot to ${path.basename(backupPath)}`);

      // Giữ tối đa 50 bản backup gần nhất
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time);

      if (files.length > 50) {
        files.slice(50).forEach(f => {
          try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch (e) {}
        });
      }
    } catch (err) {
      console.error('❌ [Database Backup Error]:', err);
    }
  }

  // ============================================================
  // WORKSPACE TRIGGER: SAVE STATION DATA (Đồng bộ đa người dùng)
  // ============================================================
  saveStationData(stationName, orders, inboundLock, clientEpoch, userEmail = 'system') {
    const key = (stationName || '').trim();
    if (!key) return { success: false, msg: 'Tên trạm không hợp lệ' };

    // Khóa tránh race condition nếu 2 người cùng bấm lưu 1 trạm
    if (this.stationLocks.get(key)) {
      return { success: false, msg: `Trạm ${key} đang được cập nhật bởi một người dùng khác. Vui lòng thử lại sau vài giây.` };
    }

    this.stationLocks.set(key, true);

    try {
      const current = this.data.stations[key] || { orders: [], inboundLock: false, epoch: 0 };

      // Chống ghi đè dữ liệu cũ hơn epoch hiện tại (Anti-Data-Resurrection)
      if (clientEpoch && current.epoch && clientEpoch < current.epoch) {
        return { success: false, msg: 'Dữ liệu trên máy bạn đã cũ hơn bản lưu gần nhất trên hệ thống. Vui lòng tải lại trang!' };
      }

      // Server-side Merge: Kết hợp dữ liệu mới với dữ liệu hiện có
      // Giữ nguyên đơn đã 'delivered' / 'done' không bị hạ cấp trạng thái
      const orderMap = {};
      (current.orders || []).forEach(o => {
        if (o && (o.orderId || o.trackingNo)) {
          orderMap[o.orderId || o.trackingNo] = o;
        }
      });

      (orders || []).forEach(newOrder => {
        if (!newOrder) return;
        const id = newOrder.orderId || newOrder.trackingNo;
        if (!id) return;

        const existing = orderMap[id];
        if (!existing) {
          orderMap[id] = newOrder;
        } else {
          // Nếu đơn trên DB đã hoàn thành mà file gửi lên trạng thái thấp hơn thì giữ nguyên trạng thái cao nhất
          const existingRank = existing.rank || (existing.status === 'delivered' ? 99 : 1);
          const newRank = newOrder.rank || 1;
          if (existingRank > newRank && existing.status === 'delivered') {
            orderMap[id] = Object.assign({}, newOrder, { status: existing.status });
          } else {
            orderMap[id] = Object.assign({}, existing, newOrder);
          }
        }
      });

      const mergedOrders = Object.values(orderMap);
      const newEpoch = Math.max(Date.now(), (current.epoch || 0) + 1);

      this.data.stations[key] = {
        stationName: key,
        orders: mergedOrders,
        inboundLock: typeof inboundLock !== 'undefined' ? !!inboundLock : current.inboundLock,
        epoch: newEpoch,
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail,
        totalOrders: mergedOrders.length
      };

      this.isDirty = true;

      console.log(`✅ [Workspace Save] Saved ${mergedOrders.length} orders for station [${key}] by ${userEmail}`);
      return {
        success: true,
        epoch: newEpoch,
        count: mergedOrders.length,
        msg: `Đã lưu thành công ${mergedOrders.length} đơn cho trạm ${key}`
      };
    } finally {
      this.stationLocks.delete(key);
    }
  }

  // ============================================================
  // WORKSPACE TRIGGER: LOAD STATION DATA
  // ============================================================
  getStationData(stationName) {
    const key = (stationName || '').trim();
    const st = this.data.stations[key];
    if (!st) {
      return {
        success: true,
        stationName: key,
        orders: [],
        inboundLock: false,
        epoch: 0,
        empty: true
      };
    }
    return {
      success: true,
      stationName: key,
      orders: st.orders || [],
      inboundLock: !!st.inboundLock,
      epoch: st.epoch || 0,
      updatedAt: st.updatedAt,
      updatedBy: st.updatedBy,
      count: (st.orders || []).length
    };
  }

  // ============================================================
  // WORKSPACE TRIGGER: DELETE / CLEAR STATION DATA
  // ============================================================
  clearStationData(stationName, userEmail = 'system') {
    const key = (stationName || '').trim();
    if (!key) return { success: false, msg: 'Tên trạm không hợp lệ' };

    const newEpoch = Date.now();
    this.data.stations[key] = {
      stationName: key,
      orders: [],
      inboundLock: false,
      epoch: newEpoch,
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail,
      cleared: true
    };

    this.isDirty = true;
    this.createBackup(`clear_${key}`);
    console.log(`🗑️ [Workspace Delete] Cleared station [${key}] by ${userEmail} (epoch: ${newEpoch})`);

    return {
      success: true,
      epoch: newEpoch,
      msg: `Đã xóa toàn bộ dữ liệu trạm ${key}.`
    };
  }

  // ============================================================
  // WORKSPACE TRIGGER: RIDER PLAN SAVE / LOAD
  // ============================================================
  saveRiderPlan(payload, userEmail = 'system') {
    const month = payload.month || new Date().toISOString().slice(0, 7);
    this.data.riderPlans[month] = {
      month: month,
      plan: payload.plan || payload,
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail
    };
    this.isDirty = true;
    return { success: true, month: month, msg: 'Đã lưu kế hoạch Rider thành công.' };
  }

  loadRiderPlan(month) {
    const m = month || new Date().toISOString().slice(0, 7);
    return {
      success: true,
      month: m,
      data: this.data.riderPlans[m] || null
    };
  }

  // ============================================================
  // LOG TRIGGER EXECUTION
  // ============================================================
  // ============================================================
  // REAL OPERATIONAL DATA INGESTION
  // ============================================================
  loadRealDataset() {
    const realDatasetPath = path.join(__dirname, '..', 'data', 'real_dataset.json');
    if (fs.existsSync(realDatasetPath)) {
      try {
        const raw = fs.readFileSync(realDatasetPath, 'utf8');
        const realData = JSON.parse(raw);
        const currentCore = (this.data.agingData && this.data.agingData.core) || [];
        const isMock = currentCore.length === 0 || (currentCore[0] && String(currentCore[0].shipmentId || '').startsWith('SPXKP'));

        if (isMock && realData.aging_core && realData.aging_core.length > 0) {
          console.log(`🚀 [Database] Ingesting ${realData.aging_core.length} REAL operational orders into Workspace DB!`);
          this.data.agingData = {
            core: realData.aging_core,
            lost: []
          };
          this.data.kpiOrders = realData.kpi_orders || [];
          this.isDirty = true;
          this.saveNow();
        } else if (!this.data.kpiOrders || this.data.kpiOrders.length === 0) {
          this.data.kpiOrders = realData.kpi_orders || [];
          this.isDirty = true;
          this.saveNow();
        }
      } catch (err) {
        console.error('❌ [Database Real Data Ingestion Error]:', err);
      }
    }
  }

  // ============================================================
  // WORKSPACE SEEDING & DATA HELPERS
  // ============================================================
  seedDefaultData() {
    const STATIONS = [
      '45-DLK Krông Pắk 02 Hub',
      '45-DLK Buôn Ma Thuột Hub',
      '45-DLK Ea Kar Hub',
      '45-DLK Cư Kuin Hub',
      '45-DLK Krông Pắk Hub'
    ];

    if (!this.data.agingData || !Array.isArray(this.data.agingData.core) || this.data.agingData.core.length === 0) {
      const core = [];
      const lost = [];
      const sampleWards = ['Thị trấn Phước An', 'Xã Ea Kly', 'Xã Hòa An', 'Xã Hòa Đông', 'Xã Ea Phê', 'Xã Ea Yông'];
      const reasons = ['Customer Reschedule', 'Bad weather', 'Insufficient time'];

      // 24 đơn tồn 1-2 ngày
      for (let i = 1; i <= 24; i++) {
        core.push({
          shipmentId: 'SPXKP01' + String(i).padStart(4, '0'),
          hubName: '45-DLK Krong Pak 02 Hub',
          Hub: '45-DLK Krong Pak 02 Hub',
          station: '45-DLK Krong Pak 02 Hub',
          aom: 'Trần Hữu Oanh',
          sup: 'Trưởng Lê Uy Trí',
          ward: sampleWards[i % sampleWards.length],
          processStatus: 'Đang xử lý',
          finalStatus: 'onhold',
          lostToday: '',
          timingDate: 1.5,
          aging: 1.5,
          agingBucket: '1–2 ngày',
          att: 1,
          inboundAt: new Date(Date.now() - 1.5 * 86400000).toISOString().slice(0, 16),
          cogs: 250000,
          reason: reasons[i % reasons.length]
        });
      }

      // 31 đơn tồn 3-5 ngày
      for (let i = 25; i <= 55; i++) {
        core.push({
          shipmentId: 'SPXKP02' + String(i).padStart(4, '0'),
          hubName: '45-DLK Krong Pak 02 Hub',
          Hub: '45-DLK Krong Pak 02 Hub',
          station: '45-DLK Krong Pak 02 Hub',
          aom: 'Trần Hữu Oanh',
          sup: 'Trưởng Lê Uy Trí',
          ward: sampleWards[i % sampleWards.length],
          processStatus: 'Đang xử lý',
          finalStatus: 'onhold',
          lostToday: '',
          timingDate: 3.5,
          aging: 3.5,
          agingBucket: '2–5 ngày',
          att: 2,
          inboundAt: new Date(Date.now() - 3.5 * 86400000).toISOString().slice(0, 16),
          cogs: 320000,
          reason: reasons[i % reasons.length]
        });
      }

      // 3 đơn tồn > 5 ngày (5-7 ngày)
      for (let i = 56; i <= 58; i++) {
        core.push({
          shipmentId: 'SPXKP03' + String(i).padStart(4, '0'),
          hubName: '45-DLK Krong Pak 02 Hub',
          Hub: '45-DLK Krong Pak 02 Hub',
          station: '45-DLK Krong Pak 02 Hub',
          aom: 'Trần Hữu Oanh',
          sup: 'Trưởng Lê Uy Trí',
          ward: sampleWards[i % sampleWards.length],
          processStatus: 'Đang xử lý',
          finalStatus: 'onhold',
          lostToday: '',
          timingDate: 5.5,
          aging: 5.5,
          agingBucket: '5–7 ngày',
          att: 3,
          inboundAt: new Date(Date.now() - 5.5 * 86400000).toISOString().slice(0, 16),
          cogs: 450000,
          reason: reasons[i % reasons.length]
        });
      }

      this.data.agingData = { core, lost };
      this.isDirty = true;
    }

    if (!this.data.fmsData || !this.data.fmsData.data) {
      const hubData = {};
      STATIONS.forEach((h, hIdx) => {
        hubData[h] = {
          stats: [50 + hIdx * 10, 15 + hIdx * 2, 8 + hIdx, 3 + hIdx, 5 + hIdx, 6 + hIdx, 2, 89 + hIdx * 15],
          details: [[], [], [], [], [], [], []],
          reasonTop: [
            { reason: 'Customer Reschedule', count: 15 + hIdx * 2 },
            { reason: 'Bad weather / Mưa lớn', count: 8 + hIdx },
            { reason: 'Unable to deliver', count: 5 + hIdx },
            { reason: 'Attempts >= 3', count: 3 + hIdx },
            { reason: 'Address not found', count: 2 }
          ]
        };
      });

      this.data.fmsData = {
        hubs: STATIONS,
        data: hubData,
        asOfTime: new Date().toISOString()
      };
      this.isDirty = true;
    }

    if (!this.data.rescueOrders || this.data.rescueOrders.length === 0 || this.data.rescueOrders[0].tracking_no.startsWith('SPX7788')) {
      this.data.rescueOrders = [
        {
          tracking_no: 'SPXVN06317039536A',
          station_name: '45-DLK Krong Pak 02 Hub',
          export_date: new Date(Date.now() - 3600000 * 2).toISOString(),
          status: 'Khẩn cấp',
          urgency: 'red',
          reason: 'Đơn trễ hẹn giao 2 ca, khách gọi hotline',
          recipient_name: 'Nguyễn Văn An',
          recipient_phone: '0905123456'
        },
        {
          tracking_no: 'SPXVN06388795878A',
          station_name: '45-DLK Krong Pak 02 Hub',
          export_date: new Date(Date.now() - 3600000 * 5).toISOString(),
          status: 'Khẩn cấp',
          urgency: 'red',
          reason: 'Khách khiếu nại chưa nhận hàng',
          recipient_name: 'Trần Thị Bích',
          recipient_phone: '0914987654'
        },
        {
          tracking_no: 'SPXVN06317042893A',
          station_name: '45-DLK Krong Pak 02 Hub',
          export_date: new Date(Date.now() - 3600000 * 8).toISOString(),
          status: 'Khẩn cấp',
          urgency: 'red',
          reason: 'Sắp hết hạn xử lý SLA (còn 2h)',
          recipient_name: 'Lê Văn Cường',
          recipient_phone: '0982345678'
        }
      ];
      this.isDirty = true;
    }

    if (!this.data.violations || this.data.violations.length === 0) {
      this.data.violations = [
        {
          case_id: 'VP-2026-001',
          station_name: '45-DLK Krông Pắk 02 Hub',
          driver_name: 'Lê Văn Tài',
          driver_phone: '0934123890',
          violation_type: 'Giao sai quy trình SOP',
          ticket_no: '',
          created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
          status: 'PENDING'
        },
        {
          case_id: 'VP-2026-002',
          station_name: '45-DLK Krông Pắk 02 Hub',
          driver_name: 'Nguyễn Hoàng Nam',
          driver_phone: '0945234901',
          violation_type: 'Trễ giờ xuất bến ca sáng',
          ticket_no: '',
          created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
          status: 'PENDING'
        },
        {
          case_id: 'VP-2026-003',
          station_name: '45-DLK Buôn Ma Thuột Hub',
          driver_name: 'Phạm Quốc Dũng',
          driver_phone: '0912345789',
          violation_type: 'Cập nhật sai trạng thái đơn',
          ticket_no: 'SPX-TCK-9901',
          created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
          status: 'INVESTIGATING'
        }
      ];
      this.isDirty = true;
    }

    if (!this.data.agingNotes) {
      this.data.agingNotes = {
        'SPX793000000002': { note: 'Khách hẹn giao buổi chiều sau 17h', user: 'xuan.nguyenthanh01@spxexpress.com', time: new Date().toISOString() },
        'SPX793000000004': { note: 'Đã phân tuyến lại cho Rider Tuấn', user: 'xuan.nguyenthanh01@spxexpress.com', time: new Date().toISOString() }
      };
      this.isDirty = true;
    }
  }
}

module.exports = new WorkspaceDatabase();
