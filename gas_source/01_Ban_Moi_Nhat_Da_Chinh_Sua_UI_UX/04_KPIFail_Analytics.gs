// ============================================================
// MODULE 8: KPI FAIL HUB ANALYTICS (FM Late / LM Late / Wrong SOP)
// ============================================================
// Nguồn dữ liệu: 3 sheet thật, KHÔNG suy diễn dữ liệu không tồn tại.
// Quy ước: mỗi dòng trong 3 sheet này là 1 đơn ĐÃ FAIL (đã lọc sẵn ở nguồn),
// nên Total = số dòng trong khoảng thời gian lọc. Không có cột nào dùng để
// tính lại "tổng đơn" hay "tỷ lệ %" trên tổng số đơn toàn hệ thống — sheet
// gốc không chứa số liệu đó.
// ============================================================

// [CHUYỂN NGUỒN DỮ LIỆU — theo yêu cầu trực tiếp] Đổi sang spreadsheet mới,
// tên sheet rút gọn. Cấu trúc cột BÊN TRONG KHÔNG ĐỔI — chỉ đổi nơi đọc, nên
// toàn bộ logic phân tích (_kpifail_buildRecords, vị trí cột, cách tính độ
// trễ...) giữ nguyên, không cần sửa gì thêm.
//   Nguồn cũ: 1YCCH_ua39S0jU0y5FHbICf-IPi88qLkY0gKcrq5tS4I
//     'FM Late Orders'      -> 'FM'
//     'LM Late Orders'      -> 'LM'
//     'Wrong SOP PU Orders' -> 'SOP'
//
// ⚠️ SAU KHI DEPLOY, PHẢI LÀM 2 VIỆC (chạy trong Apps Script Editor):
//   1. kpifail_clearCache()  — hệ thống đọc dữ liệu kiểu "chỉ lấy phần mới từ
//      dòng X trở đi" và ghi nhớ mốc dòng đã đọc của nguồn CŨ. Mốc đó vô nghĩa
//      với nguồn mới. Có sẵn cơ chế tự phát hiện khi số dòng GIẢM, nhưng nếu
//      nguồn mới nhiều dòng hơn nguồn cũ thì nó KHÔNG kích hoạt và số liệu sẽ
//      sai âm thầm — nên phải xoá cache thủ công 1 lần cho chắc.
//   2. kpifail_setupSourceChangeWatcher() — trigger theo dõi thay đổi gắn CỨNG
//      vào 1 spreadsheet cụ thể, hiện vẫn đang trỏ vào nguồn CŨ (xem ghi chú
//      đầy đủ tại chính hàm đó).
var KPIFAIL_SS_ID    = '1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0';
var KPIFAIL_SHEET_FM  = 'FM';
var KPIFAIL_SHEET_LM  = 'LM';
var KPIFAIL_SHEET_SOP = 'SOP';

function _kpifail_readSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

// Chuẩn hóa 3 sheet thô thành 1 mảng "Fail Record" duy nhất.
// date luôn là string 'yyyy-MM-dd' (không dùng Date object) để tránh lệch
// timezone khi serialize JSON qua client — so sánh chuỗi ISO vẫn đúng thứ tự thời gian.
function _kpifail_buildRecords(ss) {
  var tz = SPX_TZ;

  // [FIX] Root cause: LM Late và Wrong SOP luôn ra 0 dù sheet có data vì
  // fmtDate() cũ CHỈ nhận "instanceof Date" — nếu cột ngày gốc (cột A) bị để
  // trống, dán dạng text, hoặc lệch định dạng thì dateStr = null và TOÀN BỘ
  // dòng bị âm thầm loại khỏi record (record.date là field bắt buộc để lọc
  // theo khoảng thời gian ở kpifail_getMasterDataLite). FM Late không bị lộ
  // lỗi này vì cột A của sheet đó vẫn đang có Date hợp lệ.
  // parseAnyDate() giờ chấp nhận thêm: chuỗi 'yyyy-MM-dd', 'dd/MM/yyyy',
  // datetime kèm giờ, và serial number ngày của Sheets — không chỉ Date object.
  var parseAnyDate = function(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === 'string' && v.trim()) {
      var s = v.trim();
      var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (m) {
        var d1 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (!isNaN(d1.getTime())) return d1;
      }
      m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (m) {
        var d2 = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        if (!isNaN(d2.getTime())) return d2;
      }
      var d3 = new Date(s);
      if (!isNaN(d3.getTime())) return d3;
    }
    if (typeof v === 'number' && v > 0) {
      // [FIX-TZ] Dùng epoch neo theo giờ local của Apps Script (= project
      // Time Zone) thay vì UTC cứng, để khớp với cách toàn bộ code còn lại
      // đang quy đổi ngày theo Asia/Ho_Chi_Minh — tránh lệch ngày gần mốc
      // nửa đêm nếu nhánh fallback số serial này từng bị kích hoạt.
      var epochLocal = new Date(1899, 11, 30);
      var d4 = new Date(epochLocal.getTime() + Math.round(v * 86400000));
      if (!isNaN(d4.getTime())) return d4;
    }
    return null;
  };
  var fmtDate = function(d) {
    var dd = parseAnyDate(d);
    return dd ? Utilities.formatDate(dd, tz, 'yyyy-MM-dd') : null;
  };
  var fmtDateTime = function(d) {
    var dd = parseAnyDate(d);
    return dd ? Utilities.formatDate(dd, tz, 'yyyy-MM-dd HH:mm') : null;
  };

  // [FIX 2026-07-29] NGÂN SÁCH THỜI GIAN — trước đây hàm này đọc TOÀN BỘ 3 sheet
  // (_kpifail_readSheet, mỗi sheet 1 lệnh getRange().getValues() duy nhất, có
  // thể ~100-200k dòng) rồi mới build record, không có điểm dừng nào — log
  // Executions xác nhận lượt build toàn bộ (trigger đêm, hoặc lần đầu chưa có
  // snapshot) từng CHẠM TRẦN CỨNG 30 phút (Timed Out), có lúc lặp lại nhiều lần
  // liên tiếp. Giờ dùng _kpifail_readRowsBudgeted_() qua từng sheet, dừng SỚM
  // (mặc định KPIFAIL_TIME_BUDGET_MS ~4.5 phút) tại sheet đang xử lý nếu vượt
  // ngân sách — trả về {records, rowCounts, complete:false} với rowCounts ghi
  // đúng vị trí đã đọc tới. Người gọi lưu rowCounts này vào snapshot, và ở CHU
  // KỲ REFRESH INCREMENTAL kế tiếp (_kpifail_readSourceRowsSince_, dùng CHUNG
  // đúng cơ chế ngân sách này), phần còn lại sẽ tự được đọc tiếp — không cần
  // logic "tiếp tục" riêng, không bao giờ có 1 lượt vượt quá ngân sách.
  // startRowCounts cho phép TIẾP TỤC đúng từ vị trí lần build trước dừng lại
  // (mặc định {FM:0,LM:0,SOP:0} = build từ đầu hoàn toàn).
  var startRowCounts = arguments.length > 1 ? arguments[1] : { FM: 0, LM: 0, SOP: 0 };
  var _startTime = Date.now();
  var records = [];
  // [FIX] Đếm số dòng bị loại vì không có bất kỳ ngày nào dùng được (kể cả
  // sau fallback) — phục vụ kpifail_debugDateIssues() để soát nguồn dữ liệu.
  var skipped = { FM: 0, LM: 0, SOP: 0 };
  var fps = {};          // [MỚI] vân tay dòng đầu/dòng mốc đã đọc của từng sheet
  var dupDropped = 0;    // [MỚI] số dòng trùng bị bỏ
  var _seenKeys = {};

  function buildFromRows(values, buildRecord, catKey) {
    for (var i = 0; i < values.length; i++) {
      var rec = buildRecord(values[i]);
      if (rec) {
        // [MỚI] Khử trùng cùng khoá với _kpifail_mergeRecords_ (category|date|id|hub) — trước đây đường đọc đầy
        // đủ KHÔNG khử trùng nên cùng 1 đơn xuất hiện 2 lần trong nguồn bị đếm 2 lần (đường đọc dòng mới thì có).
        var _k = [rec.category || '', rec.date || '', rec.id || '', rec.hub || ''].join('|');
        if (_seenKeys[_k]) { dupDropped++; } else { _seenKeys[_k] = 1; records.push(rec); }
      } else skipped[catKey]++;
    }
  }

  // FM Late Orders: A Date, B Pickup Station, C KPI Station, D Shipment ID, E Bulky,
  // F DTS, G To SOC, H Picked Time, I Inbound Time, J Packed Time, K LH Onsite Reg Time,
  // L LH Arrived Time, M LH Arrived Time Finalized for KPI, N LHPacked Time, O FM ETA,
  // P # COT Late, Q Type, R FM Late Reason
  var fmSheet = ss.getSheetByName(KPIFAIL_SHEET_FM);
  var CF = fmSheet ? _kpifail_cols_(fmSheet, 'FM') : null; // [SỬA] dò cột theo TIÊU ĐỀ
  var _sharedRowCounter = { n: 0 }; // dùng chung cho cả 3 sheet — chặn TỔNG dòng, không phải từng sheet riêng
  var fmChunk = _kpifail_readRowsBudgeted_(fmSheet, Math.max(2, (startRowCounts.FM || 0) + 1), _startTime, _sharedRowCounter);
  fps.FM = _kpifail_fpOfChunk_(fmChunk, Math.max(2, (startRowCounts.FM || 0) + 1), CF);
  buildFromRows(fmChunk.values, function(r) {
    var g = function(k) { return _kpi_g_(r, CF, k); };
    // [FIX] fallback: nếu cột Date trống, dùng LH Arrived Time Finalized rồi LH Arrived Time
    var dateStr = fmtDate(g('date')) || fmtDate(g('lhArrivedFinal')) || fmtDate(g('lhArrived'));
    if (!dateStr) return null;
    var arrived = g('lhArrivedFinal') instanceof Date ? g('lhArrivedFinal') : (g('lhArrived') instanceof Date ? g('lhArrived') : null);
    var eta     = g('eta') instanceof Date ? g('eta') : null;
    var delayH  = (arrived && eta) ? Math.round(((arrived - eta) / 3600000) * 10) / 10 : null;
    return {
      id: String(g('id') || ''), date: dateStr, hub: String(g('hub') || g('pickup') || ''), category: 'FM',
      type: String(g('type') || ''), reason: String(g('reason') || ''), delayHours: delayH,
      raw: {
        pickupStation: g('pickup'), bulky: g('bulky'), dts: g('dts'), toSoc: g('toSoc'),
        pickedTime: fmtDateTime(g('picked')), inboundTime: fmtDateTime(g('inbound')), packedTime: fmtDateTime(g('packed')),
        lhArrivedTime: fmtDateTime(g('lhArrived')), lhArrivedTimeFinal: fmtDateTime(g('lhArrivedFinal')),
        lhPackedTime: fmtDateTime(g('lhPacked')), fmEta: fmtDateTime(g('eta')), cotLate: g('cotLate')
      }
    };
  }, 'FM');

  if (!fmChunk.complete) {
    _LOG.d('[KPIFail buildRecords] Hết ngân sách thời gian khi đang đọc FM (tới dòng ' + fmChunk.reachedRow + ') — dừng lại, phần còn lại sẽ đọc tiếp ở chu kỳ refresh kế tiếp.');
    return { records: records, rowCounts: { FM: fmChunk.reachedRow, LM: startRowCounts.LM || 0, SOP: startRowCounts.SOP || 0 }, fingerprints: fps, complete: false };
  }

  // LM Late Orders: A ctime_date, B Station Name, C Shipment ID, D Arrived Time,
  // E First Attempt Time, F LM ETA, G Type, H lm_inbound, I rider_id
  var lmSheet = ss.getSheetByName(KPIFAIL_SHEET_LM);
  var CL = lmSheet ? _kpifail_cols_(lmSheet, 'LM') : null; // [SỬA] dò cột theo TIÊU ĐỀ
  var lmChunk = _kpifail_readRowsBudgeted_(lmSheet, Math.max(2, (startRowCounts.LM || 0) + 1), _startTime, _sharedRowCounter);
  fps.LM = _kpifail_fpOfChunk_(lmChunk, Math.max(2, (startRowCounts.LM || 0) + 1), CL);
  buildFromRows(lmChunk.values, function(r) {
    var g = function(k) { return _kpi_g_(r, CL, k); };
    // [FIX] fallback: nếu ctime_date trống -> Arrived Time rồi First Attempt Time (nguyên nhân chính khiến LM Late = 0)
    var dateStr = fmtDate(g('date')) || fmtDate(g('arrived')) || fmtDate(g('attempt'));
    if (!dateStr) return null;
    var attempt = g('attempt') instanceof Date ? g('attempt') : null;
    var eta     = g('eta') instanceof Date ? g('eta') : null;
    var delayH  = (attempt && eta) ? Math.round(((attempt - eta) / 3600000) * 10) / 10 : null;
    return {
      id: String(g('id') || ''), date: dateStr, hub: String(g('hub') || ''), category: 'LM',
      type: String(g('type') || ''), reason: '', delayHours: delayH,
      raw: {
        arrivedTime: fmtDateTime(g('arrived')), firstAttemptTime: fmtDateTime(g('attempt')), lmEta: fmtDateTime(g('eta')),
        lmInbound: fmtDateTime(g('inbound')), riderId: g('rider') || null
      }
    };
  }, 'LM');

  if (!lmChunk.complete) {
    _LOG.d('[KPIFail buildRecords] Hết ngân sách thời gian khi đang đọc LM (tới dòng ' + lmChunk.reachedRow + ') — dừng lại, phần còn lại sẽ đọc tiếp ở chu kỳ refresh kế tiếp.');
    return { records: records, rowCounts: { FM: fmChunk.reachedRow, LM: lmChunk.reachedRow, SOP: startRowCounts.SOP || 0 }, fingerprints: fps, complete: false };
  }

  // Wrong SOP - PU Orders: A Date, B Station Name, C Shipment ID, D Type, E Pickup ETA
  var sopSheet = ss.getSheetByName(KPIFAIL_SHEET_SOP);
  var CS = sopSheet ? _kpifail_cols_(sopSheet, 'SOP') : null; // [SỬA] dò cột theo TIÊU ĐỀ
  var sopChunk = _kpifail_readRowsBudgeted_(sopSheet, Math.max(2, (startRowCounts.SOP || 0) + 1), _startTime, _sharedRowCounter);
  fps.SOP = _kpifail_fpOfChunk_(sopChunk, Math.max(2, (startRowCounts.SOP || 0) + 1), CS);
  buildFromRows(sopChunk.values, function(r) {
    var g = function(k) { return _kpi_g_(r, CS, k); };
    // [FIX] fallback: nếu Date trống -> Pickup ETA (nguyên nhân chính khiến Wrong SOP = 0)
    var dateStr = fmtDate(g('date')) || fmtDate(g('pickupEta'));
    if (!dateStr) return null;
    return {
      id: String(g('id') || ''), date: dateStr, hub: String(g('hub') || ''), category: 'SOP',
      type: String(g('type') || ''), reason: '', delayHours: null,
      raw: { pickupEta: fmtDateTime(g('pickupEta')) }
    };
  }, 'SOP');

  if (dupDropped) _LOG.d('[KPIFail buildRecords] Bỏ ' + dupDropped + ' dòng TRÙNG (cùng loại+ngày+mã đơn+trạm).');
  if (skipped.FM || skipped.LM || skipped.SOP) {
    _LOG.d('[KPIFail buildRecords] Dòng bị loại vì không xác định được ngày: ' + JSON.stringify(skipped));
  }

  return { records: records, rowCounts: { FM: fmChunk.reachedRow, LM: lmChunk.reachedRow, SOP: sopChunk.reachedRow }, fingerprints: fps,
    // [FIX LỖI THẬT — phát hiện khi thêm giới hạn số lượng] Trước đây chỉ lấy
    // sopChunk.complete — nếu FM/LM bị dừng sớm (hết ngân sách thời gian HOẶC
    // giới hạn số lượng mới thêm) nhưng SOP (thường ít dòng, đọc xong nhanh)
    // complete=true, cờ tổng thể SẼ BÁO SAI "đã xong toàn bộ" trong khi FM/LM
    // còn dở dang — hệ thống tưởng build xong, KHÔNG BAO GIỜ đọc tiếp phần còn
    // thiếu của FM/LM nữa -> MẤT DỮ LIỆU VĨNH VIỄN. Phải là AND của cả 3.
    complete: fmChunk.complete && lmChunk.complete && sopChunk.complete };
}

// Bản nhẹ cho card trang chủ — chỉ 4 số tổng + badge risk, cache 5 phút.
// Mặc định "Theo tháng hiện tại": từ ngày 01 của tháng đến NGÀY DỮ LIỆU MỚI NHẤT
// (không dùng ngày hệ thống — vì FM/LM/SOP có độ trễ báo cáo khác nhau).
// [PERF v2] Dùng kpifail_getMasterDataLite(hubName, 62) thay vì kpifail_getMasterData(180):
// - Lọc theo hub + 62 ngày NGAY TRONG vòng for đọc sheet → payload nhỏ hơn ~10-20x
// - 62 ngày = tháng này + tháng trước, đủ để tính trendPct (không cần 180 ngày)
// - Cache per (user × hub × 62d) riêng của IndexSummary, không xung đột dashboard cache
// [FIX] Helper cho cache version của kpifail_getIndexSummary — xem giải thích
// chi tiết trong comment bên trong hàm kpifail_getIndexSummary bên dưới.
function _kpifail_getIdxCacheVersion_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty('kpifail_idx_cache_ver');
    return v || '1';
  } catch (e) { return '1'; }
}
function _kpifail_bumpIdxCacheVersion_() {
  try {
    PropertiesService.getScriptProperties().setProperty('kpifail_idx_cache_ver', String(Date.now()));
  } catch (e) {}
}

function kpifail_getIndexSummary(hubName, overrideHub) {
  var sc = CacheService.getScriptCache();

  // [SECURITY FIX 2026-08] kpifail_getMasterDataLite() bên dưới ĐÃ lọc đúng theo
  // quyền người gọi (per-user), nhưng CACHE_KEY ở TẦNG NGOÀI của chính hàm này lại
  // chỉ dựa theo hubName — không có thành phần quyền/user. Hệ quả: nếu admin gọi
  // trước (hubName rỗng) và kết quả tổng hợp toàn hệ thống được cache 300s dưới key
  // 'kpifail_idx_v1_..._ALL', thì bất kỳ AOM/SUP nào gọi cùng key trong 300s đó sẽ
  // nhận thẳng data admin đã cache — bỏ qua hoàn toàn bước lọc hub bên trong
  // kpifail_getMasterDataLite() (vì cache trả sớm ở dòng "if (cached) return cached"
  // trước khi kịp gọi hàm đó). Thêm scope quyền vào cache key để triệt tiêu rò rỉ.
  var _accessForCacheScope = getModuleAccess();
  if (_accessForCacheScope.role === 'denied') {
    return JSON.stringify({ success: false, error: 'Không có quyền truy cập.' });
  }
  var _isAdminKpi = (_accessForCacheScope.role === 'admin');
  // [MỚI — theo yêu cầu trực tiếp "Tổng quan không đổi theo level"] Cùng cơ
  // chế overrideHub như aging_getIndexSummary — chỉ Admin mới dùng được.
  // [SỬA — cùng lỗi với aging_getIndexSummary] Cho người dùng thường lọc theo
  // trạm đang chọn nếu trạm nằm trong quyền; khoá cache gồm cả trạm đó.
  var _kpiAllowed = (_accessForCacheScope.hubs || []).map(function(h){ return _kpifail_normHubBase_(h); });
  // [SỬA — hỗ trợ NHIỀU TRẠM cho Xem thử cấp SUP/AOM/ROM]
  var _kpiScope = _spxScopeHubs_(overrideHub);
  var _kpiOvOk = !_kpiScope.empty && (_isAdminKpi || _kpiScope.list.every(function (h) {
    return _kpiAllowed.indexOf(_kpifail_normHubBase_(h)) >= 0;
  }));
  var _effectiveHubKpi = _kpiOvOk ? overrideHub : hubName;
  var _idxScopeKey = _isAdminKpi
    ? ('ADMIN' + (overrideHub ? '_PV_' + _kpifail_normHubBase_(overrideHub) : ''))
    : (_kpiAllowed.slice().sort().join('~') + (_kpiOvOk ? '_PV_' + _kpiScope.cacheKey() : ''));

  // [FIX] Cache key động theo trạm KHÔNG thể bị xóa bởi kpifail_clearCache() vì
  // hàm đó remove() đúng 1 key cố định 'kpifail_idx_v1' — không khớp với key thật
  // sự đang dùng ở đây ('kpifail_idx_v1_' + tên trạm). Hệ quả: card luôn trả về
  // số liệu cache cũ tới 5 phút (kể cả sau khi bấm force refresh / clear cache).
  // Thêm "version" vào key: clearCache() chỉ cần bump version để toàn bộ cache
  // theo mọi trạm (dù chưa biết tên) lập tức bị vô hiệu hóa.
  var cacheVer = _kpifail_getIdxCacheVersion_();

  // Động hóa Cache Key theo tên trạm để tránh đè dữ liệu cache giữa các bưu cục
  var cleanKey = _effectiveHubKpi ? _effectiveHubKpi.toString().replace(/[^a-zA-Z0-9]/g, '_') : 'ALL';
  // [MỚI 2026-10-24] Thêm phiên bản cache "lite" (tăng ngay khi dữ liệu KPI đổi) — trước đây khoá chỉ có phiên bản "idx"
  // (chỉ tăng khi bấm Làm mới) nên số tổng hợp có thể cũ tới hết TTL dù dữ liệu gốc đã mới.
  var CACHE_KEY = _spxSafeCacheKey_('kpifail_idx_v1_' + cacheVer + '_L' + _kpifail_getLiteCacheVersion_() + '_' + cleanKey + '_' + _idxScopeKey);
  
  try {
    var cached = _SPX_OV_FORCE_ ? null : sc.get(CACHE_KEY);
    if (cached) return cached;
  } catch (ce) {}

  try {
    // [PERF] Dùng kpifail_getMasterDataLite thay vì kpifail_getMasterData:
    // - Lọc theo hubName VÀ theo 62 ngày ngay trong vòng for khi đọc sheet
    //   (tháng này + tháng trước = đủ cho trendPct, không cần 180 ngày)
    // - Với station/SUP: payload nhỏ hơn ~10-20x so với load toàn bộ 180 ngày all hubs
    // - Cache riêng per (user × hub × 62d) — không ảnh hưởng cache của dashboard chính
    var IDX_WINDOW_DAYS = 62; // đủ tháng này + tháng trước để tính trend
    // Nhiều trạm: KHÔNG xin 'ALL' rồi lọc, vì 'ALL' với Admin là toàn hệ thống — gói
  // dữ liệu khổng lồ và có thể chạm ngưỡng chặn kích thước. Thay vào đó lấy theo
  // TỪNG TRẠM rồi gộp: mỗi trạm có bộ đệm riêng nên lượt sau rất nhanh.
  // Danh sách quá dài (AOM/ROM nhiều trạm) thì mới xin 'ALL' và lọc, vì khi đó số
  // lượt gọi nội bộ mới là thứ tốn kém hơn.
  var masterRaw;
  if (_kpiOvOk && _kpiScope.list.length > 1 && _kpiScope.list.length <= 15) {
    var _mergedRec = [], _okAll = true, _errFirst = '';
    for (var _hi = 0; _hi < _kpiScope.list.length; _hi++) {
      var _one = JSON.parse(kpifail_getMasterDataLite(_kpiScope.list[_hi], IDX_WINDOW_DAYS));
      if (!_one.success) { _okAll = false; _errFirst = _one.error || 'Lỗi đọc dữ liệu KPI.'; break; }
      _mergedRec = _mergedRec.concat(_one.records || []);
    }
    masterRaw = _okAll ? { success: true, records: _mergedRec } : { success: false, error: _errFirst };
  } else if (_kpiOvOk && _kpiScope.list.length > 15) {
    masterRaw = JSON.parse(kpifail_getMasterDataLite('ALL', IDX_WINDOW_DAYS));
    if (masterRaw.success) {
      masterRaw.records = (masterRaw.records || []).filter(function (r) { return _kpiScope.has(r.hub || ''); });
    }
  } else {
    masterRaw = JSON.parse(kpifail_getMasterDataLite(_effectiveHubKpi || 'ALL', IDX_WINDOW_DAYS));
  }
    if (!masterRaw.success) return JSON.stringify({ success: false, error: masterRaw.error });
    var records = masterRaw.records || [];
    // Không cần filter hub lại — kpifail_getMasterDataLite đã lọc server-side

    if (records.length === 0) {
      var emptyRes = JSON.stringify({
        success: true, totalFM: 0, totalLM: 0, totalSOP: 0, totalFail: 0,
        periodLabel: 'Không có dữ liệu', riskLevel: 'green', trendPct: null,
        deltaFM: 0, deltaLM: 0, deltaSOP: 0, deltaTotal: 0, latestDate: ''
      });
      sc.put(CACHE_KEY, emptyRes, 300);
      return emptyRes;
    }

    // [FIX 2026-07] Card tóm tắt ở trang chủ ghi nhãn "Tháng này" — nên PHẢI bám
    // theo ngày thực tế của hệ thống (không phải maxDate của dataset như trước).
    // Trước đây khi dữ liệu tháng mới chưa được đồng bộ, hàm này lấy maxDateStr
    // (ngày có data mới nhất, có thể vẫn thuộc tháng trước) làm mốc "tháng này"
    // → card hiển thị nguyên số liệu tháng trước nhưng gắn nhãn "Tháng này (...)",
    // khiến người dùng hiểu lầm là KPI Fail tháng hiện tại vẫn còn tồn đọng cũ.
    // Nay: nếu tháng hiện tại (theo ngày thật) chưa có bản ghi nào → trả đúng 0,
    // không fallback về tháng cũ nữa.
    var todayStr   = _kpifail_todayDateStr_();
    var monthStart = todayStr.slice(0, 7) + '-01';

    var curYear  = parseInt(todayStr.slice(0, 4), 10);
    var curMonth = parseInt(todayStr.slice(5, 7), 10);
    var dayNum   = parseInt(todayStr.slice(8, 10), 10);

    var prevMonth = curMonth - 1, prevYear = curYear;
    if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
    var prevMonthPrefix   = prevYear + '-' + String(prevMonth).padStart(2, '0');
    var prevMonthStart    = prevMonthPrefix + '-01';
    var lastDayPrevMonth  = new Date(prevYear, prevMonth, 0).getDate();
    var prevEndDay        = Math.min(dayNum, lastDayPrevMonth);
    var prevMonthEnd      = prevMonthPrefix + '-' + String(prevEndDay).padStart(2, '0');

    var curr = records.filter(function(r) { return r.date >= monthStart && r.date <= todayStr; });
    var prev = records.filter(function(r) { return r.date >= prevMonthStart && r.date <= prevMonthEnd; });

    var totalFM   = curr.filter(function(r) { return r.category === 'FM'; }).length;
    var totalLM   = curr.filter(function(r) { return r.category === 'LM'; }).length;
    var totalSOP  = curr.filter(function(r) { return r.category === 'SOP'; }).length;
    var totalFail = totalFM + totalLM + totalSOP;
    var prevTotal = prev.length;

    var trendPct = prevTotal > 0 ? Math.round(((totalFail - prevTotal) / prevTotal) * 1000) / 10 : null;

    var riskLevel = 'green';
    if (trendPct === null) riskLevel = totalFail > 0 ? 'yellow' : 'green';
    else if (trendPct > 15) riskLevel = 'red';
    else if (trendPct > 0)  riskLevel = 'yellow';

    // ── DELTA: đơn mới CHƯA GIẢI TRÌNH — lấy đúng ngày MỚI NHẤT có dữ liệu
    // NẰM TRONG THÁNG HIỆN TẠI (curr), không dùng maxDate của toàn dataset nữa —
    // nếu tháng này chưa có data (curr rỗng) thì không có ngày nào để tính delta,
    // tránh lấy nhầm ngày của tháng trước rồi gắn nhãn "mới" sai be bét.
    var maxDateInMonth = curr.reduce(function(m, r) { return r.date > m ? r.date : m; }, '');

    var notesRes = {};
    try {
      var notesRaw = kpifail_getNotes();
      var notesParsed = typeof notesRaw === 'string' ? JSON.parse(notesRaw) : notesRaw;
      notesRes = (notesParsed && notesParsed.notes) ? notesParsed.notes : {};
    } catch(ne) {}

    // Chỉ lấy records đúng ngày maxDateInMonth (nếu có), chưa note
    var onMaxDate = maxDateInMonth ? curr.filter(function(r) {
      return r.date === maxDateInMonth && r.id && !notesRes[r.id];
    }) : [];

    var deltaFM    = onMaxDate.filter(function(r){ return r.category === 'FM';  }).length;
    var deltaLM    = onMaxDate.filter(function(r){ return r.category === 'LM';  }).length;
    var deltaSOP   = onMaxDate.filter(function(r){ return r.category === 'SOP'; }).length;
    var deltaTotal = deltaFM + deltaLM + deltaSOP;

    var fmtShort = function(s) { return s.slice(8, 10) + '/' + s.slice(5, 7); };

    // latestDate = ngày mới nhất có data TRONG tháng hiện tại — rỗng nếu tháng
    // này chưa có bản ghi nào (khi đó cũng không có delta để hiện badge "mới").
    var latestDateFM  = maxDateInMonth;
    var latestDateLM  = maxDateInMonth;
    var latestDateSOP = maxDateInMonth;

    var res = JSON.stringify({
      success: true, totalFM: totalFM, totalLM: totalLM, totalSOP: totalSOP, totalFail: totalFail,
      periodLabel: fmtShort(monthStart) + ' - ' + fmtShort(todayStr),
      riskLevel: riskLevel, trendPct: trendPct,
      deltaFM: deltaFM, deltaLM: deltaLM, deltaSOP: deltaSOP, deltaTotal: deltaTotal,
      latestDate: maxDateInMonth,
      latestDateFM: latestDateFM, latestDateLM: latestDateLM, latestDateSOP: latestDateSOP
    });
    sc.put(CACHE_KEY, res, 300);
    return res;
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// Bản đầy đủ cho Module 8 dashboard — Fail Record trong cửa sổ thời gian gần đây,
// client tự lọc/aggregate theo Hub, khoảng ngày, loại lỗi để vẽ Ranking/Trend/
// Breakdown/Heatmap/Drill-down.
//
// GIỚI HẠN CỬA SỔ THỜI GIAN (quan trọng khi data tăng 2-3k/ngày):
// Dashboard (Trend tháng này vs tháng trước, Ranking, Heatmap...) không cần và
// không nên tải TOÀN BỘ lịch sử fail từ trước đến nay — càng nhiều dữ liệu lịch sử
// tích lũy, payload trả về client / kích thước cache càng phình to vô ích, khiến
// việc load ngày càng chậm dần theo THỜI GIAN VẬN HÀNH chứ không phải theo nhu cầu
// xem dữ liệu thực tế. Mặc định chỉ lấy 180 ngày gần nhất (đủ để so sánh tháng
// hiện tại với tháng trước + có biên độ dư). Cần xem xa hơn thì truyền daysBack lớn
// hơn (ví dụ kpifail_getMasterData(365)); truyền 0 để lấy toàn bộ (không khuyến khích
// khi data đã lớn).
var KPIFAIL_DEFAULT_WINDOW_DAYS = 180;
var KPIFAIL_PERSIST_SNAPSHOT_SHEET = 'KPIFail_Snapshot_Data';
var KPIFAIL_PERSIST_META_SHEET = 'KPIFail_Snapshot_Meta';
var KPIFAIL_PERSIST_REFRESH_LOCK_KEY = 'kpifail_snapshot_refresh_lock';
var KPIFAIL_PERSIST_REFRESH_SECONDS = 300;

// [FIX 2026-07-29] "NGÂN SÁCH THỜI GIAN" cho mọi lượt đọc sheet lớn trong KPI
// Fail — xem lý do đầy đủ ở _kpifail_readRowsBudgeted_(). Log Executions từng
// ghi nhận build toàn bộ / refresh incremental tồn đọng nhiều CHẠM TRẦN CỨNG
// 30 phút của Apps Script (Timed Out) — không có cách nào "xin thêm giờ" khi
// đã ở trong 1 execution, CHỈ có cách chủ động dừng SỚM HƠN nhiều và tiếp tục
// ở lượt sau. 270s (4.5 phút) chọn để có biên an toàn rộng so với cả trần 30
// phút (Workspace) VÀ trần 6 phút (tài khoản cá nhân) — không phụ thuộc loại
// tài khoản đang chạy trigger.
var KPIFAIL_TIME_BUDGET_MS   = 270000; // 4.5 phút/lượt — ngân sách an toàn cho MỌI loại tài khoản
var KPIFAIL_READ_BATCH_ROWS  = 20000;  // đọc theo lô, không đọc hết 1 lần để có điểm dừng giữa chừng
// [MỚI — SỬA LỖI THẬT: đo được lượt kpifail_prewarmCache chạy tới 1.711 giây
// (28.5 phút), vượt xa trần cứng 360s] Nguyên nhân: ngân sách 4.5 phút chỉ chặn
// bước ĐỌC — nếu Sheets API đọc nhanh (mạng tốt), 4.5 phút có thể đọc được RẤT
// NHIỀU dòng, và bước GHI snapshot sau đó (chunked vào Google Sheet, xem
// _kpifail_writePersistentSnapshot_) KHÔNG CÓ ngân sách gì — ghi càng nhiều
// dòng càng lâu, không kiểm soát được. Thêm trần CỨNG theo SỐ LƯỢNG (không chỉ
// thời gian) để bước ghi sau đó luôn nhận một khối lượng dự đoán được, dù
// Sheets API có đọc nhanh bất thường tới đâu.
var KPIFAIL_MAX_ROWS_PER_BUILD = 80000;

// Đọc 1 sheet theo LÔ (KPIFAIL_READ_BATCH_ROWS dòng/lô) từ startRow tới hết,
// dừng SỚM nếu vượt ngân sách thời gian còn lại — trả về đúng vị trí đã đọc
// tới (reachedRow) để lần gọi sau tiếp tục đúng từ đó, không đọc lại, không bỏ sót.
// KHÔNG BAO GIỜ đọc hết 1 sheet ~100-200k dòng trong 1 lệnh getRange() duy nhất
// nữa — đây là điểm khác biệt so với _kpifail_readSheet() (dùng cho code cũ,
// vẫn giữ nguyên cho các nơi khác không cần ngân sách thời gian).
// [MỚI] Tham số thứ 4 sharedRowCounter (object {n:0}, TÙY CHỌN) — nếu truyền
// vào, dùng CHUNG 1 bộ đếm giữa nhiều lần gọi hàm này (VD 3 sheet FM/LM/SOP
// trong 1 lượt build) để chặn TỔNG số dòng, không chỉ từng sheet riêng lẻ.
// ---- KPI Fail: đặc tả cột theo TIÊU ĐỀ (dòng 1 của mỗi sheet FM/LM/SOP, đối chiếu file export) ----
var _SPX_KPI_SPEC_ = {
  FM:  { spec: { date: ['date'], pickup: ['pickup station'], hub: ['kpi station'], id: ['shipment id', 'shipment_id'],
                 bulky: ['bulky'], dts: ['dts'], toSoc: ['to soc'], picked: ['picked time'], inbound: ['inbound time'],
                 packed: ['packed time'], lhArrived: ['lh arrived time'], lhArrivedFinal: ['lh arrived time finalized for kpi', 'lh arrived time finalize', /^lh arrived time finali[sz]e/],
                 lhPacked: [/^lh\s*packed time/], eta: ['fm eta'], cotLate: ['# cot late'], type: ['type'], reason: ['fm late reason'] },
         req: ['date', 'hub', 'id', 'type', 'reason', 'lhArrived', 'lhArrivedFinal', 'eta'] },
  LM:  { spec: { date: ['ctime_date', 'date'], hub: ['station name'], id: ['shipment id', 'shipment_id'], arrived: ['arrived time'],
                 attempt: ['first attempt time'], eta: ['lm eta'], type: ['type'], inbound: ['lm_inbound'], rider: ['rider_id'] },
         req: ['date', 'hub', 'id', 'arrived', 'attempt', 'eta', 'type'] },
  SOP: { spec: { date: ['date'], hub: ['station name'], id: ['shipment id', 'shipment_id'], type: ['type'], pickupEta: ['pickup eta'] },
         req: ['date', 'hub', 'id', 'type', 'pickupEta'] }
};
/**
 * _kpifail_cols_(sheet, key) — dò cột sheet KPI Fail theo TIÊU ĐỀ (thay cho r[0], r[12]... cố định).
 * Thiếu cột bắt buộc -> ném lỗi rõ + ghi cảnh báo; các lượt refresh đã có try/catch nên bản
 * persistent snapshot cũ vẫn được giữ nguyên (cũ nhưng ĐÚNG, không đọc nhầm cột).
 */
function _kpifail_cols_(sheet, key) {
  var def = _SPX_KPI_SPEC_[key];
  var hdr = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var C = _spx_findCols_(hdr, def.spec);
  try { _spx_requireCols_("Sheet KPI Fail '" + key + "'", C, def.req, hdr); }
  catch (e) { _spx_setColWarn_('kpifail:' + key, e.message); throw e; }
  _spx_setColWarn_('kpifail:' + key, null);
  return C;
}
function _kpi_g_(r, C, k) { return (C && C[k] !== undefined) ? r[C[k]] : undefined; }

// [MỚI — "KPI Fail có thể bỏ sót dòng khi nguồn ghi lại từ đầu mà số dòng không giảm"]
// Trước đây chỉ phát hiện "nguồn bị ghi lại" khi SỐ DÒNG GIẢM. Nguồn là cửa sổ trượt (mỗi ngày bỏ ngày cũ,
// thêm ngày mới) nên số dòng có thể TĂNG hoặc giữ nguyên sau khi trượt — khi đó đọc "phần sau mốc cũ" sẽ
// bỏ sót một phần dữ liệu mới mà KHÔNG AI HAY. Nay lưu thêm "VÂN TAY" (mã đơn + ngày) của dòng ĐẦU (dòng 2)
// và dòng MỐC (dòng cuối đã đọc); lượt sau đọc lại đúng 2 dòng đó, khác đi = nguồn đã đổi vị trí dòng.
function _kpifail_rowKey_(r, C) {
  if (!r || !C || C.id === undefined || C.date === undefined) return '';
  var d = r[C.date];
  var ds = (d instanceof Date) ? String(d.getTime()) : String(d == null ? '' : d);
  return String(r[C.id] == null ? '' : r[C.id]) + '~' + ds;
}
function _kpifail_fpOfChunk_(chunk, startRow, C) {
  var v = (chunk && chunk.values) || [];
  return {
    head: (startRow === 2 && v.length) ? _kpifail_rowKey_(v[0], C) : null,
    tail: v.length ? _kpifail_rowKey_(v[v.length - 1], C) : null
  };
}
var KPIFAIL_FP_NAMES_ = ['FM', 'LM', 'SOP'];
/** So vân tay đã lưu với nguồn hiện tại. Trả {rewritten, why}. Thiếu vân tay (lần đầu sau nâng cấp) = coi như cần đối soát. */
function _kpifail_sourceRewritten_(ss, snapshot, prevRowCounts) {
  var names = { FM: KPIFAIL_SHEET_FM, LM: KPIFAIL_SHEET_LM, SOP: KPIFAIL_SHEET_SOP };
  if (!snapshot || !snapshot.fp) return { rewritten: true, why: 'chưa có vân tay (lần đầu sau khi nâng cấp)' };
  for (var i = 0; i < KPIFAIL_FP_NAMES_.length; i++) {
    var k = KPIFAIL_FP_NAMES_[i];
    var prev = prevRowCounts[k] || 0;
    if (prev < 2) continue;                         // chưa đọc dòng dữ liệu nào của sheet này
    var sheet = ss.getSheetByName(names[k]);
    if (!sheet) continue;
    var fp = snapshot.fp[k];
    if (!fp || !fp.head || !fp.tail) return { rewritten: true, why: k + ': thiếu vân tay' };
    var lastRow = sheet.getLastRow();
    if (prev > lastRow) return { rewritten: true, why: k + ': dòng mốc vượt quá số dòng hiện có' };
    var C = _kpifail_cols_(sheet, k);
    var lc = Math.max(sheet.getLastColumn(), 1);
    var head = sheet.getRange(2, 1, 1, lc).getValues()[0];
    var tail = prev === 2 ? head : sheet.getRange(prev, 1, 1, lc).getValues()[0];
    if (_kpifail_rowKey_(head, C) !== fp.head) return { rewritten: true, why: k + ': dòng đầu (dòng 2) đã đổi' };
    if (_kpifail_rowKey_(tail, C) !== fp.tail) return { rewritten: true, why: k + ': dòng mốc (dòng ' + prev + ') đã đổi' };
  }
  return { rewritten: false };
}
/** Mốc PHIÊN BẢN DỮ LIỆU của snapshot (đổi khi có dòng mới / nguồn ghi lại / ngày mới nhất đổi) — KHÔNG đổi chỉ vì "chạm" lại thời gian lưu. */
function _kpifail_dataVersionOf_(m) {
  return [m.lastrow_fm, m.lastrow_lm, m.lastrow_sop, m.snapshot_max_date, m.fp_fm_head, m.fp_lm_head, m.fp_sop_head].join('|');
}
function _kpifail_dataVersionString_() {
  var sc = null, hit = null;
  try { sc = CacheService.getScriptCache(); hit = sc.get('kpifail_dataver_v1'); } catch (e0) {}
  if (hit) return hit;
  var m = _kpifail_getMetaMap_(_kpifail_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))) || {};
  var v = _kpifail_dataVersionOf_(m);
  try { if (sc) sc.put('kpifail_dataver_v1', v, 30); } catch (e1) {}
  return v;
}
/**
 * kpifail_getDataVersion() — RPC THĂM DÒ NHẸ: giao diện KPI Fail hỏi định kỳ "đã có dữ liệu mới chưa?" thay vì
 * tải lại cả gói nhiều MB. Chỉ trả mốc phiên bản (1 chuỗi), cache 30 giây dùng chung.
 */
function kpifail_getDataVersion() {
  try {
    var access = getModuleAccess();
    if (!access || access.role === 'denied') return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
    var _flmV = 0; try { _flmV = (typeof flm_kpi_version_ === 'function') ? flm_kpi_version_() : 0; } catch (eFlm) {}
    return JSON.stringify({ success: true, version: _kpifail_dataVersionString_(), flm: _flmV });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

function _kpifail_readRowsBudgeted_(sheet, startRow, startTime, sharedRowCounter) {
  if (!sheet) return { values: [], reachedRow: startRow - 1, complete: true };
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (startRow > lastRow) return { values: [], reachedRow: lastRow, complete: true };

  var values = [];
  var row = startRow;
  while (row <= lastRow) {
    if (Date.now() - startTime > KPIFAIL_TIME_BUDGET_MS) {
      return { values: values, reachedRow: row - 1, complete: false };
    }
    if (sharedRowCounter && sharedRowCounter.n >= KPIFAIL_MAX_ROWS_PER_BUILD) {
      return { values: values, reachedRow: row - 1, complete: false };
    }
    var batchSize = Math.min(KPIFAIL_READ_BATCH_ROWS, lastRow - row + 1);
    var batch = sheet.getRange(row, 1, batchSize, lastCol).getValues();
    for (var i = 0; i < batch.length; i++) values.push(batch[i]);
    if (sharedRowCounter) sharedRowCounter.n += batch.length;
    row += batchSize;
  }
  return { values: values, reachedRow: lastRow, complete: true };
}
var KPIFAIL_PERSIST_OVERLAP_DAYS = 2;


// ============================================================
// PATCH: kpifail_getMasterData() + kpifail_getIndexSummary()
// Thêm phân quyền — filter records theo hub được phép
// Cache chuyển sang per-user (key theo email) — v2
// ============================================================

// ── kpifail_getMasterDataLite: lọc theo hub + date NGAY TRONG vòng for ──────
// Nhanh hơn kpifail_getMasterData khi chỉ cần 1 hub hoặc 1 khoảng ngày ngắn.
// Schema records trả về GIỐNG HỆT getMasterData → backward-compatible.
var KPIFAIL_LITE_CACHE_VERSION_KEY = 'kpifail_lite_cache_version';

function _kpifail_getLiteCacheVersion_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var v = parseInt(props.getProperty(KPIFAIL_LITE_CACHE_VERSION_KEY) || '1', 10);
    return isNaN(v) ? 1 : v;
  } catch (e) {
    return 1;
  }
}

function _kpifail_bumpLiteCacheVersion_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var next = _kpifail_getLiteCacheVersion_() + 1;
    props.setProperty(KPIFAIL_LITE_CACHE_VERSION_KEY, String(next));
    return next;
  } catch (e) {
    return 1;
  }
}

// ============================================================
// CHUẨN HOÁ KHOÁ TRẠM DÙNG CHUNG (single source of truth)
// ------------------------------------------------------------
// Trước đây mỗi module tự viết 1 hàm chuẩn hoá tên trạm riêng
// (Quá hạn, FMS, KPI Fail, Analytics) → cùng tên trạm có thể bị
// hiểu khác nhau giữa các module, gây lệch số liệu khi gộp dữ
// liệu theo trạm. Toàn bộ logic chuẩn hoá nay quy về một hàm
// duy nhất _normStationKey_(); các hàm cũ vẫn giữ tên gọi để
// không phải sửa hàng trăm điểm gọi, nhưng bên trong chỉ là
// wrapper gọi lại hàm chung này.
//
// opts.pakFix      (default true)  : đổi "pak" -> "pac" (đồng bộ
//                                     cách viết "Pắk"/"Pak" của Krông Pắk)
// opts.stripSuffix (default true)  : bỏ hậu tố lmhub/fmhub/hub/soc/
//                                     station/lm/fm ở cuối tên trạm
// ============================================================
function _normStationKey_(raw, opts) {
  opts = opts || {};
  if (!raw) return '';
  var s = raw.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
  if (opts.pakFix !== false) s = s.replace(/pak/g, 'pac');
  s = s.replace(/[^a-z0-9]/g, '');
  if (opts.stripSuffix !== false) {
    s = s.replace(/(lmhub|fmhub|hub|soc|station|lm|fm)$/g, '');
  }
  return s;
}

function _kpifail_normHubBase_(s) {
  // Giữ nguyên hành vi cũ: KHÔNG pakFix, KHÔNG strip hậu tố — dùng cho so khớp nghiêm ngặt.
  return _normStationKey_(s, { pakFix: false, stripSuffix: false });
}

function _kpifail_normHubUI_(s) {
  // Giữ nguyên hành vi cũ: có pakFix + strip hậu tố — dùng cho so khớp lỏng (input người dùng gõ).
  return _normStationKey_(s, { pakFix: true, stripSuffix: true });
}

function _kpifail_matchHub_(recordHub, hubName, hubTargetNorm) {
  if (!hubName) return true;
  var rHub = _kpifail_normHubBase_(recordHub);
  var rHubUI = _kpifail_normHubUI_(recordHub);
  for (var i = 0; i < hubTargetNorm.length; i++) {
    if (rHub === hubTargetNorm[i] || rHubUI === hubTargetNorm[i]) return true;
  }
  return false;
}

// [FIX 2026-07-28] Đổi 1 sheet snapshot thành 2 sheet luân phiên (ping-pong, hậu tố
// _A / _B) — xem lý do đầy đủ ở _kpifail_writePersistentSnapshot_ bên dưới.
function _kpifail_getSnapshotSheet_(ss, slot) {
  var name = KPIFAIL_PERSIST_SNAPSHOT_SHEET + '_' + (slot === 'B' ? 'B' : 'A');
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['Key', 'ChunkIndex', 'ChunkData']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  return sheet;
}

function _kpifail_getSnapshotMetaSheet_(ss) {
  var sheet = ss.getSheetByName(KPIFAIL_PERSIST_META_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(KPIFAIL_PERSIST_META_SHEET);
    sheet.appendRow(['Key', 'Value']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  return sheet;
}

function _kpifail_getMetaMap_(sheet) {
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) map[key] = values[i][1];
  }
  return map;
}

function _kpifail_setMetaMap_(sheet, map) {
  var rows = [['Key', 'Value']];
  var keys = Object.keys(map || {}).sort();
  for (var i = 0; i < keys.length; i++) rows.push([keys[i], map[keys[i]]]);
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
}

function _kpifail_readPersistentSnapshot_() {
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    var metaSheet = _kpifail_getSnapshotMetaSheet_(ss);
    var metaMap = _kpifail_getMetaMap_(metaSheet);
    if (!metaMap.snapshot_version) return null;
    // [FIX 2026-07-28] Đọc đúng slot đang ACTIVE (đã ghi xong hoàn chỉnh) — không
    // đọc slot đang được ghi dở (nếu có) — xem giải thích ở hàm ghi bên dưới.
    var activeSlot = metaMap.snapshot_active_slot === 'B' ? 'B' : 'A';
    var dataSheet = _kpifail_getSnapshotSheet_(ss, activeSlot);
    if (dataSheet.getLastRow() < 2) return null;
    var rows = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 3).getDisplayValues();
    var chunks = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] !== 'snapshot') continue;
      chunks.push({ idx: Number(rows[i][1]) || 0, data: rows[i][2] || '' });
    }
    if (!chunks.length) return null;
    chunks.sort(function(a, b) { return a.idx - b.idx; });
    var json = chunks.map(function(c) { return c.data; }).join('');
    var parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.records)) return null;
    return {
      records: parsed.records,
      version: metaMap.snapshot_version || '',
      maxDate: metaMap.snapshot_max_date || '',
      savedAt: metaMap.snapshot_saved_at || '',
      count: Number(metaMap.snapshot_count) || parsed.records.length,
      // [FIX 2026-07-28] Mốc số dòng đã đọc tới lần trước cho từng sheet nguồn — dùng
      // để lần refresh sau chỉ đọc DÒNG MỚI THÊM VÀO thay vì quét lại toàn bộ sheet.
      lastRowFM:  Number(metaMap.lastrow_fm)  || 0,
      lastRowLM:  Number(metaMap.lastrow_lm)  || 0,
      lastRowSOP: Number(metaMap.lastrow_sop) || 0,
      // [MỚI] Vân tay dòng đầu/dòng mốc đã đọc — để phát hiện nguồn ghi lại mà số dòng không giảm
      fp: (metaMap.fp_fm_head || metaMap.fp_lm_head || metaMap.fp_sop_head) ? {
        FM:  { head: metaMap.fp_fm_head  || '', tail: metaMap.fp_fm_tail  || '' },
        LM:  { head: metaMap.fp_lm_head  || '', tail: metaMap.fp_lm_tail  || '' },
        SOP: { head: metaMap.fp_sop_head || '', tail: metaMap.fp_sop_tail || '' }
      } : null
    };
  } catch (e) {
    return null;
  }
}

function _kpifail_writePersistentSnapshot_(records, maxDate, rowCounts, fps) {
  var ss = _DS.ss(ADMIN_DB_ID);
  var metaSheet = _kpifail_getSnapshotMetaSheet_(ss);
  // [FIX 2026-07-28] "GHI AN TOÀN" kiểu ping-pong: đọc slot đang active TRƯỚC,
  // rồi ghi bản mới vào SLOT CÒN LẠI (không đụng gì tới slot đang active) — chỉ
  // sau khi ghi xong HOÀN TOÀN mới đổi con trỏ snapshot_active_slot sang slot
  // mới (1 lệnh ghi nhỏ, nhanh, gần như tức thời). Lý do: log Executions thực tế
  // cho thấy khi build toàn bộ chạm trần 30 phút và bị Apps Script giết giữa
  // chừng, nếu vẫn ghi kiểu "xoá sheet cũ rồi ghi mới" (1 sheet duy nhất), sheet
  // có thể bị bỏ trống dở dang đúng lúc bị giết -> snapshot hỏng -> lần đọc kế
  // tiếp tưởng chưa từng build -> build lại toàn bộ lần nữa -> lại có nguy cơ
  // timeout -> lặp lại nhiều lần (đã thấy đúng chuỗi 3 lượt Timed Out liên tiếp
  // sau lượt build đêm lúc 02:23:55 bị Timed Out). Với ping-pong: bị giết giữa
  // chừng lúc nào cũng chỉ làm hỏng slot ĐANG GHI (chưa ai đọc) — slot active cũ
  // vẫn nguyên vẹn, người đọc không hề bị ảnh hưởng.
  var oldMeta = _kpifail_getMetaMap_(metaSheet);
  var oldActiveSlot = oldMeta.snapshot_active_slot === 'B' ? 'B' : 'A';
  var newSlot = oldActiveSlot === 'A' ? 'B' : 'A';
  var dataSheet = _kpifail_getSnapshotSheet_(ss, newSlot);

  var json = JSON.stringify({ records: records || [] });
  var chunkSize = 45000;
  var rows = [['Key', 'ChunkIndex', 'ChunkData']];
  var idx = 0;
  for (var pos = 0; pos < json.length; pos += chunkSize) {
    rows.push(['snapshot', idx++, json.slice(pos, pos + chunkSize)]);
  }
  dataSheet.clearContents();
  dataSheet.getRange(1, 1, rows.length, 3).setValues(rows);
  dataSheet.getRange(1, 1, 1, 3).setFontWeight('bold');

  var nowIso = Utilities.formatDate(new Date(), SPX_TZ, "yyyy-MM-dd'T'HH:mm:ss");
  var metaUpdate = {
    snapshot_version: String(Date.now()),
    snapshot_max_date: maxDate || '',
    snapshot_saved_at: nowIso,
    snapshot_count: String((records || []).length),
    // Ghi xong hẳn rồi mới tới đây -> an toàn để đổi con trỏ sang slot mới.
    snapshot_active_slot: newSlot
  };
  // [FIX 2026-07-28] Mốc số dòng nguồn (đọc theo VỊ TRÍ DÒNG thay vì theo ngày —
  // xem _kpifail_readSourceRowsSince_). Nếu lượt này có đọc thật (rowCounts được
  // truyền vào) -> lưu mốc mới. Nếu chỉ "chạm" lại timestamp (vd bỏ qua vì nguồn
  // không ổn định) -> GIỮ NGUYÊN mốc cũ, không được ghi đè bằng rowCounts thiếu/0,
  // nếu không lần refresh kế tiếp sẽ tưởng chưa từng đọc gì và đọc lại từ đầu.
  if (rowCounts) {
    metaUpdate.lastrow_fm  = String(rowCounts.FM  || 0);
    metaUpdate.lastrow_lm  = String(rowCounts.LM  || 0);
    metaUpdate.lastrow_sop = String(rowCounts.SOP || 0);
  } else {
    if (oldMeta.lastrow_fm  !== undefined) metaUpdate.lastrow_fm  = oldMeta.lastrow_fm;
    if (oldMeta.lastrow_lm  !== undefined) metaUpdate.lastrow_lm  = oldMeta.lastrow_lm;
    if (oldMeta.lastrow_sop !== undefined) metaUpdate.lastrow_sop = oldMeta.lastrow_sop;
  }
  // [MỚI] Vân tay: lượt này có đọc dòng nào của sheet nào thì ghi vân tay mới của sheet đó; không đọc gì thì GIỮ
  // vân tay cũ (mốc không đổi). Người gọi truyền rowCounts mà quên fps -> bỏ vân tay (lượt sau sẽ đối soát lại).
  if (!(rowCounts && !fps)) {
    ['FM', 'LM', 'SOP'].forEach(function (k) {
      var lk = k.toLowerCase();
      var n = (rowCounts && fps && fps[k]) ? fps[k] : null;
      var head = (n && n.head) ? n.head : oldMeta['fp_' + lk + '_head'];
      var tail = (n && n.tail) ? n.tail : oldMeta['fp_' + lk + '_tail'];
      if (head) metaUpdate['fp_' + lk + '_head'] = head;
      if (tail) metaUpdate['fp_' + lk + '_tail'] = tail;
    });
  }
  _kpifail_setMetaMap_(metaSheet, metaUpdate);
  // [MỚI] Dữ liệu thật sự đổi -> bỏ cache gói tổng hợp (khoá gắn số phiên bản) và cache mốc phiên bản, để mọi
  // người dùng nhận bản mới ngay lượt kế thay vì chờ hết TTL 10 phút; khớp với mốc kpifail_getDataVersion().
  if (_kpifail_dataVersionOf_(oldMeta) !== _kpifail_dataVersionOf_(metaUpdate)) {
    _kpifail_bumpLiteCacheVersion_();
    try { CacheService.getScriptCache().remove('kpifail_dataver_v1'); } catch (eRm) {}
  }
}

function _kpifail_resetPersistentSnapshot_() {
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    // [FIX 2026-07-28] Dọn CẢ HAI slot (A và B) — reset kiểu cũ chỉ dọn 1 sheet là
    // đủ vì trước đây chỉ có 1 sheet; giờ có 2 slot ping-pong nên phải dọn cả 2,
    // nếu không dữ liệu cũ ở slot còn lại có thể bị đọc nhầm là "active" sau khi
    // metaSheet bị xoá (mặc định activeSlot='A' khi thiếu key snapshot_active_slot).
    _kpifail_getSnapshotSheet_(ss, 'A').clearContents();
    _kpifail_getSnapshotSheet_(ss, 'A').getRange(1, 1, 1, 3).setValues([['Key', 'ChunkIndex', 'ChunkData']]).setFontWeight('bold');
    _kpifail_getSnapshotSheet_(ss, 'B').clearContents();
    _kpifail_getSnapshotSheet_(ss, 'B').getRange(1, 1, 1, 3).setValues([['Key', 'ChunkIndex', 'ChunkData']]).setFontWeight('bold');
    var metaSheet = _kpifail_getSnapshotMetaSheet_(ss);
    metaSheet.clearContents();
    metaSheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]).setFontWeight('bold');
  } catch (e) {}
}

function _kpifail_canUseRefreshLock_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var now = Date.now();
    var raw = props.getProperty(KPIFAIL_PERSIST_REFRESH_LOCK_KEY) || '';
    if (raw) {
      var until = Number(raw);
      if (!isNaN(until) && until > now) return false;
    }
    props.setProperty(KPIFAIL_PERSIST_REFRESH_LOCK_KEY, String(now + KPIFAIL_PERSIST_REFRESH_SECONDS * 1000));
    return true;
  } catch (e) {
    return true;
  }
}

function _kpifail_releaseRefreshLock_() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(KPIFAIL_PERSIST_REFRESH_LOCK_KEY);
  } catch (e) {}
}

function _kpifail_subtractDays_(dateStr, days) {
  if (!dateStr) return '';
  var p = String(dateStr).split('-');
  if (p.length !== 3) return '';
  // [SỬA] Toán LỊCH THUẦN trên chuỗi ngày (qua UTC) — kết quả không phụ thuộc múi giờ nào.
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  d.setUTCDate(d.getUTCDate() - Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function _kpifail_mergeRecords_(baseRecords, deltaRecords, refreshFromDate) {
  var merged = [];
  var map = {};
  var cutoff = refreshFromDate || '';
  var makeKey = function(rec) {
    return [rec.category || '', rec.date || '', rec.id || '', rec.hub || ''].join('|');
  };

  for (var i = 0; i < (baseRecords || []).length; i++) {
    var rec = baseRecords[i];
    if (!rec || !rec.id || !rec.date) continue;
    if (cutoff && rec.date >= cutoff) continue;
    var oldKey = makeKey(rec);
    if (map[oldKey]) continue;
    map[oldKey] = 1;
    merged.push(rec);
  }

  for (var j = 0; j < (deltaRecords || []).length; j++) {
    var dRec = deltaRecords[j];
    if (!dRec || !dRec.id || !dRec.date) continue;
    var key = makeKey(dRec);
    if (map[key]) continue;
    map[key] = 1;
    merged.push(dRec);
  }

  merged.sort(function(a, b) {
    if ((a.date || '') === (b.date || '')) return String(b.id || '').localeCompare(String(a.id || ''));
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
  return merged;
}

// [FIX 2026-07-28] Đọc số dòng HIỆN TẠI của 3 sheet nguồn — chỉ gọi getLastRow()
// (rẻ, không tải dữ liệu), dùng để so với mốc đã lưu lần trước nhằm phát hiện
// dòng mới thêm HOẶC phát hiện sheet bị ghi lại từ đầu (số dòng giảm đột ngột).
function _kpifail_getSourceRowCounts_(ss) {
  var names = { FM: KPIFAIL_SHEET_FM, LM: KPIFAIL_SHEET_LM, SOP: KPIFAIL_SHEET_SOP };
  var out = { FM: 0, LM: 0, SOP: 0 };
  for (var k in names) {
    var sh = ss.getSheetByName(names[k]);
    out[k] = sh ? sh.getLastRow() : 0;
  }
  return out;
}

// [FIX 2026-07-28] THAY THẾ _kpifail_readSourceDeltaSince_ (đọc theo NGÀY, phải
// quét toàn bộ sheet mỗi lần vì không dám "break" sớm — xem log Executions: có
// sheet ~200k dòng, mỗi lượt "delta" vẫn mất 500-1800s vì thực chất là full scan).
//
// Hàm mới đọc theo VỊ TRÍ DÒNG: chỉ lấy phần dòng nằm SAU mốc đã đọc lần trước
// (prevRowCounts.FM/LM/SOP, lưu trong snapshot metadata). Giả định duy nhất cần
// có: dữ liệu ghi vào sheet luôn NỐI THÊM Ở CUỐI theo thời điểm ghi — đây là
// giả định VỀ VỊ TRÍ LƯU TRỮ (luôn đúng với append/batch-update qua Sheets API),
// khác hẳn giả định cũ đã gây bug là "cột ngày bên trong luôn tăng dần" (không
// đúng, vì nhiều hub ghi xen kẽ). Nhờ vậy có thể "break" an toàn: chỉ đọc đúng
// (curRow - prevRow) dòng mới, không cần quét lại lịch sử.
//
// Rủi ro còn lại (đã biết, chấp nhận có chủ đích): nếu hệ thống nguồn SỬA LẠI
// dữ liệu Ở GIỮA sheet (backfill dòng cũ) thay vì chỉ nối thêm, cách này sẽ
// không thấy được thay đổi đó cho tới lần full-rebuild định kỳ tiếp theo (xem
// kpifail_forceFullRebuild + trigger hằng ngày mới thêm). Đánh đổi có chủ đích:
// đổi 1 ngày trễ tối đa cho các bản sửa dữ liệu cũ, lấy lại tốc độ cho >99% chu
// kỳ refresh (chỉ còn tỉ lệ với số dòng MỚI trong 5 phút, không phải toàn bộ lịch sử).
function _kpifail_readSourceRowsSince_(ss, prevRowCounts) {
  var tz = SPX_TZ;
  // [FIX] Dùng cùng parseAnyDate() với _kpifail_buildRecords() để 2 đường đọc
  // (full rebuild và delta refresh) luôn cho ra cùng kết quả — tránh trường
  // hợp full rebuild thấy record (nhờ fallback) nhưng delta refresh lại không.
  var parseAnyDate = function(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === 'string' && v.trim()) {
      var s = v.trim();
      var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (m) {
        var d1 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (!isNaN(d1.getTime())) return d1;
      }
      m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (m) {
        var d2 = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        if (!isNaN(d2.getTime())) return d2;
      }
      var d3 = new Date(s);
      if (!isNaN(d3.getTime())) return d3;
    }
    if (typeof v === 'number' && v > 0) {
      // [FIX-TZ] Dùng epoch neo theo giờ local của Apps Script (= project
      // Time Zone) thay vì UTC cứng, để khớp với cách toàn bộ code còn lại
      // đang quy đổi ngày theo Asia/Ho_Chi_Minh — tránh lệch ngày gần mốc
      // nửa đêm nếu nhánh fallback số serial này từng bị kích hoạt.
      var epochLocal = new Date(1899, 11, 30);
      var d4 = new Date(epochLocal.getTime() + Math.round(v * 86400000));
      if (!isNaN(d4.getTime())) return d4;
    }
    return null;
  };
  var fmtDate = function(d) {
    var dd = parseAnyDate(d);
    return dd ? Utilities.formatDate(dd, tz, 'yyyy-MM-dd') : null;
  };
  var fmtDateTime = function(d) {
    var dd = parseAnyDate(d);
    return dd ? Utilities.formatDate(dd, tz, 'yyyy-MM-dd HH:mm') : null;
  };

  var _startTime = Date.now();

  function readNewRows(sheetName, prevCount, buildRecord, key) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { records: [], reachedRow: prevCount || 0, complete: true };
    var C = _kpifail_cols_(sheet, key); // [SỬA] dò cột theo TIÊU ĐỀ (thay r[0], r[12]... cố định)
    var startRow = Math.max(2, (prevCount || 0) + 1);
    var chunk = _kpifail_readRowsBudgeted_(sheet, startRow, _startTime);
    var out = [];
    for (var i = 0; i < chunk.values.length; i++) {
      var r = chunk.values[i];
      var sortDateStr = fmtDate(C.date !== undefined ? r[C.date] : undefined);
      var rec = buildRecord(r, sortDateStr, fmtDate, fmtDateTime, C);
      if (rec) out.push(rec);
    }
    // reachedRow có thể < startRow-1 khi hoàn toàn không đọc được gì (hết ngân
    // sách ngay từ đầu) — giữ nguyên prevCount trong trường hợp đó, không lùi mốc.
    var reached = Math.max(chunk.reachedRow, (prevCount || 0));
    return { records: out, reachedRow: reached, complete: chunk.complete, fp: _kpifail_fpOfChunk_(chunk, startRow, C) };
  }

  // [FIX 2026-07-29] Xử lý TUẦN TỰ FM → LM → SOP, dùng CHUNG 1 ngân sách thời
  // gian (_startTime) cho cả 3 — dừng lại NGAY tại sheet đầu tiên hết ngân sách,
  // KHÔNG đụng tới các sheet sau (giữ nguyên mốc cũ của chúng, chưa đọc gì thêm
  // ở lượt này — sẽ đọc bù ở lượt kế tiếp). Không bao giờ để 1 lượt gọi vượt
  // quá KPIFAIL_TIME_BUDGET_MS, dù tồn đọng bao nhiêu dòng.
  var fmResult = readNewRows(KPIFAIL_SHEET_FM, prevRowCounts.FM, function(r, sortDateStr, fd, fmt, C) {
    var g = function(k) { return _kpi_g_(r, C, k); };
    // [FIX] fallback: nếu cột Date trống, dùng LH Arrived Time Finalized rồi LH Arrived Time
    var dateStr = sortDateStr || fd(g('lhArrivedFinal')) || fd(g('lhArrived'));
    if (!dateStr) return null;
    var arrived = g('lhArrivedFinal') instanceof Date ? g('lhArrivedFinal') : (g('lhArrived') instanceof Date ? g('lhArrived') : null);
    var eta = g('eta') instanceof Date ? g('eta') : null;
    var delayH = (arrived && eta) ? Math.round(((arrived - eta) / 3600000) * 10) / 10 : null;
    return {
      id: String(g('id') || ''), date: dateStr, hub: String(g('hub') || g('pickup') || ''), category: 'FM',
      type: String(g('type') || ''), reason: String(g('reason') || ''), delayHours: delayH,
      raw: {
        pickupStation: g('pickup'), bulky: g('bulky'), dts: g('dts'), toSoc: g('toSoc'),
        pickedTime: fmt(g('picked')), inboundTime: fmt(g('inbound')), packedTime: fmt(g('packed')),
        lhArrivedTime: fmt(g('lhArrived')), lhArrivedTimeFinal: fmt(g('lhArrivedFinal')),
        lhPackedTime: fmt(g('lhPacked')), fmEta: fmt(g('eta')), cotLate: g('cotLate')
      }
    };
  }, 'FM');

  if (!fmResult.complete) {
    return {
      records: fmResult.records,
      rowCounts: { FM: fmResult.reachedRow, LM: prevRowCounts.LM, SOP: prevRowCounts.SOP },
      fingerprints: { FM: fmResult.fp },
      complete: false
    };
  }

  var lmResult = readNewRows(KPIFAIL_SHEET_LM, prevRowCounts.LM, function(r, sortDateStr, fd, fmt, C) {
    var g = function(k) { return _kpi_g_(r, C, k); };
    // [FIX] fallback ctime_date trống -> Arrived Time -> First Attempt Time
    var dateStr = sortDateStr || fd(g('arrived')) || fd(g('attempt'));
    if (!dateStr) return null;
    var attempt = g('attempt') instanceof Date ? g('attempt') : null;
    var eta = g('eta') instanceof Date ? g('eta') : null;
    var delayH = (attempt && eta) ? Math.round(((attempt - eta) / 3600000) * 10) / 10 : null;
    return {
      id: String(g('id') || ''), date: dateStr, hub: String(g('hub') || ''), category: 'LM',
      type: String(g('type') || ''), reason: '', delayHours: delayH,
      raw: {
        arrivedTime: fmt(g('arrived')), firstAttemptTime: fmt(g('attempt')), lmEta: fmt(g('eta')),
        lmInbound: fmt(g('inbound')), riderId: g('rider') || null
      }
    };
  }, 'LM');

  if (!lmResult.complete) {
    return {
      records: fmResult.records.concat(lmResult.records),
      rowCounts: { FM: fmResult.reachedRow, LM: lmResult.reachedRow, SOP: prevRowCounts.SOP },
      fingerprints: { FM: fmResult.fp, LM: lmResult.fp },
      complete: false
    };
  }

  var sopResult = readNewRows(KPIFAIL_SHEET_SOP, prevRowCounts.SOP, function(r, sortDateStr, fd, fmt, C) {
    var g = function(k) { return _kpi_g_(r, C, k); };
    // [FIX] fallback Date trống -> Pickup ETA
    var dateStr = sortDateStr || fd(g('pickupEta'));
    if (!dateStr) return null;
    return {
      id: String(g('id') || ''), date: dateStr, hub: String(g('hub') || ''), category: 'SOP',
      type: String(g('type') || ''), reason: '', delayHours: null,
      raw: { pickupEta: fmt(g('pickupEta')) }
    };
  }, 'SOP');

  return {
    records: fmResult.records.concat(lmResult.records).concat(sopResult.records),
    rowCounts: { FM: fmResult.reachedRow, LM: lmResult.reachedRow, SOP: sopResult.reachedRow },
    fingerprints: { FM: fmResult.fp, LM: lmResult.fp, SOP: sopResult.fp },
    complete: sopResult.complete
  };
}

// [MỚI] Tín hiệu "vừa có thay đổi" từ onChange trigger (xem
// kpifail_setupSourceChangeWatcher() / _kpifail_onSourceChanged_ bên dưới).
// Mỗi lần sheet nguồn bị sửa (dù bởi UI hay service account ghi qua API),
// trigger tự cập nhật property này — không cần đoán bằng cách đọc lặp lại.
var KPIFAIL_SOURCE_CHANGE_TS_PROP = 'kpifail_source_last_change_ts';
// Khoảng "im lặng" tối thiểu sau lần đổi gần nhất mới coi là an toàn để đọc.
// [FIX] Tăng từ 8s -> 15s: dữ liệu có ngày lên tới ~200k dòng, một lần ghi như
// vậy khó mà "hiện ra 1 phát" — thực tế thường được chia thành nhiều batch, có
// thể có khoảng nghỉ NGẮN giữa các batch (vài giây) trong lúc bên ghi xử lý dữ
// liệu. Nếu quiet-period quá ngắn, ta có thể lầm tưởng "đã ghi xong" ngay giữa
// 2 batch rồi đọc trúng phần chưa ghi tới. 15s là mức đánh đổi an toàn hơn,
// chấp nhận dashboard có thể "cũ" thêm vài giây trong những ngày ghi nhiều, để
// đổi lại gần như chắc chắn không đọc trúng lúc đang ghi. Có thể tăng thêm nếu
// vẫn còn gặp trường hợp mất dữ liệu giữa ngày sau khi áp fix này.
var KPIFAIL_SOURCE_QUIET_MS = 15000;

// Handler của onChange trigger — CHỈ ghi timestamp, không làm gì nặng, để mỗi
// lần trigger nổ (có thể nổ nhiều lần liên tiếp nếu bên ghi làm nhiều bước)
// không tốn quota/tài nguyên. Không tự gọi hàm này trực tiếp — do trigger gọi.
function _kpifail_onSourceChanged_(e) {
  try {
    PropertiesService.getScriptProperties().setProperty(KPIFAIL_SOURCE_CHANGE_TS_PROP, String(Date.now()));
  } catch (err) {}
}

// [MỚI] Chạy 1 LẦN DUY NHẤT (trong Apps Script Editor) để bật theo dõi thay đổi
// trên spreadsheet NGUỒN (KPIFAIL_SS_ID) — LƯU Ý: đây là 1 spreadsheet KHÁC với
// spreadsheet đang chứa script này, nên cần tài khoản chạy hàm này có QUYỀN CHỈNH
// SỬA (không chỉ xem) trên KPIFAIL_SS_ID, nếu không ScriptApp.newTrigger() sẽ báo
// lỗi quyền. Nếu không có quyền chỉnh sửa, nhờ người có quyền (vd chủ sở hữu
// service account data-dashboard hoặc admin sheet đó) chạy hộ 1 lần.
//
// ⚠️ [BẮT BUỘC CHẠY LẠI SAU KHI ĐỔI NGUỒN DỮ LIỆU] Trigger onChange gắn CỨNG vào
// ĐÚNG 1 spreadsheet cụ thể tại thời điểm tạo. Khi KPIFAIL_SS_ID đổi sang
// spreadsheet mới, trigger cũ VẪN theo dõi spreadsheet CŨ — tức là không còn tác
// dụng, mà cũng không báo lỗi gì (im lặng sai). Hàm này tự xoá trigger cũ trước
// khi tạo mới nên chỉ cần chạy lại 1 lần là xong.
function kpifail_setupSourceChangeWatcher() {
  // [SECURITY FIX 2026-08] Hàm tạo/xoá Trigger cấp project — trước đây không kiểm
  // tra quyền, ai gọi cũng chỉnh được trigger hệ thống. Chỉ admin mới được chạy.
  _requireAdmin_(1);
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === '_kpifail_onSourceChanged_') ScriptApp.deleteTrigger(t);
  });
  var ssSrc = _DS.ss(KPIFAIL_SS_ID);
  ScriptApp.newTrigger('_kpifail_onSourceChanged_')
    .forSpreadsheet(ssSrc)
    .onChange()
    .create();
  _LOG.d('✅ Trigger onChange cho KPIFAIL_SS_ID đã được tạo — mọi lần sheet nguồn bị sửa (dù qua UI hay API) sẽ tự cập nhật mốc thời gian để _kpifail_waitForStableSource_() dùng.');
}

// Kiểm tra nhanh trigger có đang tồn tại + hoạt động không — chạy trong Editor
// để xác nhận sau khi setup, hoặc để soát khi nghi trigger bị mất/hỏng.
function kpifail_checkSourceChangeWatcherStatus() {
  var found = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === '_kpifail_onSourceChanged_';
  });
  var lastTs = PropertiesService.getScriptProperties().getProperty(KPIFAIL_SOURCE_CHANGE_TS_PROP);
  var result = {
    triggerInstalled: found,
    lastChangeDetected: lastTs ? new Date(Number(lastTs)).toString() : '(chưa ghi nhận lần nào)'
  };
  _LOG.d(JSON.stringify(result));
  return JSON.stringify(result);
}

// [MỚI] Kiểm tra chủ động: nguồn (3 sheet FM/LM/SOP) có đang bị ghi/cập nhật
// ngay lúc này không — trước khi đọc để build/refresh. 2 lớp, theo thứ tự:
//
// LỚP 1 — tín hiệu onChange (nếu đã setup qua kpifail_setupSourceChangeWatcher()):
// nếu sheet nguồn vừa bị sửa trong vòng KPIFAIL_SOURCE_QUIET_MS gần nhất -> coi
// là KHÔNG ổn định NGAY, không cần đọc gì cả (rẻ, và bắt được cả trường hợp ghi
// KHÔNG đổi getLastRow() — ví dụ ghi đè giá trị các dòng đã có mà không thêm/xoá
// dòng — vốn là điểm mù của cách đọc-lặp-lại ở Lớp 2).
//
// LỚP 2 — đọc-lặp-lại getLastRow() (cách cũ, luôn chạy dù Lớp 1 có hay không):
// đọc getLastRow() của cả 3 sheet, đợi 1.5s, đọc lại — số dòng đổi giữa 2 lần
// đọc nghĩa là đang có ghi. Đây là lớp AN TOÀN ĐỘC LẬP — vẫn hoạt động dù trigger
// onChange ở Lớp 1 chưa từng setup, bị lỗi quyền, hoặc âm thầm bị xoá/hỏng sau
// này mà không ai để ý (không phụ thuộc "trigger còn sống hay không").
//
// Chỉ coi là ổn định khi CẢ HAI lớp đều xác nhận.
function _kpifail_waitForStableSource_(ss, maxAttempts) {
  // Lớp 1: tín hiệu onChange (best-effort — property có thể chưa từng tồn tại
  // nếu chưa setup trigger, khi đó bỏ qua lớp này, không chặn oan).
  try {
    var lastChangeTs = PropertiesService.getScriptProperties().getProperty(KPIFAIL_SOURCE_CHANGE_TS_PROP);
    if (lastChangeTs) {
      var elapsedMs = Date.now() - Number(lastChangeTs);
      if (elapsedMs < KPIFAIL_SOURCE_QUIET_MS) return false;
    }
  } catch (e) {}

  // Lớp 2: đọc-lặp-lại getLastRow() — luôn chạy, không phụ thuộc Lớp 1.
  maxAttempts = maxAttempts || 2;
  var sheetNames = [KPIFAIL_SHEET_FM, KPIFAIL_SHEET_LM, KPIFAIL_SHEET_SOP];
  var snap = function() {
    return sheetNames.map(function(name) {
      var sh = ss.getSheetByName(name);
      return sh ? sh.getLastRow() : -1;
    }).join(',');
  };
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var before = snap();
    Utilities.sleep(1500);
    var after = snap();
    if (before === after) return true;
  }
  return false;
}

/**
 * _kpifail_scopeKey_(access)
 * [MỚI — tối ưu quy mô 2k user] Sinh khoá cache theo PHẠM VI QUYỀN thay vì
 * theo từng email. Hai người CÙNG quyền -> CÙNG khoá -> dùng chung 1 bản cache
 * (nội dung vốn đã y hệt nhau), thay vì mỗi người 1 bản trùng lặp.
 * Có chốt độ dài: với tài khoản phạm vi rộng (tới ~1.000 trạm), danh sách hub
 * nối chuỗi sẽ rất dài — vượt giới hạn độ dài khoá cache. Khi đó rút gọn bằng
 * hash ổn định (cùng danh sách luôn ra cùng hash) + kèm số lượng hub để giảm
 * tối đa khả năng trùng khoá giữa 2 phạm vi khác nhau.
 */
function _kpifail_scopeKey_(access) {
  if (!access || access.role === 'admin') return 'admin';
  var hubs = (access.hubs && access.hubs.length) ? access.hubs.slice() : [];
  var norm = [];
  var seen = {};
  for (var i = 0; i < hubs.length; i++) {
    var h = _kpifail_normHubBase_(hubs[i]);
    if (h && !seen[h]) { seen[h] = 1; norm.push(h); }
  }
  norm.sort();
  var joined = norm.join('|');
  if (joined.length <= 120) return 'sc_' + joined.replace(/[^a-z0-9|]/gi, '_');
  var hash = 0;
  for (var j = 0; j < joined.length; j++) { hash = ((hash << 5) - hash + joined.charCodeAt(j)) | 0; }
  return 'sc' + norm.length + '_' + (hash >>> 0).toString(36);
}

function _kpifail_getPersistentMasterRecords_() {
  var ss = _DS.ss(KPIFAIL_SS_ID);
  var snapshot = _kpifail_readPersistentSnapshot_();
  var needFullBuild = !snapshot || !Array.isArray(snapshot.records) || !snapshot.records.length;
  if (needFullBuild) {
    // [FIX] Chờ nguồn ổn định trước khi build TOÀN BỘ — đây là lần xây snapshot
    // gốc, không có bản cũ nào để "giữ lại" nếu đọc trúng lúc nguồn đang bị xoá
    // để ghi lại, nên càng cần cẩn trọng ở bước này. Nếu sau các lần thử vẫn
    // không ổn định, vẫn build (còn hơn không có gì) nhưng ghi log cảnh báo rõ
    // để biết kết quả lần này có thể không đầy đủ, cần build lại sau.
    var stableFull = _kpifail_waitForStableSource_(ss);
    if (!stableFull) {
      _LOG.d('[KPIFail buildFull] CẢNH BÁO: nguồn có vẻ đang được ghi liên tục lúc build — kết quả lần này có thể thiếu, nên build lại (kpifail_forceFullRebuild) sau khi chắc chắn nguồn đã ghi xong.');
    }
    var buildResult = _kpifail_buildRecords(ss);
    var fullRecords = buildResult.records;
    var maxDate = '';
    for (var i = 0; i < fullRecords.length; i++) if (fullRecords[i] && fullRecords[i].date > maxDate) maxDate = fullRecords[i].date;
    // [FIX 2026-07-29] Lưu rowCounts THỰC TẾ đã đọc tới (buildResult.rowCounts) —
    // có thể chỉ là MỘT PHẦN nếu hết ngân sách thời gian giữa chừng
    // (buildResult.complete === false). Không sao — vì snapshot.records giờ đã
    // > 0, lần gọi kế tiếp sẽ không còn needFullBuild nữa mà đi theo đường
    // refresh incremental bình thường (_kpifail_readSourceRowsSince_), tự động
    // đọc tiếp đúng từ rowCounts này — không cần logic "tiếp tục" riêng ở đây.
    if (!buildResult.complete) {
      _LOG.d('[KPIFail buildFull] Build lần đầu chưa xong hết trong ngân sách thời gian — đã lưu ' + fullRecords.length + ' record, phần còn lại sẽ tự đọc tiếp ở các chu kỳ refresh 5 phút kế tiếp.');
    }
    _kpifail_writePersistentSnapshot_(fullRecords, maxDate, buildResult.rowCounts, buildResult.fingerprints);
    return { records: fullRecords, maxDate: maxDate, fromPersistent: false, rebuilt: true, sourceStable: stableFull, buildComplete: buildResult.complete };
  }

  var savedAtTs = snapshot.savedAt ? new Date(snapshot.savedAt).getTime() : 0;
  if (savedAtTs && (Date.now() - savedAtTs) < (KPIFAIL_PERSIST_REFRESH_SECONDS * 1000)) {
    return { records: snapshot.records, maxDate: snapshot.maxDate || '', fromPersistent: true, rebuilt: false };
  }

  if (!_kpifail_canUseRefreshLock_()) {
    return { records: snapshot.records, maxDate: snapshot.maxDate || '', fromPersistent: true, rebuilt: false, refreshSkipped: true };
  }

  try {
    // [FIX] Lớp bảo vệ CHỦ ĐỘNG (trước khi đọc): nếu nguồn đang bị ghi/cập nhật
    // ngay lúc này, bỏ qua refresh lần này luôn — không tốn công đọc + merge rồi
    // mới phát hiện bất thường ở lớp bảo vệ phản ứng bên dưới.
    var stable = _kpifail_waitForStableSource_(ss);
    if (!stable) {
      _LOG.d('[KPIFail refresh] Bỏ qua vì nguồn đang được ghi liên tục (getLastRow thay đổi giữa các lần đọc cách nhau 1.5s). Giữ snapshot cũ, thử lại ở lần refresh kế tiếp.');
      _kpifail_writePersistentSnapshot_(snapshot.records, snapshot.maxDate || '');
      return { records: snapshot.records, maxDate: snapshot.maxDate || '', fromPersistent: true, rebuilt: false, refreshSkippedUnstableSource: true };
    }

    // [FIX 2026-07-28] "ĐỌC THEO SỐ DÒNG" thay cho "đọc theo cửa sổ ngày" —
    // xem comment đầy đủ ở _kpifail_readSourceRowsSince_. Đổi KPIFAIL_PERSIST_OVERLAP_DAYS
    // + _kpifail_readSourceDeltaSince_ (quét lại TOÀN BỘ sheet mỗi 5 phút, đã xác
    // nhận qua log Executions là nguyên nhân chính gây các lượt 500-1800s) lấy
    // _kpifail_readSourceRowsSince_ (chỉ đọc đúng số dòng MỚI THÊM VÀO).
    var prevRowCounts = { FM: snapshot.lastRowFM || 0, LM: snapshot.lastRowLM || 0, SOP: snapshot.lastRowSOP || 0 };
    var curRowCounts = _kpifail_getSourceRowCounts_(ss);

    // [FIX] Phát hiện sheet bị GHI LẠI TỪ ĐẦU (clearContents rồi append lại —
    // đã xác nhận qua Version History là pattern có thật của 2 service account
    // ghi vào nguồn): nếu số dòng HIỆN TẠI < mốc đã đọc lần trước, "phần sau mốc
    // cũ là dòng mới" không còn đúng nữa (vì mốc cũ giờ đã vượt quá số dòng thật
    // có) — không thể tin incremental được nữa, phải build lại toàn bộ 1 lần.
    // Đây là tín hiệu TRỰC TIẾP (đếm dòng), thay thế hoàn toàn cơ chế cũ suy
    // đoán gián tiếp qua % sụt giảm record theo cửa sổ ngày (kém chính xác hơn
    // và chỉ hợp với cách đọc-theo-ngày cũ, không còn cần thiết với cách mới).
    var rewritten = (curRowCounts.FM < prevRowCounts.FM) || (curRowCounts.LM < prevRowCounts.LM) || (curRowCounts.SOP < prevRowCounts.SOP);

    // [MỚI] Đối soát VÂN TAY dòng đầu + dòng mốc: bắt trường hợp nguồn ghi lại/trượt cửa sổ mà SỐ DÒNG KHÔNG GIẢM
    // (khi đó đọc "sau mốc cũ" sẽ bỏ sót một phần dữ liệu mới). Khác với nhánh "số dòng giảm" bên dưới (thay hẳn
    // toàn bộ), nhánh này GỘP phần đọc lại đầy đủ vào snapshot đang có -> KHÔNG mất lịch sử đã tích luỹ.
    // Chặn tối đa 1 lần / 20 phút để nguồn có đổi liên tục cũng không kéo theo đọc toàn bộ liên tục.
    if (!rewritten) {
      var _fpc = { rewritten: false };
      try { _fpc = _kpifail_sourceRewritten_(ss, snapshot, prevRowCounts); } catch (eFp) { _LOG.d('[KPIFail refresh] Không đối soát được vân tay: ' + eFp.message); }
      if (_fpc.rewritten) {
        var _props = PropertiesService.getScriptProperties();
        var _lastFpAt = Number(_props.getProperty('kpifail_fp_rebuild_at') || 0);
        if (Date.now() - _lastFpAt >= 20 * 60 * 1000) {
          _props.setProperty('kpifail_fp_rebuild_at', String(Date.now()));
          _LOG.d('[KPIFail refresh] Vân tay nguồn đổi (' + _fpc.why + ') — đọc lại đầy đủ và GỘP vào snapshot.');
          var bF = _kpifail_buildRecords(ss);
          var mergedF = _kpifail_mergeRecords_(snapshot.records, bF.records, '');
          var maxDateF = snapshot.maxDate || '';
          for (var iF = 0; iF < mergedF.length; iF++) if (mergedF[iF] && mergedF[iF].date > maxDateF) maxDateF = mergedF[iF].date;
          _kpifail_writePersistentSnapshot_(mergedF, maxDateF, bF.rowCounts, bF.fingerprints);
          return { records: mergedF, maxDate: maxDateF, fromPersistent: true, rebuilt: true, rebuiltReason: 'source_fingerprint_changed: ' + _fpc.why, buildComplete: bF.complete };
        }
        _LOG.d('[KPIFail refresh] Vân tay đổi (' + _fpc.why + ') nhưng vừa đối soát <20 phút trước — bỏ qua lượt này.');
      }
    }

    // [SỬA — đo thật: job này ngốn 90 phút/ngày, 33% toàn bộ ngân sách nền]
    // Nguồn KPI chỉ đổi VÀI LẦN MỖI NGÀY, nhưng trước đây cứ 5 phút là làm mới:
    // đọc và ghi lại toàn bộ snapshot (~37 giây/lượt, ~145 lượt/ngày) chỉ để phát
    // hiện ra "không có gì mới".
    // Nay kiểm tra RẺ trước: đếm số dòng 3 sheet nguồn (3 lần getLastRow, ~1 giây).
    // Không dòng nào thêm và không bị ghi lại từ đầu -> nghỉ ngay, giữ nguyên snapshot.
    // KHÔNG cập nhật mốc thời gian snapshot: lượt sau vẫn kiểm tra lại, nên nguồn
    // vừa đổi là bắt được ngay, không phải chờ hết chu kỳ.
    if (!rewritten &&
        curRowCounts.FM === prevRowCounts.FM &&
        curRowCounts.LM === prevRowCounts.LM &&
        curRowCounts.SOP === prevRowCounts.SOP) {
      _LOG.d('[KPIFail refresh] Nguồn chưa có dòng mới (FM ' + curRowCounts.FM + ', LM ' + curRowCounts.LM +
             ', SOP ' + curRowCounts.SOP + ') — bỏ qua làm mới, dùng lại snapshot sẵn có.');
      return { records: snapshot.records, maxDate: snapshot.maxDate || '', fromPersistent: true,
               rebuilt: false, refreshSkipped: 'nguon_chua_doi' };
    }
    if (rewritten) {
      _LOG.d('[KPIFail refresh] Số dòng sheet nguồn GIẢM so với mốc đã đọc (FM ' + prevRowCounts.FM + '->' + curRowCounts.FM +
        ', LM ' + prevRowCounts.LM + '->' + curRowCounts.LM + ', SOP ' + prevRowCounts.SOP + '->' + curRowCounts.SOP +
        ') — nghi bị ghi lại từ đầu, build lại toàn bộ thay vì đọc incremental.');
      var buildResult2 = _kpifail_buildRecords(ss);
      var fullRecords2 = buildResult2.records;
      var maxDate2 = '';
      for (var i2 = 0; i2 < fullRecords2.length; i2++) if (fullRecords2[i2] && fullRecords2[i2].date > maxDate2) maxDate2 = fullRecords2[i2].date;
      // [FIX 2026-07-29] Lưu rowCounts THỰC TẾ đọc tới (có thể chỉ 1 phần nếu hết
      // ngân sách thời gian) — không dùng _kpifail_getSourceRowCounts_(ss) (số dòng
      // TUYỆT ĐỐI của sheet) nữa, nếu không sẽ đánh dấu nhầm là "đã đọc hết" trong
      // khi thực ra mới đọc 1 phần, làm lần refresh sau BỎ SÓT phần chưa đọc.
      _kpifail_writePersistentSnapshot_(fullRecords2, maxDate2, buildResult2.rowCounts, buildResult2.fingerprints);
      return { records: fullRecords2, maxDate: maxDate2, fromPersistent: false, rebuilt: true, rebuiltReason: 'source_row_count_decreased', buildComplete: buildResult2.complete };
    }

    var deltaResult = _kpifail_readSourceRowsSince_(ss, prevRowCounts);
    var deltaRecords = deltaResult.records;
    if (!deltaRecords.length) {
      // Không có dòng mới nào thật sự tạo ra record hợp lệ (có thể do dòng mới
      // thiếu ngày, hoặc hết ngân sách thời gian ngay từ dòng đầu tiên...) — vẫn
      // cập nhật mốc số dòng THỰC TẾ đã đọc tới (deltaResult.rowCounts, không
      // phải curRowCounts tuyệt đối) để không bỏ sót nếu lượt này chưa đọc hết.
      _kpifail_writePersistentSnapshot_(snapshot.records, snapshot.maxDate || '', deltaResult.rowCounts, deltaResult.fingerprints);
      return { records: snapshot.records, maxDate: snapshot.maxDate || '', fromPersistent: true, rebuilt: false };
    }

    // [FIX] Chỉ có DÒNG MỚI (chưa từng đọc, không trùng với bất kỳ dòng nào đã có
    // trong snapshot) — không cần "xoá vùng ngày gần đây rồi thế delta vào" như
    // cách cũ (refreshFromDate rỗng = giữ nguyên toàn bộ base, chỉ thêm mới,
    // dedupe theo category+date+id+hub qua _kpifail_mergeRecords_ sẵn có).
    var merged = _kpifail_mergeRecords_(snapshot.records, deltaRecords, '');

    var maxDate = snapshot.maxDate || '';
    for (var j = 0; j < merged.length; j++) if (merged[j] && merged[j].date > maxDate) maxDate = merged[j].date;
    // [FIX 2026-07-29] rowCounts thực tế (deltaResult.rowCounts) — nếu
    // deltaResult.complete === false (hết ngân sách giữa chừng), mốc lưu chỉ tới
    // đúng vị trí đã đọc, chu kỳ 5 phút sau sẽ tự đọc tiếp phần còn lại, không
    // cần chờ user hay admin làm gì thêm.
    _kpifail_writePersistentSnapshot_(merged, maxDate, deltaResult.rowCounts, deltaResult.fingerprints);
    if (!deltaResult.complete) {
      _LOG.d('[KPIFail refresh] Hết ngân sách thời gian, còn tồn đọng — đã đọc thêm ' + deltaRecords.length + ' record, phần còn lại sẽ đọc tiếp ở chu kỳ 5 phút kế tiếp.');
    }
    return { records: merged, maxDate: maxDate, fromPersistent: true, rebuilt: false, refreshed: true, newRowsRead: deltaRecords.length, refreshComplete: deltaResult.complete };
  } catch (e) {
    return { records: snapshot.records, maxDate: snapshot.maxDate || '', fromPersistent: true, rebuilt: false, refreshError: e.message };
  } finally {
    _kpifail_releaseRefreshLock_();
  }
}

/**
 * kpifail_getMasterDataLite(hubName, daysBack) — vỏ bọc MỎNG quanh bản gốc (_kpifail_getMasterDataLiteCore_).
 * [MỚI] Khi sheet nguồn KPI Fail thiếu cột bắt buộc (xem _kpifail_cols_), gắn thêm trường "canhBao" vào
 * kết quả để giao diện báo rõ "số liệu có thể cũ vì cột nguồn đổi". Bản gốc có thể trả chuỗi JSON lấy thẳng
 * từ cache nhiều MB nên KHÔNG parse lại — chỉ nối thêm 1 trường vào cuối chuỗi, và chỉ khi có cảnh báo
 * (lúc bình thường trả nguyên văn, không tốn gì). Cảnh báo không bao giờ bị lưu vào cache.
 */
function kpifail_getMasterDataLite(hubName, daysBack) {
  var res = _kpifail_getMasterDataLiteCore_(hubName, daysBack);
  try {
    if (typeof res === 'string' && res.charAt(res.length - 1) === '}' && res.slice(0, 60).indexOf('"success":true') >= 0) {
      var w = _spx_getColWarn_('kpifail:');
      var extra = '';
      if (w) extra += ',"canhBao":' + JSON.stringify(w);
      // [MỚI] Mốc phiên bản dữ liệu đi kèm: giao diện so với kpifail_getDataVersion() để biết khi nào cần tải lại.
      // Khoá cache gói tổng hợp gắn số phiên bản (được tăng ngay khi dữ liệu đổi) nên mốc này khớp nội dung gói.
      try { extra += ',"dataVersion":' + JSON.stringify(_kpifail_dataVersionString_()); } catch (eV) {}
      if (extra) return res.slice(0, -1) + extra + '}';
    }
  } catch (eW) {}
  return res;
}

function _kpifail_getMasterDataLiteCore_(hubName, daysBack) {
  daysBack = (daysBack === 0) ? 0 : (Number(daysBack) || KPIFAIL_DEFAULT_WINDOW_DAYS);
  hubName  = (hubName && hubName !== 'ALL') ? String(hubName).trim() : '';

  var access = getModuleAccess();
  // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"] Track
  // usage TẠI ĐÂY (điểm tải dữ liệu thật của KPI Fail), không phải lúc mở
  // module — nhất quán với cách Quá Hạn/Pick/FMS đã làm từ trước.
  if (access.role === 'denied') {
    return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
  }

  // [FIX-PERF] Tang TTL tu 360 -> 600s: giam tan suat doc Sheets khi nhieu user
  // mo module trong cung 1 khung gio. Cache per-hub nen TTL dai hon la an toan.
  var CACHE_TTL  = 600;
  // [SỬA LỖI THẬT] Ô bộ đệm Apps Script giới hạn 100KB, mà tiếng Việt tốn 2-3 byte/
  // ký tự -> khúc 90.000 ký tự VƯỢT giới hạn, bộ đệm im lặng không lưu được, mỗi
  // lượt tải lại phải dựng từ đầu (nguyên nhân KPI nặng và treo). 45.000 an toàn.
  var CHUNK_SIZE = 45000;
  var sc = CacheService.getScriptCache();
  var cacheVer = _kpifail_getLiteCacheVersion_();
  // [SỬA — TỐI ƯU QUY MÔ, theo yêu cầu trực tiếp "có thể lên tới 2k user và 1k
  // trạm, phải tính phương án tối ưu nhất mà KHÔNG giảm trải nghiệm"]
  // TRƯỚC ĐÂY khoá cache gắn theo EMAIL từng người (access.email) — nghĩa là
  // 2.000 user = 2.000 bản cache RIÊNG BIỆT của CÙNG một nội dung. Hệ quả ở quy
  // mô lớn: (1) prewarm chỉ hâm nóng đúng bản 'admin', 1.999 người còn lại vẫn
  // phải tự dựng lại từ đầu ở lần mở đầu tiên sau mỗi TTL, (2) mỗi lần dựng lại
  // là 1 lượt JSON.stringify toàn bộ (~327k record theo số thật trên hệ thống),
  // (3) cache GAS có hạn dung lượng — 2.000 bản trùng nội dung sẽ đẩy nhau ra,
  // làm tỉ lệ trúng cache tụt thảm hại đúng lúc đông người dùng nhất.
  // NAY khoá theo PHẠM VI QUYỀN (vai trò + danh sách hub đã chuẩn hoá, sắp xếp)
  // — mọi user có CÙNG quyền dùng CHUNG 1 bản. Kết quả hoàn toàn giống nhau về
  // mặt dữ liệu (cùng quyền thì nội dung trả về vốn đã y hệt), nên KHÔNG hề đổi
  // những gì người dùng nhìn thấy, chỉ giảm số bản trùng lặp từ ~2.000 xuống
  // còn đúng số nhóm quyền khác nhau (thực tế thường vài chục).
  // AN TOÀN: cache lite được xoá bằng cách TĂNG SỐ PHIÊN BẢN nhúng trong khoá
  // (_kpifail_bumpLiteCacheVersion_), không phải bằng cách dựng lại chuỗi khoá
  // cũ — nên đổi cấu trúc khoá không làm hỏng cơ chế xoá cache hiện có.
  var userKey  = _kpifail_scopeKey_(access);
  var hubKey   = hubName ? hubName.replace(/[^a-z0-9]/gi, '_') : 'ALL';
  var CACHE_KEY = 'kpifail_lite_v' + cacheVer + '_' + userKey + '_' + hubKey + '_' + daysBack;
  var useClusterCache = access.role !== 'admin' && access.hubs && access.hubs.length > 1;
  var clusterHubKey = '';
  var CLUSTER_KEY = '';
  if (useClusterCache) {
    var hubSet = {};
    for (var hk = 0; hk < access.hubs.length; hk++) {
      var nHub = _kpifail_normHubBase_(access.hubs[hk]);
      if (nHub) hubSet[nHub] = 1;
    }
    clusterHubKey = Object.keys(hubSet).sort().join('__');
    CLUSTER_KEY = 'kpifail_lite_cluster_v' + cacheVer + '_' + userKey + '_' + clusterHubKey + '_' + daysBack;
  }

  // [PERF 2026-07] Nội dung 2 hàm dưới đây trước đây tự viết lại thuật toán chunk-JSON
  // (giống hệt logic ở aging/rider-plan) — nay chỉ còn là lớp mỏng gọi CacheMgr.getChunked/
  // setChunked (API chunk dùng chung, xem CacheMgr ở đầu file). GIỮ NGUYÊN tên hàm +
  // chữ ký (prefix, jsonStr) → mọi nơi gọi (CACHE_KEY/CLUSTER_KEY/_allKey ở trên và dưới)
  // không cần đổi gì. CacheMgr tự stringify/parse, nên truyền thẳng jsonStr (string) vào
  // vẫn round-trip đúng nguyên văn (tương tự cách aging_getMasterData() đã dùng).
  function _kpifail_readChunkedJson_(prefix) {
    return CacheMgr.getChunked('KPIFAIL', prefix);
  }

  function _kpifail_writeChunkedJson_(prefix, jsonStr) {
    CacheMgr.setChunked('KPIFAIL', prefix, jsonStr, CACHE_TTL);
  }

  function _kpifail_filterRecordsByHub_(records, filterHubName) {
    if (!filterHubName || filterHubName === 'ALL') return records;
    var targetNorm = [_kpifail_normHubBase_(filterHubName), _kpifail_normHubUI_(filterHubName)];
    var filtered = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (_kpifail_matchHub_(rec.hub || '', filterHubName, targetNorm)) filtered.push(rec);
    }
    return filtered;
  }

  try {
    if (CLUSTER_KEY) {
      var clusterFull = _kpifail_readChunkedJson_(CLUSTER_KEY);
      if (clusterFull) {
        var clusterParsed = JSON.parse(clusterFull);
        if (clusterParsed && clusterParsed.success && clusterParsed.records) {
          var clusteredRecords = hubName ? _kpifail_filterRecordsByHub_(clusterParsed.records, hubName) : clusterParsed.records;
          var clusterResult = JSON.stringify({
            success: true,
            records: clusteredRecords,
            hubs: clusterParsed.hubs || [],
            windowDays: daysBack,
            access: { role: access.role, hubs: access.hubs },
            _lite: true,
            _fromClusterCache: true
          });
          _kpifail_writeChunkedJson_(CACHE_KEY, clusterResult);
          return clusterResult;
        }
      }
    }

    var full = _kpifail_readChunkedJson_(CACHE_KEY);
    if (full) return full;
  } catch(ce) {}

  // [FIX-PERF] Fallback: neu dang load 1 hub cu the ma cache ALL con fresh
  // -> filter tu cache ALL thay vi doc Sheets lai. Tiet kiem 2-4 giay GAS exec
  // cho moi lan doi tram. Chi ap dung khi hubName co gia tri (khong phai ALL).
  if (hubName) {
    try {
      var _allKey = 'kpifail_lite_v' + cacheVer + '_' + userKey + '_ALL_' + daysBack;
      var _allFull = _kpifail_readChunkedJson_(_allKey);
      if (_allFull) {
        var _allParsed = JSON.parse(_allFull);
        if (_allParsed && _allParsed.success && _allParsed.records) {
          var _filtered = _kpifail_filterRecordsByHub_(_allParsed.records, hubName);
          var _hubSet = {};
          _filtered.forEach(function(r) { if (r.hub) _hubSet[r.hub] = 1; });
          var _filteredResult = JSON.stringify({
            success: true, records: _filtered,
            hubs: Object.keys(_hubSet).sort(),
            windowDays: daysBack,
            access: { role: access.role, hubs: access.hubs },
            _lite: true, _fromAllCache: true
          });
          _kpifail_writeChunkedJson_(CACHE_KEY, _filteredResult);
          return _filteredResult;
        }
      }
    } catch(_fe) {}
  }

  // [FIX 2026-07-28] "CACHE STAMPEDE": log Executions cho thấy 3 lượt hàm này chạy
  // CHỒNG THẬT SỰ cùng lúc (10:36:15, 10:37:31, 10:38:50 — mỗi lượt 500-900s) — vì
  // khóa thêm ở kpifail_prewarmCache() chỉ chặn CHÍNH NÓ tự chồng lên mình, không hề
  // chặn được đường gọi thẳng từ kpifail_getIndexSummary() (mỗi user mở trang chủ gọi
  // 1 lần) — khi cache hết hạn, N user mở app cùng lúc = N lượt tính lại độc lập, y hệt
  // lỗi ban đầu nhưng ở tầng sâu hơn (hàm dùng chung, không phải chỉ riêng trigger).
  //
  // [FIX 2026-07-28 — bản 2] Log sau khi vá bản 1 vẫn còn chồng lấn (vd 10:37:31 và
  // 10:38:50 chạy chồng gần hết 500-700s) — vì khi lượt đang giữ khóa chạy LÂU HƠN 45s
  // (rất thường xuyên, do _kpifail_getPersistentMasterRecords_() có thể rơi vào nhánh
  // "needFullBuild" build lại toàn bộ từ Sheets, không có khóa riêng, tốn 500-1800s),
  // lượt chờ hết giờ sẽ TỰ TÍNH ĐỘC LẬP — đúng như thiết kế nhưng vẫn gây chồng lấn
  // nặng vì bản tính độc lập đó CŨNG đi vào đúng nhánh nặng đó lần nữa. Sửa lại: khi
  // không giành được khóa kịp, KHÔNG tính độc lập nữa — đọc thẳng bản "persistent
  // snapshot" đã lưu sẵn (_kpifail_readPersistentSnapshot_, chỉ 1-2 lượt đọc Sheet,
  // không kích hoạt build/refresh) để trả dữ liệu gần như ngay lập tức, dù có thể hơi
  // cũ vài phút — còn hơn tính lại toàn bộ và chồng thêm 1 lượt 500-1800s nữa.
  var _kpfColdLockKey = 'kpifail_masterdata_cold_lock_v1';
  var _kpfGotColdLock = _anaAcquireNamedLock(_kpfColdLockKey, 45000, 300000);
  if (_kpfGotColdLock) {
    try {
      // Double-check: trong lúc mình chờ lock, có thể lượt khác đã tính xong và ghi
      // cache rồi — nếu vậy dùng luôn, khỏi tính lại lần nữa.
      try {
        var _kpfRecheck = _kpifail_readChunkedJson_(CACHE_KEY);
        if (_kpfRecheck) return _kpfRecheck;
      } catch (_kpfRe) {}
      return _kpifail_computeMasterDataLiteCold_();
    } finally {
      _anaReleaseNamedLock(_kpfColdLockKey);
    }
  }
  // Không giành được khóa (lượt khác đang tính, chạy lâu hơn 45s) — dùng bản snapshot
  // đã lưu sẵn thay vì tính độc lập lần nữa. Nếu vì lý do gì đó chưa từng có snapshot
  // (rất hiếm — chỉ xảy ra ở lần khởi tạo đầu tiên), mới bắt buộc tính đầy đủ.
  try {
    var _kpfStaleSnap = _kpifail_readPersistentSnapshot_();
    if (_kpfStaleSnap && Array.isArray(_kpfStaleSnap.records)) {
      return _kpifail_buildLiteResultFrom_(_kpfStaleSnap.records, _kpfStaleSnap.maxDate, { _staleFallback: true });
    }
  } catch (_kpfSe) {}
  return _kpifail_computeMasterDataLiteCold_();

  // Tách phần lọc/định dạng kết quả ra hàm dùng chung — vừa cho đường tính đầy đủ
  // (_kpifail_computeMasterDataLiteCold_, có thể build/refresh trước khi gọi) vừa
  // cho đường dự phòng nhanh ở trên (đọc thẳng snapshot, bỏ qua build/refresh).
  function _kpifail_buildLiteResultFrom_(masterRecords, persistMaxDate, extraFlags) {
    var tz = SPX_TZ;
    var cutoffStr = '';
    if (daysBack > 0) {
      var anchorDateStr = persistMaxDate || '';
      if (!anchorDateStr) {
        for (var mi = 0; mi < masterRecords.length; mi++) {
          if (masterRecords[mi] && masterRecords[mi].date > anchorDateStr) anchorDateStr = masterRecords[mi].date;
        }
      }
      if (anchorDateStr) {
        cutoffStr = _kpifail_subtractDays_(anchorDateStr, daysBack);
      } else {
        cutoffStr = _spxVnDateStr_(-daysBack); // [SỬA] ngày theo GIỜ VIỆT NAM
      }
    }
    var targetHubNorm = hubName ? [_kpifail_normHubBase_(hubName), _kpifail_normHubUI_(hubName)] : [];
    var allowedHubNorm = (access.role !== 'admin' && access.hubs && access.hubs.length)
      ? access.hubs.map(_kpifail_normHubBase_)
      : [];

    var clusterRecords = [];
    for (var ri = 0; ri < masterRecords.length; ri++) {
      var rec = masterRecords[ri];
      if (!rec || !rec.date) continue;
      if (cutoffStr && rec.date < cutoffStr) continue;
      if (access.role !== 'admin' && allowedHubNorm.length) {
        var allowed = false;
        for (var ai = 0; ai < allowedHubNorm.length; ai++) {
          if (_kpifail_matchHub_(rec.hub || '', access.hubs[ai], [allowedHubNorm[ai], _kpifail_normHubUI_(access.hubs[ai])])) {
            allowed = true;
            break;
          }
        }
        if (!allowed) continue;
      }
      clusterRecords.push(rec);
    }

    var records = clusterRecords;
    if (hubName && hubName !== 'ALL') {
      records = clusterRecords.filter(function(r) {
        return _kpifail_matchHub_(r.hub || '', hubName, targetHubNorm);
      });
    }

    var hubSet = {};
    records.forEach(function(rec) { if (rec.hub) hubSet[rec.hub] = 1; });
    var hubs = Object.keys(hubSet).sort();
    var baseFields = {
      success: true,
      records: records,
      hubs: hubs,
      windowDays: daysBack,
      access: { role: access.role, hubs: access.hubs },
      _lite: true,
      _persisted: true,
      _persistMaxDate: persistMaxDate || ''
    };
    for (var fk in extraFlags) baseFields[fk] = extraFlags[fk];

    // [SỬA LỖI THẬT — báo cáo: "data KPI load vào là bị đứng/crash"]
    // Module luôn xin phạm vi 'ALL'. Với Admin, 'ALL' là TOÀN HỆ THỐNG (đo thật trên
    // thẻ Tổng quan: 27.745 đơn KPI Fail) -> gói JSON hàng chục MB, trình duyệt phải
    // nhận + phân tích + dựng bảng trong một nhịp -> đứng hình, có máy thì sập tab.
    // Đây KHÔNG phải lỗi dữ liệu mà là lỗi thiết kế tải: không ai xem 27.745 dòng
    // cùng lúc. Nay chặn ở ngưỡng an toàn và nói rõ phải làm gì, kèm SỐ TỔNG để
    // người dùng vẫn nắm được quy mô mà không phải tải hết.
    // [SỬA LỖI THẬT — báo cáo: "1 trạm ở cấp Lead cũng báo Cần thu hẹp phạm vi;
    // trước đây load cả tháng vẫn được, giờ 2 tuần lại không"]
    // Chốt chặn cứng em đặt lượt trước (8MB) là SAI HƯỚNG: nó chặn cả trường hợp
    // trước nay vẫn chạy. Đo dữ liệu thật: toàn hệ thống ~27.800 dòng -> gói rơi
    // đúng quanh ngưỡng đó, nên chặn gần như mọi lượt xem toàn cảnh.
    // Cách đúng là LÀM GÓI NHẸ ĐI, không phải cấm người dùng xem:
    // mỗi bản ghi mang thêm khối 'raw' (các mốc thời gian) chỉ phục vụ BẢNG CHI TIẾT,
    // mà bảng chi tiết lấy dữ liệu từ endpoint riêng (kpifail_getDrilldownPage).
    // Bỏ 'raw' khỏi gói tổng cắt được phần lớn dung lượng mà không mất chức năng nào.
    var _slim = new Array(records.length);
    for (var _si = 0; _si < records.length; _si++) {
      var _r = records[_si];
      _slim[_si] = {
        id: _r.id, date: _r.date, hub: _r.hub, category: _r.category,
        type: _r.type, reason: _r.reason, delayHours: _r.delayHours
      };
    }
    baseFields.records = _slim;
    var result = JSON.stringify(baseFields);

    // Gửi kèm số đo để chẩn đoán khi người dùng báo chậm — xem log [KPI Payload].
    baseFields._payloadInfo = { soDong: records.length, soTram: hubs.length, kyTu: result.length };
    result = JSON.stringify(baseFields);

    // Bản dự phòng nhanh (_staleFallback) không ghi đè lên cache chính thức —
    // tránh khả năng 1 bản hơi cũ đè lên bản mới hơn nếu lượt đang tính (giữ khóa)
    // vừa ghi xong ngay sau đó.
    if (!extraFlags || !extraFlags._staleFallback) {
      _kpifail_writeChunkedJson_(CACHE_KEY, result);
      if (useClusterCache) {
        var clusterHubSet = {};
        clusterRecords.forEach(function(rec) { if (rec.hub) clusterHubSet[rec.hub] = 1; });
        var clusterFields = {
          success: true,
          records: clusterRecords,
          hubs: Object.keys(clusterHubSet).sort(),
          windowDays: daysBack,
          access: { role: access.role, hubs: access.hubs },
          _lite: true,
          _cluster: true,
          _persisted: true,
          _persistMaxDate: persistMaxDate || ''
        };
        _kpifail_writeChunkedJson_(CLUSTER_KEY, JSON.stringify(clusterFields));
      }
    }
    return result;
  }

  function _kpifail_computeMasterDataLiteCold_() {
  try {
    var persisted = _kpifail_getPersistentMasterRecords_();
    var masterRecords = (persisted && persisted.records) ? persisted.records : [];
    return _kpifail_buildLiteResultFrom_(masterRecords, persisted ? (persisted.maxDate || '') : '', {});
  } catch(e) {
    return JSON.stringify({ success:false, error:e.message });
  }
  } // end _kpifail_computeMasterDataLiteCold_
}

function kpifail_getMasterData(daysBack) {
  daysBack = (daysBack === 0) ? 0 : (Number(daysBack) || KPIFAIL_DEFAULT_WINDOW_DAYS);

  // ── LẤY ACCESS ──
  var access = getModuleAccess();
  if (access.role === 'denied') {
    return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
  }

  // ── CACHE KEY per-user ──
  // [PERF 2026-07] Dùng CacheMgr.getChunked/setChunked thay cho thuật toán chunk viết
  // tay riêng (xem CacheMgr ở đầu file). Lưu ý: cache của hàm này hiện KHÔNG còn được
  // đọc lại bởi bất kỳ nơi nào khác trong hệ thống — dashboard đã chuyển hẳn sang
  // kpifail_getMasterDataLite() từ lâu (xem ghi chú ở kpifail_prewarmCache()) — nhưng
  // vẫn gộp cho nhất quán, phòng trường hợp hàm này còn được gọi trực tiếp từ nơi khác.
  var userKey = (access.role === 'admin') ? 'admin' : access.email.replace(/[^a-z0-9]/g, '_');
  var cacheKey = 'master_v3_' + userKey + '_' + daysBack;

  // ── THỬ CACHE ──
  var cachedResult2 = CacheMgr.getChunked('KPIFAIL', cacheKey);
  if (cachedResult2) return cachedResult2;

  // ── ĐỌC SHEETS ──
  try {
    var ss = _DS.ss(KPIFAIL_SS_ID);
    var records = _kpifail_buildRecords(ss).records;

    // [FIX] Cùng bug với kpifail_getMasterDataLite: neo cửa sổ theo NGÀY DỮ
    // LIỆU MỚI NHẤT thay vì ngày hệ thống thật, để tránh dashboard tụt về 0
    // khi độ trễ báo cáo của nguồn tiến gần/ vượt qua daysBack.
    if (daysBack > 0) {
      var anchorDateStr2 = '';
      for (var mi2 = 0; mi2 < records.length; mi2++) {
        if (records[mi2] && records[mi2].date > anchorDateStr2) anchorDateStr2 = records[mi2].date;
      }
      var cutoffStr;
      if (anchorDateStr2) {
        cutoffStr = _kpifail_subtractDays_(anchorDateStr2, daysBack);
      } else {
        cutoffStr = _spxVnDateStr_(-daysBack); // [SỬA] ngày theo GIỜ VIỆT NAM
      }
      records = records.filter(function(r) { return r.date >= cutoffStr; });
    }

    // ── LỌC THEO QUYỀN ──
    if (access.role !== 'admin' && access.hubs.length > 0) {
      // Dùng chung _normStationKey_() — không strip suffix để tránh mismatch
      var allowedNorm = access.hubs.map(function(s) { return _normStationKey_(s, { pakFix: false, stripSuffix: false }); });
      records = records.filter(function(r) {
        var h = _normStationKey_(r.hub || '', { pakFix: false, stripSuffix: false });
        return h && allowedNorm.indexOf(h) >= 0;
      });
    }

    var hubs = Array.from(new Set(records.map(function(r) { return r.hub; }).filter(Boolean))).sort();

    var result = JSON.stringify({
      success: true,
      records: records,
      hubs: hubs,
      windowDays: daysBack,
      access: { role: access.role, hubs: access.hubs }
    });

    // ── LƯU CACHE ──
    CacheMgr.setChunked('KPIFAIL', cacheKey, result, 360);

    return result;
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

function _kpifail_tagOfNote_(note) {
  var n = (note || '').toString();
  if (n.indexOf('[VẬN HÀNH]') === 0 || n.indexOf('[Váº¬N HÃ€NH]') === 0) return 'VAN_HANH';
  if (n.indexOf('[TÀI XẾ]') === 0 || n.indexOf('[TÃ€I Xáº¾]') === 0) return 'TAI_XE';
  if (n.indexOf('[HỆ THỐNG]') === 0 || n.indexOf('[Há»† THá»NG]') === 0) return 'HE_THONG';
  return null;
}

function _kpifail_parseJson_(val, fallback) {
  try {
    if (typeof val === 'string') return JSON.parse(val);
    if (val && typeof val === 'object') return val;
  } catch (e) {}
  return fallback;
}

// Trả riêng 1 trang drilldown đã được lọc sẵn trên server để bảng chi tiết không phải
// cắt/sort toàn bộ mảng records ở client mỗi lần đổi trang hoặc đổi bộ lọc.
// Dùng cùng nguồn dữ liệu cache của kpifail_getMasterDataLite() + kpifail_getNotes(),
// nên vẫn đảm bảo đúng phân quyền và đúng note/status hiện tại.
function kpifail_getDrilldownPage(payloadJson) {
  try {
    var req = _kpifail_parseJson_(payloadJson, {});
    var hubName = (req.hubName && req.hubName !== 'ALL') ? String(req.hubName).trim() : '';
    var daysBack = (req.daysBack === 0) ? 0 : (Number(req.daysBack) || KPIFAIL_DEFAULT_WINDOW_DAYS);
    var filterRange = req.filterRange || 'month';
    var drillCategory = req.drillCategory || 'ALL';
    var drillDateFrom = req.drillDateFrom || '';
    var drillDateTo = req.drillDateTo || '';
    var drillSearch = (req.drillSearch || '').toString().trim().toLowerCase();
    var drillRootCause = req.drillRootCause || 'ALL';
    var drillStatus = req.drillStatus || 'ALL';
    var pageSize = Math.max(1, Math.min(200, Number(req.pageSize) || 25));
    var page = Math.max(1, Number(req.page) || 1);

    var liteRaw = kpifail_getMasterDataLite(hubName, daysBack);
    var lite = _kpifail_parseJson_(liteRaw, null);
    if (!lite || !lite.success) {
      return JSON.stringify({ success: false, error: (lite && lite.error) || 'Không lấy được dữ liệu KPI Fail' });
    }

    var records = lite.records || [];
    var notesRaw = kpifail_getNotes();
    var notesObj = _kpifail_parseJson_(notesRaw, {});
    var notes = (notesObj && notesObj.notes) ? notesObj.notes : {};

    var maxDate = '';
    for (var i = 0; i < records.length; i++) {
      if (records[i] && records[i].date && records[i].date > maxDate) maxDate = records[i].date;
    }

    function fmtDateStr(dt) {
      return (dt instanceof Date && !isNaN(dt.getTime()))
        ? Utilities.formatDate(dt, SPX_TZ, 'yyyy-MM-dd')
        : '';
    }

    function addDaysStr(dateStr, days) {
      if (!dateStr) return '';
      var parts = dateStr.split('-');
      if (parts.length !== 3) return '';
      // [SỬA] Toán LỊCH THUẦN qua UTC — không phụ thuộc múi giờ dự án.
      var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }

    function getRangeBounds() {
      if (!maxDate) return { start: '0000-01-01', end: '9999-12-31', prevStart: null, prevEnd: null };
      if (filterRange === 'all') return { start: '0000-01-01', end: maxDate, prevStart: null, prevEnd: null };
      if (filterRange === '30d') {
        var start30 = addDaysStr(maxDate, -29);
        var prevEnd30 = addDaysStr(start30, -1);
        var prevStart30 = addDaysStr(prevEnd30, -29);
        return { start: start30, end: maxDate, prevStart: prevStart30, prevEnd: prevEnd30 };
      }

      var parts = maxDate.split('-').map(function(v) { return Number(v); });
      var y = parts[0], m = parts[1], d = parts[2];
      if (filterRange === 'lastmonth') { m -= 1; if (m < 1) { m = 12; y -= 1; } }
      var start = y + '-' + String(m).padStart(2, '0') + '-01';
      var lastDayOfMonth = new Date(y, m, 0).getDate();
      var endDay = (filterRange === 'lastmonth') ? lastDayOfMonth : d;
      var end = y + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(endDay, lastDayOfMonth)).padStart(2, '0');
      var py = y, pm = m - 1; if (pm < 1) { pm = 12; py -= 1; }
      var prevStart = py + '-' + String(pm).padStart(2, '0') + '-01';
      var elapsedDays = Math.round((new Date(y, m - 1, Math.min(endDay, lastDayOfMonth)) - new Date(y, m - 1, 1)) / 86400000) + 1;
      var prevLastDay = new Date(py, pm, 0).getDate();
      var prevEndDay = Math.min(elapsedDays, prevLastDay);
      var prevEnd = py + '-' + String(pm).padStart(2, '0') + '-' + String(prevEndDay).padStart(2, '0');
      return { start: start, end: end, prevStart: prevStart, prevEnd: prevEnd };
    }

    var bounds = getRangeBounds();
    var currentRange = records.filter(function(r) {
      return r && r.date && r.date >= bounds.start && r.date <= bounds.end;
    });

    var currentRangeTotal = currentRange.length;
    var currentRangeNoted = 0;
    for (var j = 0; j < currentRange.length; j++) {
      var noteNow = notes[currentRange[j].id];
      if (noteNow && noteNow.note && noteNow.note.toString().trim()) currentRangeNoted++;
    }

    var drillRows = currentRange.slice();
    if (drillCategory !== 'ALL') drillRows = drillRows.filter(function(r) { return r.category === drillCategory; });
    if (drillDateFrom) drillRows = drillRows.filter(function(r) { return r.date >= drillDateFrom; });
    if (drillDateTo) drillRows = drillRows.filter(function(r) { return r.date <= drillDateTo; });
    if (drillSearch) {
      drillRows = drillRows.filter(function(r) {
        var id = (r.id || '').toString().toLowerCase();
        var hub = (r.hub || '').toString().toLowerCase();
        return id.indexOf(drillSearch) !== -1 || hub.indexOf(drillSearch) !== -1;
      });
    }
    if (drillRootCause !== 'ALL') {
      drillRows = drillRows.filter(function(r) {
        var tag = _kpifail_tagOfNote_(notes[r.id] && notes[r.id].note);
        if (drillRootCause === 'UNKNOWN') return !tag;
        return tag === drillRootCause;
      });
    }

    var rowsBeforeStatus = drillRows.slice();
    if (drillStatus === 'PENDING') {
      drillRows = drillRows.filter(function(r) {
        var n = notes[r.id];
        return !(n && n.note && n.note.toString().trim());
      });
    } else if (drillStatus === 'DONE') {
      drillRows = drillRows.filter(function(r) {
        var n = notes[r.id];
        return !!(n && n.note && n.note.toString().trim());
      });
    }

    drillRows.sort(function(a, b) {
      if (a.date === b.date) return (b.id || '').localeCompare(a.id || '');
      return (b.date || '').localeCompare(a.date || '');
    });

    var totalRows = drillRows.length;
    var totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    if (page > totalPages) page = totalPages;
    var startIdx = (page - 1) * pageSize;
    var pageRows = drillRows.slice(startIdx, startIdx + pageSize);

    var rowsBeforeStatusNoted = 0;
    for (var k = 0; k < rowsBeforeStatus.length; k++) {
      var noteBefore = notes[rowsBeforeStatus[k].id];
      if (noteBefore && noteBefore.note && noteBefore.note.toString().trim()) rowsBeforeStatusNoted++;
    }

    return JSON.stringify({
      success: true,
      page: page,
      pageSize: pageSize,
      totalRows: totalRows,
      totalPages: totalPages,
      rows: pageRows,
      rowsBeforeStatusTotal: rowsBeforeStatus.length,
      rowsBeforeStatusNoted: rowsBeforeStatusNoted,
      rowsBeforeStatusPct: rowsBeforeStatus.length > 0 ? Math.round((rowsBeforeStatusNoted / rowsBeforeStatus.length) * 100) : 0,
      currentRangeTotal: currentRangeTotal,
      currentRangeNoted: currentRangeNoted,
      currentRangePct: currentRangeTotal > 0 ? Math.round((currentRangeNoted / currentRangeTotal) * 100) : 0,
      maxDate: maxDate,
      bounds: bounds,
      access: { role: lite.access ? lite.access.role : '', hubs: lite.access ? lite.access.hubs : [] },
      windowDays: daysBack
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// ── kpifail_clearCache() — xóa v1 (global cũ) + v2 của user hiện tại ──────
function kpifail_clearCache() {
  try {
    var sc = CacheService.getScriptCache();

    // [MỚI 2026-10-24] Log Executions: có lúc 5 lượt clearCache trong CÙNG 1 giây (mỗi lượt ~3,5 giây + 1 lượt treo 30 phút).
    // Gộp lượt gọi dồn của CÙNG người dùng trong 5 giây — lượt đầu đã xoá cache, các lượt sau không còn gì để xoá.
    // Chỉ gộp trong 5 giây và theo từng người nên không làm người khác giữ cache cũ.
    try {
      var _clrA = getModuleAccess();
      var _clrKey = 'kpifail_clr_' + String((_clrA && _clrA.email) || 'anon').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
      if (sc.get(_clrKey)) return JSON.stringify({ success: true, debounced: true });
      sc.put(_clrKey, '1', 5);
    } catch (eDb) {}

    // Xóa cache v1 cũ (global, nhiều daysBack variants)
    var candidates = [KPIFAIL_DEFAULT_WINDOW_DAYS, 0, 30, 60, 90, 365];
    candidates.forEach(function(days) {
      var prefix = 'kpifail_master_v1_' + days;
      try {
        var metaStr = sc.get(prefix + '_meta');
        if (metaStr) {
          var meta = JSON.parse(metaStr);
          var keys = [prefix + '_meta'];
          for (var i = 0; i < meta.chunks; i++) keys.push(prefix + '_c' + i);
          sc.removeAll(keys);
        }
      } catch(ie) {}
    });

    // Xóa cache v2 của user đang gọi (định dạng key CŨ, trước khi gộp vào CacheMgr —
    // giữ lại để dọn nốt các entry còn sót từ trước lúc deploy bản gộp, vô hại nếu
    // không tìm thấy gì)
    var access = getModuleAccess();
    var userKey = (access.role === 'admin') ? 'admin' : access.email.replace(/[^a-z0-9]/g, '_');
    candidates.forEach(function(days) {
      var prefix = 'kpifail_master_v3_' + userKey + '_' + days;
      try {
        var metaStr = sc.get(prefix + '_meta');
        if (metaStr) {
          var meta = JSON.parse(metaStr);
          var keys = [prefix + '_meta'];
          for (var i = 0; i < meta.chunks; i++) keys.push(prefix + '_c' + i);
          sc.removeAll(keys);
        }
      } catch(ie) {}
    });
    // [PERF 2026-07] Dọn theo định dạng key MỚI (qua CacheMgr, kể từ khi gộp
    // kpifail_getMasterData() — xem hàm đó) — để đúng và nhất quán, dù cache này
    // hiện không còn ai đọc lại trong thực tế.
    candidates.forEach(function(days) {
      CacheMgr.invalidateChunked('KPIFAIL', 'master_v3_' + userKey + '_' + days);
    });

    // Bump index cache version (invalidate kpifail_getIndexSummary toàn bộ)
    _kpifail_bumpIdxCacheVersion_();
    _kpifail_bumpLiteCacheVersion_();
    _kpifail_invalidateNotesCache_();
    // [FIX 2026-07-28] BỎ _kpifail_resetPersistentSnapshot_() khỏi đây — đây là
    // nguyên nhân chính gây cảm giác "KPI Fail load chậm hẳn đi, trước đây đâu
    // thế". Hàm kpifail_clearCache() này được gọi từ 3 nơi rất hay dùng: nút
    // "làm mới" trong module KPI Fail, nút làm mới Ở TRANG CHỦ
    // (runBackgroundSync forceServer), và hàm "xoá toàn bộ cache" của admin —
    // TẤT CẢ đều chỉ có ý định xoá cache NHẸ (ScriptCache, TTL vài phút) để lấy
    // dữ liệu mới hơn, KHÔNG có ý định xoá luôn persistent snapshot (nguồn tốn
    // 500-1800s+ để build lại từ đầu, đôi khi Timed Out — xem log Executions).
    // Trước bản sửa này, MỖI LẦN ai đó bấm 1 trong 3 nút trên, snapshot bị xoá
    // sạch → lần đọc kế tiếp (của TẤT CẢ mọi user, không chỉ người vừa bấm) rơi
    // vào nhánh needFullBuild → build lại toàn bộ → chậm hẳn, có khi timeout.
    // Bump 2 version cache ở trên đã đủ để user thấy dữ liệu MỚI HƠN (bỏ qua
    // ScriptCache 10 phút, đọc thẳng persistent snapshot — snapshot tự làm mới
    // theo chu kỳ 5 phút của riêng nó, không cần ai "ép" xoá sạch mới có mới).
    // Muốn build lại TOÀN BỘ persistent snapshot thật sự (hiếm khi cần) → dùng
    // riêng kpifail_forceFullRebuild(), không lồng vào hàm clearCache dùng chung.

    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// [MỚI] Công cụ chẩn đoán: soát 3 sheet nguồn (FM/LM/SOP) để biết chính xác
// bao nhiêu dòng có/không có ngày hợp lệ ở cột A, và cột nào đang cứu được
// (fallback) hay vẫn chịu mất (không có ngày nào dùng được). Chạy trực tiếp
// từ Apps Script Editor (chọn hàm này > Run), xem kết quả ở View > Logs.
// Không tự sửa dữ liệu — chỉ đọc và báo cáo.
function kpifail_debugDateIssues() {
  // [SECURITY FIX 2026-08] Hàm debug đọc/tổng hợp dữ liệu thô KPIFail toàn hệ
  // thống để soát lỗi ngày tháng — trước đây không kiểm tra quyền. Chỉ admin mới
  // cần và được dùng công cụ debug này.
  _requireAdmin_(2);
  var ss = _DS.ss(KPIFAIL_SS_ID);
  var tz = SPX_TZ;
  var parseAnyDate = function(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === 'string' && v.trim()) {
      var s = v.trim();
      var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      if (m) { var d1 = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); if (!isNaN(d1.getTime())) return d1; }
      m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (m) { var d2 = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); if (!isNaN(d2.getTime())) return d2; }
      var d3 = new Date(s);
      if (!isNaN(d3.getTime())) return d3;
    }
    if (typeof v === 'number' && v > 0) {
      // [FIX-TZ] Dùng epoch neo theo giờ local của Apps Script (= project
      // Time Zone) thay vì UTC cứng, để khớp với cách toàn bộ code còn lại
      // đang quy đổi ngày theo Asia/Ho_Chi_Minh — tránh lệch ngày gần mốc
      // nửa đêm nếu nhánh fallback số serial này từng bị kích hoạt.
      var epochLocal = new Date(1899, 11, 30);
      var d4 = new Date(epochLocal.getTime() + Math.round(v * 86400000));
      if (!isNaN(d4.getTime())) return d4;
    }
    return null;
  };
  var describe = function(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? 'Date(invalid)' : 'Date(' + Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm') + ')';
    if (v === '' || v === null || v === undefined) return '(trống)';
    return typeof v + '("' + String(v) + '")';
  };

  function inspect(sheetName, key, fallbackKeys, fallbackLabels) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) {
      _LOG.d('[' + sheetName + '] Không có dữ liệu hoặc không tìm thấy sheet.');
      return;
    }
    var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    // [SỬA] Cột ngày + cột dự phòng dò theo TIÊU ĐỀ (xem _kpifail_cols_)
    var _KC = _kpifail_cols_(sheet, key);
    var dateColIdx = _KC.date;
    var fallbackColIdxs = fallbackKeys.map(function(k) { return _KC[k]; });
    var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var okColA = 0, okFallback = 0, lostTotal = 0;
    var sampleColA = [], sampleFallback = [], sampleLost = [];
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var dA = parseAnyDate(r[dateColIdx]);
      if (dA) { okColA++; continue; }
      var found = null;
      for (var f = 0; f < fallbackColIdxs.length; f++) {
        found = parseAnyDate(r[fallbackColIdxs[f]]);
        if (found) break;
      }
      if (found) {
        okFallback++;
        if (sampleFallback.length < 3) sampleFallback.push('row ' + (i + 2) + ': cột A = ' + describe(r[dateColIdx]) + ' -> dùng ' + fallbackLabels[f] + ' = ' + describe(found));
      } else {
        lostTotal++;
        if (sampleLost.length < 3) sampleLost.push('row ' + (i + 2) + ': cột A = ' + describe(r[dateColIdx]) + ', các cột fallback cũng trống/không hợp lệ');
      }
    }
    _LOG.d('===== ' + sheetName + ' (tổng ' + values.length + ' dòng) =====');
    _LOG.d('  Cột A hợp lệ sẵn: ' + okColA);
    _LOG.d('  Cứu được nhờ fallback: ' + okFallback + (sampleFallback.length ? ('\n    ' + sampleFallback.join('\n    ')) : ''));
    _LOG.d('  VẪN MẤT (không có ngày nào dùng được): ' + lostTotal + (sampleLost.length ? ('\n    ' + sampleLost.join('\n    ')) : ''));
  }

  inspect(KPIFAIL_SHEET_FM,  'FM',  ['lhArrivedFinal', 'lhArrived'], ['LH Arrived Time Finalize', 'LH Arrived Time']);
  inspect(KPIFAIL_SHEET_LM,  'LM',  ['arrived', 'attempt'],          ['Arrived Time', 'First Attempt Time']);
  inspect(KPIFAIL_SHEET_SOP, 'SOP', ['pickupEta'],                   ['Pickup ETA']);
}

// [MỚI] Chạy 1 LẦN ngay sau khi deploy bản fix fallback ngày ở trên.
// Lý do cần hàm riêng: snapshot cũ (đã lưu trong ADMIN_DB_ID) được build bằng
// logic CŨ nên các record LM/SOP thiếu cột A đã bị loại vĩnh viễn khỏi
// snapshot — hàm này gộp thêm bước build lại ngay và trả về số liệu trước/sau
// để xác nhận fix có hiệu lực, không cần đợi người dùng mở app mới kích hoạt rebuild.
function kpifail_forceFullRebuild() {
  // [SECURITY FIX 2026-08] Hàm build lại toàn bộ snapshot KPIFail (chi phí Sheets
  // API rất lớn, ~100k+ dòng) — trước đây không kiểm tra quyền, có thể bị spam gọi
  // liên tục qua console gây tốn quota/làm chậm hệ thống cho mọi người (DoS). Chỉ
  // admin mới được chạy thao tác "chạy tay" này.
  _requireAdmin_(2);
  var ss = _DS.ss(KPIFAIL_SS_ID);

  // [FIX] Kiểm tra nguồn ổn định TRƯỚC KHI build — nếu đọc trúng lúc nguồn
  // đang ghi (thực tế có ngày ~200k dòng, 1 lần ghi có thể kéo dài nhiều phút
  // chứ không "hiện ra 1 lần"), bản build ra sẽ thiếu dữ liệu. Dùng
  // maxAttempts=3 (thay vì 2 như đường tự động) vì đây là hàm chạy TAY, không
  // thường xuyên, chấp nhận chờ thêm vài giây để chắc chắn hơn.
  var stable = _kpifail_waitForStableSource_(ss, 3);
  if (!stable) {
    var msg = 'Nguồn (FM/LM/SOP) có vẻ đang được ghi/cập nhật ngay lúc này — KHÔNG build lại để tránh có bản thiếu. Đợi vài phút cho chắc chắn lần ghi hiện tại đã xong (kiểm tra Version History của sheet nguồn nếu cần), rồi chạy lại kpifail_forceFullRebuild() lần nữa. Snapshot hiện có KHÔNG bị thay đổi gì.';
    _LOG.d('[KPIFail forceFullRebuild] BỊ HOÃN: ' + msg);
    return JSON.stringify({ success: false, aborted: true, reason: msg });
  }

  var before = _kpifail_readPersistentSnapshot_();
  var beforeCount = before && before.records ? before.records.length : 0;
  var beforeByCat = { FM: 0, LM: 0, SOP: 0 };
  if (before && before.records) {
    before.records.forEach(function(r) { if (beforeByCat[r.category] !== undefined) beforeByCat[r.category]++; });
  }

  // [FIX 2026-07-28] KHÔNG còn gọi kpifail_clearCache() TRƯỚC khi build nữa —
  // trước đây hàm đó xoá sạch persistent snapshot ngay tại đây, nên nếu bước
  // build bên dưới timeout (đã thấy xảy ra thật, log 02:23:55 Timed Out 30
  // phút), snapshot bị mất trắng, không còn gì để phục hồi. Giờ chỉ build +
  // ghi (_kpifail_writePersistentSnapshot_ đã tự an toàn kiểu ping-pong: ghi
  // vào slot KHÔNG active, chỉ đổi con trỏ sau khi ghi xong hẳn) — nếu build
  // timeout, snapshot CŨ vẫn còn nguyên, không bị mất gì. Gọi kpifail_clearCache()
  // ở CUỐI (sau khi build+ghi xong) chỉ để bump cache version, cho user thấy
  // bản mới ngay thay vì đợi ScriptCache 10 phút tự hết hạn.

  var buildResultForce = _kpifail_buildRecords(ss);
  var freshRecords = buildResultForce.records;
  var maxDate = '';
  for (var i = 0; i < freshRecords.length; i++) if (freshRecords[i].date > maxDate) maxDate = freshRecords[i].date;
  // [FIX 2026-07-29] Lưu rowCounts THỰC TẾ đọc tới (có thể chỉ 1 phần nếu hết
  // ngân sách thời gian giữa chừng — buildResultForce.complete === false) — nếu
  // vậy, các chu kỳ refresh 5 phút TIẾP THEO sẽ tự đọc bù phần còn lại, không
  // cần chạy lại forceFullRebuild thủ công.
  _kpifail_writePersistentSnapshot_(freshRecords, maxDate, buildResultForce.rowCounts, buildResultForce.fingerprints);
  // Ghi xong hẳn rồi mới bump version cache — user thấy bản mới ngay, không
  // đụng gì tới snapshot vừa ghi (kpifail_clearCache() giờ chỉ bump cache, xem fix ở đó).
  try { kpifail_clearCache(); } catch (eCc) {}

  var afterByCat = { FM: 0, LM: 0, SOP: 0 };
  freshRecords.forEach(function(r) { if (afterByCat[r.category] !== undefined) afterByCat[r.category]++; });

  var summary = {
    success: true,
    before: { total: beforeCount, byCategory: beforeByCat },
    after: { total: freshRecords.length, byCategory: afterByCat },
    maxDate: maxDate,
    complete: buildResultForce.complete
  };
  _LOG.d('[KPIFail forceFullRebuild] ' + JSON.stringify(summary));
  return JSON.stringify(summary);
}


// ──────────────── KPI FAIL — NOTE & ĐỒNG BỘ SHEET LƯU TRỮ ────────────────
// Mục đích: 3 sheet nguồn (FM/LM/SOP) là dữ liệu thô, không có chỗ để note.
// Ta lưu Note/User Note vào 1 sheet riêng trong ADMIN_DB_ID (cùng spreadsheet
// đang chứa App_Notes của module Aging). Mỗi lần "Đồng bộ Sheet" sẽ ghi đè
// toàn bộ dữ liệu hiện có (đã chuẩn hóa từ _kpifail_buildRecords) vào sheet
// này, giữ lại Note/User Note cũ theo Shipment ID — Shipment ID nào không còn
// trong dữ liệu nguồn sẽ tự động biến mất khỏi sheet lưu trữ (không cần xóa tay).
var KPIFAIL_NOTES_SHEET = 'KPIFail_Notes';
var KPIFAIL_NOTES_COLS  = 11; // ID, Ngày, Hub, Loại, Type, Lý Do, Trễ(h), Ghi Chú, User Note, Thời Gian Note, _LastEditTS(ẩn)
var KPIFAIL_NOTES_COL_LASTEDIT_TS = 11; // cột Date object đầy đủ — chỉ dùng để tính tuổi chính xác, không hiển thị

// [TỐI ƯU] Xóa nhiều dòng cùng lúc theo range liên tiếp thay vì gọi sheet.deleteRow()
// từng dòng một trong vòng lặp — mỗi lần deleteRow() làm dịch chuyển toàn bộ phần còn
// lại của sheet, nên xóa N dòng rời rạc kiểu cũ tốn O(N) lần dịch chuyển. Hàm này gom
// các số dòng liên tiếp (vd 50,51,52 → 1 range) thành ít lệnh deleteRows() hơn, xóa từ
// range có start lớn nhất xuống dưới để không làm lệch chỉ số các range chưa xử lý.
// rows: mảng số dòng (1-indexed), không cần sắp xếp sẵn.
function _kpifail_batchDeleteRows_(sheet, rows) {
  if (!rows || rows.length === 0) return 0;
  var sorted = rows.slice().sort(function(a, b) { return a - b; });
  var ranges = [];
  var start = sorted[0], prev = sorted[0];
  for (var i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      ranges.push([start, prev]);
      start = sorted[i]; prev = sorted[i];
    }
  }
  ranges.push([start, prev]);
  // Xóa từ range có dòng bắt đầu lớn nhất xuống nhỏ nhất — range nhỏ hơn (ở trên)
  // không bị lệch chỉ số vì các range lớn hơn (ở dưới) đã bị xóa trước.
  ranges.sort(function(a, b) { return b[0] - a[0]; });
  ranges.forEach(function(r) { sheet.deleteRows(r[0], r[1] - r[0] + 1); });
  return sorted.length;
}

// [FIX] Fallback ngày khi không tìm thấy record gốc (_kpifail_findRecordById_ trả về
// null) — trước đây ghi '' vào cột Ngày, khiến dòng đó KHÔNG BAO GIỜ bị 2 lớp dọn dẹp
// (_kpifail_pruneOldNotes_ và orphan-cleanup) động tới vì cả 2 đều yêu cầu có Ngày mới
// xét xóa. Hệ quả là note "mồ côi ngày" tồn tại vĩnh viễn, đi ngược chính sách lưu trữ
// 180 ngày. Dùng ngày hôm nay làm fallback để dòng vẫn có "tuổi" tính được — không
// chính xác bằng ngày đơn fail thật, nhưng đảm bảo dòng vẫn nằm trong vòng đời dọn dẹp.
// [AN TOÀN] Kiểm tra chuỗi đúng định dạng yyyy-MM-dd trước khi so sánh lexicographic
// với cutoff. So sánh chuỗi kiểu "d < cutoffStr" chỉ đúng khi cả 2 cùng định dạng
// yyyy-MM-dd — nếu vì lý do nào đó cột Ngày bị ghi sai định dạng (vd dd/MM/yyyy do
// thao tác tay hoặc import lỗi), so sánh sẽ sai lệch ÂM THẦM (không báo lỗi) và có
// thể xóa nhầm note còn mới hoặc giữ lại note đã quá hạn. Dòng không đúng định dạng
// sẽ bị BỎ QUA khỏi việc dọn dẹp (an toàn hơn xóa nhầm), không làm crash cleanup.
function _kpifail_isValidIsoDate_(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function _kpifail_todayDateStr_() {
  var tz = SPX_TZ;
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

function _kpifail_getNotesSheet_() {
  var ss = _DS.ss(ADMIN_DB_ID);
  var sheet = ss.getSheetByName(KPIFAIL_NOTES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(KPIFAIL_NOTES_SHEET);
    sheet.appendRow(['Shipment ID','Ngày','Hub','Loại','Type','Lý Do','Trễ (giờ)','Ghi Chú','User Note','Thời Gian Note','_LastEditTS']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,KPIFAIL_NOTES_COLS).setFontWeight('bold');
    sheet.hideColumns(KPIFAIL_NOTES_COL_LASTEDIT_TS);
  } else if (sheet.getLastColumn() < KPIFAIL_NOTES_COL_LASTEDIT_TS) {
    // [MIGRATION TỰ ĐỘNG] Sheet đã tồn tại từ trước khi có cột _LastEditTS — tự thêm
    // header cột 11 + ẩn đi, không cần chạy hàm migrate riêng. Các dòng note cũ sẽ có
    // cột này rỗng cho tới khi được sửa lần kế tiếp (xem ghi chú ở kpifail_saveNote).
    sheet.getRange(1, KPIFAIL_NOTES_COL_LASTEDIT_TS).setValue('_LastEditTS').setFontWeight('bold');
    sheet.hideColumns(KPIFAIL_NOTES_COL_LASTEDIT_TS);
  }
  return sheet;
}

// ── [NÂNG CẤP] AUDIT TRAIL — lịch sử thay đổi note (ai sửa gì lúc nào) ──
// kpifail_saveNote/kpifail_saveNotesBulk GHI ĐÈ note cũ, không giữ lại nội dung
// trước đó. Sheet này lưu append-only mọi lần thay đổi (kể cả sửa nhiều lần cho
// cùng 1 đơn) để tra cứu khi cần biết "ai đổi note gì, lúc nào, nội dung cũ là gì".
var KPIFAIL_HISTORY_SHEET = 'KPIFail_Notes_History';

function _kpifail_getHistorySheet_() {
  var ss = _DS.ss(ADMIN_DB_ID);
  var sheet = ss.getSheetByName(KPIFAIL_HISTORY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(KPIFAIL_HISTORY_SHEET);
    // Cột 6 (_TS) lưu Date object đầy đủ — CHỈ để tính tuổi khi prune, không hiển thị
    // trên UI (kpifail_getNoteHistory không trả field này). Cột "Thời Gian" (dd/MM HH:mm)
    // không có năm nên không đủ để tính tuổi chính xác qua nhiều năm vận hành.
    sheet.appendRow(['Shipment ID','Note Cũ','Note Mới','User','Thời Gian','_TS']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,6).setFontWeight('bold');
    sheet.hideColumns(6);
  }
  return sheet;
}

// Ghi 1 dòng lịch sử — gọi sau khi save note thành công. Không throw lỗi ra ngoài
// (audit trail là phụ, không được phép làm hỏng luồng save note chính).
function _kpifail_logNoteHistory_(shipmentId, oldNote, newNote, user, timestamp) {
  if (oldNote === newNote) return; // không đổi gì thì khỏi log
  try {
    var sheet = _kpifail_getHistorySheet_();
    sheet.appendRow([shipmentId, oldNote || '', newNote || '', user, timestamp, new Date()]);
  } catch (e) { /* không để lỗi log chặn luồng save chính */ }
}

// Lấy lịch sử thay đổi của 1 Shipment ID — dùng cho UI hiển thị "Xem lịch sử sửa".
// Lấy lịch sử thay đổi của 1 Shipment ID — dùng TextFinder.findAll() (tìm phía server
// của Sheets) thay vì đọc toàn bộ sheet về rồi lọc bằng JS. Sheet này là append-only
// (mỗi lần sửa note đều thêm dòng mới), nên theo thời gian sẽ có rất nhiều dòng —
// đọc toàn bộ mỗi lần xem lịch sử 1 đơn là lặp lại đúng lỗi đã sửa ở kpifail_saveNote
// trước đây (quét tuyến tính thay vì tìm trực tiếp).
function kpifail_getNoteHistory(shipmentId) {
  // [SECURITY FIX 2026-08] Trước đây không kiểm tra quyền. Sheet lịch sử note không
  // có cột hub nên chưa lọc chi tiết theo hub được ở đây — chặn tối thiểu ở mức đã
  // được duyệt dùng hệ thống (đồng bộ với aging_syncNotes/getNotesOnly).
  try { _requireApproved_(); } catch (eAuth) { return JSON.stringify({ success: false, error: eAuth.message }); }
  var cleanId = (shipmentId || '').toString().trim();
  if (!cleanId) return JSON.stringify({ success: false, error: 'Thiếu Shipment ID' });
  try {
    var sheet = _kpifail_getHistorySheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, history: [] });

    var idRange = sheet.getRange(2, 1, lastRow - 1, 1);
    var matches = idRange.createTextFinder(cleanId).matchEntireCell(true).findAll();
    var history = matches.map(function(cell) {
      var rowVals = sheet.getRange(cell.getRow(), 2, 1, 4).getDisplayValues()[0];
      return { oldNote: rowVals[0], newNote: rowVals[1], user: rowVals[2], time: rowVals[3] };
    });
    history.reverse(); // mới nhất lên đầu (findAll trả theo thứ tự dòng tăng dần)
    return JSON.stringify({ success: true, history: history });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// Trả về dict { shipmentId: {note, user, time} } — dùng để merge vào bảng Chi Tiết Đơn Fail ở client,
// không cần đọc lại toàn bộ record gốc nên nhẹ và nhanh.
// Cache ngắn hạn 25s: vì sheet KPIFail_Notes chứa TOÀN BỘ record (do syncFullData
// ghi đè cả nguồn vào đây, không chỉ dòng có note), nên ở quy mô 100k dòng việc đọc
// 10 cột mỗi lần FE poll (30s/lần/user) là chi phí I/O đáng kể nếu có nhiều user
// đang mở dashboard cùng lúc. Cache được xoá ngay khi saveNote thành công nên dữ
// liệu vẫn coi như gần-thời-gian-thực (chỉ "trễ" tối đa với chính người vừa lưu,
// và họ đã có optimistic update ở client nên không ảnh hưởng trải nghiệm).
var KPIFAIL_NOTES_CACHE_KEY = 'kpifail_notes_v1';
var KPIFAIL_NOTES_CACHE_TTL = 25;

function kpifail_getNotes() {
  // [SECURITY FIX 2026-08] Xem chú thích ở kpifail_getNoteHistory() — cùng lớp lỗi.
  try { _requireApproved_(); } catch (eAuth) { return JSON.stringify({ success: false, error: eAuth.message }); }
  var sc = CacheService.getScriptCache();
  try {
    var cached = sc.get(KPIFAIL_NOTES_CACHE_KEY);
    if (cached) return cached;
  } catch (ce) {}

  try {
    var sheet = _kpifail_getNotesSheet_();
    var lastRow = sheet.getLastRow();
    var result;
    if (lastRow < 2) {
      result = JSON.stringify({ success: true, notes: {} });
    } else {
      // Chỉ cần đọc 4 cột (ID, Note, User, Time) thay vì cả 10 cột — giảm ~60% dữ liệu kéo về.
      var idCol   = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
      var noteCol = sheet.getRange(2, 8, lastRow - 1, 3).getDisplayValues();
      var notes = {};
      for (var i = 0; i < idCol.length; i++) {
        var id = (idCol[i][0] || '').toString().trim();
        // Bỏ qua dòng không có note để dict trả về client luôn nhỏ gọn,
        // dù sheet nguồn có 100k dòng record nhưng số dòng có note thực tế luôn ít hơn nhiều.
        var noteText = noteCol[i][0] || '';
        if (!id || !noteText) continue;
        notes[id] = { note: noteText, user: noteCol[i][1] || '', time: noteCol[i][2] || '' };
      }
      result = JSON.stringify({ success: true, notes: notes });
    }
    try { sc.put(KPIFAIL_NOTES_CACHE_KEY, result, KPIFAIL_NOTES_CACHE_TTL); } catch (ce2) {}
    return result;
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

function _kpifail_invalidateNotesCache_() {
  try { CacheService.getScriptCache().remove(KPIFAIL_NOTES_CACHE_KEY); } catch (e) {}
}

// Tìm dòng theo Shipment ID bằng TextFinder (tìm phía server của Sheets),
// thay vì kéo cả cột ID về runtime rồi quét tuyến tính trong JS — quan trọng
// khi sheet lưu trữ có hàng chục/trăm nghìn dòng (vì syncFullData ghi cả
// toàn bộ dữ liệu nguồn vào đây, không chỉ các dòng có note).
function _kpifail_findNoteRow_(sheet, cleanId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var range = sheet.getRange(2, 1, lastRow - 1, 1);
  var found = range.createTextFinder(cleanId).matchEntireCell(true).findNext();
  return found ? found.getRow() : -1;
}

// Tìm 1 record gốc theo ID — ưu tiên đọc từ cache của kpifail_getMasterData()
// (vài chunk, rẻ) thay vì rebuild lại toàn bộ 3 sheet nguồn (đắt, O(100k)).
// Chỉ rebuild full khi cache miss thật sự (trường hợp hiếm: chưa ai mở dashboard
// trong vòng 90s gần nhất).
function _kpifail_findRecordById_(cleanId) {
  try {
    var fastRaw = kpifail_getMasterDataLite('ALL', KPIFAIL_DEFAULT_WINDOW_DAYS);
    var fastData = JSON.parse(fastRaw);
    if (fastData && fastData.success && fastData.records) {
      for (var f = 0; f < fastData.records.length; f++) {
        if (fastData.records[f].id === cleanId) return fastData.records[f];
      }
    }
  } catch (e) {}

  // Fallback hiếm gặp: cache miss → rebuild trực tiếp từ 3 sheet nguồn.
  try {
    var ssSrc = _DS.ss(KPIFAIL_SS_ID);
    var all = _kpifail_buildRecords(ssSrc).records;
    for (var k = 0; k < all.length; k++) { if (all[k].id === cleanId) return all[k]; }
  } catch (eSrc) {}
  return null;
}

// ── [FIX NGHẼN LOCK] NAMED LOCK RIÊNG CHO GHI KPIFail_Notes ──
// TRƯỚC ĐÂY: kpifail_saveNote / kpifail_saveNotesBulk / kpifail_autoCleanupNotes đều
// dùng chung LockService.getScriptLock() — đây là khóa TOÀN CỤC của CẢ script, cũng
// đang được Analytics saveSnapshot()/savePickup() (chờ tới 45s) và trendNightlyPurge()
// (chờ tới 60s) sử dụng. Hệ quả: chỉ cần 1 trạm bất kỳ đang lưu snapshot Analytics
// hoặc job dọn note tự động (autoCleanup, chạy 6h/lần) đang giữ khóa, thì lệnh lưu
// note (chỉ chờ 10s) rất dễ bị waitLock() ném timeout → trả success:false → user thấy
// "bấm lưu note mãi không được", dù thực ra chẳng liên quan gì tới chính module note.
//
// FIX: dùng "named lock" riêng cho KPIFail_Notes qua PropertiesService (cùng kỹ thuật
// đã áp dụng ở _anaAcquireNamedLock cho Analytics) — chỉ chặn LẪN NHAU giữa các thao
// tác ghi KPIFail_Notes (saveNote/saveNotesBulk/autoCleanup) với nhau, HOÀN TOÀN tách
// biệt khỏi Analytics/Trend/mọi module khác trong hệ thống. Bước check-and-set vẫn
// bọc trong ScriptLock NGẮN (2s) để tránh race 2 request cùng đọc "trống" đồng thời.
var KPIFAIL_NOTES_LOCK_KEY = 'kpifail_notes_write_lock_v1';

function _kpifail_acquireNoteLock_(maxWaitMs, staleMs) {
  maxWaitMs = maxWaitMs || 15000;
  staleMs   = staleMs   || 30000;
  var props = PropertiesService.getScriptProperties();
  var waitStart = Date.now();
  while (Date.now() - waitStart < maxWaitMs) {
    var acquireLock = LockService.getScriptLock();
    var gotIt = false;
    try {
      acquireLock.waitLock(2000);
      var existing = props.getProperty(KPIFAIL_NOTES_LOCK_KEY);
      if (!existing || (Date.now() - parseInt(existing, 10)) > staleMs) {
        // Lock trống, hoặc lock cũ đã quá staleMs (process trước đó crash/timeout mà
        // không kịp release) → chiếm lock.
        props.setProperty(KPIFAIL_NOTES_LOCK_KEY, String(Date.now()));
        gotIt = true;
      }
    } catch (eAcquire) {
      // ScriptLock ngắn (2s) bị timeout — hiếm, coi như chưa lấy được, thử lại vòng sau.
    } finally {
      try { acquireLock.releaseLock(); } catch (e2) {}
    }
    if (gotIt) return true;
    Utilities.sleep(200);
  }
  return false;
}

function _kpifail_releaseNoteLock_() {
  try { PropertiesService.getScriptProperties().deleteProperty(KPIFAIL_NOTES_LOCK_KEY); } catch (e) {}
}

// ── LƯU NOTE HÀNG LOẠT (Bulk Action) — 1 LẦN LOCK DUY NHẤT CHO CẢ BATCH ──
// kpifail_saveNote (ở trên) thiết kế cho 1 note/lần gọi — đúng cho thao tác note đơn
// lẻ hằng ngày, nhưng nếu gọi N lần riêng biệt cho Bulk Action (gán Root Cause hàng
// loạt, có thể 50-200+ đơn) thì tốn N lần network round-trip + N lần waitLock/
// releaseLock, dễ nghẽn khi nhiều user thao tác cùng lúc. Hàm này nhận 1 mảng ID +
// 1 nội dung note chung, xử lý TOÀN BỘ trong đúng 1 lần lock — nhanh hơn nhiều và
// giảm hẳn áp lực lên LockService so với gọi lặp lại kpifail_saveNote.
// [FIX BẢO MẬT NGHIÊM TRỌNG — phát hiện qua rà soát IDOR chủ động, CÙNG LỖI đã
// tìm và vá ở aging_saveNote()] kpifail_saveNote()/kpifail_saveNotesBulk() TRƯỚC
// ĐÂY hoàn toàn KHÔNG kiểm tra quyền — Session.getActiveUser() chỉ dùng để hiển
// thị tên người ghi, không kiểm tra gì cả. Viết 1 hàm dùng CHUNG cho cả 2 (đúng
// nguyên tắc "1 logic — 1 nơi chịu trách nhiệm") thay vì lặp lại logic 2 lần.
// LƯU Ý: KHÔNG thêm giới hạn "chỉ Lead/Staff" như đã làm ở Quá Hạn — quy tắc đó
// chỉ được xác nhận cho riêng Quá Hạn, chưa xác nhận áp dụng cho KPI Fail. Vá
// này CHỈ đóng đúng lỗ hổng đã xác nhận chắc chắn: hub phải thuộc quyền người
// gọi (nhất quán với mọi hàm khác đã vá), không tự ý mở rộng thêm giới hạn cấp
// bậc chưa được yêu cầu.
function _kpifail_checkNotePermission_(hub) {
  try {
    var access = getModuleAccess();
    if (access.role === 'denied') {
      return { allowed: false, error: 'Bạn không có quyền ghi chú KPI Fail.' };
    }
    if (access.role === 'admin') return { allowed: true };
    if (!hub) {
      Logger.log('[kpifail note CẢNH BÁO] Không xác định được hub — cho phép ghi (không chặn), user=' + access.email);
      return { allowed: true };
    }
    var hasHub = (access.hubs || []).some(function (h) {
      return (typeof cleanHubString === 'function' ? cleanHubString(h) === cleanHubString(hub) : h.trim().toLowerCase() === hub.trim().toLowerCase());
    });
    if (!hasHub) return { allowed: false, error: 'Không có quyền ghi chú cho trạm: ' + hub };
    return { allowed: true };
  } catch (e) {
    return { allowed: false, error: 'Lỗi kiểm tra quyền: ' + e.message };
  }
}

function kpifail_saveNotesBulk(idsJson, noteText) {
  var ids;
  try { ids = JSON.parse(idsJson); } catch (e) { ids = []; }
  if (!Array.isArray(ids) || ids.length === 0) {
    return JSON.stringify({ success: false, error: 'Danh sách ID rỗng' });
  }

  var userEmail = Session.getActiveUser().getEmail() || '';
  var shortUser = userEmail ? userEmail.split('@')[0].toUpperCase() : 'ADMIN';
  var timestamp = Utilities.formatDate(new Date(), 'GMT+7', 'dd/MM HH:mm');
  var nowTs = new Date(); // [BẢO VỆ] Date object đầy đủ — ghi vào cột 11 để tính tuổi
                          // chính xác, bảo vệ note vừa sửa khỏi bị auto-cleanup xóa sớm.

  var gotLock = _kpifail_acquireNoteLock_(20000, 30000);
  if (!gotLock) {
    return JSON.stringify({
      success: false, lockBusy: true,
      error: 'Hệ thống đang bận ghi note khác (đơn khác/user khác), vui lòng thử lại sau vài giây.'
    });
  }
  try {
    var sheet = _kpifail_getNotesSheet_();
    var ok = 0, failed = [], blocked = [];

    for (var i = 0; i < ids.length; i++) {
      var cleanId = (ids[i] || '').toString().trim();
      if (!cleanId) continue;
      try {
        var rowIdx = _kpifail_findNoteRow_(sheet, cleanId);
        var oldNoteText = '';
        if (rowIdx > -1) {
          // Đã có dòng sẵn trong sheet — đọc thẳng hub từ cột 3 (index 2), không
          // cần tra lại _kpifail_findRecordById_() (tốn kém hơn).
          var _hubFromSheet = sheet.getRange(rowIdx, 3, 1, 1).getDisplayValues()[0][0] || '';
          var _permCheck = _kpifail_checkNotePermission_(_hubFromSheet);
          if (!_permCheck.allowed) { blocked.push(cleanId); continue; }
          oldNoteText = sheet.getRange(rowIdx, 8, 1, 1).getDisplayValues()[0][0] || '';
          sheet.getRange(rowIdx, 8, 1, 3).setValues([[noteText, shortUser, timestamp]]);
          sheet.getRange(rowIdx, KPIFAIL_NOTES_COL_LASTEDIT_TS).setValue(nowTs);
        } else {
          var rec = _kpifail_findRecordById_(cleanId);
          var _permCheck2 = _kpifail_checkNotePermission_(rec ? rec.hub : '');
          if (!_permCheck2.allowed) { blocked.push(cleanId); continue; }
          sheet.appendRow([
            cleanId,
            rec ? rec.date : _kpifail_todayDateStr_(),
            rec ? rec.hub : '',
            rec ? rec.category : '',
            rec ? rec.type : '',
            rec ? rec.reason : '',
            (rec && rec.delayHours != null) ? rec.delayHours : '',
            noteText, shortUser, timestamp, nowTs
          ]);
        }
        _kpifail_logNoteHistory_(cleanId, oldNoteText, noteText, shortUser, timestamp);
        ok++;
      } catch (eRow) {
        failed.push(cleanId);
      }
    }

    _kpifail_invalidateNotesCache_();
    _kpifail_bumpIdxCacheVersion_();       // xóa cache getIndexSummary → card index refresh đúng
    return JSON.stringify({
      success: true, total: ids.length, ok: ok, failed: failed, blocked: blocked,
      user: shortUser, time: timestamp
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  } finally {
    _kpifail_releaseNoteLock_();
  }
}

// Lưu/sửa Note cho 1 Shipment ID. Nếu Shipment ID chưa có dòng trong sheet lưu trữ
// (chưa "Đồng bộ Sheet" lần nào) thì tự tìm dữ liệu gốc để điền đủ cột trước khi
// thêm dòng mới, tránh dòng note bị thiếu Ngày/Hub/Loại.
// Lưu ý hiệu năng: bước tìm kiếm (TextFinder / cache lookup) được thực hiện TRƯỚC
// khi lock, chỉ lock đúng bước ghi giá trị → giảm thời gian giữ lock, giảm nghẽn
// khi nhiều user note cùng lúc.
//
// [NÂNG CẤP] CHỐNG GHI ĐÈ KHI 2 NGƯỜI CÙNG SỬA: tham số `expectedOldNote` (optional)
// là nội dung note mà client ĐANG THẤY lúc mở modal sửa. Nếu nội dung thật trong
// sheet đã khác (ai đó vừa sửa trong lúc mình đang gõ) → trả về conflict, KHÔNG ghi
// đè, để frontend cảnh báo user trước khi quyết định ghi đè hay không.
function kpifail_saveNote(shipmentId, noteText, expectedOldNote) {
  var cleanId = (shipmentId || '').toString().trim();
  if (!cleanId) return JSON.stringify({ success: false, error: 'Thiếu Shipment ID' });

  var sheet = _kpifail_getNotesSheet_();
  var rowIdx = _kpifail_findNoteRow_(sheet, cleanId);
  var rec = (rowIdx === -1) ? _kpifail_findRecordById_(cleanId) : null;

  // [FIX BẢO MẬT — xem giải thích đầy đủ tại _kpifail_checkNotePermission_() và
  // kpifail_saveNotesBulk() phía trên] Xác định hub TRƯỚC khi ghi — đọc thẳng từ
  // sheet nếu dòng đã tồn tại (rẻ hơn), tra lại record nếu là dòng mới.
  var _hubForPermCheck = (rowIdx > -1)
    ? (sheet.getRange(rowIdx, 3, 1, 1).getDisplayValues()[0][0] || '')
    : (rec ? rec.hub : '');
  var _permCheck = _kpifail_checkNotePermission_(_hubForPermCheck);
  if (!_permCheck.allowed) {
    return JSON.stringify({ success: false, error: _permCheck.error });
  }

  var userEmail = Session.getActiveUser().getEmail() || '';
  var shortUser = userEmail ? userEmail.split('@')[0].toUpperCase() : 'ADMIN';
  var timestamp = Utilities.formatDate(new Date(), 'GMT+7', 'dd/MM HH:mm');
  var nowTs = new Date(); // [BẢO VỆ] Date object đầy đủ — ghi vào cột 11 để bảo vệ note
                          // vừa sửa khỏi bị auto-cleanup xóa sớm (xem kpifail_autoCleanupNotes).

  // [FIX NGHẼN LOCK] Named lock riêng cho KPIFail_Notes thay vì LockService.getScriptLock()
  // toàn cục — trước đây bị Analytics saveSnapshot/savePickup (giữ tới 45s) và
  // trendNightlyPurge (giữ tới 60s) chiếm mất, khiến lưu note (chỉ chờ 10s) rất dễ
  // timeout dù chẳng liên quan gì tới các module đó. Xem chi tiết ở _kpifail_acquireNoteLock_.
  var gotLock = _kpifail_acquireNoteLock_(15000, 30000);
  if (!gotLock) {
    return JSON.stringify({
      success: false, lockBusy: true,
      error: 'Hệ thống đang bận ghi note khác, vui lòng thử lại sau vài giây.'
    });
  }

  var oldNoteText = '';
  var shouldPushAlert = false;
  try {
    // Re-check trong lock: phòng trường hợp 2 request cùng tạo dòng mới cho
    // cùng 1 ID trong lúc tìm kiếm (trước khi vào lock) diễn ra song song.
    if (rowIdx === -1) {
      rowIdx = _kpifail_findNoteRow_(sheet, cleanId);
    }

    var oldUser = '', oldTime = '';
    if (rowIdx > -1) {
      var oldVals = sheet.getRange(rowIdx, 8, 1, 3).getDisplayValues()[0];
      oldNoteText = oldVals[0] || ''; oldUser = oldVals[1] || ''; oldTime = oldVals[2] || '';
    }

    // Chỉ kiểm tra conflict khi client CÓ gửi expectedOldNote (tương thích ngược —
    // nếu không truyền, hành vi y hệt bản cũ, không chặn gì cả).
    if (expectedOldNote !== undefined && expectedOldNote !== null && oldNoteText !== expectedOldNote) {
      return JSON.stringify({
        success: false, conflict: true,
        error: 'Note đã bị thay đổi bởi người khác trong lúc bạn đang sửa.',
        currentNote: oldNoteText, currentUser: oldUser, currentTime: oldTime
      });
    }

    if (rowIdx > -1) {
      sheet.getRange(rowIdx, 8, 1, 3).setValues([[noteText, shortUser, timestamp]]);
      sheet.getRange(rowIdx, KPIFAIL_NOTES_COL_LASTEDIT_TS).setValue(nowTs);
    } else {
      sheet.appendRow([
        cleanId,
        rec ? rec.date : _kpifail_todayDateStr_(),
        rec ? rec.hub : '',
        rec ? rec.category : '',
        rec ? rec.type : '',
        rec ? rec.reason : '',
        (rec && rec.delayHours != null) ? rec.delayHours : '',
        noteText, shortUser, timestamp, nowTs
      ]);
    }

    _kpifail_logNoteHistory_(cleanId, oldNoteText, noteText, shortUser, timestamp);
    _kpifail_invalidateNotesCache_();
    shouldPushAlert = true;
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  } finally {
    _kpifail_releaseNoteLock_();
  }

  // ── ALERT HOOK: đẩy RA NGOÀI lock ghi note ──
  // Chỉ push khi vừa ghi note thành công — đây là dấu hiệu "đơn cần xử lý được ghi
  // nhận". Severity 3 (khẩn) nếu đơn đã quá 24h chưa có note, 2 (cần xử lý) cho note
  // mới. Trước đây nằm TRONG lock: nếu Alert_Aggregate vượt ngưỡng và phải prune
  // (xóa từng dòng), thời gian giữ khóa ghi note bị kéo dài theo, khiến các user
  // khác đang chờ lưu note dễ bị timeout hơn. Không throw nếu lỗi — không liên quan
  // tới việc note đã lưu thành công hay chưa.
  if (shouldPushAlert && rec && rec.hub) {
    _pushAlert_({
      stationName: rec.hub,
      source:      'kpifail',
      severity:    (!oldNoteText) ? 3 : 2,
      entityRef:   cleanId,
      message:     'KPI Fail note ' + ((!oldNoteText) ? 'mới' : 'cập nhật') + ' — ' + (rec.category || '') + ' / ' + (rec.type || '')
    });
  }

  return JSON.stringify({ success: true, user: shortUser, time: timestamp });
}

// ── DỌN 1 LẦN: xoá các dòng note RỖNG còn sót lại từ cơ chế syncFullData CŨ ──
// Cơ chế cũ từng ghi TOÀN BỘ record nguồn vào KPIFail_Notes (kể cả không có note),
// nên trước khi đổi sang cơ chế mới, sheet có thể đang tồn đọng rất nhiều dòng mà
// cột Ghi Chú (H) và User Note (I) đều trống. Hàm này chỉ cần chạy 1 LẦN DUY NHẤT
// sau khi deploy bản backend mới — để đưa sheet về đúng trạng thái "chỉ chứa note
// thật". Sau lần chạy này, kpifail_saveNote (chỉ thêm dòng có note) và
// kpifail_syncFullData (chỉ xoá dòng orphan) sẽ tự giữ sheet luôn gọn, không cần
// chạy lại hàm này nữa trừ khi nghi ngờ có rác phát sinh lại.
function kpifail_migrateCleanEmptyNotes() {
  // [SECURITY FIX 2026-08] Hàm dọn/ghi lại sheet Notes toàn hệ thống — trước đây
  // không kiểm tra quyền. Chỉ admin mới được chạy công cụ dọn dẹp/di trú này.
  _requireAdmin_(2);
  // [FIX NGHẼN LOCK] Dùng chung named lock của KPIFail_Notes để nhất quán với
  // saveNote/saveNotesBulk/autoCleanup — tránh đụng độ ghi/xóa cùng sheet, đồng thời
  // không còn phụ thuộc/ảnh hưởng LockService.getScriptLock() toàn cục.
  var gotLock = _kpifail_acquireNoteLock_(20000, 30000);
  if (!gotLock) {
    return JSON.stringify({ success: false, lockBusy: true, error: 'Không lấy được lock, thử lại sau.' });
  }
  try {
    var sheet = _kpifail_getNotesSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ success: true, removed: 0, remaining: 0 });

    // Chỉ cần đọc 2 cột Ghi Chú (H) + User Note (I) để xét rỗng — nhẹ hơn đọc cả 10 cột.
    var noteData = sheet.getRange(2, 8, lastRow - 1, 2).getDisplayValues();
    var deleteRows = [];
    for (var i = 0; i < noteData.length; i++) {
      var ghiChu   = (noteData[i][0] || '').toString().trim();
      var userNote = (noteData[i][1] || '').toString().trim();
      if (!ghiChu && !userNote) deleteRows.push(i + 2);
    }

    // Xoá từ dưới lên để không lệch chỉ số dòng.
    deleteRows.sort(function(a, b) { return b - a; });
    deleteRows.forEach(function(r) { sheet.deleteRow(r); });

    _kpifail_invalidateNotesCache_();
    return JSON.stringify({
      success: true,
      removed: deleteRows.length,
      remaining: Math.max(sheet.getLastRow() - 1, 0)
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  } finally {
    _kpifail_releaseNoteLock_();
  }
}

// Đọc CHỈ cột Shipment ID từ 1 sheet nguồn (không parse Date, không build object raw
// như _kpifail_buildRecords) — dùng để kiểm tra "ID này còn đang fail hay không",
// rẻ hơn nhiều so với việc build full record khi chỉ cần biết có tồn tại hay không.
function _kpifail_readIdColumnOnly_(ss, sheetName, idColIdx) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var lastRow = sheet.getLastRow();
  // [SỬA] idColIdx là KHOÁ ('FM'|'LM'|'SOP') -> dò theo TIÊU ĐỀ; vẫn nhận số cũ để tương thích.
  if (typeof idColIdx === 'string') idColIdx = _kpifail_cols_(sheet, idColIdx).id;
  var vals = sheet.getRange(2, idColIdx + 1, lastRow - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var id = String(vals[i][0] || '').trim();
    if (id) out.push(id);
  }
  return out;
}

function _kpifail_getActiveIdSet_() {
  var ssSrc = _DS.ss(KPIFAIL_SS_ID);
  var ids = {};
  // [SỬA] Cột Shipment ID dò theo TIÊU ĐỀ (không còn cột D/C/C cố định)
  _kpifail_readIdColumnOnly_(ssSrc, KPIFAIL_SHEET_FM, 'FM').forEach(function(id) { ids[id] = true; });
  _kpifail_readIdColumnOnly_(ssSrc, KPIFAIL_SHEET_LM, 'LM').forEach(function(id) { ids[id] = true; });
  _kpifail_readIdColumnOnly_(ssSrc, KPIFAIL_SHEET_SOP, 'SOP').forEach(function(id) { ids[id] = true; });
  return ids;
}

// "Đồng bộ Sheet" — ĐÃ THIẾT KẾ LẠI (xem ghi chú đầu file phần KPIFAIL_NOTES_SHEET).
// KPIFail_Notes giờ CHỈ chứa các dòng có note thật (kpifail_saveNote tự thêm dòng khi
// user note lần đầu) — không còn là bản sao toàn bộ dữ liệu nguồn nữa.
// Vì vậy "đồng bộ" không cần đọc + ghi lại toàn bộ record nguồn (vốn rất tốn kém khi
// nguồn có hàng trăm nghìn dòng), chỉ cần làm 1 việc: DỌN NOTE RÁC — note nào có
// Shipment ID không còn xuất hiện trong 3 sheet nguồn nữa (đơn đã fix / hết fail)
// thì xoá khỏi sheet lưu trữ. Đây chính là cơ chế "xoá dữ liệu" để KPIFail_Notes
// không bao giờ phình to vô hạn theo lưu lượng fail hàng ngày — kích thước của nó
// luôn tỉ lệ với SỐ NOTE ĐANG CÒN HIỆU LỰC, không tỉ lệ với tổng số đơn fail.
function kpifail_syncFullData() {
  // Giờ chỉ là lối tắt để user chủ động kích hoạt sớm — logic dọn dẹp thật sự nằm ở
  // kpifail_autoCleanupNotes() (chạy tự động mỗi 6 tiếng qua trigger, xem bên dưới).
  var res = JSON.parse(kpifail_autoCleanupNotes());
  if (!res.success) return JSON.stringify(res);
  return JSON.stringify({
    success: true,
    removed: res.removedOrphan + res.removedOld,
    remaining: res.remaining,
    time: res.time
  });
}

// ── LỚP BẢO VỆ THỨ 2: dọn theo TUỔI NOTE (retention), độc lập với orphan-cleanup ──
// Orphan-cleanup (ở trên) chỉ xoá note khi ID *biến mất khỏi nguồn*. Nhưng nếu nguồn
// (FM/LM/SOP) giữ lại lịch sử lâu dài (không tự dọn), ID vẫn "active" mãi mãi dù đơn
// đã xử lý xong từ lâu → note KHÔNG BAO GIỜ bị orphan-cleanup động tới. Đây là kẽ hở
// thực sự nguy hiểm ở quy mô 500 hub. Hàm này thêm lớp chặn độc lập: note nào có
// Ngày (cột B, ngày của đơn fail) cũ hơn maxAgeDays thì xoá luôn, BẤT KỂ ID còn
// active trong nguồn hay không — vì sau X ngày, note đã hoàn thành nhiệm vụ ghi nhận/
// theo dõi, không cần giữ vĩnh viễn.
// Mặc định 180 ngày — có thể chỉnh theo nhu cầu vận hành thực tế.
var KPIFAIL_NOTES_MAX_AGE_DAYS = 180;
var KPIFAIL_HISTORY_MAX_AGE_DAYS = 365;

// Thời gian ân hạn cho orphan-cleanup: khi đơn đã biến mất khỏi 3 sheet nguồn
// (FM/LM/SOP — nghĩa là đơn đã fix/hết fail), note KHÔNG bị xóa ngay lập tức nữa.
// Chỉ xóa khi đơn đã vắng mặt khỏi nguồn VÀ note cũng đã đủ "tuổi" (tính theo Ngày
// của đơn ở cột B) ít nhất KPIFAIL_ORPHAN_GRACE_DAYS. Tránh tình trạng note vừa ghi
// 1-5 ngày trước bị xóa oan chỉ vì đơn được xử lý xong rất nhanh sau khi note.
var KPIFAIL_ORPHAN_GRACE_DAYS = 30;

function _kpifail_pruneOldNotes_(maxAgeDays) {
  maxAgeDays = maxAgeDays || KPIFAIL_NOTES_MAX_AGE_DAYS;
  var sheet = _kpifail_getNotesSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var tz = SPX_TZ;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  var cutoffStr = Utilities.formatDate(cutoff, tz, 'yyyy-MM-dd');

  // Chỉ cần đọc cột B (Ngày) — nhẹ, không cần đọc cả 10 cột.
  var dateCol = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
  var deleteRows = [];
  for (var i = 0; i < dateCol.length; i++) {
    var d = (dateCol[i][0] || '').toString().trim();
    // Bỏ qua nếu sai định dạng — tránh so sánh chuỗi sai lệch âm thầm (xem _kpifail_isValidIsoDate_).
    if (d && _kpifail_isValidIsoDate_(d) && d < cutoffStr) deleteRows.push(i + 2);
  }
  _kpifail_batchDeleteRows_(sheet, deleteRows);
  return deleteRows.length;
}

// Dọn KPIFail_Notes_History theo tuổi — dùng cột _TS (cột 6, Date object đầy đủ) để
// tính tuổi chính xác, KHÔNG dùng cột "Thời Gian" hiển thị (dd/MM HH:mm, thiếu năm).
function _kpifail_pruneOldHistory_(maxAgeDays) {
  maxAgeDays = maxAgeDays || KPIFAIL_HISTORY_MAX_AGE_DAYS;
  var sheet = _kpifail_getHistorySheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  var tsCol = sheet.getRange(2, 6, lastRow - 1, 1).getValues();
  var deleteRows = [];
  for (var i = 0; i < tsCol.length; i++) {
    var ts = tsCol[i][0];
    if (ts instanceof Date && ts.getTime() < cutoffMs) deleteRows.push(i + 2);
  }
  _kpifail_batchDeleteRows_(sheet, deleteRows);
  return deleteRows.length;
}

// [BẢO VỆ TỐI THIỂU] Không bao giờ xóa note nào đã được tạo/sửa trong vòng X ngày gần
// nhất, BẤT KỂ thuộc lớp dọn nào (tuổi 180 ngày hay orphan+ân hạn). Đây là "sàn" cứng
// đảm bảo mọi note luôn được lưu tối thiểu 30 ngày kể từ lần ghi/sửa cuối — kể cả note
// ghi cho 1 đơn đã rất cũ (đơn fail từ 200 ngày trước nhưng user vừa note hôm nay vẫn
// được giữ đủ 30 ngày, không bị dọn ngay ở lần cleanup kế tiếp dù "Ngày" đơn đã quá hạn).
// Dựa vào cột _LastEditTS (Date object đầy đủ, không phải "Thời Gian Note" hiển thị
// dd/MM HH:mm vì thiếu năm, không đủ tính tuổi chính xác qua nhiều năm vận hành).
var KPIFAIL_MIN_RETENTION_SINCE_EDIT_DAYS = 30;

// ── GỘP 2 LỚP DỌN + CHẠY TỰ ĐỘNG QUA TRIGGER (không phụ thuộc ai bấm nút) ──
// Đây là hàm thật sự đảm bảo KPIFail_Notes không phình vô hạn: chạy định kỳ, KHÔNG
// cần user thao tác. Nút "Đồng bộ Sheet" trên UI giờ chỉ là cách user CHỦ ĐỘNG kích
// hoạt sớm hơn lịch trigger, không phải là cơ chế dọn rác chính.
// [CẬP NHẬT] Orphan-cleanup giờ có thời gian ân hạn (KPIFAIL_ORPHAN_GRACE_DAYS) —
// không xóa ngay khi đơn biến mất khỏi nguồn nữa, tránh xóa oan note vừa ghi gần đây.
// Đảm bảo mọi note đều được lưu tối thiểu đúng theo chính sách 180 ngày
// (KPIFAIL_NOTES_MAX_AGE_DAYS) như đã thống nhất, bất kể đơn đã fix nhanh hay chậm.
// [FIX RACE CONDITION] Trước đây tính toán danh sách dòng cần xóa TRƯỚC khi vào lock,
// rồi xóa theo SỐ THỨ TỰ DÒNG đã chốt sẵn — nếu có user sửa đúng dòng đó trong lúc chờ
// lock, dòng vẫn bị xóa theo quyết định cũ, làm mất nội dung vừa sửa. Giờ chỉ tính toán
// "trước" với bước ĐẮT (activeIds — quét 3 sheet nguồn ~100k dòng), còn việc đọc dữ liệu
// của CHÍNH sheet KPIFail_Notes (rẻ, vì sheet này chỉ chứa các dòng có note thật) được
// dời vào BÊN TRONG lock, ngay trước khi xóa — đảm bảo quyết định xóa luôn dựa trên dữ
// liệu mới nhất, không còn khoảng hở race condition.
function kpifail_autoCleanupNotes() {
  // [SECURITY FIX 2026-08] Hàm XOÁ VĨNH VIỄN note "orphan" (đơn đã hết fail) —
  // trước đây không kiểm tra quyền, gọi trực tiếp bất cứ lúc nào cũng xoá được,
  // bỏ qua các điều kiện an toàn (đợi nguồn ổn định) mà trigger tự động vẫn tôn
  // trọng. Chỉ admin (hoặc trigger 6 giờ/lần chạy dưới danh nghĩa tài khoản admin
  // đã cài) mới được gọi.
  _requireAdmin_(2);
  // [TỐI ƯU] Đọc activeIds TRƯỚC khi vào lock — đây là bước đắt nhất (quét cả 3 sheet
  // nguồn FM/LM/SOP, có thể tới ~100k dòng), không liên quan trực tiếp tới việc ghi/sửa
  // note nên an toàn khi đọc ngoài lock (dữ liệu nguồn hiếm khi đổi trong vài giây).
  //
  // [FIX] BẢO VỆ CHỐNG XOÁ NHẦM DO ĐỌC TRÚNG LÚC NGUỒN ĐANG GHI: activeIds quyết
  // định note nào bị coi là "orphan" (đơn đã hết fail) để XOÁ VĨNH VIỄN. Nếu đọc
  // trúng lúc pipeline ngoài đang clear+ghi lại sheet (đã xác nhận qua Version
  // History — 2 service account ghi liên tục, không theo lịch cố định), activeIds
  // sẽ THIẾU nhiều ID đang active thật -> note của các đơn đó bị hiểu lầm là orphan
  // và bị xoá oan, không thể khôi phục. Hậu quả nặng hơn hẳn so với dashboard hiển
  // thị sai tạm thời, nên cần chặn TRƯỚC khi tính activeIds: nếu nguồn không ổn
  // định, bỏ qua HẲN lượt dọn orphan lần này (vẫn chạy dọn theo tuổi note — không
  // phụ thuộc activeIds nên an toàn — và dọn lịch sử), rồi thử lại ở lượt kế tiếp
  // (trigger chạy mỗi 6 giờ, không mất mát gì khi lùi 1 chu kỳ).
  var ssSrc = _DS.ss(KPIFAIL_SS_ID);
  var sourceStableForOrphan = _kpifail_waitForStableSource_(ssSrc);
  var activeIds = sourceStableForOrphan ? _kpifail_getActiveIdSet_() : null;
  if (!sourceStableForOrphan) {
    _LOG.d('[KPIFail AutoCleanup] Bỏ qua lượt dọn ORPHAN lần này vì nguồn có vẻ đang được ghi liên tục — vẫn dọn theo tuổi note (không phụ thuộc nguồn). Thử lại orphan ở lượt kế tiếp (6 giờ sau).');
  }

  var tz = SPX_TZ;
  var graceCutoff = new Date();
  graceCutoff.setDate(graceCutoff.getDate() - KPIFAIL_ORPHAN_GRACE_DAYS);
  var graceCutoffStr = Utilities.formatDate(graceCutoff, tz, 'yyyy-MM-dd');
  var ageCutoff = new Date();
  ageCutoff.setDate(ageCutoff.getDate() - KPIFAIL_NOTES_MAX_AGE_DAYS);
  var ageCutoffStr = Utilities.formatDate(ageCutoff, tz, 'yyyy-MM-dd');
  var minRetentionMs = KPIFAIL_MIN_RETENTION_SINCE_EDIT_DAYS * 24 * 60 * 60 * 1000;

  var removedOrphan = 0, removedOld = 0, removedHistory = 0;
  var sheet = _kpifail_getNotesSheet_();
  // [FIX NGHẼN LOCK] Dùng named lock riêng cho KPIFail_Notes (giống saveNote/saveNotesBulk)
  // thay vì LockService.getScriptLock() toàn cục — job dọn dẹp này chỉ cần tránh đụng
  // với chính các thao tác ghi note, không cần (và không nên) chặn Analytics/Trend.
  var gotLock = _kpifail_acquireNoteLock_(20000, 30000);
  if (!gotLock) {
    _LOG.d('[KPIFail AutoCleanup] Không lấy được lock ghi note, bỏ qua lượt dọn này (thử lại lượt sau).');
    return JSON.stringify({ success: false, lockBusy: true, error: 'Không lấy được lock, thử lại lượt sau.' });
  }
  try {
    // Đọc lại NGAY TRONG LOCK — dữ liệu luôn mới nhất tại thời điểm quyết định xóa,
    // không dùng lại bất kỳ giá trị nào đã đọc từ trước khi vào lock.
    var lastRow = sheet.getLastRow();
    var orphanRows = [], oldRows = [];
    var nowMs = Date.now();

    if (lastRow >= 2) {
      var idCol      = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      var dateCol    = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues();
      var lastEditTs = sheet.getRange(2, KPIFAIL_NOTES_COL_LASTEDIT_TS, lastRow - 1, 1).getValues();

      for (var i = 0; i < idCol.length; i++) {
        var id = String(idCol[i][0] || '').trim();
        var orderDate = (dateCol[i][0] || '').toString().trim();
        var validDate = orderDate && _kpifail_isValidIsoDate_(orderDate);
        var rowNum = i + 2;

        // [SÀN BẢO VỆ] Note đã sửa trong vòng KPIFAIL_MIN_RETENTION_SINCE_EDIT_DAYS
        // ngày gần nhất → KHÔNG xóa, bất kể thuộc lớp nào. Dòng cũ (tạo trước khi có
        // cột _LastEditTS) sẽ có ô này rỗng → bỏ qua sàn bảo vệ này, áp dụng luật cũ.
        var ts = lastEditTs[i][0];
        if (ts instanceof Date && (nowMs - ts.getTime()) < minRetentionMs) continue;

        // Lớp 1 — tuổi note: bất kể ID còn active trong nguồn hay không, quá hạn
        // KPIFAIL_NOTES_MAX_AGE_DAYS thì xóa. Ưu tiên kiểm tra trước vì áp dụng chung.
        if (validDate && orderDate < ageCutoffStr) {
          oldRows.push(rowNum);
          continue; // đã chắc chắn xóa, khỏi cần xét orphan nữa
        }

        // Lớp 2 — orphan + ân hạn: ID không còn active trong nguồn VÀ đã đủ
        // KPIFAIL_ORPHAN_GRACE_DAYS kể từ ngày đơn. Ngày không xác định (rỗng/sai định
        // dạng) → KHÔNG xóa, an toàn hơn xóa nhầm note còn mới.
        // [FIX] activeIds === null nghĩa là nguồn không ổn định lúc đọc (xem trên) —
        // KHÔNG coi bất kỳ ID nào là orphan trong trường hợp này (an toàn hơn xoá nhầm).
        if (activeIds && id && !activeIds[id] && validDate && orderDate < graceCutoffStr) {
          orphanRows.push(rowNum);
        }
      }
    }

    // Gộp 2 danh sách lại xóa 1 lần (tránh batchDelete gọi 2 lần làm lệch chỉ số
    // nếu 2 danh sách có dòng trùng nhau — đã loại trùng bằng "continue" ở trên rồi,
    // nhưng gộp vẫn an toàn hơn và ít lệnh deleteRows hơn).
    var allDeleteRows = oldRows.concat(orphanRows);
    _kpifail_batchDeleteRows_(sheet, allDeleteRows);
    removedOld = oldRows.length;
    removedOrphan = orphanRows.length;

    // [FIX] KPIFail_Notes_History là append-only, KHÔNG có cơ chế dọn nào trước đây —
    // đúng lỗi tích lũy vô hạn mình đã dày công sửa cho KPIFail_Notes. Giữ lịch sử lâu
    // hơn note thường (365 ngày) vì đây là log audit, không cần dọn gấp như note đang
    // hoạt động — nhưng vẫn phải có trần, không giữ mãi mãi.
    removedHistory = _kpifail_pruneOldHistory_(KPIFAIL_HISTORY_MAX_AGE_DAYS);

    _kpifail_invalidateNotesCache_();
    _LOG.d('[KPIFail AutoCleanup] orphan=' + removedOrphan + ' old=' + removedOld +
      ' history=' + removedHistory + ' remaining=' + Math.max(sheet.getLastRow() - 1, 0));

    return JSON.stringify({
      success: true,
      removedOrphan: removedOrphan,
      removedOld: removedOld,
      removedHistory: removedHistory,
      remaining: Math.max(sheet.getLastRow() - 1, 0),
      time: Utilities.formatDate(new Date(), 'GMT+7', 'dd/MM HH:mm')
    });
  } catch (e) {
    _LOG.d('[KPIFail AutoCleanup] ERROR: ' + e.message);
    return JSON.stringify({ success: false, error: e.message });
  } finally {
    _kpifail_releaseNoteLock_();
  }
}

// ── Trigger setup: gọi 1 LẦN DUY NHẤT để bật lịch tự động dọn note ──
// Chạy mỗi 6 tiếng/lần — đủ thường xuyên để note rác không kịp tích lũy lớn (kể cả
// ở quy mô 5k note/ngày), mà không tốn quota trigger quá mức.
// [DEPRECATED 2026-07-29] Đã gộp vào setupNightlyMaintenanceTrigger() (chạy 1
// lần/đêm thay vì mỗi 6 tiếng) — KHÔNG chạy lại hàm này, sẽ tạo trùng trigger.
// Giữ lại code chỉ để tham khảo lịch sử.
function setupKPIFailCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'kpifail_autoCleanupNotes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('kpifail_autoCleanupNotes')
    .timeBased().everyHours(6).create();
  _LOG.d('✅ Trigger kpifail_autoCleanupNotes đã được tạo — chạy mỗi 6 tiếng.');
}

// [FIX 2026-07-28] Trigger CHẠY TAY 1 LẦN để bật lưới an toàn cho phương án đọc
// theo số dòng (_kpifail_readSourceRowsSince_): cách đọc mới chỉ bắt được dòng
// MỚI THÊM VÀO CUỐI sheet, không bắt được trường hợp hệ thống nguồn SỬA LẠI dữ
// liệu cũ ở giữa sheet (backfill). Chạy kpifail_forceFullRebuild() 1 lần/ngày vào
// giờ vắng (2h sáng) để đối chiếu lại toàn bộ — chấp nhận trễ tối đa 1 ngày cho
// các bản sửa dữ liệu cũ, đổi lại giữ tốc độ nhanh cho toàn bộ các chu kỳ 5 phút
// còn lại trong ngày. CHẠY 1 LẦN function này trong GAS editor để kích hoạt.
function setupKPIFailNightlyRebuildTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'kpifail_nightlyFullRebuildRunner') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('kpifail_nightlyFullRebuildRunner')
    .timeBased().inTimezone(SPX_TZ).atHour(2).everyDays(1).create();
  _LOG.d('✅ Trigger kpifail_nightlyFullRebuildRunner đã được tạo — chạy 2h sáng hằng ngày (giờ VN).');
  return 'Đã tạo trigger kpifail_nightlyFullRebuildRunner — chạy 2h sáng hằng ngày (giờ VN).';
}

function kpifail_nightlyFullRebuildRunner() {
  try {
    var res = kpifail_forceFullRebuild();
    _LOG.d('[KPIFail nightly rebuild] ' + res);
  } catch (e) {
    _LOG.d('[KPIFail nightly rebuild] ERROR: ' + e.message);
  }
}

// ── [NÂNG CẤP] PREWARM CACHE — chạy nền để dashboard hầu như luôn load từ cache ──
// Cache TTL 300s nghĩa là nếu không ai mở dashboard trong 5 phút, lượt mở tiếp theo
// sẽ rơi vào cold path (mở 3 sheet ngoài qua mạng — chậm, đã phân tích ở các lần
// trước).
// [FIX] Hàm này TRƯỚC ĐÂY gọi kpifail_getMasterData() — đọc THẲNG 3 sheet nguồn,
// KHÔNG qua persisted snapshot, KHÔNG có stability-check chống race condition.
// Vì dashboard đã chuyển sang dùng kpifail_getMasterDataLite() (qua
// _kpifail_getPersistentMasterRecords_ — có snapshot + stability-check) từ lâu,
// cache mà kpifail_getMasterData() tạo ra (key 'kpifail_master_v3_...') KHÔNG còn
// được bất kỳ nơi nào khác đọc lại — nghĩa là trigger 5 phút/lần này chỉ đang tốn
// quota Sheets API + tự đặt mình vào rủi ro đọc trúng lúc nguồn đang bị ghi, mà
// không mang lại lợi ích thực tế nào. Đổi sang gọi kpifail_getMasterDataLite('ALL', ...)
// — vừa đúng cache mà dashboard thật sự dùng, vừa tự động kế thừa mọi lớp bảo vệ
// (persisted snapshot, stability-check, anomaly-guard) đã thêm ở trên.
function kpifail_prewarmCache() {
  if (_spxIsPrewarmQuietHours_()) { _LOG.d('[KPIFail Prewarm] Bỏ qua — khung giờ vắng user (23h-5h).'); return; }
  // [FIX 2026-08-13] Job KHÔNG QUAN TRỌNG (chỉ giữ cache nóng, mất 1 lượt không hỏng
  // dữ liệu) — tự nhường quota runtime/ngày cho traffic user thật khi ngân sách hôm
  // nay đã cao. Xem giải thích đầy đủ ở _spxShouldSkipForBudget_().
  if (_spxShouldSkipForBudget_()) { _LOG.d('[KPIFail Prewarm] Bỏ qua — ngân sách runtime hôm nay đã cao, nhường quota cho user.'); return; }
  // [FIX 2026-07-28] Log Executions thực tế cho thấy hàm này (trigger 5 phút) thỉnh
  // thoảng chạy rất lâu (có lượt tới 30 phút, bị Timed Out) — vì KHÔNG có khóa chống
  // chồng lấn, các trigger 5 phút tiếp theo vẫn cứ bắn thêm trong khi lượt trước còn
  // chạy → nhiều bản chạy song song tranh nhau tài nguyên, càng chồng càng chậm, kéo
  // theo cả kpifail_getIndexSummary (card trang chủ) bị kẹt hàng trăm giây do xếp hàng
  // phía sau. Áp dụng ĐÚNG pattern _anaAcquireNamedLock() đã dùng cho
  // pick_live_prewarmCache (fix 2026-07-24) — nếu đang có 1 lượt chạy dở, bỏ qua chu
  // kỳ này ngay (không chờ), cache cũ vẫn còn dùng tạm được, chu kỳ 5 phút sau sẽ thử lại.
  // [FIX 2026-07-31] Thêm staleMs tường minh (trước dùng mặc định 90s) — đồng bộ
  // với chu kỳ trigger mới (10 phút, trước 5 phút). Đây là lớp khóa NGOÀI, lớp
  // chống chồng lấn thật đã có ở khóa TRONG (kpifail_masterdata_cold_lock_v1,
  // staleMs 300s) nên rủi ro không lớn, nhưng vẫn nâng cho đồng bộ.
  var gotLock = _anaAcquireNamedLock('kpifail_prewarm_lock_v1', 10000, 600000);
  if (!gotLock) { _LOG.d('[KPIFail Prewarm] Bỏ qua — lượt trước còn đang chạy.'); return; }
  var _t0 = Date.now();
  try {
    // [TỐI ƯU QUAN TRỌNG — đo thật: hàm này từng có lượt chạy 1.439 giây (24
    // phút), tốn ~7% ngân sách 360 phút/ngày chỉ trong MỘT lượt]
    // TRƯỚC ĐÂY gọi kpifail_getMasterDataLite('ALL', ...) — hàm đó làm 3 việc:
    //   (1) làm mới snapshot dùng CHUNG cho mọi user  <- việc DUY NHẤT prewarm cần
    //   (2) dựng kết quả "lite" cho riêng phạm vi quyền admin
    //   (3) JSON.stringify + ghi cache phân mảnh ~327k bản ghi  <- TỐN NHẤT
    // Sau khi khoá cache đã đổi sang theo PHẠM VI QUYỀN, phần (2)+(3) chỉ phục
    // vụ đúng nhóm admin (vài người), trong khi chi phí thì cả hệ thống gánh mỗi
    // 10 phút. Nay prewarm CHỈ làm (1) — phần thật sự dùng chung cho 2.000 user.
    // KHÔNG giảm trải nghiệm: (2)+(3) vẫn chạy khi user mở module, nhưng lúc đó
    // snapshot đã nóng sẵn nên KHÔNG phải đọc lại Sheets (phần chậm nhất) —
    // đúng cách mà 1.999 user không-phải-admin vốn đã luôn chạy từ trước tới nay.
    _kpifail_getPersistentMasterRecords_();
    _LOG.d('[KPIFail Prewarm] Snapshot dùng chung đã được làm mới lúc ' + new Date());
  } catch (e) {
    _LOG.d('[KPIFail Prewarm] ERROR: ' + e.message);
  } finally {
    _anaReleaseNamedLock('kpifail_prewarm_lock_v1');
    var _elapsedMin = (Date.now() - _t0) / 60000;
    _spxTrackExecMinutes_(_elapsedMin);
    // [CẢNH BÁO SỚM] Ghi log rõ ràng khi 1 lượt chạy đã tốn quá NỬA ngân sách còn
    // lại của 1 chu kỳ (10 phút = 1/36 ngày) — để phát hiện xu hướng chậm dần TRƯỚC
    // khi nó lặp lại đúng sự cố "30 phút, Timed Out" đã từng xảy ra, thay vì chỉ biết
    // sau khi đã sập. Ngưỡng 3 phút = 50% của chu kỳ trigger 10 phút và cũng là 50%
    // của trần cứng 6 phút/lần chạy Apps Script.
    if (_elapsedMin >= 3) {
      _LOG.d('[KPIFail Prewarm] ⚠️ CẢNH BÁO: lượt này chạy ' + _elapsedMin.toFixed(1) +
        ' phút (>50% trần 6 phút/lần) — dữ liệu đang tăng, cân nhắc chia lô trước khi lặp lại sự cố Timed Out cũ.');
    }
  }
}

// [FIX 2026-07-31] Đổi 5 phút -> 10 phút — 1 trong 5 trigger được cân bằng lại để
// tổng thời gian chạy/ngày của TẤT CẢ trigger nền không vượt quota 360 phút/ngày
// (tài khoản Workspace). An toàn để giảm tần suất vì kpifail_getMasterDataLite()
// luôn có đường tự build dự phòng khi cache/snapshot chưa kịp làm mới (không có
// rủi ro lỗi cứng như fms_live/pick_live).
function setupKPIFailPrewarmTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 10-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher10Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher10Min() thay thế.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'kpifail_prewarmCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('kpifail_prewarmCache')
    .timeBased().everyMinutes(10).create();
  _LOG.d('✅ Trigger kpifail_prewarmCache đã được tạo — chạy mỗi 10 phút.');
}

// ============================================================
// AGING — PRE-WARM CACHE & ORPHAN CLEANUP TRIGGER
// ============================================================
// [OPT] Hàm prewarm giữ aging_getMasterData() luôn có cache nóng.
// Chạy setupAgingPrewarmTrigger() MỘT LẦN trong Apps Script Editor để bật.
function aging_prewarmCache() {
  if (_spxIsPrewarmQuietHours_()) { _LOG.d('[Aging Prewarm] Bỏ qua — khung giờ vắng user (23h-5h).'); return; }

  // [VIẾT LẠI — theo yêu cầu: "tận dụng nhịp cập nhật nguồn để user luôn thấy số mới nhất"]
  // Nguồn cập nhật MỖI GIỜ trong khung 7:00-18:00. Cách cũ: mỗi lượt trigger chỉ chạy
  // ĐÚNG 1 trong 4 giai đoạn (core/lost/fm/finalize) -> phải 4 lượt mới xong 1 bản chụp,
  // và chạy lại vô điều kiện kể cả khi nguồn CHƯA đổi (tốn ngân sách vô ích).
  // Cách mới, 2 nguyên tắc:
  //   1) CHỈ DỰNG KHI NGUỒN ĐÃ ĐỔI — so dấu phiên bản nguồn (đọc đúng 1 ô) với dấu đã
  //      lưu trong bản chụp. Nguồn chưa đổi thì không làm gì, để dành ngân sách.
  //   2) KHI ĐÃ DỰNG THÌ DỰNG TRỌN trong 1 lượt (đo thật: 4 giai đoạn xong dưới 6 phút),
  //      thay vì rải ra 4 lượt. Nhờ vậy số mới của nguồn đến tay người dùng trong vòng
  //      1 nhịp trigger, không phải chờ cả tiếng.
  // [SỬA — theo phản hồi: nguồn KHÔNG ghi xong trong 1 nhịp mà đồng bộ dần]
  // Nguồn có thể ghi từ 10:00 tới 10:10. Nếu bắt gặp lúc đang ghi dở, bản chụp sẽ
  // dựng từ DỮ LIỆU THIẾU và người dùng thấy số thấp hơn thực tế mà không biết.
  // Quy tắc: chỉ dựng khi nguồn ĐÃ NGỪNG THAY ĐỔI — đọc dấu phiên bản 2 lần cách
  // nhau 8 giây; còn nhảy số nghĩa là đang ghi dở -> để lượt sau (10 phút nữa).
  var srcVer = '';
  try {
    srcVer = _aging_getSourceVersion_();
    Utilities.sleep(8000);
    var srcVer2 = _aging_getSourceVersion_();
    if (srcVer && srcVer2 && srcVer !== srcVer2) {
      _LOG.d('[Aging Prewarm] Nguồn ĐANG GHI DỞ (' + srcVer + ' -> ' + srcVer2 + ') — hoãn dựng, giữ bản chụp hoàn chỉnh trước đó.');
      return;
    }
    srcVer = srcVer2 || srcVer;
  } catch (eSv) {}
  var meta = {};
  try { meta = _kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))) || {}; } catch (eM) {}
  var snapAgeMin = meta.snapshot_version ? Math.round((Date.now() - Number(meta.snapshot_version)) / 60000) : 99999;
  var stage = '';
  try { stage = PropertiesService.getScriptProperties().getProperty(AGING_BUILD_STAGE_KEY) || 'core'; } catch (eSt) {}

  // [SỬA — theo phản hồi: nguồn GHI ĐÈ TOÀN BỘ, đẩy dần, không rõ tiến độ]
  // Giữa chừng sheet có thể mất bớt dòng (xoá rồi ghi lại). Chỉ dựa vào "số dòng
  // ngừng nhảy trong 8 giây" là chưa đủ — rơi đúng khoảng nghỉ giữa hai đợt ghi sẽ
  // tưởng nhầm đã xong và dựng ra bản THIẾU DÒNG.
  // Chốt khối lượng: bản ghi đè hoàn chỉnh không thể ít hơn 80% lần hoàn chỉnh trước.
  // Nếu thấp hơn -> coi như đang ghi dở, hoãn. Nhưng KHÔNG hoãn vô hạn: dữ liệu có
  // thể giảm thật (đợt dọn lớn), nên sau 3 lượt liên tiếp vẫn thấp thì chấp nhận.
  try {
    // [SỬA] So SỐ ĐƠN THẬT (không phải lastRow, vốn gồm hàng chục nghìn dòng trống). Chỉ đọc khi thật sự
    // sắp dựng (nguồn đổi / chu kỳ dở / bản chụp quá hạn) để không tốn 1 lượt đọc cột mỗi 10 phút.
    var _wouldBuild = !(srcVer && meta.snapshot_source_version === srcVer && snapAgeMin <= 180 && stage === 'core' && meta.snapshot_schema === AGING_SNAPSHOT_SCHEMA);
    var _srcRows  = 0;
    if (_wouldBuild) { try { _srcRows = _aging_countSourceOrders_(); } catch (eCo) { _srcRows = 0; } }
    var _prevRows = Number(meta.snapshot_core_count || 0);
    var _props    = PropertiesService.getScriptProperties();
    var _streak   = Number(_props.getProperty('aging_low_rows_streak') || 0);
    if (_prevRows > 0 && _srcRows > 0 && _srcRows < _prevRows * 0.8) {
      _streak++;
      _props.setProperty('aging_low_rows_streak', String(_streak));
      if (_streak < 3) {
        _LOG.d('[Aging Prewarm] Nguồn mới chỉ có ' + _srcRows + '/' + _prevRows + ' dòng (' +
               Math.round(_srcRows / _prevRows * 100) + '%) — nhiều khả năng đang ghi dở, hoãn (lượt ' + _streak + '/3).');
        return;
      }
      _LOG.d('[Aging Prewarm] Vẫn thấp sau ' + _streak + ' lượt — chấp nhận là dữ liệu giảm thật, dựng bình thường.');
    }
    _props.deleteProperty('aging_low_rows_streak');
  } catch (eRows) {}

  // Nguồn chưa đổi + bản chụp còn trong hạn + không có chu kỳ dựng dở -> nghỉ.
  if (srcVer && meta.snapshot_source_version === srcVer && snapAgeMin <= 180 && stage === 'core' && meta.snapshot_schema === AGING_SNAPSHOT_SCHEMA) {
    _LOG.d('[Aging Prewarm] Nguồn chưa đổi (' + srcVer + '), bản chụp mới ' + snapAgeMin + ' phút — không cần dựng lại.');
    return;
  }

  // Dựng trọn 1 chu kỳ trong lượt này, dừng khi đã ghi bản chụp mới hoặc gần hết giờ.
  var t0 = Date.now(), verBefore = Number(meta.snapshot_version) || 0, lastStage = '';
  for (var n = 0; n < 12; n++) {
    // [MỚI] Lượt trigger gộp (spxDispatcher10Min) chạy NHIỀU job trong 1 lần thực thi 6 phút: tính cả
    // thời gian đã trôi từ lúc dispatcher bắt đầu, không chỉ từ lúc hàm này bắt đầu.
    if (Date.now() - t0 > 4.5 * 60 * 1000 || (_SPX_DISPATCH_T0 && Date.now() - _SPX_DISPATCH_T0 > 4.0 * 60 * 1000)) {
      _LOG.d('[Aging Prewarm] Hết thời lượng 1 lượt — lượt trigger sau chạy tiếp từ giai đoạn đang dở.');
      break;
    }
    var before = PropertiesService.getScriptProperties().getProperty(AGING_BUILD_STAGE_KEY) || 'core';
    aging_stagedBuildRunner();
    var after = PropertiesService.getScriptProperties().getProperty(AGING_BUILD_STAGE_KEY) || 'core';
    var verNow = 0;
    try { verNow = Number(_kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))).snapshot_version) || 0; } catch (eV) {}
    if (verNow !== verBefore) {
      // Kiểm tra lại: nguồn có đổi TRONG LÚC đang dựng không? Nếu có, bản chụp vừa
      // ghi có thể dính dữ liệu nửa chừng -> đánh dấu để lượt sau dựng lại, thay vì
      // tin tưởng nhầm rồi phục vụ số thiếu suốt cả giờ.
      var srcAfter = '', _stamped = '';
      try { srcAfter = _aging_getSourceVersion_(); } catch (eSa) {}
      try { _stamped = String(_kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))).snapshot_source_version || ''); } catch (eSt2) {}
      // [SỬA] So với dấu ĐÃ ĐÓNG vào bản chụp (= phiên bản lúc đọc core), không phải srcVer đầu lượt:
      // chu kỳ nối từ lượt trước vẫn bị bắt. Cũng bỏ việc ghi đè 'DANG_GHI_DO' — nó xoá cả bản đồ
      // meta (mất snapshot_version/ô đang dùng) khiến người dùng phải chờ dựng trực tiếp; dấu đóng
      // đúng đã đủ để lượt sau tự nhận ra bản chụp lệch nguồn.
      if (srcAfter && _stamped && srcAfter !== _stamped) {
        _LOG.d('[Aging Prewarm] Nguồn đã đổi từ lúc đọc (' + _stamped + ' -> ' + srcAfter + ') — bản vừa dựng có thể CŨ/THIẾU DÒNG, dựng lại NGAY trong lượt này.');
        // [SỬA] Trước đây chỉ đánh dấu rồi dừng -> người dùng thấy số thiếu tới 10
        // phút (đo bằng mô phỏng kịch bản job rơi đúng khoảng nghỉ giữa 2 đợt ghi).
        // Nay dựng lại ngay nếu còn thời lượng, rút thời gian phơi nhiễm xuống ~1 phút.
        verBefore = verNow;      // mốc mới để vòng lặp nhận ra lần ghi kế tiếp
        srcVer    = srcAfter;
        lastStage = '';
        continue;
      } else {
        _LOG.d('[Aging Prewarm] Đã dựng xong bản chụp mới theo nguồn ' + srcVer + '.');
      }
      break;
    }
    if (before === after && lastStage === before) {
      _LOG.d('[Aging Prewarm] Giai đoạn ' + after + ' không tiến triển 2 lượt — dừng, chờ lượt sau.');
      break;
    }
    lastStage = before;
  }
}

// [FIX 2026-07-31] Đổi 5 phút -> 10 phút — cùng đợt cân bằng lại tổng quota
// 360 phút/ngày. An toàn vì aging_getMasterData() có khóa chống chồng lấn + tự
// build dự phòng khi cache trống (đã vá 2026-07-30), không có rủi ro lỗi cứng.
function setupAgingPrewarmTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 10-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher10Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher10Min() thay thế.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'aging_prewarmCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aging_prewarmCache')
    .timeBased().everyMinutes(10).create();
  _LOG.d('✅ Trigger aging_prewarmCache — chạy mỗi 10 phút.');
}

// [OPT] Dọn orphan notes định kỳ (tách khỏi cold path aging_getMasterData).
// Chỉ chạy 1 lần/6h thay vì mỗi lần load data → không ảnh hưởng response time.
// Chạy setupAgingOrphanCleanupTrigger() MỘT LẦN để bật.
function aging_orphanCleanup() {
  // [SECURITY FIX 2026-08] Hàm XOÁ note "orphan" trong App_Notes trên toàn hệ
  // thống — trước đây không kiểm tra quyền. Chỉ admin (hoặc trigger 6h/lần chạy
  // dưới danh nghĩa admin đã cài) mới được gọi.
  _requireAdmin_(2);
  try {
    const ssCore = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
    const ssLost = _DS.ss('1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE');
    const ssNote = _DS.ss(ADMIN_DB_ID);

    const coreRes = JSON.parse(_aging_getCoreDataFromSS(ssCore));
    const lostRes = JSON.parse(_aging_getLostDataFromSS(ssLost));

    const activeIds = new Set(
      (coreRes.data || []).map(function(r){ return r.shipmentId; })
      .concat((lostRes.data || []).map(function(r){ return r.shipmentId; }))
      .filter(Boolean)
    );

    // Dọn orphan thật sự (truyền activeIds để clearContents nếu cần)
    _aging_getNotesFromSS(ssNote, activeIds);
    // Sau khi dọn, invalidate notes cache để lần đọc tiếp lấy data sạch
    _aging_invalidateNotesCache();
    _LOG.d('[Aging OrphanCleanup] Hoàn thành lúc ' + new Date());
  } catch(e) {
    _LOG.d('[Aging OrphanCleanup] ERROR: ' + e.message);
  }
}

// [DEPRECATED 2026-07-29] Đã gộp vào setupNightlyMaintenanceTrigger() (chạy 1
// lần/đêm thay vì mỗi 6 tiếng) — KHÔNG chạy lại hàm này, sẽ tạo trùng trigger.
// Giữ lại code chỉ để tham khảo lịch sử.
function setupAgingOrphanCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'aging_orphanCleanup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aging_orphanCleanup')
    .timeBased().everyHours(6).create();
  _LOG.d('✅ Trigger aging_orphanCleanup — chạy mỗi 6 tiếng.');
}

// [FIX 2026-07-29] GỘP 2 việc bảo trì (dọn note orphan KPI Fail + Aging) — trước
// đây mỗi việc có trigger RIÊNG chạy mỗi 6 tiếng (4 lần/ngày), không phục vụ user
// real-time (chỉ dọn dữ liệu cũ/orphan), không cần thiết phải chạy dày. Gộp về 1
// trigger DUY NHẤT chạy 1 lần/đêm (3h sáng — lệch giờ với kpifail_nightlyFullRebuildRunner
// và trendNightlyPurgeRunner đang chạy 2h sáng, tránh dồn nhiều job nặng cùng lúc).
// CHẠY setupNightlyMaintenanceTrigger() MỘT LẦN để chuyển đổi — hàm này tự xoá 2
// trigger 6-tiếng cũ (kpifail_autoCleanupNotes, aging_orphanCleanup) trước khi tạo
// trigger mới, không để sót trigger cũ chạy song song.
function setupNightlyMaintenanceTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'kpifail_autoCleanupNotes' || fn === 'aging_orphanCleanup' || fn === 'spx_nightlyMaintenanceRunner') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('spx_nightlyMaintenanceRunner')
    .timeBased().inTimezone(SPX_TZ).atHour(3).everyDays(1).create();
  _LOG.d('✅ Trigger spx_nightlyMaintenanceRunner đã được tạo — chạy 3h sáng hằng ngày, thay cho 2 trigger 6-tiếng cũ.');
  return 'Đã tạo trigger spx_nightlyMaintenanceRunner (3h sáng hằng ngày) và xoá 2 trigger 6-tiếng cũ (kpifail_autoCleanupNotes, aging_orphanCleanup).';
}

function spx_nightlyMaintenanceRunner() {
  // Mỗi việc bọc try/catch RIÊNG — 1 việc lỗi không được phép chặn việc còn lại.
  try {
    kpifail_autoCleanupNotes();
    _LOG.d('[Nightly Maintenance] kpifail_autoCleanupNotes xong.');
  } catch (e1) {
    _LOG.d('[Nightly Maintenance] kpifail_autoCleanupNotes ERROR: ' + e1.message);
  }
  try {
    aging_orphanCleanup();
    _LOG.d('[Nightly Maintenance] aging_orphanCleanup xong.');
  } catch (e2) {
    _LOG.d('[Nightly Maintenance] aging_orphanCleanup ERROR: ' + e2.message);
  }

  // [MỚI — khép khoảng trống "người dùng bỏ dở đồng bộ BI"] Mỗi đêm đối chiếu
  // Station_Daily với Rider Plan: ngày nào máy chủ ĐÃ CÓ số mà Rider Plan chưa có
  // thì bù vào. Nhờ vậy dù người dùng đóng tab, đổi máy hay xoá dữ liệu trình duyệt,
  // số vẫn về đúng chỗ mà không ai phải nhớ chạy tay.
  // An toàn: hàm bù dùng đúng quy tắc của rp_upsertDayFromBI -> KHÔNG đè số người
  // dùng tự nhập tay, và ghi đúng NGÀY CỦA DỮ LIỆU, không phải ngày chạy job.
  try {
    var _rc = JSON.parse(rp_reconcileFromStationDaily(null, null));
    _LOG.d('[Nightly Maintenance] Đối chiếu BI->Rider Plan: xét ' + (_rc.soNgayXet || 0) +
           ' ngày, bù ' + (_rc.buSung || 0) + ', bỏ qua ' + (_rc.boQua || 0) + '.');
  } catch (e3) {
    _LOG.d('[Nightly Maintenance] Đối chiếu BI->Rider Plan ERROR: ' + e3.message);
  }
}

var _WM = 'https://docs.google.com/spreadsheets/d/1Nl-XWrF29uUG3DKxD8CtpGOj9FkI1XChpkjN2AqclMA/edit';
var _WD = 'https://docs.google.com/spreadsheets/d/1n7qiYKs3b08P4KzMOEFPt2c1VI1XnZBf44TJl4KmehA/edit';

var _TAIL_TEAMS = [
  'Roadmap Lead', 'Roadmap Staff', 'Detail Cong Viec',
  'Plan Dao Tao Staff->Lead', 'Quy Doi Ranking',
  'Thuat Ngu & Tu Viet Tat', 'Trang Thai Don Hang', 'Phong Ban & Chuc Nang'
];

var _WN = {
  'opex':'OPEX', 'fin':'Fin', 'risk':'Risk Management', 'rs':'Rider', 'proc':'Procurement',
  'quy trinh nhan su':'HR', 'gia tri cot loi':'Gia Tri Cot Loi', 'cac chuong trinh':'Cac Chuong Trinh',
  'l&d':'L&D', 'wfa':'WFA', 'admin':'Admin', 'c&b':'C&B', 'cs':'CS', 'claim':'Claim',
  'hse':'HSE', 'it':'IT', 'olm':'OLM', 'product':'Product', 'hr':'HR'
};

// ---------- PUBLIC ----------
function wiki_getDocumentData_v2(forceRefresh) {
  // [SECURITY FIX 2026-08] Hàm này parse tới 10 sheet từ 2 Google Sheets — theo
  // chính log Executions ghi nhận trong code, có thể mất tới ~184s/lượt khi bỏ qua
  // cache (forceRefresh=true). Trước đây KHÔNG kiểm tra quyền — ai gọi qua console
  // cũng được, và có thể spam forceRefresh=true liên tục để gây quá tải/hết quota
  // Apps Script cho toàn hệ thống (DoS). Thêm chặn: phải là user đã duyệt mới đọc
  // được (kể cả bản cache), và CHỈ ADMIN mới được ép refresh bỏ qua cache.
  // [FIX] Hàm này luôn trả về OBJECT thô (không JSON.stringify — xem return result ở
  // dưới) — dùng JSON.stringify ở đây từng làm sai hợp đồng, khiến JS_TaiLieu.html
  // nhận về string thay vì object, hiện sai thông báo lỗi (r.success luôn undefined).
  try { _requireApproved_(); } catch (eAuth) { return { success: false, version: 'v2-row-wide-real-links', error: eAuth.message }; }
  // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"]
  if (forceRefresh) {
    try { _requireAdmin_(2); } catch (eAdmin) { forceRefresh = false; } // không phải admin → âm thầm dùng bản cache thay vì lỗi cứng
  }
  var t0 = Date.now();
  // [FIX 2026-07-29] THÊM CACHE — trước đây hàm này parse lại 10 sheet từ 2 file
  // Google Sheets MỖI LẦN gọi, không có cache nào cả (log Executions ghi nhận
  // avg 54.6s, max 184.6s/lượt). Nội dung Tài Liệu/Roadmap ít khi đổi trong ngày
  // nên cache 30 phút là hợp lý — vẫn giữ đường "Tải lại" (nút wRb, gọi
  // wLoad(true) ở client) bỏ qua cache để admin thấy ngay nội dung vừa sửa.
  var WIKI_CACHE_KEY = 'doc_data_v2';
  var WIKI_CACHE_TTL = 1800; // 30 phút
  if (!forceRefresh) {
    var cached = CacheMgr.getChunked('WIKI', WIKI_CACHE_KEY);
    if (cached) return cached;
  }
  try {
    var ss1 = SpreadsheetApp.openByUrl(_WM);
    var ss2 = SpreadsheetApp.openByUrl(_WD);

    var raw = [];
    raw = raw.concat(_sopParse(ss1));
    raw = raw.concat(_rmParse(ss1, 'Roadmap Ob Lead', 'Roadmap Lead'));
    raw = raw.concat(_rmParse(ss1, 'Roadmap Ob Staff', 'Roadmap Staff'));
    raw = raw.concat(_dcParse(ss1));
    raw = raw.concat(_planParse(ss1));
    raw = raw.concat(_rankParse(ss1));
    raw = raw.concat(_tnParse(ss1));
    raw = raw.concat(_ttParse(ss1));
    raw = raw.concat(_pbParse(ss1));
    raw = raw.concat(_dlkParse(ss2));

    var out = _dedup(raw).map(function(it) {
      return {
        team: _normalizeTeam(it.team || 'Khac'),
        category: (it.category || 'Khac').toString().trim(),
        title: (it.title || '').toString().trim(),
        description: (it.description || '').toString(),
        links: _dedupLinks(it.links || []),
        sourceUrl: '',
        sourceName: ''
      };
    });

    var result = {
      success: true,
      version: 'v2-row-wide-real-links',
      total: out.length,
      data: out,
      tailTeams: _TAIL_TEAMS,
      debug: {
        ms: Date.now() - t0,
        withLinks: out.filter(function(x){ return x.links && x.links.length; }).length
      }
    };
    try { CacheMgr.setChunked('WIKI', WIKI_CACHE_KEY, result, WIKI_CACHE_TTL); } catch (eWc) {}
    return result;
  } catch (e) {
    return {
      success: false,
      version: 'v2-row-wide-real-links',
      error: e && e.stack ? e.stack : String(e),
      debug: { ms: Date.now() - t0 }
    };
  }
}

// ---------- ROW-WIDE LINK EXTRACTOR ----------
function _collectRowLinks(sheet, rowIndex, lastCol) {
  var out = [];
  if (!sheet || rowIndex < 1 || lastCol < 1) return out;

  var rg = sheet.getRange(rowIndex, 1, 1, lastCol);
  var rich = rg.getRichTextValues()[0];
  var formulas = rg.getFormulas()[0];
  var display = rg.getDisplayValues()[0];

  function add(url, name) {
    if (!url) return;
    url = String(url).trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (out.some(function(x){ return x.url === url; })) return;
    out.push({ url: url, name: (name || _gn(url) || 'Xem tai lieu').trim() });
  }

  for (var c = 0; c < lastCol; c++) {
    var f = formulas[c] || '';
    var rt = rich[c];
    var txt = (display[c] || '').toString().trim();

    if (f && /^=HYPERLINK\(/i.test(f)) {
      var m = f.match(/=HYPERLINK\s*\(\s*"([^"]+)"\s*[;,]\s*"([^"]*)"\s*\)/i);
      if (m && m[1]) add(m[1], m[2]);
    }

    if (rt) {
      try {
        var u = rt.getLinkUrl();
        if (u) add(u, (rt.getText() || '').trim());
      } catch(e) {}

      try {
        var runs = rt.getRuns ? rt.getRuns() : [];
        for (var j = 0; j < runs.length; j++) {
          var ru = runs[j].getLinkUrl();
          if (ru) add(ru, (runs[j].getText() || '').trim());
        }
      } catch(e) {}
    }

    if (txt) {
      var urls = txt.match(/https?:\/\/[^\s)\]]+/gi) || [];
      for (var k = 0; k < urls.length; k++) add(urls[k], _gn(urls[k]));
    }
  }

  return out;
}

function _ensureLinkFromRow(item, sheet, row, lastCol, carryLinks) {
  var links = _collectRowLinks(sheet, row, lastCol);
  if (!links.length && carryLinks && carryLinks.length) links = carryLinks.slice();
  item.links = _dedupLinks((item.links || []).concat(links));
  return item;
}

// ---------- PARSERS ----------
function _sopParse(ss) {
  var res = [], sh = ss.getSheetByName('SOP ( All FTE )');
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 4) return res;
  var lc = sh.getLastColumn();
  var data = sh.getRange(1, 1, lr, Math.min(lc, 10)).getDisplayValues();

  var lastTeam = '', lastCat = '', carry = [];
  for (var i = 3; i < lr; i++) {
    var row = data[i];
    var team = row[1] ? row[1].trim() : lastTeam;
    var cat  = row[2] ? row[2].trim() : lastCat;
    var title = row[4] ? row[4].trim() : '';
    var access = row[6] ? row[6].trim() : '';
    var date = row[7] ? row[7].trim() : '';
    if (team) lastTeam = team;
    if (cat) lastCat = cat;
    if (!title) continue;

    var desc = [];
    if (access && access.length < 80) desc.push('🔒 ' + access);
    if (date && date !== '0') desc.push('📅 ' + date);

    var it = {
      team: team || 'OPS',
      category: cat || 'Khac',
      title: title,
      description: desc.join('  '),
      links: [],
      _src: 'SOP'
    };

    it = _ensureLinkFromRow(it, sh, i + 1, lc, carry);
    if (it.links.length) carry = it.links.slice();
    res.push(it);
  }
  return res;
}

function _rmParse(ss, sheetName, targetTeam) {
  var res = [], sh = ss.getSheetByName(sheetName);
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 6) return res;
  var lc = sh.getLastColumn();
  var data = sh.getRange(1, 1, lr, Math.min(lc, 12)).getDisplayValues();

  var lastCat = '', carry = [];
  for (var i = 5; i < lr; i++) {
    var row = data[i];
    var cat = row[1] ? row[1].trim() : lastCat;
    var title = row[2] ? row[2].trim() : '';
    var outcome = row[8] ? row[8].trim() : '';
    if (!title) continue;

    var upper = title.toUpperCase();
    if (upper.includes('WEEK') && upper.includes('ACTIVIT')) continue;
    if (upper === 'CONTENTS' || upper === 'TOPIC') continue;
    if (cat) lastCat = cat;

    var it = {
      team: targetTeam,
      category: cat || 'General',
      title: title,
      description: outcome,
      links: [],
      _src: 'RM'
    };

    it = _ensureLinkFromRow(it, sh, i + 1, lc, carry);
    if (it.links.length) carry = it.links.slice();
    res.push(it);
  }
  return res;
}

function _dcParse(ss) {
  var SKIP = {'link':1,'tai lieu tham khao':1,'lien ket':1};
  var res = [], sh = ss.getSheetByName('Detail công việc hàng ngày') || ss.getSheetByName('Detail cÃ´ng viá»‡c hÃ ng ngÃ y');
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 3) return res;
  var lc = sh.getLastColumn();
  var data = sh.getRange(1, 1, lr, Math.min(lc, 9)).getDisplayValues();

  var lastTopic = '', lastCat = '', carry = [];
  for (var i = 2; i < lr; i++) {
    var row = data[i];
    var topic = row[0] ? row[0].trim() : lastTopic;
    var cat   = row[3] ? row[3].trim() : lastCat;
    var title = row[4] ? row[4].trim() : '';
    var outcome = row[6] ? row[6].trim() : '';
    if (topic) lastTopic = topic;
    if (cat) lastCat = cat;
    if (!title || title === '-') continue;
    if (SKIP[(title || '').toLowerCase()]) continue;

    var it = {
      team: 'Detail Cong Viec',
      category: cat || topic || 'Khac',
      title: title,
      description: outcome,
      links: [],
      _src: 'DC'
    };

    it = _ensureLinkFromRow(it, sh, i + 1, lc, carry);
    if (it.links.length) carry = it.links.slice();
    res.push(it);
  }
  return res;
}

function _dlkParse(ss) {
  var res = [], sh = ss.getSheetByName('Nội dung') || ss.getSheetByName('Ná»™i dung');
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 2) return res;
  var lc = sh.getLastColumn();
  var data = sh.getRange(1, 1, lr, Math.min(lc, 6)).getDisplayValues();

  var lastTeam = '', lastCat = '', carry = [];
  for (var i = 1; i < lr; i++) {
    var row = data[i];
    var team = row[0] ? row[0].trim() : lastTeam;
    var cat = row[1] ? row[1].trim() : lastCat;
    var title = row[2] ? row[2].trim() : '';
    var desc = row[3] ? row[3].toString().replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
    if (team) lastTeam = team;
    if (cat) lastCat = cat;

    if (title) {
      var it = {
        team: team || 'Khac',
        category: cat || 'Khac',
        title: title,
        description: desc,
        links: [],
        _src: 'DLK'
      };

      it = _ensureLinkFromRow(it, sh, i + 1, lc, carry);
      if (it.links.length) carry = it.links.slice();
      res.push(it);
    } else if (res.length > 0 && desc) {
      var prev = res[res.length - 1];
      if (!prev.description.includes(desc.slice(0, 20))) {
        prev.description = prev.description ? prev.description + '\n' + desc : desc;
      }
    }
  }
  return res;
}

// ---------- INFO SHEETS ----------
function _planParse(ss) {
  var res = [], sh = ss.getSheetByName('Plan đào tạo Staff->Lead') || ss.getSheetByName('Plan Ä‘Ã o táº¡o Staff->Lead');
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 2) return res;
  var data = sh.getRange(2, 1, lr - 1, 8).getDisplayValues();

  var lastWeek = '';
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var week = row[0] ? row[0].trim() : lastWeek;
    var phase = row[1] ? row[1].trim() : '';
    var focus = row[2] ? row[2].trim() : '';
    var goal = row[3] ? row[3].trim() : '';
    var content = row[4] ? row[4].trim() : '';
    var reviewer = row[7] ? row[7].trim() : '';
    if (week) lastWeek = week;
    if (!focus) continue;

    var desc = [];
    if (phase) desc.push('📌 ' + phase);
    if (goal) desc.push('🎯 ' + goal);
    if (content) desc.push(content.slice(0, 120));
    if (reviewer) desc.push('Reviewer: ' + reviewer);

    res.push({ team:'Plan Dao Tao Staff->Lead', category:week || 'General', title:focus, description:desc.join('  ·  '), links:[], _src:'PLAN' });
  }
  return res;
}

function _rankParse(ss) {
  var res = [], sh = ss.getSheetByName('Quy đổi ranking') || ss.getSheetByName('Quy Ä‘á»•i ranking');
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 3) return res;
  var data = sh.getRange(3, 1, lr - 2, 7).getDisplayValues();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var rank = row[0] ? row[0].trim() : '';
    var score = row[1] ? row[1].trim() : '';
    if (rank && score) res.push({ team:'Quy Doi Ranking', category:'KPI Ranking', title:rank, description:'Diem: ' + score, links:[], _src:'RANK' });

    var prank = row[2] ? row[2].trim() : '';
    var pscore = row[3] ? row[3].trim() : '';
    if (prank && pscore) res.push({ team:'Quy Doi Ranking', category:'Performance Ranking', title:prank, description:'Diem: ' + pscore, links:[], _src:'RANK' });

    var result = row[5] ? row[5].trim() : '';
    var scard = row[6] ? row[6].trim() : '';
    if (result && scard) res.push({ team:'Quy Doi Ranking', category:'Scorecard', title:result, description:'Scorecard: ' + scard, links:[], _src:'RANK' });
  }
  return res;
}

function _tnParse(ss) {
  var res = [], sh = ss.getSheetByName('Thuật ngữ/Từ viết tắt') || ss.getSheetByName('Thuáº­t ngá»¯/Tá»« viáº¿t táº¯t') || ss.getSheetByName('Thuáº­t ngá»¯Tá»« viáº¿t táº¯t');
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 2) return res;
  var data = sh.getRange(2, 2, lr - 1, 2).getDisplayValues();

  for (var i = 0; i < data.length; i++) {
    var word = data[i][0] ? data[i][0].trim() : '';
    var meaning = data[i][1] ? data[i][1].trim() : '';
    if (!word || word.toLowerCase() === 'word') continue;
    res.push({ team:'Thuat Ngu & Tu Viet Tat', category:'Glossary', title:word, description:meaning, links:[], _src:'TN' });
  }
  return res;
}

function _ttParse(ss) {
  var res = [], sh = ss.getSheetByName('Ý nghĩa các trạng thái đơn hàng') || ss.getSheetByName('Ã nghÄ©a cÃ¡c tráº¡ng thÃ¡i Ä‘Æ¡n hÃ ng');
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 3) return res;
  var data = sh.getRange(3, 1, lr - 2, 3).getDisplayValues();

  for (var i = 0; i < data.length; i++) {
    var status = data[i][0] ? data[i][0].trim() : '';
    var pic = data[i][1] ? data[i][1].trim() : '';
    var desc = data[i][2] ? data[i][2].trim() : '';
    if (!status || status === 'STATUS') continue;
    res.push({ team:'Trang Thai Don Hang', category:pic || 'General', title:status, description:desc, links:[], _src:'TT' });
  }
  return res;
}

function _pbParse(ss) {
  var res = [], sh = ss.getSheetByName('Các phòng ban và chức năng') || ss.getSheetByName('CÃ¡c phÃ²ng ban vÃ  chá»©c nÄƒng');
  if (!sh) return res;
  var lr = sh.getLastRow();
  if (lr < 2) return res;
  var data = sh.getRange(2, 1, lr - 1, 5).getDisplayValues();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var dept = row[0] ? row[0].trim() : '';
    var func = row[1] ? row[1].trim() : '';
    var groups = row[2] ? row[2].toString().replace(/[\r\n]+/g, ', ').trim() : '';
    var lead = row[3] ? row[3].trim() : '';
    var pic = row[4] ? row[4].toString().replace(/[\r\n]+/g, ', ').trim() : '';
    if (!dept || dept === 'Phong ban') continue;

    var parts = [];
    if (groups && groups !== '-') parts.push(groups);
    if (lead) parts.push('Lead: ' + lead);
    if (pic) parts.push('PIC: ' + pic);

    res.push({ team:'Phong Ban & Chuc Nang', category:dept, title:func || dept, description:parts.join(' | '), links:[], _src:'PB' });
  }
  return res;
}

// ---------- DEDUP / NORMALIZE ----------
function _mergeLinks(target, source) {
  (source || []).forEach(function(l) {
    if (!l || !l.url) return;
    if (!target.some(function(ex) { return ex.url === l.url; })) target.push(l);
  });
}

function _dedup(items) {
  var seen = {}, res = [];
  (items || []).forEach(function(it) {
    var team = _normalizeTeam(it.team || 'Khac');
    var title = (it.title || '').toLowerCase().trim();
    if (!title) return;
    var key = team.toLowerCase() + '|||' + title;

    if (seen[key] !== undefined) {
      var ex = res[seen[key]];
      if (it.description && !ex.description) ex.description = it.description;
      else if (it.description && ex.description && ex.description.indexOf(it.description.slice(0, 25)) < 0) ex.description += ' | ' + it.description;
      _mergeLinks(ex.links, it.links);
      if (it.category && ex.category === 'Khac') ex.category = it.category;
    } else {
      seen[key] = res.length;
      res.push({
        team: team,
        category: it.category || 'Khac',
        title: it.title || '',
        description: it.description || '',
        links: _dedupLinks(it.links || []),
        _src: it._src || ''
      });
    }
  });
  return res;
}

function _dedupLinks(links) {
  var byUrl = {};
  (links || []).forEach(function(l) {
    if (!l || !l.url) return;
    var u = String(l.url).trim();
    if (!/^https?:\/\//i.test(u)) return;
    if (!byUrl[u]) byUrl[u] = { url: u, name: l.name || _gn(u) };
  });
  return Object.keys(byUrl).map(function(k){ return byUrl[k]; });
}

function _normalizeTeam(raw) {
  if (!raw) return 'Khac';
  var k = raw.toLowerCase().trim();
  return _WN[k] || raw.trim();
}

function _gn(url) {
  if (!url) return 'Xem tai lieu';
  var u = String(url).toLowerCase();
  if (u.indexOf('spreadsheets') >= 0) return 'Google Sheet';
  if (u.indexOf('/document') >= 0) return 'Google Doc';
  if (u.indexOf('presentation') >= 0) return 'Google Slides';
  if (u.indexOf('/forms') >= 0) return 'Google Form';
  if (u.indexOf('drive.google') >= 0) return 'Google Drive';
  if (u.indexOf('youtube') >= 0 || u.indexOf('youtu.be') >= 0) return 'Video';
  if (u.indexOf('.pdf') >= 0) return 'PDF';
  try { return url.split('/')[2].replace('www.', '') || 'Xem'; }
  catch(e) { return 'Xem tai lieu'; }
}
// ============================================================

// --- MODULE 6: MA TRẬN GIÁ (LƯƠNG) ---

// ============================================================

function normalizeKey(str) {

  if (!str) return "";

  var m = str.toString().match(/\d+/g);

  return m ? m.join('-') : str.toString().replace(/[\s'"]/g,"").toLowerCase();

}

function getFeeMatrix() {

  try {

    // [SECURITY FIX 2026-08] Bảng hệ số/điểm tính lương là dữ liệu nhạy cảm riêng
    // của module Lương — trước đây hàm này KHÔNG kiểm tra spx_checkLuongAccess(),
    // nên bất kỳ user "Duyệt" chung (chưa chắc được cấp quyền Lương) cũng gọi thẳng
    // được qua console và lấy toàn bộ bảng phí, bỏ qua hẳn cổng phân quyền riêng
    // mà JS_Luong.html chỉ đang enforce ở phía giao diện.
    if (spx_checkLuongAccess() !== 'granted') {
      return { success: false, error: 'Không có quyền truy cập dữ liệu Lương.' };
    }

    var ss      = SpreadsheetApp.openByUrl(DB_FEE_URL);

    var matrix  = { "deli":{}, "pickup":{}, "return":{} };

    var mapping = { "Data Giao":"deli", "Data Lấy":"pickup", "Data Trả":"return" };

    for (var tab in mapping) {

      var sheet = ss.getSheetByName(tab); if (!sheet) continue;

      var data  = sheet.getDataRange().getValues();

      var dataStart = -1;

      for (var r = 0; r < Math.min(10, data.length); r++) {

        if (!isNaN(parseFloat(data[r][0])) && data[r][0] !== "") { dataStart = r; break; }

      }

      if (dataStart < 1) continue;

      var headers = data[dataStart-1];

      for (var i = dataStart; i < data.length; i++) {

        var min = parseFloat(data[i][0]); var max = parseFloat(data[i][1]);

        if (isNaN(max) || data[i][1] === "") max = 999999;

        for (var j = 2; j < headers.length; j++) {

          var weightKey = normalizeKey(headers[j]); var points = parseFloat(data[i][j]);

          if (!weightKey || isNaN(points)) continue;

          var code = mapping[tab];

          if (!matrix[code][weightKey]) matrix[code][weightKey] = [];

          matrix[code][weightKey].push({ min, max, points });

        }

      }

    }

    return { success: true, data: matrix };

  } catch (e) { return { success: false, error: e.message }; }

}

