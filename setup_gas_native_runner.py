import os
import subprocess
import shutil

src_dir = "gas_source/01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX"
views_dir = "public/views"
os.makedirs(views_dir, exist_ok=True)

print("=== 1. SAO CHÉP TOÀN BỘ FILE GIAO DIỆN HTML MỚI NHẤT ===")
html_count = 0
for f in os.listdir(src_dir):
    if f.endswith('.html'):
        shutil.copy2(os.path.join(src_dir, f), os.path.join(views_dir, f))
        html_count += 1
print(f"✅ Đã sao chép {html_count} file giao diện HTML mới nhất vào {views_dir}/")

print("\n=== 2. TẠO BỘ NẠP GAS RUNTIME (services/gas_runtime.js) ===")
runner_code = """const vm = require('vm');
const fs = require('fs');
const path = require('path');

class GasRuntime {
  constructor() {
    this.srcDir = path.join(__dirname, '../gas_source/01_Ban_Moi_Nhat_Da_Chinh_Sua_UI_UX');
    this.initContext();
    this.loadGsFiles();
  }

  initContext() {
    // 1. Nạp cache dữ liệu Google Sheets đã tải về
    let wsData = {};
    try {
      const p = path.join(__dirname, '../data/workspace_data.json');
      if (fs.existsSync(p)) wsData = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {}

    const memoryCache = new Map();
    const scriptProps = new Map();

    // 2. Giả lập môi trường Google Apps Script chuẩn cho Node.js
    const SpreadsheetApp = {
      openById: (id) => ({
        getSheetByName: (sheetName) => ({
          getDataRange: () => ({
            getValues: () => this.getSheetValues(sheetName, wsData)
          }),
          getRange: (...args) => ({
            getValues: () => this.getSheetValues(sheetName, wsData),
            getValue: () => (this.getSheetValues(sheetName, wsData)[0] || [])[0]
          }),
          getLastRow: () => this.getSheetValues(sheetName, wsData).length,
          getLastColumn: () => (this.getSheetValues(sheetName, wsData)[0] || []).length
        })
      }),
      getActiveSpreadsheet: () => SpreadsheetApp.openById('default')
    };

    const CacheService = {
      getScriptCache: () => ({
        get: (k) => memoryCache.get(k) || null,
        put: (k, v, ttl) => memoryCache.set(k, v),
        remove: (k) => memoryCache.delete(k)
      })
    };

    const PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (k) => scriptProps.get(k) || process.env[k] || '',
        setProperty: (k, v) => scriptProps.set(k, v),
        getProperties: () => Object.fromEntries(scriptProps)
      }),
      getUserProperties: () => PropertiesService.getScriptProperties()
    };

    const Utilities = {
      formatDate: (d, tz, fmt) => new Date(d).toISOString().slice(0, 10),
      base64Encode: (str) => Buffer.from(str).toString('base64'),
      base64Decode: (str) => Buffer.from(str, 'base64').toString('utf8'),
      sleep: (ms) => {}
    };

    const Session = {
      getActiveUser: () => ({ getEmail: () => 'xuan.nguyenthanh01@spxexpress.com' }),
      getEffectiveUser: () => ({ getEmail: () => 'xuan.nguyenthanh01@spxexpress.com' })
    };

    const LockService = {
      getScriptLock: () => ({ waitLock: () => true, releaseLock: () => true })
    };

    this.sandbox = {
      SpreadsheetApp,
      CacheService,
      PropertiesService,
      Utilities,
      Session,
      LockService,
      console,
      Date,
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      parseInt,
      parseFloat,
      isNaN,
      isFinite
    };

    this.context = vm.createContext(this.sandbox);
  }

  getSheetValues(name, wsData) {
    const sName = String(name || '').toLowerCase();
    if (sName.includes('aom') || sName.includes('sup')) {
      const rows = [['STT', 'Provinces', 'AOM', 'AOM_Email', 'Sup_Name', 'Sup_Email', 'Hub']];
      if (wsData.hubOrgMap) {
        let i = 1;
        for (const [k, v] of Object.entries(wsData.hubOrgMap)) {
          rows.push([String(i++), v.province || '', v.aom || '', v.aomEmail || '', v.sup || '', v.supEmail || '', k]);
        }
      }
      return rows;
    }
    if (sName.includes('lm') || sName.includes('fm') || sName.includes('kpi')) {
      const rows = [['ctime_date', 'Station Name', 'Shipment ID', 'Arrived Time', 'First Attempt Time', 'LM ETA', 'Type']];
      if (wsData.kpiOrders) {
        for (const o of wsData.kpiOrders) {
          rows.push([o.date, o.station, o.orderId, o.arrivedTime, '', o.eta, o.type || o.category]);
        }
      }
      return rows;
    }
    return [['Header1', 'Header2'], ['Value1', 'Value2']];
  }

  loadGsFiles() {
    const order = [
      '00_Core_Config.gs',
      'StationConfig.gs',
      '01_Admin_Dashboard.gs',
      '02_Aging_Quahan.gs',
      '03_Pick_Operations.gs',
      '04_KPIFail_Analytics.gs',
      '06_RiderPlan_Forecast.gs',
      '07_Rescue_ViPham_Triggers.gs',
      'Flmkpi backend.gs'
    ];

    let loadedCount = 0;
    for (const f of order) {
      const p = path.join(this.srcDir, f);
      if (fs.existsSync(p)) {
        try {
          const code = fs.readFileSync(p, 'utf8');
          vm.runInContext(code, this.context, { filename: f });
          loadedCount++;
        } catch (err) {
          console.warn(`[GAS Warning] ${f}:`, err.message);
        }
      }
    }
    console.log(`🚀 [GAS Engine] Đã nạp thành công ${loadedCount}/${order.length} file .gs gốc vào Node.js!`);
  }

  call(funcName, params = []) {
    if (typeof this.context[funcName] === 'function') {
      return this.context[funcName](...params);
    }
    return null;
  }
}

module.exports = new GasRuntime();
"""

os.makedirs('services', exist_ok=True)
with open('services/gas_runtime.js', 'w', encoding='utf-8') as f:
    f.write(runner_code)
print("✅ Đã tạo thành công services/gas_runtime.js!")

print("\n=== 3. CHẠY THỬ NGHIỆM GỌI CÁC HÀM TÍNH TOÁN GỐC TRÊN NODE.JS ===")
test_code = """const gas = require('./services/gas_runtime');

console.log('\\n[TEST 1] Gọi hàm gốc: spx_getSystemConfig()');
const cfg = gas.call('spx_getSystemConfig');
console.log('  Kết quả:', typeof cfg === 'string' ? cfg.slice(0, 100) : cfg);

console.log('\\n[TEST 2] Gọi hàm gốc: spx_getOverviewPart("kpifail", "45-DLK Krong Pak 02 Hub")');
const ovKp = gas.call('spx_getOverviewPart', ['kpifail', '45-DLK Krong Pak 02 Hub']);
console.log('  Krông Pắc 02 Overview gốc:', typeof ovKp === 'string' ? ovKp.slice(0, 150) : ovKp);

console.log('\\n[TEST 3] Gọi hàm gốc: spx_getOverviewPart("kpifail", "45-DLK Mdrak Hub")');
const ovMd = gas.call('spx_getOverviewPart', ['kpifail', '45-DLK Mdrak Hub']);
console.log('  Mdrak Overview gốc:', typeof ovMd === 'string' ? ovMd.slice(0, 150) : ovMd);
"""

with open('test_native_gs.js', 'w', encoding='utf-8') as f:
    f.write(test_code)

res = subprocess.run(['node', 'test_native_gs.js'], capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print("Stderr:", res.stderr)
