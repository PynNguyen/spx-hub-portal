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
          stations: ['ALL', 'Krông Pắc 02', 'Buôn Ma Thuột', 'Ea Kar', 'Cư Kuin']
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
  logTrigger(triggerName, details = {}, status = 'SUCCESS') {
    const entry = {
      triggerName,
      status,
      timestamp: new Date().toISOString(),
      details
    };
    this.data.triggerLogs.unshift(entry);
    if (this.data.triggerLogs.length > 500) {
      this.data.triggerLogs = this.data.triggerLogs.slice(0, 500);
    }
    this.isDirty = true;
  }
}

module.exports = new WorkspaceDatabase();
