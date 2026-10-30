const vm = require('vm');
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
          getName: () => sheetName,
          clearContents: () => {},
          clear: () => {},
          clearFormats: () => {},
          appendRow: (row) => {},
          insertRowAfter: () => {},
          insertRowBefore: () => {},
          deleteRow: () => {},
          hideSheet: () => {},
          showSheet: () => {},
          getMaxRows: () => 10000,
          getMaxColumns: () => 100,
          getDataRange: () => {
            const vals = this.getSheetValues(sheetName);
            return {
              getValues: () => vals,
              getDisplayValues: () => vals.map(row => row.map(v => String(v != null ? v : ''))),
              getLastRow: () => vals.length,
              getLastColumn: () => (vals[0] || []).length
            };
          },
          getRange: (r, c, numRows, numCols) => {
            const all = this.getSheetValues(sheetName);
            const startRow = (r && r > 0) ? r - 1 : 0;
            const endRow = (numRows && numRows > 0) ? startRow + numRows : all.length;
            const rowsSlice = all.slice(startRow, endRow);
            const sliceData = rowsSlice.map(row => {
              const startCol = (c && c > 0) ? c - 1 : 0;
              const endCol = (numCols && numCols > 0) ? startCol + numCols : row.length;
              return row.slice(startCol, endCol);
            });

            const rangeBase = {
              getValues: () => sliceData,
              getDisplayValues: () => sliceData.map(row => row.map(v => String(v != null ? v : ''))),
              getValue: () => (sliceData[0] || [])[0],
              getDisplayValue: () => String((sliceData[0] || [])[0] != null ? (sliceData[0] || [])[0] : ''),
              getLastRow: () => startRow + sliceData.length,
              getLastColumn: () => (sliceData[0] || []).length,
              getNumRows: () => sliceData.length,
              getNumColumns: () => (sliceData[0] || []).length
            };
            const rangeProxy = new Proxy(rangeBase, {
              get: (target, prop) => {
                if (prop in target) return target[prop];
                return () => rangeProxy; // Tự động hỗ trợ 100% mọi hàm format (setFontWeight, setBackground,...)
              }
            });
            return rangeProxy;
          },
          getLastRow: () => this.getSheetValues(sheetName).length,
          getLastColumn: () => (this.getSheetValues(sheetName)[0] || []).length
        })
      }),
      getActiveSpreadsheet: () => SpreadsheetApp.openById('default'),
      create: (name) => SpreadsheetApp.openById('created')
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
      _anaAcquireNamedLock: () => true,
      _anaReleaseNamedLock: () => true,
      console,
      Logger: {
        log: (...args) => console.log('[GAS Logger]', ...args),
        clear: () => {},
        getLog: () => ''
      },
      checkUserAccess: () => true,
      ScriptApp: {
        getService: () => ({
          getUrl: () => 'https://spx-hub-portal.onrender.com'
        }),
        newTrigger: () => ({
          timeBased: () => ({
            everyHours: () => ({ create: () => {} }),
            everyDays: () => ({ atHour: () => ({ create: () => {} }) })
          })
        }),
        deleteTrigger: () => {}
      },
      HtmlService: {
        createTemplateFromFile: (name) => ({
          evaluate: () => ({
            getContent: () => {
              try {
                const viewsDir = require('path').join(__dirname, '../public/views');
                const fn = name.endsWith('.html') ? name : name + '.html';
                let c = require('fs').readFileSync(require('path').join(viewsDir, fn), 'utf8');
                return c.replace(/<\?!=\s*include\(['"]([^'"]+)['"]\)\s*\?>/g, (_, inc) => {
                  try {
                    const ifn = inc.endsWith('.html') ? inc : inc + '.html';
                    return require('fs').readFileSync(require('path').join(viewsDir, ifn), 'utf8');
                  } catch(e) { return ''; }
                });
              } catch(e) { return ''; }
            }
          })
        }),
        createHtmlOutputFromFile: (name) => ({
          getContent: () => {
            try {
              const viewsDir = require('path').join(__dirname, '../public/views');
              const fn = name.endsWith('.html') ? name : name + '.html';
              return require('fs').readFileSync(require('path').join(viewsDir, fn), 'utf8');
            } catch(e) { return ''; }
          }
        }),
        createHtmlOutput: (html) => ({
          getContent: () => html,
          setTitle: () => {},
          addMetaTag: () => {},
          setXFrameOptionsMode: () => {}
        })
      },
      checkUserAccess: () => true,
      include: (name) => { try { return require('fs').readFileSync(require('path').join(__dirname, '../public/views/' + name + '.html'), 'utf8'); } catch(e){ return ''; } },
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

  getSheetValues(name) {
    if (!this.sheetTables) {
      try {
        const p = path.join(__dirname, '../data/sheet_tables.json');
        this.sheetTables = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
      } catch (e) { this.sheetTables = {}; }
    }
    const clean = String(name || '').trim();
        if (sName.includes('summary fm')) {
      return [['pickup', 'inbound', 'packed', 'seal', 'mp', 'social', 'reverse', 'cb', 'wh']];
    }
    if (sName.includes('high aging')) {
      return [['id', 'station', 'action', 'risk']];
    }
    for (const [k, rows] of Object.entries(this.sheetTables)) {
      if (k.toLowerCase() === clean.toLowerCase() || clean.toLowerCase().includes(k.toLowerCase())) {
        return rows;
      }
    }
    return [['Col1'], ['Val1']];
  }

  loadGsFiles() {
    const order = [
      '00_Core_Config.gs',
      'StationConfig.gs',
      '05_FMS_Live_Firestore.gs',
      'Firestore bridge.gs',
      'Multi_DB_Router.gs',
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
