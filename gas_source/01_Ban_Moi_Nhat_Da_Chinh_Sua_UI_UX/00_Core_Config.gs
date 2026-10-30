// [MỚI — "múi giờ của toàn bộ phải theo GIỜ VIỆT NAM"] Trước đây ~30 chỗ lấy múi giờ từ cài đặt DỰ ÁN Apps Script
// (Session.getScriptTimeZone) và ~25 chỗ cắt ngày bằng getHours()/setHours() — tức theo múi giờ dự án. Nếu cài đặt
// dự án khác Việt Nam thì mọi mốc "hôm nay", "N ngày trước", giờ chạy trigger đều lệch mà không báo lỗi. Nay mọi
// định dạng ngày giờ dùng HẰNG SỐ SPX_TZ; mốc ngày dùng 2 hàm bên dưới; trigger đặt giờ có .inTimezone(SPX_TZ).
// (Việt Nam không có giờ mùa hè nên 1 ngày luôn đúng 86.400.000 ms.)
var SPX_TZ = 'Asia/Ho_Chi_Minh';
/** 'yyyy-MM-dd' của (hôm nay + offsetDays) THEO GIỜ VIỆT NAM. */
function _spxVnDateStr_(offsetDays) {
  return Utilities.formatDate(new Date(Date.now() + (offsetDays || 0) * 86400000), SPX_TZ, 'yyyy-MM-dd');
}
/** Thời điểm 00:00 GIỜ VIỆT NAM của (hôm nay + offsetDays) — dùng làm mốc cắt so với Date thật. */
function _spxVnMidnight_(offsetDays) {
  return new Date(_spxVnDateStr_(offsetDays) + 'T00:00:00+07:00');
}

/**

 * ============================================================

 * BACKEND MASTER V5.0 - SPX HUB KRÔNG PẮC 02

 * Tác giả: Admin Xuân - Krông Pắc 02

 * Cập nhật: Tích hợp Module Báo Cáo Phân Tích (từ Bổ Sung)

 * ============================================================

 */

var DB_FEE_URL  = 'https://docs.google.com/spreadsheets/d/1zGRw8ClXQ5QldxCMXtM7RbY-xlHAt2iJsXdolwzyvrM/edit';

const ADMIN_DB_ID = '145-rfoh-hLPPa5o8Uoy1SFl04ryh9N4x5Roi2ByxwPY';

// ============================================================
// QUẢN LÝ ADMIN 2 CẤP — Admin_Roles sheet (trong ADMIN_DB_ID)
// Cột: A=Email | B=Cấp(1/2) | C=Ghi chú | D=Người thêm | E=Ngày thêm
//
// Cấp 1: thấy & thêm/xoá được admin cấp 2 qua UI. Cấp 2: quyền admin đầy đủ
// (thấy hết mọi hub/module) giống cấp 1, chỉ khác không quản lý được admin khác.
//
// FAILSAFE: email dưới đây LUÔN LUÔN được coi là admin cấp 1, kể cả khi sheet
// Admin_Roles bị lỗi, rỗng, hoặc bị xoá nhầm hết dòng — để tránh bị khoá hoàn
// toàn khỏi hệ thống. Chỉ thêm/sửa mảng này trực tiếp trong code khi thực sự
// cần thiết (ví dụ người giữ tài khoản duy nhất nghỉ việc).
// ============================================================
var ADMIN_ROLES_SHEET   = 'Admin_Roles';
var ADMIN_FAILSAFE_EMAIL = [
  'xuan.nguyenthanh01@spxexpress.com'
];

// ============================================================
// ⚙️ PERFORMANCE INFRASTRUCTURE (thêm mới — không đổi logic nghiệp vụ)
// Bao gồm 4 phần theo yêu cầu tối ưu:
//   1. _DS      — Data Session Manager (memoize theo 1 lần thực thi)
//   2. CacheMgr — Cache Manager chuẩn hóa CacheService
//   3. _LOG     — Logger Manager (DEBUG / PRODUCTION)
//   4. SystemManager — "Refresh System" 1 nút duy nhất
// ============================================================

// ── 1) DATA SESSION MANAGER ──────────────────────────────────────────────
// "Data Session" = phạm vi 1 lần thực thi function (1 lượt gọi từ client
// qua google.script.run, hoặc 1 lượt doGet). Apps Script khởi tạo lại toàn
// bộ biến global mỗi lần thực thi mới, nên bộ nhớ đệm dưới đây KHÔNG rò rỉ
// sang các phiên khác và KHÔNG cần lo dữ liệu cũ/stale giữa các lượt gọi —
// chỉ tránh việc trong CÙNG 1 lượt gọi, nhiều hàm con lỡ mở lại cùng 1
// Spreadsheet hoặc đọc lại cùng 1 sheet nhiều lần.
// Chỉ đọc lại (bypass cache) khi chính code gọi _DS.invalidate()/_DS.reset()
// — ví dụ sau khi Upload/Save/Load hoặc khi bấm "Refresh System".
var _DS = (function () {
  var ssCache    = {};   // id -> Spreadsheet
  var sheetCache = {};   // ssId + '::' + sheetName -> Sheet
  var valuesCache = {};  // sheetKey + '::' + rangeKey -> values (getDataRange/getValues)

  return {
    // Mở Spreadsheet theo ID — chỉ openById() thật sự 1 lần / phiên cho mỗi ID.
    ss: function (id, forceRefresh) {
      if (!id) return null;
      if (forceRefresh || !ssCache[id]) {
        ssCache[id] = SpreadsheetApp.openById(id);
      }
      return ssCache[id];
    },
    // Lấy Sheet theo tên — memoize theo (spreadsheetId + tên sheet).
    sheet: function (ss, name, forceRefresh) {
      if (!ss || !name) return null;
      var key = ss.getId() + '::' + name;
      if (forceRefresh || !(key in sheetCache)) {
        sheetCache[key] = ss.getSheetByName(name);
      }
      return sheetCache[key];
    },
    // Đọc getDataRange().getValues() 1 lần / phiên cho mỗi sheet. Dùng
    // rangeKey khi cần phân biệt nhiều kiểu đọc khác nhau trên cùng sheet
    // (ví dụ đọc full range vs đọc range con) — mặc định 'full'.
    values: function (sheet, rangeKey, forceRefresh) {
      if (!sheet) return [];
      rangeKey = rangeKey || 'full';
      var key = sheet.getParent().getId() + '::' + sheet.getSheetId() + '::' + rangeKey;
      if (forceRefresh || !(key in valuesCache)) {
        valuesCache[key] = sheet.getDataRange().getValues();
      }
      return valuesCache[key];
    },
    // Xoá cache của 1 spreadsheet ID cụ thể (và mọi sheet/values liên quan),
    // gọi sau khi Upload/Save/Load thay đổi dữ liệu và cần đọc lại ngay
    // trong cùng phiên.
    invalidate: function (id) {
      if (id) delete ssCache[id];
      Object.keys(sheetCache).forEach(function (k) {
        if (id && k.indexOf(id + '::') === 0) delete sheetCache[k];
      });
      Object.keys(valuesCache).forEach(function (k) {
        if (id && k.indexOf(id + '::') === 0) delete valuesCache[k];
      });
    },
    // Reset toàn bộ Data Session — dùng trong SystemManager.refreshSystem().
    reset: function () {
      ssCache = {};
      sheetCache = {};
      valuesCache = {};
    }
  };
})();

// ── 2) CACHE MANAGER ─────────────────────────────────────────────────────
// Chuẩn hóa việc dùng CacheService cho các dữ liệu ít thay đổi: Permission,
// Admin, Hub, Mail, Mapping, SA. Các cache "nghiệp vụ" đặc thù (aging,
// kpifail, fms_live…) đã có cơ chế riêng ở đúng module của chúng — CacheMgr
// không thay thế các cơ chế đó, chỉ cung cấp API dùng chung, nhất quán cho
// những chỗ cache đơn giản (get/set theo TTL).
var CacheMgr = (function () {
  var NAMESPACES = ['PERMISSION', 'ADMIN', 'HUB', 'MAIL', 'MAPPING', 'SA', 'ANALYTICS'];
  var DEFAULT_TTL = 300; // giây — giống TTL đang dùng cho admin roles map

  function keyOf(ns, key) { return 'cm_' + ns + '_' + key; }

  return {
    NAMESPACES: NAMESPACES,
    // Đọc cache, trả về null nếu chưa có / lỗi parse.
    get: function (ns, key) {
      try {
        var raw = CacheService.getScriptCache().get(keyOf(ns, key));
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    // Ghi cache (mặc định TTL 300s, tối đa cho phép của CacheService là 21600s).
    set: function (ns, key, value, ttlSeconds) {
      try {
        CacheService.getScriptCache().put(
          keyOf(ns, key), JSON.stringify(value), ttlSeconds || DEFAULT_TTL
        );
        return true;
      } catch (e) { return false; }
    },
    // Xoá 1 key cụ thể trong 1 namespace.
    invalidate: function (ns, key) {
      try { CacheService.getScriptCache().remove(keyOf(ns, key)); } catch (e) {}
    },
    // Xoá toàn bộ key đã biết của 1 namespace (cần truyền danh sách key vì
    // ScriptCache không hỗ trợ liệt kê theo prefix).
    invalidateAll: function (ns, keys) {
      try {
        var full = (keys || []).map(function (k) { return keyOf(ns, k); });
        if (full.length) CacheService.getScriptCache().removeAll(full);
      } catch (e) {}
    },
    // Xoá sạch cache CacheMgr của TẤT CẢ namespace đã biết (dùng trong
    // Refresh System) — cần truyền map { ns: [keys] } vì lý do nêu trên.
    clearAll: function (keysByNs) {
      var self = this;
      NAMESPACES.forEach(function (ns) {
        self.invalidateAll(ns, (keysByNs && keysByNs[ns]) || []);
      });
    },
    // ── CHUNKED CACHE (2026-07) ──────────────────────────────────────────
    // Gộp pattern "cắt JSON lớn thành nhiều entry CacheService" — trước đây
    // bị viết tay lặp lại độc lập ở nhiều module (aging_getMasterData,
    // kpifail_getIndexSummary, rider-plan forecast...), mỗi nơi tự implement
    // lại y hệt thuật toán (giới hạn 100KB/entry của CacheService buộc phải
    // chunk). Dùng chung API này cho MỌI cache "nghiệp vụ" cỡ lớn từ nay.
    // Best-effort tuyệt đối: mọi lỗi (quá lớn, cache service lỗi, JSON hỏng,
    // thiếu chunk do lệch TTL) đều trả về false/null, KHÔNG BAO GIỜ throw —
    // để cache lỗi không thể làm hỏng luồng đọc dữ liệu chính ở nơi gọi.
    setChunked: function (ns, key, value, ttlSeconds) {
      try {
        var raw = JSON.stringify(value);
        var CHUNK = 90000; // an toàn dưới giới hạn 100KB/entry của CacheService
        var chunks = [];
        for (var i = 0; i < raw.length; i += CHUNK) chunks.push(raw.slice(i, i + CHUNK));
        if (chunks.length > 40) return false; // dữ liệu quá lớn bất thường → bỏ qua, không rủi ro
        var base = keyOf(ns, key);
        var payload = {};
        payload[base + '_meta'] = JSON.stringify({ chunks: chunks.length });
        chunks.forEach(function (c, idx) { payload[base + '_c' + idx] = c; });
        CacheService.getScriptCache().putAll(payload, ttlSeconds || DEFAULT_TTL);
        return true;
      } catch (e) { return false; }
    },
    getChunked: function (ns, key) {
      try {
        var base = keyOf(ns, key);
        var sc = CacheService.getScriptCache();
        var metaStr = sc.get(base + '_meta');
        if (!metaStr) return null;
        var meta = JSON.parse(metaStr);
        var n = meta.chunks;
        if (!n || n <= 0 || n > 40) return null;
        var keys = [];
        for (var i = 0; i < n; i++) keys.push(base + '_c' + i);
        var got = sc.getAll(keys);
        var parts = [];
        for (var j = 0; j < n; j++) {
          var part = got[base + '_c' + j];
          if (part === null || part === undefined) return null; // thiếu chunk (lệch TTL) → coi như miss
          parts.push(part);
        }
        return JSON.parse(parts.join(''));
      } catch (e) { return null; }
    },
    invalidateChunked: function (ns, key) {
      try {
        var base = keyOf(ns, key);
        var sc = CacheService.getScriptCache();
        var metaStr = sc.get(base + '_meta');
        if (!metaStr) return;
        var meta = JSON.parse(metaStr);
        var keys = [base + '_meta'];
        for (var i = 0; i < meta.chunks; i++) keys.push(base + '_c' + i);
        sc.removeAll(keys);
      } catch (e) {}
    }
  };
})();

// ── 3) LOGGER MANAGER ────────────────────────────────────────────────────
// Tách DEBUG / PRODUCTION: PRODUCTION không ghi log không cần thiết (giảm
// overhead ghi Stackdriver log khi hệ thống chạy ở tần suất cao). Đổi
// DEBUG_MODE = true khi cần xem lại toàn bộ log để chẩn đoán lỗi.
var _LOG = (function () {
  var DEBUG_MODE = false; // đổi thành true khi cần debug production
  var ERROR_LOG_CACHE_KEY = 'sys_recent_errors_v1';
  var MAX_RECENT_ERRORS = 50;

  return {
    setDebugMode: function (on) { DEBUG_MODE = !!on; },
    isDebugMode: function () { return DEBUG_MODE; },
    // Log thông thường (debug) — chỉ ghi khi DEBUG_MODE = true.
    d: function (msg) { if (DEBUG_MODE) Logger.log(msg); },
    // Log lỗi — LUÔN ghi bất kể DEBUG_MODE, vì cần cho chẩn đoán sự cố.
    // [MỚI — tab "Tuỳ chọn nâng cao"] Logger.log() gốc CHỈ hiện trong Execution
    // log của ĐÚNG lần chạy đó, KHÔNG persist giữa các lần gọi khác nhau —
    // không thể "xem lại lỗi gần đây" bằng cách đó. Thêm buffer nhẹ qua
    // CacheService (không phải Sheet, tránh làm chậm hàm dùng chung này — nó
    // được gọi ở RẤT nhiều nơi trong toàn bộ file) — bọc try/catch kỹ, không
    // bao giờ được phép làm hỏng hành vi log gốc hay ném lỗi ngược lên caller.
    e: function (msg) {
      Logger.log(msg);
      try {
        var cache = CacheService.getScriptCache();
        var raw = cache.get(ERROR_LOG_CACHE_KEY);
        var list = raw ? JSON.parse(raw) : [];
        list.unshift({ ts: new Date().toISOString(), msg: String(msg).substring(0, 500) });
        if (list.length > MAX_RECENT_ERRORS) list.length = MAX_RECENT_ERRORS;
        cache.put(ERROR_LOG_CACHE_KEY, JSON.stringify(list), 21600); // 6 tiếng — TTL tối đa CacheService
      } catch (eCacheLog) {}
    },
    getRecentErrors: function () {
      try {
        var raw = CacheService.getScriptCache().get(ERROR_LOG_CACHE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) { return []; }
    }
  };
})();

// ── 4) SYSTEM MANAGER — "Refresh System" 1 nút duy nhất ─────────────────
// Gộp lại toàn bộ cơ chế clear cache/invalidate đã có sẵn trong hệ thống
// (không viết lại logic của chúng) + reset Data Session + clear CacheMgr,
// để người dùng chỉ cần bấm 1 nút. Hàm này KHÔNG đổi kết quả trả về của
// các hàm invalidate hiện có — chỉ gọi tuần tự và gộp báo cáo.
function spx_refreshSystem() {
  // [FIX LỖI BẢO MẬT THẬT — phát hiện khi tách 2 luồng dọn dẹp theo yêu cầu
  // trực tiếp] Hàm này TRƯỚC ĐÂY hoàn toàn KHÔNG kiểm tra quyền — bất kỳ ai
  // (kể cả gọi thẳng qua console trình duyệt) đều có thể xoá cache SERVER-WIDE
  // ảnh hưởng mọi user khác. Giờ đây đây là hành động CHỈ ADMIN mới nên làm
  // (đã tách khỏi luồng dọn dẹp cá nhân của user thường) — thêm đúng guard
  // chuẩn đã dùng nhất quán cho mọi hàm admin-only khác trong file này.
  // [SỬA — theo yêu cầu trực tiếp "loại bỏ Dọn dẹp hệ thống khỏi admin cấp 2"]
  // Nâng từ _requireAdmin_(2) lên (1) — chỉ cấp 1 gọi được.
  _requireAdmin_(1);
  var report = { steps: [], errors: [] };

  function run(label, fn) {
    try {
      var r = fn();
      report.steps.push({ step: label, result: r || 'ok' });
    } catch (e) {
      report.errors.push({ step: label, error: e.message });
    }
  }

  // 1. Clear Runtime — reset Data Session Manager (memoize theo phiên)
  run('data_session_reset', function () { _DS.reset(); return 'reset'; });

  // 2. Clear Cache — dùng lại toàn bộ cơ chế invalidate cache nghiệp vụ
  //    đã có sẵn (permission, admin, aging, kpifail, luong, fms_live…)
  run('permission_and_business_cache', function () { return spx_invalidateAllCache(); });
  if (typeof aging_clearCache === 'function') {
    run('aging_cache', function () { return aging_clearCache(); });
  }
  if (typeof kpifail_clearCache === 'function') {
    run('kpifail_cache', function () { return kpifail_clearCache(); });
  }
  if (typeof fms_live_clearCache === 'function') {
    run('fms_live_cache', function () { return fms_live_clearCache(); });
  }
  if (typeof _admin_invalidateCache === 'function') {
    run('admin_roles_cache', function () { return _admin_invalidateCache(); });
  }

  // 3. Clear CacheMgr namespaces chuẩn hóa (Permission/Admin/Hub/Mail/Mapping/SA)
  run('cache_manager_clear', function () { CacheMgr.clearAll(); return 'cleared'; });

  _LOG.e('[spx_refreshSystem] ' + JSON.stringify(report));
  return JSON.stringify({ success: report.errors.length === 0, report: report, ts: new Date().toISOString() });
}

// ── 4b) LẤY URL WEB APP THẬT — dùng để client reload chính xác frame TOP ──
// Client không thể tin cậy document.referrer để biết URL /exec hay /dev thật
// (GAS lồng nhiều lớp iframe khác origin, referrer có thể trỏ tới domain nội
// bộ khác của Google tuỳ ngữ cảnh mở app → điều hướng sai, ra trang lỗi).
// ScriptApp.getService().getUrl() luôn trả về đúng URL deployment hiện tại
// (tự động đúng cho cả /exec production và /dev testing), lấy 1 lần và
// cache phía client — an toàn, không đụng logic nào khác.
function spx_getWebAppUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    _LOG.e('[spx_getWebAppUrl] ' + e.message);
    return '';
  }
}

/**
 * _admin_getAdminMap()
 * Đọc sheet Admin_Roles → { email: level(1|2) }. Cache 300s (ScriptCache)
 * để tránh mở spreadsheet mỗi lần check quyền.
 */
// ═══════════════════════════════════════════════════════════════════════
// [MỚI — theo yêu cầu trực tiếp] PHÂN CẤP ROM: ROM > AOM > SUP > Lead/Staff
//
// BỐI CẢNH: sheet nguồn 'Khu vực quản lý (AOMSup)' (do đội khác quản) chỉ có
// cột AOM_Email và Sup_Email — KHÔNG có cột nào cho ROM. Vì vậy ROM trước đây
// hoàn toàn không tồn tại trong dữ liệu: giao diện có nút xem thử "L1-ROM"
// nhưng không tài khoản thật nào được nhận cấp này.
//
// CÁCH LÀM: KHÔNG sửa sheet nguồn (không thuộc quyền mình, sửa vào dễ bị ghi
// đè khi đội kia cập nhật). Thay vào đó lưu cấu hình ROM trong DB quản trị của
// chính hệ thống, quản qua màn Admin — cùng cách đã làm với Admin_Roles.
//
// CẤU TRÚC sheet 'ROM_Roles' (tự tạo khi cần):
//   A: rom_email   B: aom_email   C: ghi chú/ngày cấp
// Mỗi dòng = 1 quan hệ "ROM này quản AOM kia". 1 ROM nhiều AOM -> nhiều dòng.
// Phạm vi trạm của ROM = hợp của phạm vi tất cả AOM mà ROM đó quản, suy ra
// động từ sheet nguồn -> AOM thay trạm thì ROM tự cập nhật theo, không phải
// sửa 2 nơi.
// ═══════════════════════════════════════════════════════════════════════
var ROM_ROLES_SHEET = 'ROM_Roles';

/** Bảng ROM -> danh sách AOM_Email. Cache 5 phút (đổi rất ít). */
function _rom_getRomMap() {
  var CK = 'rom_roles_map_v1';
  var sc = CacheService.getScriptCache();
  try { var hit = sc.get(CK); if (hit) return JSON.parse(hit); } catch (e) {}

  var map = {};
  var _romOk = true;
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName(ROM_ROLES_SHEET);
    if (sheet && sheet.getLastRow() > 1) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < data.length; i++) {
        var rom = String(data[i][0] || '').toLowerCase().trim();
        var aom = String(data[i][1] || '').toLowerCase().trim();
        if (!rom || !aom) continue;
        if (!map[rom]) map[rom] = [];
        if (map[rom].indexOf(aom) < 0) map[rom].push(aom);
      }
    }
  } catch (e) {
    _LOG.d('[_rom_getRomMap] ERROR: ' + e.message);
    _romOk = false;
  }
  // [SỬA] KHÔNG lưu cache khi đọc lỗi/rỗng: trước đây một lần Sheets lỗi thoáng qua làm kết quả rỗng bị giữ trong cache tới hết TTL.
  if (_romOk) { try { sc.put(CK, JSON.stringify(map), 300); } catch (e) {} }
  return map;
}

/** Xoá cache sau khi Admin thay đổi cấu hình ROM. */
function _rom_invalidateCache() {
  try {
    CacheService.getScriptCache().remove('rom_roles_map_v1');
    CacheMgr.invalidate('SA', 'rom_avail_aoms_v2');
    var romMap = _rom_getRomMap();
    if (romMap) {
      Object.keys(romMap).forEach(function (em) {
        CacheMgr.invalidate('SA', 'rom_scope_v2_' + em.replace(/[^a-z0-9]/g, '_'));
      });
    }
  } catch (e) {}
}

/**
 * _rom_getScope(email)
 * Trả { isRom, aomEmails, stations } — phạm vi THẬT của 1 ROM.
 * stations suy ra ĐỘNG từ sheet nguồn theo các AOM mà ROM quản.
 */
/**
 * rom_getScopeForPreview(romEmail) — phạm vi trạm của 1 ROM, dùng cho chế độ Xem thử.
 * [MỚI — rà soát: ROM đã cấu hình thật nhưng giao diện vẫn coi như "chưa có dữ liệu
 * phân vùng"] Trả về danh sách AOM và danh sách trạm mà ROM đó quản, để Xem thử cấp
 * ROM lọc đúng phạm vi thay vì hiện số toàn hệ thống.
 * Chỉ Admin gọi được (Xem thử là công cụ của Admin).
 */
/**
 * spx_getHubOrgDirectory() — danh bạ TRẠM -> {AOM, SUP} lấy thẳng từ cây tổ chức.
 * [MỚI — theo yêu cầu: "toàn bộ module phải phân cấp đúng, số liệu đúng của họ"]
 * Trước đây việc "SUP/AOM này quản những trạm nào" được suy ra từ allData — tức dữ
 * liệu của module Kiểm soát Giao hàng. Hệ quả: khi dữ liệu đó chưa tải xong (hoặc
 * người dùng chưa vào module đó), phạm vi ra RỖNG -> không lọc -> mọi cấp đều thấy
 * số toàn hệ thống. Đó là gốc rễ của việc "SUP A lại xem được toàn bộ".
 * Danh bạ này lấy thẳng từ nguồn tổ chức nên luôn có, không phụ thuộc module nào.
 * Nhẹ (1 dòng / trạm) và đệm 1 giờ.
 */
function spx_getHubOrgDirectory() {
  var CK = 'spx_hub_org_dir_v1';
  try {
    var hit = CacheMgr.getChunked('ACCESS', CK);
    if (hit && hit.byHub) return JSON.stringify(hit);
  } catch (e) {}
  var out = { byHub: {}, supNames: [], aomNames: [] };
  try {
    var ss = SpreadsheetApp.openById(ORG_SOURCE_SPREADSHEET_ID);
    var sh = ss.getSheetByName('Khu vực quản lý (AOMSup)');
    if (sh && sh.getLastRow() > 1) {
      var vals = sh.getDataRange().getValues();
      var head = vals[0].map(function (x) { return String(x || '').trim().toLowerCase(); });
      var iHub = head.indexOf('hub'), iAom = head.indexOf('aom'), iSup = head.indexOf('sup_name');
      var seenS = {}, seenA = {};
      if (iHub >= 0) {
        for (var i = 1; i < vals.length; i++) {
          var hub = String(vals[i][iHub] || '').trim();
          if (!hub) continue;
          var aom = iAom >= 0 ? String(vals[i][iAom] || '').trim() : '';
          var sup = iSup >= 0 ? String(vals[i][iSup] || '').trim() : '';
          out.byHub[_normStationKey_(hub)] = { hub: hub, aom: aom, sup: sup };
          if (sup && !seenS[sup]) { seenS[sup] = 1; out.supNames.push(sup); }
          if (aom && !seenA[aom]) { seenA[aom] = 1; out.aomNames.push(aom); }
        }
      }
    }
    out.supNames.sort(); out.aomNames.sort();
    if (Object.keys(out.byHub).length > 0) { try { CacheMgr.setChunked('ACCESS', CK, out, 3600); } catch (e2) {} } // [SỬA] không lưu cache danh bạ rỗng
  } catch (e) { out.error = e.message; }
  return JSON.stringify(out);
}

function rom_getScopeForPreview(romEmail) {
  try {
    _requireAdmin_(2);
    var sc = _rom_getScope(romEmail);
    return JSON.stringify({
      success: true,
      isRom: !!sc.isRom,
      email: String(romEmail || '').toLowerCase().trim(),
      aomEmails: sc.aomEmails || [],
      hubs: sc.stations || [],
      nguon: sc.nguon || 'legacy'
    });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

function _rom_getScope(email) {
  var em = String(email || '').toLowerCase().trim();
  if (!em) return { isRom: false, aomEmails: [], stations: [] };

  var CK = 'rom_scope_v2_' + em.replace(/[^a-z0-9]/g, '_');
  try {
    var hit = CacheMgr.get('SA', CK);
    if (hit) return hit;
  } catch (e) {}

  var romMap = _rom_getRomMap();
  var aomList = romMap[em];
  if (!aomList || !aomList.length) return { isRom: false, aomEmails: [], stations: [] };

  var want = {};
  aomList.forEach(function (a) { want[a] = true; });

  // [SỬA — rà soát: ROM đã được cấu hình thật nhưng phạm vi lại tra ở NGUỒN CŨ]
  // Phần bên dưới đọc sheet 'AOM SUP' trong file 1Tqy2J — nguồn đã bỏ. Các đường
  // phân quyền khác đã chuyển sang file tổ chức chính thức, riêng ROM còn sót lại
  // -> ROM mới cấu hình có thể ra 0 trạm, và đó là lý do phần Xem thử cấp ROM bị
  // coi là "chưa có dữ liệu phân vùng thật".
  // Nay lấy trạm từ chính cây tổ chức: gom trạm của từng AOM mà ROM này quản.
  // Không thấy gì thì mới lùi về nguồn cũ (giữ nguyên bên dưới).
  try {
    var _orgRom = _spxBuildOrgAccessMap_();
    if (_orgRom && _orgRom.byEmail) {
      var _stOrg = [], _seenOrg = {};
      Object.keys(want).forEach(function (aomEmail) {
        var _aom = _orgRom.byEmail[aomEmail];
        if (_aom && _aom.stations && _aom.stations.length) {
          _aom.stations.forEach(function (h) { if (h && !_seenOrg[h]) { _seenOrg[h] = true; _stOrg.push(h); } });
        }
      });
      if (_stOrg.length) {
        var resOrg = { isRom: true, aomEmails: aomList, stations: _stOrg.sort(), nguon: 'org' };
        try { CacheMgr.set('SA', CK, resOrg, 1800); } catch (e) {}
        return resOrg;
      }
    }
  } catch (eOrgRom) {}

  var stations = [], seen = {};
  try {
    var srcSS = _DS.ss(RP_SOURCE_ID);
    // Tận dụng _rp_getSASheetValues_ (đã có chunked cache 180s) nếu có, tránh scan sheet thô
    var data = (typeof _rp_getSASheetValues_ === 'function')
      ? _rp_getSASheetValues_(srcSS)
      : (srcSS.getSheetByName('AOM SUP') || srcSS.getSheets()[0]).getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var aomE = String(data[i][RP_SA_COL_AOM_EMAIL] || '').toLowerCase().trim();
      if (!aomE || !want[aomE]) continue;
      var hub = String(data[i][RP_SA_COL_HUB] || '').trim();
      if (hub && !seen[hub]) { seen[hub] = true; stations.push(hub); }
    }
  } catch (e) {
    _LOG.d('[_rom_getScope] ERROR: ' + e.message);
  }
  var res = { isRom: true, aomEmails: aomList, stations: stations.sort() };
  if (stations.length > 0) {
    try { CacheMgr.set('SA', CK, res, 1800); } catch (e) {}
  }
  return res;
}

/** [Admin] Đọc toàn bộ cấu hình ROM để hiển thị ở màn quản trị. */
function rom_listConfig() {
  try {
    _requireAdmin_(1);
    var map = _rom_getRomMap();
    var out = [];
    Object.keys(map).sort().forEach(function (rom) {
      var sc = _rom_getScope(rom);
      out.push({ romEmail: rom, aomEmails: map[rom], stationCount: sc.stations.length });
    });
    return JSON.stringify({ success: true, data: out });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/** [Admin] Gán 1 AOM cho 1 ROM. */
function rom_assignAom(romEmail, aomEmail) {
  try {
    _requireAdmin_(1);
    var rom = String(romEmail || '').toLowerCase().trim();
    var aom = String(aomEmail || '').toLowerCase().trim();
    if (!rom || rom.indexOf('@') < 0) return JSON.stringify({ success: false, error: 'Email ROM không hợp lệ.' });
    if (!aom || aom.indexOf('@') < 0) return JSON.stringify({ success: false, error: 'Email AOM không hợp lệ.' });

    if (!_anaAcquireNamedLock('rom_roles_write_lock_v1', 10000, 15000)) {
      return JSON.stringify({ success: false, error: 'Hệ thống đang bận, thử lại sau vài giây.' });
    }
    try {
      var ss = _DS.ss(ADMIN_DB_ID);
      var sheet = ss.getSheetByName(ROM_ROLES_SHEET);
      if (!sheet) {
        sheet = ss.insertSheet(ROM_ROLES_SHEET);
        sheet.getRange(1, 1, 1, 3).setValues([['rom_email', 'aom_email', 'ghi_chu']]);
      }
      // Chống trùng
      if (sheet.getLastRow() > 1) {
        var d = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
        for (var i = 0; i < d.length; i++) {
          if (String(d[i][0] || '').toLowerCase().trim() === rom &&
              String(d[i][1] || '').toLowerCase().trim() === aom) {
            return JSON.stringify({ success: false, error: 'Cặp ROM–AOM này đã có rồi.' });
          }
        }
      }
      sheet.appendRow([rom, aom, 'Cấp bởi ' + Session.getActiveUser().getEmail() + ' lúc ' + _anaVNNow()]);
    } finally {
      _anaReleaseNamedLock('rom_roles_write_lock_v1');
    }
    _rom_invalidateCache();
    var scope = _rom_getScope(rom);
    return JSON.stringify({ success: true, stationCount: scope.stations.length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/** [Admin] Gỡ 1 AOM khỏi 1 ROM. */
function rom_revokeAom(romEmail, aomEmail) {
  try {
    _requireAdmin_(1);
    var rom = String(romEmail || '').toLowerCase().trim();
    var aom = String(aomEmail || '').toLowerCase().trim();
    if (!_anaAcquireNamedLock('rom_roles_write_lock_v1', 10000, 15000)) {
      return JSON.stringify({ success: false, error: 'Hệ thống đang bận, thử lại sau vài giây.' });
    }
    try {
      var ss = _DS.ss(ADMIN_DB_ID);
      var sheet = ss.getSheetByName(ROM_ROLES_SHEET);
      if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: false, error: 'Chưa có cấu hình ROM nào.' });
      var d = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
      for (var i = d.length - 1; i >= 0; i--) {
        if (String(d[i][0] || '').toLowerCase().trim() === rom &&
            String(d[i][1] || '').toLowerCase().trim() === aom) {
          sheet.deleteRow(i + 2);
          break;
        }
      }
    } finally {
      _anaReleaseNamedLock('rom_roles_write_lock_v1');
    }
    _rom_invalidateCache();
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/** [Admin] Danh sách AOM có thật trong sheet nguồn — để chọn khi gán. */
function rom_listAvailableAoms() {
  try {
    _requireAdmin_(1);
    var CK = 'rom_avail_aoms_v2';
    var cached = CacheMgr.get('SA', CK);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return JSON.stringify({ success: true, data: cached });
    }

    var out = [], seen = {};
    var srcSS = _DS.ss(RP_SOURCE_ID);
    var data = (typeof _rp_getSASheetValues_ === 'function')
      ? _rp_getSASheetValues_(srcSS)
      : (srcSS.getSheetByName('AOM SUP') || srcSS.getSheets()[0]).getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var em = String(data[i][RP_SA_COL_AOM_EMAIL] || '').toLowerCase().trim();
      if (!em || seen[em]) continue;
      seen[em] = true;
      out.push({ email: em, name: String(data[i][2] || '').trim() });
    }
    out.sort(function (a, b) { return a.email < b.email ? -1 : 1; });
    if (out.length > 0) {
      try { CacheMgr.set('SA', CK, out, 1800); } catch (e) {}
    }
    return JSON.stringify({ success: true, data: out });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

function _admin_getAdminMap() {
  var CACHE_KEY = 'admin_roles_map_v1';
  var sc = CacheService.getScriptCache();
  try {
    var cached = sc.get(CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch(ce) {}

  var map = {};
  var _adminOk = true;
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName(ADMIN_ROLES_SHEET);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var email = data[i][0] ? data[i][0].toString().toLowerCase().trim() : '';
        var level = parseInt(data[i][1], 10);
        if (email && (level === 1 || level === 2)) map[email] = level;
      }
    }
  } catch(e) {
    _LOG.d('[_admin_getAdminMap] ERROR: ' + e.message);
    _adminOk = false;
  }

  // Failsafe: đảm bảo luôn có ít nhất email gốc là cấp 1
  ADMIN_FAILSAFE_EMAIL.forEach(function(e) {
    var em = e.toLowerCase().trim();
    if (em && !map[em]) map[em] = 1;
  });

  // [SỬA] KHÔNG lưu cache khi đọc lỗi/rỗng: trước đây một lần Sheets lỗi thoáng qua làm kết quả rỗng bị giữ trong cache tới hết TTL. Với bản đồ quyền admin, lỗi đọc làm mất quyền admin (chỉ còn email dự phòng) trong cả 5 phút.
  if (_adminOk) { try { sc.put(CACHE_KEY, JSON.stringify(map), 300); } catch(ce) {} }
  return map;
}

/** Xoá cache map admin — gọi sau khi thêm/xoá admin trong sheet */
function _admin_invalidateCache() {
  try {
    CacheService.getScriptCache().remove('admin_roles_map_v1');
    CacheMgr.invalidateChunked('ADMIN', 'spx_admin_list_v1');
    CacheMgr.invalidateChunked('ADMIN', 'spx_pending_access_list_v1');
  } catch(e) {}
}

// ============================================================
// [SECURITY HARDENING 2026-08] GUARD DÙNG CHUNG
// ------------------------------------------------------------
// Lý do thêm: trong Apps Script, MỌI hàm top-level (kể cả không được
// bất kỳ file HTML nào của ta gọi tới) đều có thể bị gọi trực tiếp từ
// console trình duyệt qua google.script.run.tenHam(...) — bởi BẤT KỲ
// ai đã load được 1 trang bất kỳ của web app này, kể cả người CHƯA
// được duyệt (trang UI_RequestAccess vẫn dùng chung cầu nối này).
// doGet() chỉ quyết định trang HTML nào được trả, KHÔNG chặn được
// từng lệnh gọi RPC riêng lẻ. Vì vậy các hàm quản trị/di trú/xoá dữ
// liệu PHẢI tự kiểm tra quyền ngay trong thân hàm — không được dựa
// vào việc "không ai biết tên hàm này" hay "chỉ được include ở UI admin".
// Dùng 2 hàm dưới đây ở ĐẦU mọi hàm public có khả năng đọc/ghi dữ liệu
// nhạy cảm hoặc phá huỷ dữ liệu.
// ============================================================

/**
 * _requireAdmin_(maxLevel)
 * Ném lỗi nếu người gọi hiện tại không phải admin cấp <= maxLevel (mặc định 2,
 * tức admin cấp 1 hoặc cấp 2 đều qua). Dùng maxLevel=1 cho thao tác chỉ admin
 * cấp 1 mới được làm (xoá sheet permission gốc, seed lại admin...).
 * Trả về email người gọi (đã chuẩn hoá) nếu hợp lệ, để hàm gọi tiếp có thể dùng
 * ngay (ví dụ ghi vào cột "resolvedBy"/"addedBy" thay vì tin chuỗi client gửi lên).
 */
/**
 * _requireAdminIfInteractive_(maxLevel)
 * [SỬA LỖI THẬT — báo cáo: "tần suất sử dụng = 0 dù user dùng rất nhiều"]
 * Các job NỀN gọi _requireAdmin_() ở dòng đầu. Nhưng job nền chạy theo lịch thì
 * KHÔNG có người đăng nhập -> Session.getActiveUser().getEmail() rỗng -> hàm đó
 * NÉM LỖI ngay, job chết trước khi làm gì.
 * Hệ quả đo được: spx_usageStats_flushBuffer lỗi 86 lượt -> dữ liệu tần suất nằm
 * mãi trong bộ đệm, không bao giờ ghi xuống sheet -> thống kê hiện 0.
 * Ba job khác (archive / crawl trạm / dọn Trend) lỗi 33 lượt cũng CÙNG nguyên nhân.
 * Nay: có người dùng thật -> kiểm tra quyền như cũ (chặn người ngoài gọi thẳng);
 * chạy nền (không có email) -> cho chạy, vì chính hệ thống gọi chứ không phải ai đó.
 */
function _requireAdminIfInteractive_(maxLevel) {
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) { email = ''; }
  if (!email) return '';           // chạy nền theo lịch — không có ai để kiểm tra
  return _requireAdmin_(maxLevel);
}

function _requireAdmin_(maxLevel) {
  maxLevel = maxLevel || 2;
  var email = Session.getActiveUser().getEmail().toLowerCase().trim();
  var map = _admin_getAdminMap();
  var level = map[email];
  if (!level || level > maxLevel) {
    throw new Error('Không có quyền thực hiện thao tác này (yêu cầu admin cấp ' + maxLevel + ' trở lên).');
  }
  return email;
}

/**
 * _requireApproved_()
 * Ném lỗi nếu người gọi hiện tại chưa được duyệt đăng nhập (cột B Admin_Access
 * khác "Duyệt"). Dùng cho các RPC đọc dữ liệu vận hành/lịch sử — không cần
 * phân quyền theo hub cụ thể nhưng vẫn phải là user đã được công ty duyệt.
 * Trả về email đã chuẩn hoá.
 *
 * [PERF FIX 2026-08] checkUserAccess() bên dưới KHÔNG có cache — đọc thẳng
 * getDataRange() của cả sheet Admin_Access mỗi lần gọi (chấp nhận được khi trước
 * đây chỉ gọi ĐÚNG 1 LẦN/trang trong doGet()). Sau khi thêm _requireApproved_()
 * vào include() (chặn đọc mã nguồn khi chưa duyệt — xem include() bên dưới),
 * 1 lần tải trang giờ gọi include() nhiều lần (mỗi <?!= include('...') ?> trong
 * index.html), nên nếu không nhớ lại kết quả trong PHẠM VI 1 LẦN THỰC THI, sheet
 * Admin_Access sẽ bị đọc lặp lại nhiều lần/trang thay vì 1 lần như trước — chậm
 * trang + tốn quota Sheets API vô ích. Biến _approvedMemo dưới đây là biến cấp
 * script (tồn tại suốt 1 lần thực thi doGet(), KHÔNG phải cache liên-request) —
 * chỉ đọc sheet đúng 1 lần cho mỗi user/thực thi, các lần gọi include() sau dùng
 * lại kết quả đã nhớ, không đọc lại sheet.
 */
var _approvedMemo = null; // { email, ok } — chỉ sống trong phạm vi 1 lần thực thi hiện tại
function _requireApproved_() {
  var email = Session.getActiveUser().getEmail();
  if (_approvedMemo && _approvedMemo.email === email) {
    if (!_approvedMemo.ok) throw new Error('Tài khoản chưa được duyệt truy cập hệ thống.');
    return email.toLowerCase().trim();
  }
  var ok = !!email && checkUserAccess(email);
  // [SỬA LỖI THẬT — truy từ báo cáo "ẩn module nhưng vẫn hiện đầy đủ",
  // kiểm chứng bằng Console: window.SPX_MODULE_STATUS = {} trong khi tab Quản
  // lý Module (cùng nguồn dữ liệu) vẫn thấy module ĐANG ẨN]
  // checkUserAccess() CHỈ tra sheet Admin_Access, KHÔNG có ngoại lệ cho admin.
  // Admin nào không có dòng "Duyệt" trong sheet đó -> bị coi là CHƯA DUYỆT ->
  // mọi hàm dùng _requireApproved_ đều từ chối. Riêng hàm đọc trạng thái
  // module lại "fail-open" (trả rỗng im lặng) -> không module nào bị ẩn.
  // Trong khi đó _requireAdmin_() tra bảng admin -> tab Quản lý Module vẫn
  // chạy đúng, tạo ra đúng hiện tượng "admin thấy đang ẩn, menu vẫn hiện đủ".
  // Admin (mọi cấp) hiển nhiên là đã được duyệt truy cập.
  if (!ok && email) {
    try {
      var _am = _admin_getAdminMap();
      if (_am[String(email).toLowerCase().trim()]) ok = true;
    } catch (eAm) {}
  }
  _approvedMemo = { email: email, ok: ok };
  if (!ok) throw new Error('Tài khoản chưa được duyệt truy cập hệ thống.');
  return email.toLowerCase().trim();
}

/**
 * admin_seedInitialAdmins()
 * CHẠY THỦ CÔNG 1 LẦN DUY NHẤT từ Apps Script Editor để khởi tạo sheet
 * Admin_Roles từ danh sách RP_ADMIN_EMAIL cũ (toàn bộ → cấp 1, giữ nguyên
 * quyền hiện có, không ai bị mất quyền admin sau khi migrate).
 * Sau khi chạy xong, việc thêm admin cấp 2 mới sẽ dùng UI thay vì sửa code.
 */
function admin_seedInitialAdmins() {
  // [SECURITY FIX 2026-08] Trước đây không kiểm tra quyền. An toàn khi thêm
  // _requireAdmin_() vì ADMIN_FAILSAFE_EMAIL luôn được _admin_getAdminMap() coi là
  // admin cấp 1 kể cả khi sheet Admin_Roles còn trống — không lo tự khoá mình khỏi
  // lần chạy khởi tạo đầu tiên.
  _requireAdmin_(1);
  var ss = _DS.ss(ADMIN_DB_ID);
  var sheet = ss.getSheetByName(ADMIN_ROLES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ADMIN_ROLES_SHEET);
    sheet.appendRow(['Email', 'Cấp (1/2)', 'Ghi chú', 'Người thêm', 'Ngày thêm']);
  }
  var existingData = sheet.getDataRange().getValues();
  var existing = [];
  for (var i = 1; i < existingData.length; i++) {
    if (existingData[i][0]) existing.push(existingData[i][0].toString().toLowerCase().trim());
  }
  var added = 0;
  (RP_ADMIN_EMAIL || []).forEach(function(raw) {
    var email = raw.toLowerCase().trim();
    if (email && existing.indexOf(email) < 0) {
      sheet.appendRow([email, 1, 'Migrated từ RP_ADMIN_EMAIL', 'system', new Date()]);
      existing.push(email);
      added++;
    }
  });
  _admin_invalidateCache();
  return 'Đã thêm ' + added + ' admin (cấp 1) vào sheet ' + ADMIN_ROLES_SHEET + '. Tổng hiện có: ' + existing.length;
}

/**
 * spx_getAdminList()
 * Public wrapper — chỉ trả về danh sách nếu người gọi là admin cấp 1.
 */
function spx_getAdminList() {
  try {
    var email = Session.getActiveUser().getEmail().toLowerCase().trim();
    var map = _admin_getAdminMap();
    if (map[email] !== 1) {
      return JSON.stringify({ success: false, error: 'Chỉ admin cấp 1 mới được xem danh sách này.' });
    }

    var CK = 'spx_admin_list_v1';
    var cached = CacheMgr.getChunked('ADMIN', CK);
    if (cached && Array.isArray(cached)) {
      return JSON.stringify({ success: true, list: cached, myEmail: email });
    }

    // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"]
    var ss = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName(ADMIN_ROLES_SHEET);
    var list = [];
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (!data[i][0]) continue;
        list.push({
          row: i + 1,
          email: data[i][0].toString().trim(),
          level: parseInt(data[i][1], 10) || 2,
          note: data[i][2] ? data[i][2].toString() : '',
          addedBy: data[i][3] ? data[i][3].toString() : '',
          addedDate: data[i][4] ? data[i][4].toString() : '',
          isFailsafe: ADMIN_FAILSAFE_EMAIL.map(function(e){return e.toLowerCase().trim();}).indexOf(data[i][0].toString().toLowerCase().trim()) >= 0
        });
      }
    }
    if (list.length > 0) {
      try { CacheMgr.setChunked('ADMIN', CK, list, 300); } catch (e) {}
    }
    return JSON.stringify({ success: true, list: list, myEmail: email });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_addAdmin(newEmail, note)
 * Thêm 1 admin CẤP 2 mới. Chỉ admin cấp 1 mới gọi được (kiểm tra server-side).
 * Admin cấp 2 có quyền y hệt cấp 1 (thấy hết mọi hub/module), chỉ khác là
 * không tự thêm/xoá được admin khác qua UI này.
 */
function spx_addAdmin(newEmail, note) {
  try {
    var caller = Session.getActiveUser().getEmail().toLowerCase().trim();
    var map = _admin_getAdminMap();
    if (map[caller] !== 1) {
      return JSON.stringify({ success: false, error: 'Chỉ admin cấp 1 mới được thêm admin.' });
    }

    newEmail = (newEmail || '').toString().toLowerCase().trim();
    if (!newEmail || newEmail.indexOf('@') < 0) {
      return JSON.stringify({ success: false, error: 'Email không hợp lệ.' });
    }
    if (map[newEmail]) {
      return JSON.stringify({ success: false, error: 'Email này đã là admin (cấp ' + map[newEmail] + ').' });
    }

    // [FIX NGHẼN LOCK 2026-07-24] TRƯỚC ĐÂY dùng thẳng LockService.getScriptLock() —
    // khoá TOÀN CỤC của cả script, cùng hàng đợi với Rider Plan/KPIFail Notes/Analytics...
    // (xem giải thích đầy đủ ở saveRiderPlan()). Đổi sang named lock riêng cho
    // Admin_Roles qua _anaAcquireNamedLock() (đã có sẵn, dùng chung) — chỉ chặn lẫn
    // nhau giữa các thao tác thêm/xoá admin, không kéo cả hệ thống chờ.
    if (!_anaAcquireNamedLock('admin_roles_write_lock_v1', 10000, 15000)) {
      return JSON.stringify({ success: false, error: 'Hệ thống đang bận, vui lòng thử lại sau ít giây.' });
    }
    try {
      var ss = _DS.ss(ADMIN_DB_ID);
      var sheet = ss.getSheetByName(ADMIN_ROLES_SHEET);
      if (!sheet) {
        sheet = ss.insertSheet(ADMIN_ROLES_SHEET);
        sheet.appendRow(['Email', 'Cấp (1/2)', 'Ghi chú', 'Người thêm', 'Ngày thêm']);
      }
      // Check lại 1 lần nữa trong lock để tránh race condition 2 người thêm cùng lúc
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var existed = data[i][0] ? data[i][0].toString().toLowerCase().trim() : '';
        if (existed === newEmail) {
          return JSON.stringify({ success: false, error: 'Email này đã có trong danh sách.' });
        }
      }
      sheet.appendRow([newEmail, 2, note || '', caller, new Date()]);
    } finally {
      _anaReleaseNamedLock('admin_roles_write_lock_v1');
    }

    _admin_invalidateCache();
    getModuleAccess_invalidate(newEmail);
    try { CacheService.getScriptCache().remove('luong_access_v1_' + newEmail.replace(/[^a-z0-9]/g, '_')); } catch(ce) {}
    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_removeAdmin(targetEmail)
 * Xoá 1 admin cấp 2 khỏi danh sách. Chỉ admin cấp 1 mới gọi được.
 * Không cho xoá email failsafe, và không cho tự xoá chính mình.
 */
function spx_removeAdmin(targetEmail) {
  try {
    var caller = Session.getActiveUser().getEmail().toLowerCase().trim();
    var map = _admin_getAdminMap();
    if (map[caller] !== 1) {
      return JSON.stringify({ success: false, error: 'Chỉ admin cấp 1 mới được xoá admin.' });
    }

    targetEmail = (targetEmail || '').toString().toLowerCase().trim();
    if (ADMIN_FAILSAFE_EMAIL.map(function(e){ return e.toLowerCase().trim(); }).indexOf(targetEmail) >= 0) {
      return JSON.stringify({ success: false, error: 'Không thể xoá admin failsafe (được bảo vệ trong code).' });
    }
    if (targetEmail === caller) {
      return JSON.stringify({ success: false, error: 'Không thể tự xoá chính mình. Nhờ 1 admin cấp 1 khác xoá giúp.' });
    }

    // [FIX NGHẼN LOCK 2026-07-24] Đổi sang named lock riêng cho Admin_Roles — xem giải
    // thích đầy đủ ở spx_addAdmin() / saveRiderPlan().
    if (!_anaAcquireNamedLock('admin_roles_write_lock_v1', 10000, 15000)) {
      return JSON.stringify({ success: false, error: 'Hệ thống đang bận, vui lòng thử lại sau ít giây.' });
    }
    var rowToDelete = -1;
    try {
      var ss = _DS.ss(ADMIN_DB_ID);
      var sheet = ss.getSheetByName(ADMIN_ROLES_SHEET);
      if (!sheet) return JSON.stringify({ success: false, error: 'Chưa có sheet Admin_Roles.' });

      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var email = data[i][0] ? data[i][0].toString().toLowerCase().trim() : '';
        if (email === targetEmail) { rowToDelete = i + 1; break; }
      }
      if (rowToDelete < 0) {
        return JSON.stringify({ success: false, error: 'Không tìm thấy email này trong danh sách.' });
      }
      sheet.deleteRow(rowToDelete);
    } finally {
      _anaReleaseNamedLock('admin_roles_write_lock_v1');
    }

    _admin_invalidateCache();
    getModuleAccess_invalidate(targetEmail);
    try { CacheService.getScriptCache().remove('luong_access_v1_' + targetEmail.replace(/[^a-z0-9]/g, '_')); } catch(ce) {}
    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// ============================================================
// DUYỆT ĐĂNG NHẬP TRỰC TIẾP TRÊN INDEX — Admin_Access sheet
// Cột: A=Email | B=Trạng thái đăng nhập (Duyệt/Chờ/Từ chối) | C=Ngày yêu cầu | D=Trạng thái quyền Lương
//
// Cho phép admin cấp 1 HOẶC cấp 2 duyệt/từ chối/thu hồi quyền đăng nhập ngay
// trên UI index, thay vì phải mở Google Sheet Admin_Access và sửa tay cột B.
// checkUserAccess() trong doGet() đọc trực tiếp cột B mỗi lần load trang nên
// không cần invalidate cache — cập nhật có hiệu lực ngay ở lần load kế tiếp.
// ============================================================

/**
 * spx_getPendingAccessList()
 * Trả về toàn bộ danh sách trong Admin_Access để hiển thị modal "Duyệt đăng nhập".
 * Chỉ admin (cấp 1 hoặc cấp 2) mới gọi được.
 * Cột F (tự tạo, không có trong sheet gốc) lưu "thời điểm admin thao tác gần nhất"
 * (duyệt/thu hồi đăng nhập hoặc Lương) — dùng để sắp xếp tab "Đã duyệt" theo thời
 * gian mới nhất lên đầu, thay vì A-Z, giúp tìm ngay tài khoản vừa mới duyệt.
 */
function spx_getPendingAccessList() {
  try {
    var caller = Session.getActiveUser().getEmail().toLowerCase().trim();
    var adminMap = _admin_getAdminMap();
    if (!adminMap[caller]) {
      return JSON.stringify({ success: false, error: 'Chỉ admin mới được xem danh sách duyệt đăng nhập.' });
    }

    var CK = 'spx_pending_access_list_v1';
    var cached = CacheMgr.getChunked('ADMIN', CK);
    if (cached && Array.isArray(cached)) {
      return JSON.stringify({ success: true, list: cached, myEmail: caller, myLevel: adminMap[caller] });
    }

    // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"]

    var ss = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName('Admin_Access');
    if (!sheet) return JSON.stringify({ success: false, error: 'Không tìm thấy sheet Admin_Access.' });

    var data = sheet.getDataRange().getValues();
    var list = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      // Cột C dùng CHUNG cho cả 2 mục đích: lúc dòng mới tạo (submitAccessRequest)
      // nó là "thời điểm yêu cầu"; sau khi admin duyệt/thu hồi bất kỳ thao tác nào
      // (spx_setAccessLoginStatus / spx_setAccessLuongStatus / spx_setLoginAndLuongStatus)
      // nó bị ghi đè thành "thời điểm thao tác gần nhất" — không dùng cột F riêng nữa.
      var tsRaw = data[i][2]; // cột C
      var tsVal = tsRaw ? tsRaw.toString() : '';
      var tsMs  = tsRaw ? (tsRaw instanceof Date ? tsRaw.getTime() : (new Date(tsRaw)).getTime() || 0) : 0;
      list.push({
        row: i + 1,
        email: data[i][0].toString().trim(),
        statusLogin: data[i][1] ? data[i][1].toString().trim() : '',
        requestedDate: tsVal,
        requestedTs: tsMs,
        statusLuong: data[i][3] ? data[i][3].toString().trim() : '',
        assignedHub: data[i][4] ? data[i][4].toString().trim() : '',
        lastActionDate: tsVal,
        lastActionTs: tsMs
      });
    }
    if (list.length > 0) {
      try { CacheMgr.setChunked('ADMIN', CK, list, 300); } catch (e) {}
    }
    return JSON.stringify({ success: true, list: list, myEmail: caller, myLevel: adminMap[caller] });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_setAccessLoginStatus(email, status)
 * Cập nhật cột B (trạng thái đăng nhập) trong Admin_Access cho 1 email.
 * status hợp lệ: 'Duyệt' | 'Chờ' (đúng 2 giá trị của dropdown trong sheet thật).
 * Nếu email chưa có trong sheet (admin muốn cấp quyền trước cho ai đó chưa
 * từng đăng nhập lần nào) → tự thêm dòng mới luôn (upsert), để admin không
 * cần chờ user bấm "Gửi yêu cầu" trước.
 * Cũng ghi lại thời điểm thao tác vào cột C (dùng chung với thời điểm yêu cầu ban đầu) để tab "Đã duyệt" sắp mới nhất lên đầu.
 * Admin cấp 1 HOẶC cấp 2 đều gọi được (kiểm tra server-side).
 */
function spx_setAccessLoginStatus(email, status) {
  try {
    var caller = Session.getActiveUser().getEmail().toLowerCase().trim();
    var adminMap = _admin_getAdminMap();
    if (!adminMap[caller]) {
      return JSON.stringify({ success: false, error: 'Chỉ admin mới được duyệt đăng nhập.' });
    }

    var validStatus = ['Duyệt', 'Chờ'];
    if (validStatus.indexOf(status) < 0) {
      return JSON.stringify({ success: false, error: 'Trạng thái không hợp lệ.' });
    }

    email = (email || '').toString().toLowerCase().trim();
    if (!email || email.indexOf('@') < 0) {
      return JSON.stringify({ success: false, error: 'Email không hợp lệ.' });
    }

    // [FIX NGHẼN LOCK 2026-07-24] TRƯỚC ĐÂY dùng thẳng LockService.getScriptLock() —
    // đây chính là nguyên nhân nút "Duyệt"/"+ Lương" ở modal "Duyệt đăng nhập" phải
    // bấm nhiều lần mới ăn: khoá toàn cục này bị 15+ hàm khác dùng chung (Rider Plan,
    // KPIFail Notes, Analytics snapshot...) nên mỗi cú Duyệt phải xếp hàng sau các thao
    // tác nặng không liên quan, dễ vượt quá 10s chờ và lỗi âm thầm. Đổi sang named lock
    // riêng cho Admin_Access qua _anaAcquireNamedLock() (đã có sẵn, dùng chung).
    if (!_anaAcquireNamedLock('admin_access_write_lock_v1', 10000, 15000)) {
      return JSON.stringify({ success: false, error: 'Hệ thống đang bận, vui lòng thử lại sau ít giây.' });
    }
    var wasNew = false;
    var now = new Date();
    try {
      var ss = _DS.ss(ADMIN_DB_ID);
      var sheet = ss.getSheetByName('Admin_Access');
      if (!sheet) return JSON.stringify({ success: false, error: 'Không tìm thấy sheet Admin_Access.' });

      var data = sheet.getDataRange().getValues();
      var found = false;
      for (var i = 1; i < data.length; i++) {
        var e = data[i][0] ? data[i][0].toString().toLowerCase().trim() : '';
        if (e === email) {
          sheet.getRange(i + 1, 2, 1, 2).setValues([[status, now]]); // cột B, C (gộp 1 lần ghi thay vì 2)
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow([email, status, now]); // cột C (vị trí 3) đã là now, không cần ghi thêm
        wasNew = true;
      }
    } finally {
      try { _accInvalidate_(); } catch (eAccInv) {}
      _anaReleaseNamedLock('admin_access_write_lock_v1');
    }

    return JSON.stringify({ success: true, email: email, status: status, wasNew: wasNew, approvedBy: caller });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_setAccessLuongStatus(email, status)
 * Cập nhật cột D (trạng thái duyệt truy cập Lương) trong Admin_Access cho 1 email.
 * status hợp lệ: 'Duyệt' | 'Chờ'. Chỉ tác động lên dòng đã tồn tại (không upsert,
 * vì quyền Lương chỉ có ý nghĩa với user đã có trong hệ thống — nếu chưa có dòng
 * thì phải duyệt đăng nhập trước bằng spx_setAccessLoginStatus).
 * Cũng ghi lại thời điểm thao tác vào cột C (dùng chung với thời điểm yêu cầu ban đầu) để tab "Đã duyệt" sắp mới nhất lên đầu.
 * Admin cấp 1 HOẶC cấp 2 đều gọi được (kiểm tra server-side).
 */
function spx_setAccessLuongStatus(email, status) {
  try {
    var caller = Session.getActiveUser().getEmail().toLowerCase().trim();
    var adminMap = _admin_getAdminMap();
    if (!adminMap[caller]) {
      return JSON.stringify({ success: false, error: 'Chỉ admin mới được duyệt quyền Lương.' });
    }

    var validStatus = ['Duyệt', 'Chờ'];
    if (validStatus.indexOf(status) < 0) {
      return JSON.stringify({ success: false, error: 'Trạng thái không hợp lệ.' });
    }

    email = (email || '').toString().toLowerCase().trim();
    if (!email || email.indexOf('@') < 0) {
      return JSON.stringify({ success: false, error: 'Email không hợp lệ.' });
    }

    // [FIX NGHẼN LOCK 2026-07-24] Đổi sang named lock riêng cho Admin_Access — xem giải
    // thích đầy đủ ở spx_setAccessLoginStatus() / saveRiderPlan().
    if (!_anaAcquireNamedLock('admin_access_write_lock_v1', 10000, 15000)) {
      return JSON.stringify({ success: false, error: 'Hệ thống đang bận, vui lòng thử lại sau ít giây.' });
    }
    var found = false;
    try {
      var ss = _DS.ss(ADMIN_DB_ID);
      var sheet = ss.getSheetByName('Admin_Access');
      if (!sheet) return JSON.stringify({ success: false, error: 'Không tìm thấy sheet Admin_Access.' });

      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var e = data[i][0] ? data[i][0].toString().toLowerCase().trim() : '';
        if (e === email) {
          sheet.getRange(i + 1, 3, 1, 2).setValues([[new Date(), status]]); // cột C, D (gộp 1 lần ghi thay vì 2)
          found = true;
          break;
        }
      }
    } finally {
      try { _accInvalidate_(); } catch (eAccInv) {}
      _anaReleaseNamedLock('admin_access_write_lock_v1');
    }
    if (!found) return JSON.stringify({ success: false, error: 'Không tìm thấy email này — cần duyệt đăng nhập trước.' });

    // Xoá cache quyền Lương của user này (spx_checkLuongAccess dùng ScriptCache 300s)
    try {
      CacheService.getScriptCache().remove('luong_access_v1_' + email.replace(/[^a-z0-9]/g, '_'));
    } catch(ce) {}

    return JSON.stringify({ success: true, email: email, status: status, approvedBy: caller });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_setLoginAndLuongStatus(email)
 * Duyệt CÙNG LÚC cột B (đăng nhập) VÀ cột D (Lương) = 'Duyệt' cho 1 email,
 * trong 1 lần lock + 1 lần đọc/ghi sheet — dùng cho nút "Duyệt + Lương" ở tab
 * "Chờ duyệt", để admin không cần bấm 2 lần (duyệt đăng nhập xong lại phải
 * qua tab "Đã duyệt" tìm email đó lần nữa để bấm duyệt Lương).
 * Nếu email chưa có dòng (cấp quyền trước cho người chưa từng gửi yêu cầu)
 * thì upsert luôn, giống spx_setAccessLoginStatus.
 * Admin cấp 1 HOẶC cấp 2 đều gọi được (kiểm tra server-side).
 */
function spx_setLoginAndLuongStatus(email) {
  try {
    var caller = Session.getActiveUser().getEmail().toLowerCase().trim();
    var adminMap = _admin_getAdminMap();
    if (!adminMap[caller]) {
      return JSON.stringify({ success: false, error: 'Chỉ admin mới được duyệt quyền.' });
    }

    email = (email || '').toString().toLowerCase().trim();
    if (!email || email.indexOf('@') < 0) {
      return JSON.stringify({ success: false, error: 'Email không hợp lệ.' });
    }

    // [FIX NGHẼN LOCK 2026-07-24] Đổi sang named lock riêng cho Admin_Access — xem giải
    // thích đầy đủ ở spx_setAccessLoginStatus() / saveRiderPlan(). Đây chính là nút
    // "+ Lương" ở tab "Chờ duyệt" mà user báo phải bấm nhiều lần mới ăn.
    if (!_anaAcquireNamedLock('admin_access_write_lock_v1', 10000, 15000)) {
      return JSON.stringify({ success: false, error: 'Hệ thống đang bận, vui lòng thử lại sau ít giây.' });
    }
    var wasNew = false;
    var now = new Date();
    try {
      var ss = _DS.ss(ADMIN_DB_ID);
      var sheet = ss.getSheetByName('Admin_Access');
      if (!sheet) return JSON.stringify({ success: false, error: 'Không tìm thấy sheet Admin_Access.' });

      var data = sheet.getDataRange().getValues();
      var found = false;
      for (var i = 1; i < data.length; i++) {
        var e = data[i][0] ? data[i][0].toString().toLowerCase().trim() : '';
        if (e === email) {
          sheet.getRange(i + 1, 2, 1, 3).setValues([['Duyệt', now, 'Duyệt']]); // cột B,C,D (gộp 1 lần ghi thay vì 3)
          found = true;
          break;
        }
      }
      if (!found) {
        // Cấp trước cho email chưa từng gửi yêu cầu: appendRow rồi set thêm cột D
        sheet.appendRow([email, 'Duyệt', now]); // cột C (vị trí 3) đã là now
        sheet.getRange(sheet.getLastRow(), 4).setValue('Duyệt'); // cột D
        wasNew = true;
      }
    } finally {
      try { _accInvalidate_(); } catch (eAccInv) {}
      _anaReleaseNamedLock('admin_access_write_lock_v1');
    }

    try { CacheService.getScriptCache().remove('luong_access_v1_' + email.replace(/[^a-z0-9]/g, '_')); } catch(ce) {}

    return JSON.stringify({ success: true, email: email, wasNew: wasNew, approvedBy: caller });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// ============================================================

// --- ĐIỀU HƯỚNG & BẢO MẬT (DOGET) ---

// ============================================================

function doGet(e) {

  // [RESILIENCE FIX 2026-08] Trước đây nếu checkUserAccess() ném lỗi (VD sheet
  // Admin_Access tạm thời không mở được, quota Sheets API hết tạm thời, v.v.) thì
  // toàn bộ doGet() crash — nghĩa là MỌI người dùng, không chỉ 1 người, đều thấy
  // trang lỗi Apps Script xấu xí thay vì app, cho tới khi lỗi tự hết. Bọc try/catch
  // để lỗi tạm thời chỉ hiển thị 1 trang thông báo dễ hiểu + không văng traceback kỹ
  // thuật ra cho end-user, thay vì làm cả hệ thống "sập" theo đúng nghĩa đen.
  var userEmail = '';
  var isApproved = false;
  try {
    userEmail  = Session.getActiveUser().getEmail();
    isApproved = checkUserAccess(userEmail);
  } catch (eAuth) {
    _LOG && _LOG.d && _LOG.d('[doGet] Lỗi kiểm tra quyền truy cập: ' + eAuth.message);
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#334155">' +
      '<h2 style="color:#dc2626">Hệ thống đang bận</h2>' +
      '<p>Không thể xác thực quyền truy cập lúc này (có thể do đang tải cao điểm). ' +
      'Vui lòng tải lại trang sau ít phút. Nếu vẫn lỗi, liên hệ quản trị viên.</p></div>'
    ).setTitle('SPX HUB · FLM Assistant — Đang bận');
  }

  if (!isApproved) {

    var template = HtmlService.createTemplateFromFile('UI_RequestAccess');

    template.userEmail = userEmail;

    try {
      return template.evaluate()
        .setTitle('SPX HUB · FLM Assistant — Yêu cầu truy cập')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    } catch (eEval1) {
      // [RESILIENCE FIX 2026-08] template.evaluate() thực thi các scriptlet <?= ?> —
      // nếu lỗi giữa chừng (hiếm, nhưng có thể xảy ra), trả về thông báo thay vì để
      // lỗi Apps Script mặc định hiển thị cho người dùng.
      _LOG && _LOG.d && _LOG.d('[doGet] Lỗi render UI_RequestAccess: ' + eEval1.message);
      return HtmlService.createHtmlOutput(
        '<div style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#334155">' +
        '<h2 style="color:#dc2626">Hệ thống đang bận</h2><p>Vui lòng tải lại trang sau ít phút.</p></div>'
      ).setTitle('SPX HUB · FLM Assistant — Đang bận');
    }

  }

  var page        = e.parameter.page || 'index';

  // [FIX 2026-08] Trước đây switch-case này trỏ tới nhiều tên file KHÔNG khớp file
  // thật trong project ('UI_Pick', 'UI_TonDong', 'UI_QuaHan', 'tinhluong', 'UI_DoiSoat'
  // đều không tồn tại; 'JS_Rider_Plan'/'Index' sai case so với 'JS_Rider_plan'/'index'
  // thật) — bấm các link ?page=pick/tondong/salary/doisoat/riderplan (hoặc cả link mặc
  // định nếu tên file thật đúng là chữ thường) sẽ làm HtmlService ném lỗi "file không
  // tồn tại trong project", tức là link chết. Các module đó nay đều đã chuyển hẳn sang
  // kiến trúc SPA (include tĩnh trong index, hoặc lazy-load qua getModuleHtml) nên
  // không còn cần trang riêng — nay mọi case không khớp file thật đều fallback an toàn
  // về SPA chính thay vì crash. Chỉ giữ 2 case còn thật sự có file riêng.
  var htmlTemplate = 'index';

  switch (page.toLowerCase()) {

    case 'tracuu':   htmlTemplate = 'JS_Tracuu'; break;

    case 'tailieu':  htmlTemplate = 'JS_TaiLieu'; break;

    case 'kpifail':  htmlTemplate = 'JS_KPIFail';  break;

    // [FIX 2026-08-16] Trang THỬ NGHIỆM giao diện tái cấu trúc theo phân cấp mới
    // (Admin>ROM>AOM>SUP>Lead>Staff) — HOÀN TOÀN TÁCH BIỆT khỏi index.html thật,
    // chỉ truy cập được khi gõ đúng ?page=uitest, không ảnh hưởng bất kỳ user nào
    // đang dùng hệ thống bình thường. Nếu file UI_Rebuild_Test chưa tồn tại (chưa
    // deploy bản thử), cơ chế fallback ở dưới tự động quay về index thật, không lỗi.
    case 'uitest':   htmlTemplate = 'UI_Rebuild_Test'; break;

    // Mọi giá trị khác (kể cả 'pick','tondong','quahan','salary','doisoat','riderplan',
    // hoặc không truyền 'page') → dùng Index SPA, các module đó nay tải qua include()
    // tĩnh hoặc getModuleHtml() lazy-load bên trong SPA, không tách trang riêng nữa.
    default:         htmlTemplate = 'index';      break;

  }

  var template;
  try {
    template = HtmlService.createTemplateFromFile(htmlTemplate);
  } catch (eTpl) {
    // [RESILIENCE FIX] Nếu tên file bị gõ sai / bị xoá trong tương lai, đừng để cả
    // trang trắng xoá — fallback về SPA chính thay vì crash toàn bộ.
    _LOG && _LOG.d && _LOG.d('[doGet] Không tải được template "' + htmlTemplate + '": ' + eTpl.message + ' — fallback về index.');
    template = HtmlService.createTemplateFromFile('index');
  }

  template.userName = userEmail.split('@')[0].toUpperCase();

  // [MỚI - ZERO-LATENCY BOOTSTRAP] Nhúng sẵn dữ liệu quyền & trạng thái module ngay từ server
  var bootstrapData = null;
  try {
    if (typeof spx_getBootstrap === 'function') {
      var _rawBoot = spx_getBootstrap();
      bootstrapData = (typeof _rawBoot === 'string') ? JSON.parse(_rawBoot) : _rawBoot;
    }
  } catch (eBoot) {
    bootstrapData = { email: userEmail, moduleAccess: { role: 'denied', hubs: [] } };
  }
  // [MỚI - ZERO-LATENCY PREVIEW] Nếu là Admin, nạp luôn danh bạ tổ chức vào bootstrap để chọn AOM/SUP không bị lag mạng
  if (bootstrapData && bootstrapData.moduleAccess && bootstrapData.moduleAccess.role === 'admin') {
    try {
      if (typeof spx_getHubOrgDirectory === 'function') {
        var _rawDir = spx_getHubOrgDirectory();
        bootstrapData.hubOrgDir = (typeof _rawDir === 'string') ? JSON.parse(_rawDir) : _rawDir;
      }
    } catch (eDir) {}
  }
  template.BOOTSTRAP_DATA = bootstrapData || {};
  template.BOOTSTRAP_JSON = JSON.stringify(bootstrapData || {});

  var modStatusData = {};
  try {
    if (typeof spx_getModuleStatusPublic === 'function') {
      var _rawMod = spx_getModuleStatusPublic();
      var _parsedMod = (typeof _rawMod === 'string') ? JSON.parse(_rawMod) : _rawMod;
      modStatusData = (_parsedMod && _parsedMod.statuses) ? _parsedMod.statuses : {};
    }
  } catch (eMod) {
    modStatusData = {};
  }
  template.MOD_STATUS_JSON = JSON.stringify(modStatusData || {});

  try {
    return template.evaluate()
      // [ĐỔI TÊN — theo yêu cầu] Trước đây: 'SPX HUB SYSTEM - INDEX' (tên từ bản rất
      // cũ, lộ cả tên file kỹ thuật 'INDEX'). Nay dùng đúng tên in dưới logo.
      .setTitle((!page || String(page).toLowerCase() === 'index') ? 'SPX HUB · FLM Assistant' : ('SPX HUB · FLM Assistant — ' + page))
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (eEval2) {
    // [RESILIENCE FIX 2026-08] Cùng lý do như nhánh UI_RequestAccess ở trên — lỗi
    // giữa lúc render (kể cả lỗi từ include() bên trong template) không nên làm
    // trang trắng xoá hoàn toàn.
    _LOG && _LOG.d && _LOG.d('[doGet] Lỗi render template "' + htmlTemplate + '": ' + eEval2.message);
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#334155">' +
      '<h2 style="color:#dc2626">Không tải được trang</h2>' +
      '<p>Đã có lỗi khi hiển thị trang. Vui lòng tải lại. Nếu vẫn lỗi, liên hệ quản trị viên.</p></div>'
    ).setTitle('SPX HUB · FLM Assistant — Lỗi tải trang');
  }

}

// ============================================================

// --- MODULE 2: QUẢN LÝ TỒN ĐỌNG ---

// ============================================================

function onhold_processFMSInMemory(csvString) {

  if (!csvString) return { error: "Dữ liệu trống." };

  try {

    const data    = Utilities.parseCsv(csvString);

    const headers = data[0].map(h => h.trim());

    const findIdx = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

    const c = {

      id: findIdx('Order ID'), ward: findIdx('Ward Name'), reason: findIdx('OnHoldReason'),

      status: findIdx('Status'), cur: findIdx('Current Station'), dest: findIdx('Destination Station'),

      attempts: findIdx('Delivery Attempts'), recTime: findIdx('Current Station Received Time'),

      // [MỚI — theo yêu cầu trực tiếp] Tổng số LƯỢT GIAO của đơn, để theo dõi
      // trực quan đơn nào đã đi giao nhiều lần mà vẫn chưa xong.
      holdTimes: findIdx('Total of On Hold Times')

    };

    // [FIX 2026-06] ĐIỀU KIỆN ĐÚNG: một đơn chỉ thật sự là "tồn đọng của trạm X" khi
    // Current Station === Destination Station === X — tức đơn đã VỀ ĐÚNG trạm chịu
    // trách nhiệm xử lý. Nếu Current Station khác Destination Station, đơn đang ở
    // trạm trung gian (vd trạm cha/FM "Krông Pắk Hub" chưa chuyển xuống trạm con/LM
    // "Krông Pắk 02 Hub") hoặc lạc tuyến thật sự — KHÔNG được tính là backlog của bất
    // kỳ trạm nào lúc này (gộp vào trạm đích sẽ tạo backlog ảo cho trạm chưa nhận hàng;
    // gộp vào trạm hiện tại thì sai trách nhiệm xử lý). Các đơn này bị loại khỏi thống
    // kê chính, gom riêng vào danh sách `inTransitExceptions` để soi nếu cần.
    // (Trước đó gom theo Current Station đơn thuần → bị tách 1 trạm thật thành 5 "hub"
    // ảo do đơn lạc tuyến/transit; sau đó cân nhắc đổi sang Destination Station đơn
    // thuần → lại đếm nhầm backlog cho trạm chưa thực nhận hàng. Cả hai đều sai.)

    let apptIdx = findIdx('Reschedule Time');

    if (apptIdx === -1) apptIdx = 26;

    // [SỬA — theo yêu cầu trực tiếp "kiểm tra đủ cột cần thiết, báo rõ thiếu cột
    // gì"] Trước đây chỉ kiểm tra 2 cột (Order ID, Status) — mọi cột khác thiếu
    // thì KHÔNG báo lỗi, chỉ âm thầm đọc ra undefined/rỗng, số liệu sai nhưng
    // trông vẫn chạy "thành công" bình thường. Nay chia 2 mức:
    //
    // (A) BẮT BUỘC — thiếu thì DỪNG HẲN, báo lỗi rõ tên cột: Order ID, Status, và
    //     Current Station. Current Station thêm vào danh sách bắt buộc vì nó quyết
    //     định TOÀN BỘ cơ chế gom theo trạm (hub) — thiếu cột này thì mọi dòng đều
    //     có hub=undefined, bị lọc sạch ở dòng "if (!hub ...) return;" bên dưới,
    //     kết quả trả về sẽ là "thành công" nhưng 0 đơn — trông như "không có tồn
    //     đọng nào" trong khi thực ra là FILE SAI, cực kỳ dễ gây hiểu nhầm nguy
    //     hiểm nếu không chặn ngay từ đầu.
    //
    // (B) MỀM — thiếu thì VẪN CHẠY (giữ hành vi cũ, không phá luồng xử lý bình
    //     thường), nhưng gom lại thành danh sách trả về cho giao diện tự quyết định
    //     hiển thị cảnh báo hay không — đúng tinh thần đã làm với destColMissing
    //     (xem ngay bên dưới), nay áp dụng thống nhất cho các cột còn lại.
    const REQUIRED_HARD = [['Order ID', 'id'], ['Status', 'status'], ['Current Station', 'cur']];
    const missingHardCols = REQUIRED_HARD.filter(function(p){ return c[p[1]] === -1; }).map(function(p){ return p[0]; });
    if (missingHardCols.length) {
      return { error: 'File FMS thiếu cột bắt buộc: ' + missingHardCols.join(', ') + '. Không thể xử lý — kiểm tra lại file export.' };
    }
    const REQUIRED_SOFT = [
      ['Ward Name', 'ward'], ['OnHoldReason', 'reason'], ['Delivery Attempts', 'attempts'],
      ['Current Station Received Time', 'recTime'], ['Total of On Hold Times', 'holdTimes']
    ];
    const missingSoftCols = REQUIRED_SOFT.filter(function(p){ return c[p[1]] === -1; }).map(function(p){ return p[0]; });

    let hubData = {};
    const inTransitExceptions = []; // đơn Current != Destination — chưa về đúng trạm
    // [DEBUG 2026-06] Nếu không tìm thấy cột Destination Station, hàm sẽ fallback về
    // hành vi cũ (không lọc gì) để không crash — nhưng phải BÁO RÕ ra ngoài thay vì
    // âm thầm fallback, để dễ truy khi dropdown vẫn hiện nhiều hub sau khi đã fix.
    const destColMissing = (c.dest === -1);
    if (destColMissing) {
      _LOG.d('[FMS WARNING] Không tìm thấy cột "Destination Station" trong file CSV. Headers thực tế: ' + JSON.stringify(headers));
    }

    const validRows = data.slice(1).filter(r => c.dest === -1 || r[c.cur] === r[c.dest]);

    const hubs  = [...new Set(validRows.map(r => r[c.cur]))].filter(h => h);

    hubs.forEach(h => { hubData[h] = { stats: [0,0,0,0,0,0,0,0], details: [[],[],[],[],[],[],[]] }; });

    // [SỬA — theo câu hỏi trực tiếp "sai lệch số liệu giữa các lần upload"]
    // TRƯỚC: "now" lấy theo ĐỒNG HỒ LÚC BẤM UPLOAD (new Date()) — upload ĐÚNG 1
    // file CSV lúc 9h sáng và 5h chiều cùng ngày sẽ ra diffDays khác nhau cho MỌI
    // đơn, có thể đẩy đơn đang ở sát ranh giới 3 ngày / 5 ngày sang nhóm "Tồn"
    // khác giữa 2 lần upload. Luồng Live không bị lỗi này vì nó đọc thẳng bucket
    // aging_leadtime có sẵn từ nguồn — nhưng file tải tay KHÔNG có cột tương
    // đương (đã xác nhận bằng chính file CSV mẫu được cung cấp, chỉ có "Current
    // Station Received Time", không có "Aging Leadtime"). NAY: neo "now" vào
    // chính mốc THỜI GIAN MỚI NHẤT xuất hiện TRONG DỮ LIỆU (giá trị lớn nhất của
    // cột "Current Station Received Time" trên toàn file) thay vì đồng hồ xử lý —
    // mốc này nằm SẴN TRONG FILE, nên upload lại ĐÚNG file đó bất kỳ lúc nào
    // cũng luôn ra CÙNG 1 kết quả. Chỉ rơi về đồng hồ thật nếu file không có nổi
    // 1 giá trị hợp lệ (vd thiếu cột, hoặc toàn bộ ô trống/sai định dạng).
    let now = null;
    data.slice(1).forEach(function(r){
      if (c.recTime === -1) return;
      var t = new Date(r[c.recTime]);
      if (!isNaN(t.getTime()) && (!now || t.getTime() > now.getTime())) now = t;
    });
    var _nowIsFromData = !!now;
    if (!now) now = new Date(); // dự phòng — không có mốc nào trong file thì mới dùng đồng hồ thật

    data.slice(1).forEach(r => {

      // Đơn chưa về đúng trạm đích → không tính vào backlog của trạm nào, chỉ ghi nhận riêng
      if (c.dest !== -1 && r[c.cur] !== r[c.dest]) {
        if (r[c.id]) inTransitExceptions.push({ id: r[c.id], current: r[c.cur], destination: r[c.dest] });
        return;
      }

      const hub    = r[c.cur];

      const status = (r[c.status] || "").toString().trim();

      if (!hub || !hubData[hub] || !status.includes('Received')) return;

      const reason   = (r[c.reason] || "").toString().trim().toLowerCase();

      const attempts = parseInt(r[c.attempts]) || 0;

      const target   = hubData[hub];

      const zoneId  = (r.length > 37 && r[37]) ? r[37].toString().trim() : "N/A";

      const account = (r.length > 22 && r[22]) ? r[22].toString().trim() : "N/A";

      let appointmentDate = "/";

      if (apptIdx !== -1 && r.length > apptIdx && r[apptIdx]) {

        let rawDate = r[apptIdx].toString().trim();

        if (rawDate !== "0" && rawDate !== "" && rawDate.toLowerCase() !== "null" && rawDate.toLowerCase() !== "n/a") {

          let match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);

          appointmentDate = match ? match[3]+"/"+match[2]+"/"+match[1] : rawDate.substring(0,10);

        }

      }

      // [FIX] Tính recTime TRƯỚC khi build rowData để có thể đính kèm "Ngày Nhập Kho"
      // (r[6], định dạng ISO yyyy-MM-dd) vào cả rowData lẫn agingRow — trước đây
      // frontend (renderTableFMS trong JS_FMS.html) đã đọc r[6] cho cột "Ngày Nhập
      // Kho" và cho filter dropdown tương ứng, nhưng backend chưa từng gửi phần tử
      // này xuống nên cột đó luôn hiện "—" và bộ lọc luôn trống.
      const recTime = new Date(r[c.recTime]);
      const recTimeValid = !isNaN(recTime.getTime());
      const recTimeIso = recTimeValid ? Utilities.formatDate(recTime, "GMT+7", "yyyy-MM-dd") : "";

      // [MỚI] Thêm số lượt giao vào CUỐI mảng (index 7) — cố ý thêm ở cuối để
      // KHÔNG làm lệch index của 7 trường cũ, mọi nơi đang đọc row[0..6] vẫn
      // chạy y nguyên, không phải sửa theo.
      const holdTimes = parseInt(r[c.holdTimes], 10) || 0;
      const rowData = [r[c.id], zoneId, r[c.ward], account, r[c.reason], appointmentDate, recTimeIso, holdTimes];

      // [SỬA — đồng bộ với _fmsLive_classifyByAction_ theo yêu cầu trực tiếp]
      // Luồng TẢI FILE này phân loại theo VĂN BẢN lý do (không có mã như luồng
      // Live), nên phải áp cùng 2 quy tắc, nếu không 2 chế độ cho số KHÁC NHAU
      // trên cùng 1 trạm — đúng loại sai lệch khó phát hiện nhất.
      //
      // Quy tắc 1: "Buyer Never Place" -> HOÀN HÀNG (nhóm 4).
      //   Trước đây chuỗi này không khớp 'reject'/'cancel' nên rơi xuống nhánh
      //   cuối = Delay Khác. Nay bắt riêng, khớp đúng luồng Live (mã 13).
      //   Đơn VẪN được tính vào tổng tồn tại hub như mọi nhóm khác.
      //
      // Quy tắc 2: đơn đã 3+ lần giao NHƯNG lý do cuối là "Insufficient time"
      //   -> DELAY KHÁC (nhóm 2), không phải Quá 3 Ca. Lý do nghiệp vụ: giao
      //   không kịp ca, ca sau vẫn đi giao — chưa thể cập nhật hoàn hàng.
      //   Phải đặt TRƯỚC nhánh 'attempts >= 3' thì mới có tác dụng.
      //
      // Quy tắc 3: [MỚI — theo yêu cầu trực tiếp "Unable to Deliver vô phần
      //   hoàn hàng, không tính vào phần đơn hàng cần giao"] Đồng bộ với mã
      //   182 vừa thêm vào FMS_REASON_CODE_MAP ở luồng Live — luồng TẢI FILE
      //   này không có mã, chỉ có văn bản, nên bắt riêng theo chuỗi.
      if (reason.includes('buyer never place')) { target.stats[4]++; target.details[4].push(rowData); }

      else if (reason.includes('unable to deliver')) { target.stats[4]++; target.details[4].push(rowData); }

      else if (reason.includes('reject') || reason.includes('cancel')) { target.stats[4]++; target.details[4].push(rowData); }

      else if (attempts >= 3 && reason.includes('insufficient time')) { target.stats[2]++; target.details[2].push(rowData); }

      else if (attempts >= 3)            { target.stats[3]++; target.details[3].push(rowData); }

      else if (reason.includes('reschedule')) { target.stats[1]++; target.details[1].push(rowData); }

      else if (reason === 'normal' || reason === "") { target.stats[0]++; target.details[0].push(rowData); }

      else                               { target.stats[2]++; target.details[2].push(rowData); }

      if (recTimeValid) {

        const diffDays = (now.getTime() - recTime.getTime()) / 86400000;

        const agingRow = [r[c.id], zoneId, r[c.ward], account, r[c.reason], diffDays.toFixed(1)+" ngày", recTimeIso];

        if (diffDays >= 3 && diffDays <= 5) { target.stats[5]++; target.details[5].push(agingRow); }

        else if (diffDays > 5)              { target.stats[6]++; target.details[6].push(agingRow); }

      }

      target.stats[7]++;

    });

    // ── ALERT HOOK: push cảnh báo FMS vào Alert_Aggregate theo từng hub ──
    // stats[idx]: [0]Đơn Mới [1]Hẹn Giao [2]Delay Khác [3]Quá 3 Ca [4]Hoàn Hàng [5]Tồn3-5N [6]Tồn>5N [7]Total
    // [MỚI — "Top On-hold Reason" cho Manual, đồng bộ với Live] Live
    // (fms_live_getSnapshot) đã có exceptions.reasonTop từ lâu — Manual dùng
    // CHUNG cấu trúc stats[]/details[] (đã xác nhận qua comment trên: cùng 8
    // category y hệt Live) nên tái dùng ĐÚNG logic đó: chỉ đếm reason ở các
    // nhóm "ngoại lệ thật" — Hẹn giao/Delay khác/Quá 3 ca/Hoàn hàng (1-4) và
    // Tồn >5N (6) — KHÔNG tính nhóm "Đơn mới bình thường" (0) hay Tồn 3-5N (5,
    // chưa đủ nghiêm trọng). reason lấy ở ĐÚNG vị trí index 4 của rowData/
    // agingRow — cùng vị trí Live đang đọc (row[4]) — không phải suy đoán.
    // Tính RIÊNG theo từng hub (không gộp toàn bộ) vì Manual vốn duyệt dữ liệu
    // theo từng hub một qua dropdown, khác Live (có thể xem gộp nhiều hub).
    hubs.forEach(function(h) {
      var hd = hubData[h];
      if (!hd) return;
      var reasonCounts = {};
      [1, 2, 3, 4, 6].forEach(function(catIdx) {
        (hd.details[catIdx] || []).forEach(function(row) {
          var reasonKey = (row[4] || 'N/A').toString();
          reasonCounts[reasonKey] = (reasonCounts[reasonKey] || 0) + 1;
        });
      });
      hd.reasonTop = Object.keys(reasonCounts).map(function(k) { return { reason: k, count: reasonCounts[k] }; })
        .sort(function(a, b) { return b.count - a.count; }).slice(0, 8);
    });
    hubs.forEach(function(h) {
      var stats = hubData[h] ? hubData[h].stats : null;
      if (!stats) return;
      var qua3ca   = stats[3] || 0;
      var ton5n    = stats[6] || 0;
      var total    = stats[7] || 0;
      if (total === 0) return;
      var sev = (qua3ca > 0 || ton5n > 0) ? 3 : 2;
      _pushAlert_({
        stationName: h,
        source:      'fms',
        severity:    sev,
        entityRef:   '',
        message:     'FMS tổng hợp: ' + total + ' đơn tồn' +
                     (qua3ca > 0 ? ', ' + qua3ca + ' quá 3 ca' : '') +
                     (ton5n  > 0 ? ', ' + ton5n  + ' tồn >5N'  : '')
      });
    });

    // [MỚI] Trả kèm mốc "now" đã dùng để tính Tồn 3-5N/Tồn >5N — để giao diện có
    // thể hiện rõ "tính theo thời điểm nào", tránh thắc mắc khi 2 lần upload cùng
    // 1 file ra số khác nhau (trường hợp hiếm, file không có mốc hợp lệ nào).
    return { success: true, hubs: hubs.sort(), data: hubData, inTransitExceptions: inTransitExceptions, destColMissing: destColMissing, _debugHeaders: destColMissing ? headers : undefined, asOfTime: now.toISOString(), asOfFromData: _nowIsFromData, missingColumns: missingSoftCols };

  } catch (e) { return { error: e.message }; }

}

/**
 * ============================================================
 * BACKEND - MODULE 3: TRA CỨU (CẬP NHẬT MỚI)
 * Thay thế 3 hàm cũ: tracuu_getAllWards, tracuu_getAllHubs, search_searchSortCode
 * ============================================================
 *
 * LOGIC MỚI:
 *
 * 1) tracuu_getAllWards()
 *    → Trả về mảng {ward, station} từ sheet Data (cột C = Sort Code/Ward, cột L = Delivery Station1)
 *    → Frontend dùng để gợi ý autocomplete theo xã/phường khi user gõ từng chữ
 *
 * 2) tracuu_getAllHubs()
 *    → Trả về mảng {name, code} từ sheet Mail (cột B = HUB Name FMS, cột C = HUB Code)
 *    → Frontend dùng để gợi ý autocomplete theo tên/mã HUB
 *
 * 3) search_searchSortCode(query, mode)
 *    → mode = 'hub'  : Tìm theo HUB Name (FMS) hoặc HUB Code trong sheet Mail → trả email
 *    → mode = 'ward' : Tìm theo Sort Code/Xã/Phường trong sheet Data → lấy Delivery Station1
 *                      → dùng Delivery Station1 lookup sang sheet Mail → lấy email
 * ============================================================
 */

const TRACUU_SHEET_ID = '1r1jLZNHxbz8xFHJ5C8bne5YMVGXRR_k41i_NU_1TxxU';

// [FIX 2026-07-29] Đọc CHUNG sheet Mail/Data qua cache — trước đây 4 hàm
// (tracuu_getAllWards, tracuu_getAllHubs, search_searchSortCode,
// search_searchSortCode_v2) mỗi hàm tự đọc lại TOÀN BỘ 2 sheet này một cách
// ĐỘC LẬP, dù cùng đọc y hệt 1 nguồn (log Executions: 25-25 lượt/vài tiếng,
// avg vài giây/lượt — cộng dồn không nhỏ). Dữ liệu ward/hub mapping thuộc loại
// tham chiếu, ít khi đổi trong ngày → cache 30 phút là an toàn. Bất kỳ hàm nào
// cần đọc Mail/Data đều nên gọi qua đây thay vì tự getDataRange() riêng.
function _tc_getMailValues_() {
  var cached = CacheMgr.getChunked('TRACUU', 'mail_values_v1');
  if (cached) return cached;
  var sheet = _DS.ss(TRACUU_SHEET_ID).getSheetByName('Mail');
  var values = sheet ? sheet.getDataRange().getDisplayValues() : [];
  try { CacheMgr.setChunked('TRACUU', 'mail_values_v1', values, 1800); } catch (e) {}
  return values;
}
function _tc_getDataValues_() {
  var cached = CacheMgr.getChunked('TRACUU', 'data_values_v1');
  if (cached) return cached;
  var sheet = _DS.ss(TRACUU_SHEET_ID).getSheetByName('Data');
  var values = sheet ? sheet.getDataRange().getDisplayValues() : [];
  try { CacheMgr.setChunked('TRACUU', 'data_values_v1', values, 1800); } catch (e) {}
  return values;
}
 
// ----------------------------------------------------------
// HÀM 1: Lấy danh sách xã/phường kèm station (cho autocomplete)
// ----------------------------------------------------------
// ── HÀM 1 ──────────────────────────────────────────
function tracuu_getAllWards() {
  try {
    // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"]
    const data = _tc_getDataValues_(); // full rows from cột A, hàng 0 = header
    if (!data || data.length < 2) return [];

    let wards = [], seen = new Set();
    // Cột D (index 3) = Ward/Xã Phường | Cột I (index 8) = Station | Cột J (index 9) = Zone
    for (let i = 1; i < data.length; i++) {
      let ward    = (data[i][3] || '').toString().trim();
      let station = (data[i][8] || '').toString().trim();
      let zoneId  = (data[i][9] || '').toString().trim();
      if (!ward) continue;
      let key = ward + '|' + station + '|' + zoneId;
      if (!seen.has(key)) {
        wards.push({ ward, station, zoneId });
        seen.add(key);
      }
    }
    return wards;
  } catch(e) { _LOG.d('tracuu_getAllWards: ' + e.message); return []; }
}
// ----------------------------------------------------------
// HÀM 2: Lấy danh sách HUB Name + HUB Code (cho autocomplete)
// ----------------------------------------------------------
// ── HÀM 2 ──────────────────────────────────────────
function tracuu_getAllHubs() {
  try {
    const data = _tc_getMailValues_(); // full rows từ cột A, hàng 0 = header
    if (!data || data.length < 2) return [];

    let hubs = [], seen = new Set();
    // Cột B (index 1) = HUB Name (FMS)  |  Cột C (index 2) = HUB Code
    for (let i = 1; i < data.length; i++) {
      let name = (data[i][1] || '').toString().trim();
      let code = (data[i][2] || '').toString().trim();
      if (!name) continue;
      if (!seen.has(name)) { hubs.push({ name, code }); seen.add(name); }
    }
    return hubs;
  } catch(e) { _LOG.d('tracuu_getAllHubs: ' + e.message); return []; }
}
 
 
// ── HÀM 3 ──────────────────────────────────────────
function search_searchSortCode(query, mode) {
  try {
    // [SECURITY FIX — rà soát bảo mật toàn diện] Hàm này trả về danh bạ HUB
    // (tên, mã, email nội bộ, và từ hôm nay có cả địa chỉ/toạ độ) — trước đây
    // KHÔNG kiểm tra người gọi đã đăng nhập/được duyệt hay chưa. Vì Apps
    // Script cho phép gọi THẲNG bất kỳ hàm top-level nào qua
    // google.script.run bất kể frontend có gọi tới hay không, bất kỳ ai tải
    // được URL web app (kể cả chưa được duyệt truy cập) đều lấy được toàn bộ
    // danh bạ này qua console. Gate ở ĐÚNG hàm gốc (không phải chỉ ở
    // search_searchSortCode_v2) vì các Lớp 2-5 của v2 đều gọi lại hàm NÀY —
    // chặn ở đây tự động chặn luôn mọi đường gọi vào, không cần lặp lại.
    _requireApproved_();
    if (!query) return { success: false, error: 'Vui lòng nhập từ khóa!' };
 
    const mailData = _tc_getMailValues_();
    const dbData   = _tc_getDataValues_();
    if (!mailData.length || !dbData.length) return { success: false, error: 'Không tìm thấy sheet!' };
 
    const q        = query.toString().toLowerCase().trim();
    const qNoDia   = _tc_normalizeNoDiacritics(query); // hỗ trợ gõ tắt / gõ thiếu dấu / sai dấu
 
    // Build mail dict: hubName.lower → {email, name, code}
    let mailByName = {};
    for (let i = 1; i < mailData.length; i++) {
      let name  = (mailData[i][1] || '').toString().trim();
      let code  = (mailData[i][2] || '').toString().trim();
      let email = (mailData[i][4] || '').toString().trim();
      if (name) mailByName[name.toLowerCase()] = { email, name, code };
    }
 
    let results = [], seen = new Set();
 
    // MODE HUB: tìm trực tiếp trong sheet Mail
    if (!mode || mode === 'hub') {
      // [MỚI — theo yêu cầu trực tiếp "tra hub trả về địa chỉ, toạ độ luôn"]
      // Tái dùng ĐÚNG nguồn dữ liệu đã dùng ở tab "Trạm quản lý" (Admin) —
      // không tạo nguồn đọc riêng, đảm bảo nhất quán 1 nguồn sự thật duy nhất.
      var hubInfoMap = _spxGetHubInfoMap_().byHub || {};
      var _tcMatched = [], _tcAnyUnmatched = false;
      for (let i = 1; i < mailData.length; i++) {
        let name  = (mailData[i][1] || '').toString().trim();
        let code  = (mailData[i][2] || '').toString().trim();
        let email = (mailData[i][4] || '').toString().trim();
        if (!name) continue;
        if (name.toLowerCase().includes(q) || code.toLowerCase().includes(q)
            || _tc_normalizeNoDiacritics(name).includes(qNoDia)) {
          let key = name + '_' + code;
          if (!seen.has(key)) {
            var _hkey = _orgNormHub_(name);
            if (!hubInfoMap[_hkey]) _tcAnyUnmatched = true;
            _tcMatched.push({ key, name, code, email, hkey: _hkey });
            seen.add(key);
          }
        }
      }
      // [MỚI — TỰ PHỤC HỒI, cùng cơ chế đã kiểm chứng ở "Trạm quản lý" (Admin)]
      // Sheet "Mail" của Tra cứu nằm ở 1 file HOÀN TOÀN KHÁC với "Hub/SOC infor"
      // — nếu cache hub-info đang giữ bản cũ (dựng trước khi trạm này có/đổi
      // tên trong sheet nguồn), tên khớp 100% ngoài thực tế vẫn ra rỗng. Tự
      // làm mới NGAY MỘT LẦN khi phát hiện thiếu khớp, trước khi chịu thua —
      // không bắt Admin phải nhớ bấm "Làm mới cache trạm" mỗi lần.
      if (_tcAnyUnmatched) {
        hubInfoMap = _spxGetHubInfoMap_(true).byHub || hubInfoMap;
      }
      _tcMatched.forEach(function(m) {
        var hInfo = hubInfoMap[m.hkey] || null;
        results.push({ type: 'hub', station: m.name, sortCode: m.code,
                       province: 'Danh bạ HUB', email: m.email || 'Liên hệ quản lý', wardName: '',
                       // [MỚI] Địa chỉ + toạ độ thật từ sheet Hub/SOC infor — không có nghĩa là
                       // rỗng nếu hub chưa có trong sheet đó (VD hub quá mới), frontend tự ẩn
                       // phần này khi address rỗng, không hiện "-" gây rối mắt.
                       address:     hInfo ? hInfo.address  : '',
                       coord:       hInfo ? hInfo.coord    : '',
                       hubProvince: hInfo ? hInfo.province : '',
                       hubCity:     hInfo ? hInfo.city     : '',
                       parentHub:   hInfo ? hInfo.parent   : '',
                       // [MỚI — chẩn đoán] Vẫn không khớp được sau khi đã tự làm mới cache —
                       // gợi ý tên gần giống nhất để lộ ra ngay đây là lệch tên thật (không
                       // phải cache cũ), khỏi phải mở riêng 1 lượt điều tra khác.
                       _hubInfoUnmatched: !hInfo,
                       _hubInfoSuggest: hInfo ? [] : _spxSuggestHubMatches_(m.hkey, hubInfoMap, 3) });
      });
    }
 
    // MODE WARD: tìm trong sheet Data (cấu trúc mới, theo Delivery Hub Zone 5.3)
    // Cột D (index 3)  = ward list -- old ward
    // Cột E (index 4)  = L2 - District
    // Cột F (index 5)  = L1 - Old   (tỉnh/thành TRƯỚC sáp nhập)
    // Cột G (index 6)  = L1 - New   (tỉnh/thành SAU sáp nhập)
    // Cột I (index 8)  = Station name
    // Cột J (index 9)  = Hub zone id (Zone)
    // Cột K (index 10) = Hub zone name
    if (!mode || mode === 'ward') {
      const stationProvinceMap = _tc_getStationProvinceMap(); // { normalizedStation: province } — fallback nếu Data thiếu L1-New
      for (let i = 1; i < dbData.length; i++) {
        let ward        = (dbData[i][3]  || '').toString().trim();  // cột D
        let district     = (dbData[i][4]  || '').toString().trim();  // cột E
        let provinceOld  = (dbData[i][5]  || '').toString().trim();  // cột F
        let provinceNew  = (dbData[i][6]  || '').toString().trim();  // cột G
        let station      = (dbData[i][8]  || '').toString().trim();  // cột I
        let zoneId       = (dbData[i][9]  || '').toString().trim();  // cột J
        let hubZoneName  = (dbData[i][10] || '').toString().trim();  // cột K
        if (!ward || !station) continue;
        if (ward.toLowerCase().includes(q) || _tc_normalizeNoDiacritics(ward).includes(qNoDia)) {
          let mailInfo = mailByName[station.toLowerCase()];
          let key = station + '_' + ward + '_' + zoneId;
          if (!seen.has(key)) {
            let finalProvince = provinceNew || stationProvinceMap[_tc_normalize(station)] || '';
            results.push({
              type:        'ward',
              station,
              sortCode:    mailInfo ? mailInfo.code  : '',
              province:    finalProvince,   // giữ tên field cũ để không vỡ logic cảnh báo trùng tỉnh + frontend cũ
              provinceOld: provinceOld,     // MỚI: tỉnh/thành trước sáp nhập
              provinceNew: provinceNew,     // MỚI: tỉnh/thành sau sáp nhập
              district:    district,        // MỚI: quận/huyện cũ
              hubZoneName: hubZoneName,     // MỚI: tên hub zone
              email:       mailInfo ? mailInfo.email : 'Liên hệ quản lý',
              wardName:    ward,
              zoneId:      zoneId
            });
            seen.add(key);
          }
        }
      }
      // Nếu nhiều tỉnh khác nhau cùng trả kết quả (VD "Xuân Phú" trùng tên ở nhiều nơi),
      // sắp xếp theo tỉnh để các địa danh cùng tên nhưng khác tỉnh không bị xen kẽ lộn xộn
      const provincesInResult = new Set(results.map(r => r.province).filter(Boolean));
      if (provincesInResult.size > 1) {
        results.sort((a, b) => (a.province || '').localeCompare(b.province || '', 'vi'));
      }
    }
 
    return { success: true, data: results };
  } catch(e) { _LOG.d('search_searchSortCode: ' + e.message); return { success: false, error: e.message }; }
}

/**
 * ============================================================
 * MODULE 3B: XỬ LÝ TÌM KIẾM ĐỊA CHỈ SAU SÁP NHẬP XÃ/PHƯỜNG
 * ============================================================
 * search_searchSortCode_v2(query, mode) là ĐIỂM VÀO MỚI cho frontend
 * (thay thế search_searchSortCode trong JS_TraCuu.html).
 *
 * QUAN TRỌNG: sheet Data chỉ lưu tên xã/phường CŨ (trước sáp nhập) và chỉ có
 * cặp Old/New ở cấp TỈNH (cột L1-Old/L1-New) — KHÔNG có bảng ánh xạ Old/New
 * cấp xã/phường nào trong Data để so khớp tĩnh. Vì vậy khi user gõ tên xã/
 * phường MỚI (sau sáp nhập 2025), hệ thống phải "hỏi" 1 công cụ tìm kiếm/AI
 * có kiến thức cập nhật để suy ra (các) tên xã/phường CŨ tương ứng, rồi mới
 * tra tiếp trong Data như bình thường.
 *
 * Luồng xử lý (dừng ngay khi có kết quả ở lớp nào):
 *   Lớp 1: search_searchSortCode gốc (match/includes trực tiếp trong Data)
 *   Lớp 2: tra bảng "ResolvedAlias" đã học từ các lần tra AI/geocode trước đó
 *          — O(1), không tốn API. Hỗ trợ 1 query → NHIỀU xã cũ (N:1 do sáp nhập).
 *   Lớp 3: fuzzy match (Jaccard theo token) trực tiếp trong Data — bắt các
 *          case tên mới còn giữ 1 phần tên cũ, không cần gọi API
 *   Lớp 4: dùng AI SuperAgent (insea.io, _callInsea — cùng hạ tầng AI mascot
 *          đang dùng) như 1 "công cụ tìm kiếm" để suy ra tên xã/phường cũ đã
 *          sáp nhập thành địa danh user gõ. Hỗ trợ trả về NHIỀU xã cũ nếu 1
 *          phường mới gộp từ nhiều phường cũ khác station. Kết quả được lưu
 *          vào ResolvedAlias để lần sau tra thẳng Lớp 2, không gọi AI lại.
 *   Lớp 5: Geocoding API (Nominatim, miễn phí) — phương án cuối cùng nếu Lớp 4
 *          không xác định được (AI lỗi/quota/không chắc chắn).
 *   Không lớp nào ra kết quả → ghi vào sheet "UnresolvedQueries" để đội vận
 *   hành biết còn địa chỉ nào chưa cập nhật, đồng thời báo rõ cho user.
 * ============================================================
 */

const TC_ALIAS_SHEET_NAME = 'ResolvedAlias';
const TC_ALIAS_CACHE_KEY  = 'TC_WARD_ALIAS_MAP';
const TC_ALIAS_CACHE_TTL  = 21600; // 6 giờ (giới hạn CacheService: tối đa 21600s)
const TC_FUZZY_THRESHOLD  = 0.4;   // ngưỡng Jaccard để coi là "đủ giống"

// ── Bổ sung: tra Tỉnh/Thành theo tên Station, để phân biệt các ward TRÙNG TÊN
// nhưng thuộc các tỉnh khác nhau (VD "Xuân Phú" có ở cả Huế lẫn Thanh Hóa).
// Tái dùng bảng "AOM SUP"/"SA" mà module Rider Plan đang dùng (_rp_buildSAMap) —
// không cần tạo thêm dữ liệu, vì Station -> Province đã tồn tại sẵn ở đó.
function _tc_getStationProvinceMap() {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'TC_STATION_PROVINCE_MAP';
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var map = {};
  var _tcOk = true;
  try {
    var srcSS = _DS.ss(RP_SOURCE_ID); // sheet "AOM SUP"/"SA", đã dùng cho Rider Plan
    var saMap = _rp_buildSAMap(srcSS); // { hubName: {province, sup} }
    Object.keys(saMap).forEach(function(hub) {
      map[_tc_normalize(hub)] = saMap[hub].province;
    });
  } catch (e) {
    _LOG.d('_tc_getStationProvinceMap: ' + e.message);
    _tcOk = false;
  }
  // [SỬA] Trước đây lỗi đọc hay bản đồ rỗng vẫn bị lưu cache TC_ALIAS_CACHE_TTL (6 GIỜ) -> Tra cứu mất tỉnh của mọi trạm suốt 6 giờ.
  if (_tcOk && Object.keys(map).length > 0) { try { cache.put(cacheKey, JSON.stringify(map), TC_ALIAS_CACHE_TTL); } catch (eC) {} }
  return map;
}

// ── Chuẩn hóa chuỗi: bỏ tiền tố hành chính, dấu câu, khoảng trắng thừa (VẪN GIỮ DẤU) ──
function _tc_normalize(s) {
  return (s || '').toString().normalize('NFC').toLowerCase()
    .replace(/^(xã|phường|thị trấn|tt\.?)\s+/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Bỏ dấu tiếng Việt hoàn toàn — CÙNG LOGIC với hàm norm() ở frontend (JS_TraCuu.html)
// để đảm bảo tìm được cả khi user gõ tắt không dấu (VD "binh thuan" hoặc "bình thuan"
// gõ thiếu dấu vẫn khớp được "Bình Thuận") ──
function _tc_stripDiacritics(s) {
  if (!s) return '';
  return s.toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Chuẩn hóa "không dấu" đầy đủ (bỏ tiền tố hành chính + bỏ dấu) — dùng làm
// khóa so khớp/alias/cache, để khớp được dù user gõ có dấu, thiếu dấu, hay sai dấu ──
function _tc_normalizeNoDiacritics(s) {
  return _tc_stripDiacritics(_tc_normalize(s));
}

// ── Độ tương đồng theo token (Jaccard) — so khớp KHÔNG DẤU để bắt được cả lỗi gõ tắt/sai dấu ──
function _tc_similarity(a, b) {
  var tokensA = _tc_normalizeNoDiacritics(a).split(' ').filter(Boolean);
  var tokensB = _tc_normalizeNoDiacritics(b).split(' ').filter(Boolean);
  var setB = {}; tokensB.forEach(function(t){ setB[t] = true; });
  var unionSet = {}; tokensA.forEach(function(t){ unionSet[t]=true; }); tokensB.forEach(function(t){ unionSet[t]=true; });
  var inter = 0; tokensA.forEach(function(t){ if (setB[t]) inter++; });
  var unionSize = Object.keys(unionSet).length;
  return unionSize ? inter / unionSize : 0;
}


// ── Lấy (hoặc tạo mới) sheet lưu các alias đã "học" ──
function _tc_getAliasSheet_() {
  var ss = _DS.ss(TRACUU_SHEET_ID);
  var sheet = ss.getSheetByName(TC_ALIAS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TC_ALIAS_SHEET_NAME);
    sheet.appendRow(['OldQueryNorm', 'OldQueryLabel', 'ResolvedNewWard', 'Timestamp']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ── Đọc bảng alias, có cache để không phải đọc sheet mỗi lần search ──
// Trả về { normQuery: [oldWard1, oldWard2, ...] } — hỗ trợ 1 địa danh mới
// gộp từ NHIỀU xã/phường cũ (N:1). Đọc được cả dữ liệu cũ (lưu 1 chuỗi đơn).
function _tc_getResolvedAliasMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(TC_ALIAS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  var sheet = _tc_getAliasSheet_();
  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
    data.forEach(function(r) {
      var norm = (r[0] || '').trim();
      var raw  = (r[2] || '').trim();
      if (!norm || !raw) return;
      var arr;
      try { arr = JSON.parse(raw); if (!Array.isArray(arr)) arr = [String(arr)]; }
      catch (e) { arr = [raw]; } // dữ liệu cũ lưu dạng 1 chuỗi đơn — vẫn đọc được bình thường
      arr = arr.map(function(w){ return (w||'').toString().trim(); }).filter(Boolean);
      if (arr.length) map[norm] = arr;
    });
  }
  cache.put(TC_ALIAS_CACHE_KEY, JSON.stringify(map), TC_ALIAS_CACHE_TTL);
  return map;
}

// ── Ghi 1 alias mới đã được xác nhận (từ Lớp 4/5) ──
// oldWards: string (1 xã) hoặc array (nhiều xã cũ gộp thành 1 địa danh mới)
function _tc_saveResolvedAlias(oldQuery, oldWards) {
  try {
    var arr = Array.isArray(oldWards) ? oldWards : [oldWards];
    arr = arr.map(function(w){ return (w||'').toString().trim(); }).filter(Boolean);
    if (!arr.length) return;

    var norm = _tc_normalizeNoDiacritics(oldQuery);
    var sheet = _tc_getAliasSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var existing = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
      for (var i = 0; i < existing.length; i++) {
        if ((existing[i][0] || '').trim() === norm) return; // đã có rồi, khỏi ghi trùng
      }
    }
    sheet.appendRow([norm, oldQuery, JSON.stringify(arr), new Date()]);

    var cache = CacheService.getScriptCache();
    var map = JSON.parse(cache.get(TC_ALIAS_CACHE_KEY) || '{}');
    map[norm] = arr;
    cache.put(TC_ALIAS_CACHE_KEY, JSON.stringify(map), TC_ALIAS_CACHE_TTL);
  } catch (e) { _LOG.d('_tc_saveResolvedAlias: ' + e.message); }
}

// ── Sheet ghi lại các query KHÔNG lớp nào tra ra — để đội vận hành biết
// còn địa chỉ (mới sáp nhập) nào chưa có trong Data mà cần bổ sung ──
function _tc_getUnresolvedSheet_() {
  var ss = _DS.ss(TRACUU_SHEET_ID);
  var sheet = ss.getSheetByName('UnresolvedQueries');
  if (!sheet) {
    sheet = ss.insertSheet('UnresolvedQueries');
    sheet.appendRow(['Query gốc', 'QueryNorm', 'Số lần bị hỏi', 'Lần đầu', 'Lần gần nhất']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _tc_logUnresolvedQuery(query) {
  try {
    var norm = _tc_normalizeNoDiacritics(query);
    if (!norm) return;
    var sheet = _tc_getUnresolvedSheet_();
    var lastRow = sheet.getLastRow();
    var now = new Date();
    if (lastRow >= 2) {
      var existing = sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues();
      for (var i = 0; i < existing.length; i++) {
        if ((existing[i][1] || '').trim() === norm) {
          var rowIdx = i + 2;
          var curCount = Number(sheet.getRange(rowIdx, 3).getValue()) || 0;
          sheet.getRange(rowIdx, 3).setValue(curCount + 1);
          sheet.getRange(rowIdx, 5).setValue(now);
          return;
        }
      }
    }
    sheet.appendRow([query, norm, 1, now, now]);
  } catch (e) { _LOG.d('_tc_logUnresolvedQuery: ' + e.message); }
}

// ── Lớp 4: dùng AI SuperAgent (insea.io) làm "công cụ tìm kiếm" để suy ra
// (các) xã/phường CŨ đã sáp nhập/đổi tên thành địa danh user gõ. Dùng chung
// hạ tầng _callInsea đang phục vụ AI mascot — có cache theo query 7 ngày để
// đỡ tốn quota cho các câu hỏi lặp lại. ──
function _tc_llmWardLookup(query) {
  try {
    var prompt = ''
      + 'Bạn là chuyên gia hành chính Việt Nam, nắm rõ đợt sáp nhập đơn vị hành chính '
      + 'cấp xã/phường và cấp tỉnh năm 2025.\n'
      + 'Địa danh cần tra: "' + query + '"\n'
      + 'Hãy xác định (các) xã/phường TRƯỚC sáp nhập (tên cũ) đã được sáp nhập và/hoặc '
      + 'đổi tên thành địa danh trên. Nếu địa danh này vốn dĩ đã là tên cũ (chưa từng đổi), '
      + 'trả về chính nó. Nếu không tìm được thông tin đáng tin cậy, trả về mảng rỗng — '
      + 'TUYỆT ĐỐI không suy đoán/bịa tên.\n'
      + 'CHỈ trả lời bằng JSON hợp lệ, không kèm bất kỳ chữ nào khác, đúng định dạng:\n'
      + '{"oldWards":["Tên xã/phường cũ 1","Tên xã/phường cũ 2"],"confidence":"high|medium|low"}';

    var res = _callInsea(prompt, { cacheKey: 'wm_' + _tc_normalizeNoDiacritics(query), cacheTTL: 604800 }); // cache 7 ngày
    if (!res || !res.success || !res.text) return null;

    var raw = res.text.toString().trim()
      .replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    var m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;

    var parsed = JSON.parse(m[0]);
    if (!parsed || !Array.isArray(parsed.oldWards) || !parsed.oldWards.length) return null;

    var out = parsed.oldWards.map(function(w){ return (w || '').toString().trim(); }).filter(Boolean);
    return out.length ? out : null;
  } catch (e) {
    _LOG.d('_tc_llmWardLookup: ' + e.message);
    return null;
  }
}

// ── Lớp 5: gọi Nominatim (OpenStreetMap) để suy ra tên xã/phường hiện hành ──
// Miễn phí, KHÔNG cần API key. Theo chính sách sử dụng của Nominatim:
//   - Tối đa 1 request/giây → có Utilities.sleep(1000) trước mỗi lần gọi
//   - Bắt buộc gửi User-Agent định danh ứng dụng (thay email bên dưới bằng email thật của bạn/team)
//   - Nếu tần suất tra cứu lớn hơn nhiều, nên cân nhắc tự host Nominatim thay vì dùng server công cộng
function _tc_geocodeFallback(query) {
  var address = encodeURIComponent(query + ', Việt Nam');
  var url = 'https://nominatim.openstreetmap.org/search?q=' + address
          + '&format=json&addressdetails=1&countrycodes=vn&limit=1&accept-language=vi';

  try {
    Utilities.sleep(1000); // tôn trọng rate-limit 1 req/giây của Nominatim
    var resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'SPX-HUB-Ops-TraCuu/1.0 (noi bo cong ty; lien he: thay-email-cua-ban@congty.vn)' }
    });
    var json = JSON.parse(resp.getContentText());
    if (!json || !json.length) {
      _LOG.d('_tc_geocodeFallback (Nominatim): không có kết quả cho "' + query + '"');
      return null;
    }
    var addr = json[0].address || {};
    // Cấp xã/phường trong dữ liệu OSM VN thường nằm ở 1 trong các field sau, tùy khu vực
    var ward = addr.suburb || addr.quarter || addr.neighbourhood
             || addr.city_district || addr.town || addr.village || addr.hamlet || null;
    return ward;
  } catch (e) {
    _LOG.d('_tc_geocodeFallback (Nominatim) error: ' + e.message);
    return null;
  }
}

/**
 * GHI CHÚ: Nominatim không cần API key nên KHÔNG cần chạy hàm setup nào trước khi dùng.
 * Chỉ cần đảm bảo domain "nominatim.openstreetmap.org" không bị chặn trong policy mạng
 * của tổ chức bạn (Apps Script mặc định không bị giới hạn domain).
 */

// ── Lớp 3: fuzzy match trực tiếp trong Data (không cần API, đã bỏ dấu khi so khớp) ──
function _tc_findWardFuzzy(query, dbData) {
  var best = null, bestScore = 0;
  for (var i = 1; i < dbData.length; i++) {
    var ward = (dbData[i][3] || '').toString().trim();
    if (!ward) continue;
    var score = _tc_similarity(query, ward);
    if (score > bestScore) { bestScore = score; best = ward; }
  }
  return bestScore >= TC_FUZZY_THRESHOLD ? { ward: best, score: bestScore } : null;
}

/**
 * ĐIỂM VÀO CHÍNH — gọi hàm này thay cho search_searchSortCode trong frontend.
 * Trả về đúng format cũ ({ success, data: [...] }), chỉ thêm 2 field trong mỗi item:
 *   - matchedFromOldName: nếu có giá trị, UI hiển thị "đã cập nhật từ tên cũ"
 *   - _layer: 1 | 2 | 3 (phục vụ debug, không bắt buộc hiển thị cho user)
 */
function search_searchSortCode_v2(query, mode) {
  if (!query) return { success: false, error: 'Vui lòng nhập từ khóa!' };

  // Lớp 1: hàm gốc (đủ nhanh, xử lý được phần lớn case bình thường)
  var direct = search_searchSortCode(query, mode);
  if (direct.success && direct.data && direct.data.length > 0) {
    direct.data.forEach(function(r){ r._layer = 1; });
    return direct;
  }
  if (mode === 'hub') return direct; // HUB không có khái niệm sáp nhập, dừng ở đây

  try {
    var dbData = _tc_getDataValues_();

    // Lớp 2: bảng alias đã học từ các lần tra AI/geocode trước — hỗ trợ 1 query
    // khớp NHIỀU xã cũ (N:1, do 1 phường mới có thể gộp từ nhiều phường cũ)
    var aliasMap = _tc_getResolvedAliasMap();
    var mappedOldWards = aliasMap[_tc_normalizeNoDiacritics(query)];
    if (mappedOldWards && mappedOldWards.length) {
      var merged2 = [], seen2 = new Set();
      mappedOldWards.forEach(function(ow) {
        var r = search_searchSortCode(ow, 'ward');
        if (r.success && r.data && r.data.length) {
          r.data.forEach(function(item) {
            var k = item.station + '_' + item.wardName + '_' + item.zoneId;
            if (!seen2.has(k)) { seen2.add(k); merged2.push(item); }
          });
        }
      });
      if (merged2.length) {
        merged2.forEach(function(r){ r.matchedFromOldName = query; r._layer = 2; });
        return { success: true, data: merged2 };
      }
    }

    // Lớp 3: fuzzy match trực tiếp, không cần API
    var fuzzy = _tc_findWardFuzzy(query, dbData);
    if (fuzzy) {
      var r3 = search_searchSortCode(fuzzy.ward, 'ward');
      if (r3.success && r3.data.length > 0) {
        r3.data.forEach(function(r){ r._layer = 3; });
        return r3;
      }
    }

    // Lớp 4: AI SuperAgent (insea.io) làm công cụ tìm kiếm — suy ra (các) xã/phường
    // cũ đã sáp nhập/đổi tên thành địa danh user gõ. Hỗ trợ N:1 (nhiều xã cũ khác station).
    var aiOldWards = _tc_llmWardLookup(query);
    if (aiOldWards && aiOldWards.length) {
      var merged4 = [], seen4 = new Set();
      aiOldWards.forEach(function(ow) {
        var r = search_searchSortCode(ow, 'ward');
        if (r.success && r.data && r.data.length) {
          r.data.forEach(function(item) {
            var k = item.station + '_' + item.wardName + '_' + item.zoneId;
            if (!seen4.has(k)) { seen4.add(k); merged4.push(item); }
          });
        }
      });
      if (merged4.length) {
        _tc_saveResolvedAlias(query, aiOldWards); // học lại — lần sau tra thẳng Lớp 2, không gọi AI nữa
        merged4.forEach(function(r){ r.matchedFromOldName = query; r._layer = 4; });
        return { success: true, data: merged4 };
      }
    }

    // Lớp 5: Geocoding API (Nominatim) — phương án cuối cùng, khi AI cũng không xác định được
    var geoWard = _tc_geocodeFallback(query);
    if (geoWard) {
      var r5 = search_searchSortCode(geoWard, 'ward');
      if (r5.success && r5.data.length > 0) {
        _tc_saveResolvedAlias(query, [geoWard]); // học lại cho lần sau
        r5.data.forEach(function(r){ r.matchedFromOldName = query; r._layer = 5; });
        return r5;
      }
    }

    // Không lớp nào ra kết quả — ghi log để đội vận hành biết còn địa chỉ nào
    // (rất có thể vừa sáp nhập/đổi tên) chưa được cập nhật trong Data
    _tc_logUnresolvedQuery(query);
    return { success: true, data: [] }; // vẫn trả success để UI hiện "không tìm thấy" như bình thường
  } catch (e) {
    _LOG.d('search_searchSortCode_v2: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ============================================================
 * HƯỚNG DẪN THAY THẾ TRONG BACKEND.GS
 * ============================================================
 *
 * 1. Mở file Code.gs (hoặc Backend.gs) trong Apps Script Editor
 * 2. Tìm và XÓA 3 hàm cũ:
 *      - tracuu_getAllWards()
 *      - tracuu_getAllHubs()
 *      - search_searchSortCode()  (hàm cũ chỉ nhận 1 tham số)
 * 3. DÁN toàn bộ nội dung file này vào thay thế
 * 4. Lưu lại (Ctrl+S)
 *
 * THAY ĐỔI SO VỚI PHIÊN BẢN CŨ:
 * ─────────────────────────────────────────────────────────
 * tracuu_getAllWards():
 *   CŨ: chỉ trả về [{ward: string}]
 *   MỚI: trả về [{ward, station}] — gồm cả Delivery Station1
 *        để autocomplete biết xã thuộc hub nào
 *
 * tracuu_getAllHubs():
 *   CŨ: trả về [string]  (chỉ tên HUB)
 *   MỚI: trả về [{name, code}]  (tên + mã HUB Code)
 *        để autocomplete hiển thị cả mã HUB
 *
 * search_searchSortCode(query, mode):
 *   CŨ: 1 tham số, tìm đồng thời cả Hub và Ward
 *   MỚI: 2 tham số (query + mode)
 *        mode='hub'  → chỉ tìm trong sheet Mail
 *        mode='ward' → tìm trong sheet Data, map sang Mail lấy email
 *        (nếu không truyền mode → tìm cả hai, giữ backward compat)
 *
 * Kết quả trả về có thêm field:
 *   - type: 'hub' | 'ward'    (để UI phân biệt màu/icon)
 *   - wardName: string        (tên xã/phường gốc user tìm)
 * ─────────────────────────────────────────────────────────
 */

// ============================================================

// --- MODULE 4: QUÁ HẠN (AGING) ---

// ============================================================

// [ĐÃ XOÁ — aging_getCoreData(), chính comment gốc của hàm này đã tự xác nhận
// "KHÔNG CÒN FRONTEND NÀO GỌI TỚI" (tiền thân của aging_getMasterData() đang
// dùng thật) — xác nhận lại qua grep toàn bộ 4 file .gs + .html]

// [ĐÃ XOÁ — aging_getLostData() và aging_getFMData(), xác nhận qua grep toàn
// bộ 4 file .gs + toàn bộ .html — không còn nơi nào gọi tới. Cả 2 đều lấy
// từng loại dữ liệu riêng lẻ (Lost/FM), đã được thay thế bởi endpoint gộp
// aging_getMasterData() đang dùng thật xuyên suốt Quá Hạn/Tổng quan.]


// ============================================================
// PATCH: aging_getMasterData() — Thêm phân quyền
// THAY THẾ hàm aging_getMasterData() cũ trong backend.gs
// Cache giờ là per-user (key theo email) thay vì global,
// vì mỗi user thấy tập hợp hub khác nhau.
// ============================================================


// ============================================================
// PHÂN QUYỀN MODULE — SHARED PERMISSION ENGINE
// Dùng chung cho Quá Hạn (aging) và KPI Fail (kpifail)
// 3 tầng: admin > aom > sup > station
// Nguồn: sheet "AOM SUP" trong RP_SOURCE_ID
//   col3 = AOM_Email → hubs tương ứng (col8 = Hub_Name AMH)
//   col5 = Sup_Email  → hubs tương ứng
//   DS Nhân viên col7=Email, col4=Nơi làm việc → 1 hub/hàng
//     (1 email xuất hiện ở nhiều hàng = quản lý nhiều trạm, role station)
// Conflict AOM+SUP trên cùng email → lấy AOM (role cao hơn)
// ============================================================

/**
 * getModuleAccess()
 * Trả về { role: 'admin'|'aom'|'sup'|'station'|'denied', email, hubs: [] }
 * Tái dùng _rp_lookupSA (Rider Plan engine) để đảm bảo cùng sheet, cùng
 * column, cùng hub format — tránh mismatch khi filter aging/kpifail data.
 * Cache ScriptCache 120s per-user.
 */
/**
 * _spx_mapRoleToLevel_(access)
 * [FIX 2026-08-16] Ánh xạ role gốc (admin/aom/sup/station/denied — KHÔNG ĐỔI, hàng
 * trăm hàm khác trong hệ thống vẫn đang dựa thẳng vào các giá trị này) sang cấp bậc
 * MỚI theo đúng thứ bậc đã thống nhất: Admin > ROM > AOM > SUP > Lead > Staff. Đây
 * là lớp ánh xạ THÊM VÀO — access.role/access.hubs vẫn giữ nguyên y hệt cũ cho MỌI
 * hàm hiện có, không phá vỡ bất kỳ phân quyền nào đang chạy.
 *
 * - ROM (levelNum=2): CHƯA có dữ liệu nguồn (đội vận hành xác nhận sẽ bổ sung sau) —
 *   chưa có role nào ánh xạ vào đây, chỉ CHỪA SẴN vị trí trong thứ bậc số để khi có
 *   dữ liệu ROM thật, không phải đánh số lại toàn bộ các cấp còn lại.
 * - Lead/Staff (levelNum=5/6): sheet "DS Nhân viên" HIỆN CHƯA có cột chức danh —
 *   mọi 'station' mặc định là Lead (khớp cách dùng thực tế hiện tại — chính prompt AI
 *   nội bộ đã gọi role này là "Hub Team Lead"). Khi cột chức danh được bổ sung (đã dò
 *   tự động qua TÊN cột ở _rp_lookupSA(), không cần sửa hàm này), access.title sẽ có
 *   giá trị thật và hàm này TỰ ĐỘNG tách đúng Lead/Staff — không cần đổi code thêm.
 */
function _spx_mapRoleToLevel_(access) {
  var role = access.role;
  if (role === 'admin') return { levelNum: 1, levelCode: 'admin', levelLabel: 'Admin' };
  if (role === 'aom')   return { levelNum: 3, levelCode: 'aom',   levelLabel: 'AOM' };
  if (role === 'sup')   return { levelNum: 4, levelCode: 'sup',   levelLabel: 'SUP' };
  if (role === 'station') {
    var title = (access.title || '').toString().trim().toLowerCase();
    if (title === 'staff' || title === 'nhân viên') {
      return { levelNum: 6, levelCode: 'staff', levelLabel: 'Staff' };
    }
    return { levelNum: 5, levelCode: 'lead', levelLabel: 'Lead' };
  }
  return { levelNum: 99, levelCode: 'denied', levelLabel: 'Không có quyền' };
}

/** Gắn thêm levelNum/levelCode/levelLabel vào 1 object access đã có role/hubs — dùng chung ở mọi điểm return của getModuleAccess(). */
function _spx_withLevel_(result) {
  var lvl = _spx_mapRoleToLevel_(result);
  result.levelNum = lvl.levelNum;
  result.levelCode = lvl.levelCode;
  result.levelLabel = lvl.levelLabel;
  return result;
}

function getModuleAccess() {
  var CACHE_TTL = 120;
  var sc = CacheService.getScriptCache();

  try {
    var email = Session.getActiveUser().getEmail().toLowerCase().trim();
    if (!email) return _spx_withLevel_({ role: 'denied', email: '', hubs: [] });

    // Admin bypass — dùng sheet Admin_Roles (2 cấp), có failsafe cứng trong code
    var adminMap = _admin_getAdminMap();
    if (adminMap[email]) {
      return _spx_withLevel_({ role: 'admin', level: adminMap[email], email: email, hubs: [] }); // hubs=[] → không lọc, thấy tất cả
    }

    // Thử cache per-user
    // [SỬA] v2 -> v3: bộ đệm cũ chứa cấp bậc SAI (mọi user cấp trạm đều là Lead do
    // thiếu chức danh). Đổi phiên bản khoá để mọi người được tính lại ngay sau deploy.
    var cacheKey = 'mod_access_v3_' + email.replace(/[^a-z0-9]/g, '_');
    try {
      var cached = sc.get(cacheKey);
      if (cached) return _spx_withLevel_(JSON.parse(cached));
    } catch(ce) {}

    // Dùng _rp_lookupSA — cùng engine với Rider Plan, cùng sheet SA, cùng col6 (Hub)
    // Đảm bảo hub format trong access.hubs khớp với hub trong aging/kpifail data
    // [SỬA LỖI THẬT — báo cáo: user chức danh "Staff" nhưng giao diện hiện "Lead"]
    // Hệ thống có HAI bộ phân quyền song song:
    //   (1) _rp_lookupSA  -> đọc file CŨ (RP_SOURCE_ID). Sheet nhân sự ở đó không có
    //       cột chức danh -> title luôn rỗng -> MỌI user cấp trạm mặc định thành LEAD
    //       (387 nhân viên Staff bị cấp nhầm quyền Lead, đo trên file tổ chức).
    //   (2) _spxBuildOrgAccessMap_ -> đọc ĐÚNG nguồn duy nhất (ORG_SOURCE_SPREADSHEET_ID),
    //       có sẵn chức danh và ánh xạ chuẩn staff/team lead/supervisor.
    // Giao diện đang chạy bằng (1). Nay ưu tiên (2) — nguồn chính thức — và CHỈ khi
    // không tìm thấy mới lùi về (1), để không ai đột ngột mất quyền nếu nguồn mới
    // còn thiếu người. Kết quả trả về giữ NGUYÊN định dạng cũ (role/hubs/title) nên
    // các module khác không phải sửa gì.
    var result = null;
    try {
      var _orgMap = _spxBuildOrgAccessMap_();
      var _me = (_orgMap && _orgMap.byEmail) ? _orgMap.byEmail[email] : null;
      if (_me && _me.stations && _me.stations.length) {
        var _r = String(_me.role || '').toUpperCase();
        var _roleOut = (_r === 'AOM') ? 'aom' : (_r === 'SUP') ? 'sup' : 'station';
        result = {
          role: _roleOut, email: email, hubs: _me.stations.slice(),
          title: _me.position || null,          // 'Staff' / 'Team Lead' / 'Supervisor'
          source: 'org'
        };
      }
    } catch (eOrgAcc) { /* nguồn mới lỗi -> lùi về đường cũ, không chặn đăng nhập */ }

    if (!result) {
      var srcSS = _DS.ss(RP_SOURCE_ID);
      var sa = _rp_lookupSA(email, srcSS);
      if (sa && sa.role && sa.hubs && sa.hubs.length > 0) {
        result = { role: sa.role, email: email, hubs: sa.hubs, title: sa.title || null, source: 'legacy' };
      } else {
        result = { role: 'denied', email: email, hubs: [] };
      }
    }

    try { sc.put(cacheKey, JSON.stringify(result), CACHE_TTL); } catch(ce) {}
    return _spx_withLevel_(result);

  } catch(e) {
    return _spx_withLevel_({ role: 'denied', email: '', hubs: [], error: e.message });
  }
}

/**
 * getModuleAccess_invalidate()
 * Gọi khi cần reset cache (ví dụ sau khi update sheet SA)
 */
function getModuleAccess_invalidate(email) {
  try {
    var sc = CacheService.getScriptCache();
    if (email) {
      sc.remove('mod_access_v3_' + email.replace(/[^a-z0-9]/g, '_'));
    }
  } catch(e) {}
}


/**
 * spx_getModuleAccess()
 * Public wrapper — được gọi từ index.html qua google.script.run
 * Trả về JSON string { role, hubs } để frontend lưu vào window.SPX_ACCESS
 */
function spx_getModuleAccess() {
  try {
    var access = getModuleAccess();
    return JSON.stringify(access);
  } catch(e) {
    return JSON.stringify({ role: 'denied', hubs: [], error: e.message });
  }
}

