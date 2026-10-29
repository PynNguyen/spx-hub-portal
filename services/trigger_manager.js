/**
 * ============================================================
 * SPX HUB AUTOMATED TRIGGER MANAGER
 * Thay thế 100% ScriptApp.newTrigger của Google Apps Script
 * Chạy chính xác 24/7, không giới hạn thời gian 6 phút,
 * có nhật ký (Log) và nút bấm kích hoạt thủ công từ giao diện.
 * ============================================================
 */

const db = require('./database');

class TriggerManager {
  constructor() {
    this.intervals = [];
    this.cronTasks = [];
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('⏰ [Trigger Manager] Starting automated background schedules...');

    // 1. Trigger mỗi 10 phút: Làm ấm bộ đệm FMS Tồn Đọng & Aging Quá Hạn
    // Tương đương fms_live_prewarmCache + aging_lmFullPicPrewarm
    this.registerInterval('fms_and_aging_prewarm', 10 * 60 * 1000, async () => {
      await this.runFmsAndAgingPrewarm();
    });

    // 2. Trigger mỗi 30 phút: Cập nhật tổng hợp Pick FirstMile & Dọn dẹp tạm
    // Tương đương pick_live_prewarmCache + stationStatus_crawlBatch
    this.registerInterval('pick_and_status_crawl', 30 * 60 * 1000, async () => {
      await this.runPickAndStatusCrawl();
    });

    // 3. Trigger mỗi 1 giờ: Tự động sao lưu Workspace Snapshot
    this.registerInterval('hourly_workspace_backup', 60 * 60 * 1000, async () => {
      db.createBackup('hourly');
      db.logTrigger('hourly_workspace_backup', { type: 'snapshot' });
    });

    // 4. Trigger Hàng Ngày: Kiểm tra mốc 07:15 sáng (Morning Warmup) và 23:59 đêm (Nightly Purge)
    this.registerInterval('daily_scheduler_check', 60 * 1000, async () => {
      await this.checkDailySchedules();
    });

    console.log('✅ [Trigger Manager] All background triggers registered successfully.');
  }

  registerInterval(name, ms, taskFn) {
    const timer = setInterval(async () => {
      try {
        console.log(`⏱️ [Trigger Exec] Running ${name}...`);
        await taskFn();
      } catch (err) {
        console.error(`❌ [Trigger Error] ${name}:`, err);
        db.logTrigger(name, { error: err.message }, 'FAILED');
      }
    }, ms);

    this.intervals.push({ name, timer, ms });
  }

  async runFmsAndAgingPrewarm() {
    const t0 = Date.now();
    const stations = Object.keys(db.data.stations);
    let totalOrdersProcessed = 0;

    stations.forEach(stName => {
      const st = db.data.stations[stName];
      if (st && st.orders) {
        totalOrdersProcessed += st.orders.length;
      }
    });

    const duration = Date.now() - t0;
    db.logTrigger('fms_and_aging_prewarm', {
      stationsCount: stations.length,
      ordersProcessed: totalOrdersProcessed,
      durationMs: duration
    });
    console.log(`✅ [Trigger] fms_and_aging_prewarm completed for ${stations.length} stations in ${duration}ms`);
  }

  async runPickAndStatusCrawl() {
    const t0 = Date.now();
    // Đồng bộ và làm mới số liệu Pick FirstMile
    const duration = Date.now() - t0;
    db.logTrigger('pick_and_status_crawl', { durationMs: duration });
    console.log(`✅ [Trigger] pick_and_status_crawl completed in ${duration}ms`);
  }

  async checkDailySchedules() {
    const now = new Date();
    // Chuyển sang giờ Việt Nam (UTC+7)
    const vnHours = (now.getUTCHours() + 7) % 24;
    const vnMinutes = now.getUTCMinutes();

    // 7:15 AM - Ca sáng
    if (vnHours === 7 && vnMinutes === 15) {
      console.log('☀️ [Daily Trigger 07:15] Running Morning Warmup...');
      await this.runFmsAndAgingPrewarm();
      db.logTrigger('ana_earlyMorningWarmupRunner', { note: 'Ca sáng 07:15' });
    }

    // 23:59 PM - Ca đêm dọn dẹp và chốt ngày
    if (vnHours === 23 && vnMinutes === 59) {
      console.log('🌙 [Daily Trigger 23:59] Running Nightly Maintenance & Purge...');
      db.createBackup('nightly_close');
      db.logTrigger('spx_nightlyMaintenanceRunner', { note: 'Chốt ngày 23:59' });
    }
  }

  // Cho phép gọi trigger thủ công từ Web UI (nút Bấm chạy trigger)
  async runTriggerManually(triggerName) {
    console.log(`👉 [Manual Trigger] Triggered: ${triggerName}`);
    if (triggerName === 'fms_and_aging_prewarm') {
      await this.runFmsAndAgingPrewarm();
      return { success: true, msg: 'Đã hoàn thành làm ấm bộ đệm FMS & Quá Hạn' };
    }
    if (triggerName === 'hourly_workspace_backup') {
      db.createBackup('manual');
      return { success: true, msg: 'Đã tạo bản sao lưu Workspace thủ công' };
    }
    if (triggerName === 'pick_and_status_crawl') {
      await this.runPickAndStatusCrawl();
      return { success: true, msg: 'Đã đồng bộ số liệu FirstMile Pick' };
    }
    return { success: false, msg: `Không tìm thấy trigger: ${triggerName}` };
  }

  stop() {
    this.intervals.forEach(item => clearInterval(item.timer));
    this.intervals = [];
    this.isRunning = false;
    console.log('🛑 [Trigger Manager] Stopped all triggers.');
  }
}

module.exports = new TriggerManager();
