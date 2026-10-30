// ============================================================
// MODULE: PICK — LIVE (sheet "3. FM action realtime")
// ============================================================
// [KIẾN TRÚC LẠI 2026-07-23 — HIỆU NĂNG, sheet đã vượt >100k dòng]
// TRƯỚC ĐÂY: mỗi request user (pick_getLiveData) tự quét lại TOÀN BỘ sheet,
// build object cho MỌI dòng rồi mới lọc theo trạm sau, và cache qua
// CacheMgr.setChunked() (giới hạn cứng 40 chunk x 90KB ≈ 3.6MB). Ở quy mô
// >100k dòng, JSON vượt xa 3.6MB nên setChunked() luôn trả false lặng lẽ —
// cache KHÔNG BAO GIỜ hit nữa, mọi lần mở tab Live đều full-scan sheet.
//
// GIỜ: áp dụng lại đúng kiến trúc đã dùng cho module FMS Live (sheet
// 200k+ dòng, xem _fmsLive_buildRawSnapshot_ / _fmsLive_getHubsDataCached_
// phía trên) — tái dùng CHUNG các helper cache vật lý _fmsLive_writeChunkedJson_
// / _fmsLive_readChunkedJson_ / _fmsLive_readChunkedJsonBatch_ (đã tổng quát
// hoá theo prefix, không riêng cho FMS):
//   1) Quét sheet 1 LẦN DUY NHẤT ở tiến trình NỀN (trigger 5 phút/lần,
//      pick_live_prewarmCache), gom dữ liệu theo TỪNG TRẠM, ghi cache riêng
//      từng trạm — KHÔNG còn cache theo user.
//   2) Request của user KHÔNG BAO GIỜ tự quét sheet. Cache miss -> trả về
//      "chưa sẵn sàng" ngay lập tức thay vì bắt user chờ.
//   3) User (KỂ CẢ ADMIN) phải chủ động CHỌN TRẠM muốn xem — không còn
//      nhánh "tải tất cả" ngầm định. pick_live_getStations() trả danh sách
//      trạm (+ số đơn) để FE hiển thị bộ chọn; pick_live_getStationData()
//      chỉ trả dữ liệu của (những) trạm được chọn VÀ nằm trong quyền thực
//      tế của user (server luôn ép giao, không tin dữ liệu FE gửi lên).
//   4) Đọc sheet bằng getValues() THÔ (bỏ hẳn getDisplayValues()) — nhanh
//      hơn đáng kể ở quy mô lớn vì không tốn chi phí format từng cell theo
//      locale. Cell kiểu Date được quy về epoch ms (number), FE tự format
//      hiển thị (xem fmtDT() trong renderLiveTablePICK, JS_Pick.html).
//
// Cấu trúc sheet: A1 = dòng ghi chú lịch cập nhật, HEADER THẬT ở ROW 2,
// dữ liệu bắt đầu ROW 3. Cột A→P:
//   A shipment_id | B station_name | C created_time | D pickup_done
//   E inbound_time | F last_touch_at | G fleet_final_status | H shop_id
//   I product_name | J order_type | K action_needed | L depart_time_1
//   M depart_time_2 | N lh_packed | O aom | P sup
//
// Phân quyền dùng LẠI đúng getModuleAccess() (3 tầng admin/aom/sup/station)
// và _normStationKey_() để lọc theo station_name — giống hệt cách
// aging_getMasterData() lọc fmData theo hub.

var PICK_LIVE_INDEX_KEY = 'pick_live_index_v1';
var PICK_LIVE_CACHE_TTL = 3600; // [FIX 2026-08-01] 60 phút — dư so với chu kỳ trigger nền MỚI 30 phút (đủ dư nếu 1 lượt trigger lỡ nhịp, hoặc bị bỏ qua vì khung giờ vắng)
var PICK_LIVE_SS_ID = '1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA';
var PICK_LIVE_MAX_HUBS_PER_CALL = 30; // chặn 1 lần gọi kéo quá nhiều trạm cùng lúc

// Sanitizer key cache riêng cho Pick Live — CỐ Ý không dùng _normStationKey_()
// (hàm đó bỏ dấu + bỏ hậu tố để so khớp MỜ, 2 trạm khác nhau có thể trùng key,
// chấp nhận được khi SO KHỚP quyền nhưng làm cache key thì sẽ đè dữ liệu nhau).
function _pickLive_hubCacheKey_(stationName) {
  var s = (stationName || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return 'pick_live_hub_' + s + '_v1';
}

// Quy 1 cell thô về dạng gọn cho JSON: Date -> epoch ms (number, FE tự format),
// null/undefined -> '', còn lại giữ nguyên (string/number).
function _pickLiveCellOut_(v) {
  if (v instanceof Date) return v.getTime();
  if (v === null || v === undefined) return '';
  return v;
}

/**
 * _pickLive_buildRawSnapshot_()
 * Quét TOÀN BỘ sheet 1 LẦN, gom theo trạm. CHỈ gọi từ tiến trình nền
 * (pick_live_prewarmCache, qua trigger) hoặc thủ công từ Apps Script editor
 * khi cần build ngay — KHÔNG BAO GIỜ gọi trực tiếp từ 1 request user thường.
 */
function _pickLive_buildRawSnapshot_() {
  try {
    var ss = _DS.ss(PICK_LIVE_SS_ID);
    var sheet = ss.getSheetByName('3. FM action realtime');
    if (!sheet) return { success: false, error: "Không thấy sheet '3. FM action realtime'" };
    var lastRow = sheet.getLastRow();
    var updatedNote = sheet.getRange(1, 1).getDisplayValue() || '';
    if (lastRow < 3) return { success: true, hubs: [], counts: {}, data: {}, updatedNote: updatedNote, generatedAt: Date.now() };

    // [FIX 2026-07-30] NGÂN SÁCH THỜI GIAN — trước đây đọc TOÀN BỘ sheet trong 1
    // lệnh getRange().getValues() duy nhất, không có điểm dừng nào. Log Executions
    // xác nhận đã có lượt build mất 606.9s (>10 phút) — cùng lớp rủi ro đã gặp và
    // vá ở KPI Fail (nguy cơ chạm trần cứng 30 phút khi sheet tiếp tục lớn thêm).
    // Đọc theo lô, dừng SỚM nếu vượt ngân sách — trả về snapshot PARTIAL (thiếu 1
    // phần trạm ở cuối sheet) thay vì có nguy cơ timeout. Vì cache này BUILD LẠI
    // TOÀN BỘ mỗi 5 phút (không có incremental merge như KPI Fail), thiếu 1 phần ở
    // lượt này chỉ khiến các trạm đó "cũ hơn 1 chu kỳ" — tự khỏi ở lượt kế tiếp,
    // không cần logic tiếp tục phức tạp.
    var _startTime = Date.now();
    var _timeBudgetMs = 270000; // 4.5 phút — cùng mức đã dùng cho KPI Fail
    // [FIX — đo thật: max 398.6s, VẪN vượt 330s lý thuyết (đọc 4.5p + ghi 1p) dù
    // đã có ngân sách] Nguyên nhân: kiểm tra ngân sách chỉ diễn ra GIỮA CÁC BATCH,
    // không ngắt được 1 lệnh getValues() đang chạy giữa chừng (Apps Script không
    // hỗ trợ huỷ đồng bộ). Nếu đã dùng gần hết ngân sách (vd 260/270s) và Sheets
    // API đang chậm bất thường, 1 batch 20.000 dòng cuối có thể tự nó mất thêm
    // hàng chục giây, đẩy tổng vượt xa lý thuyết. Giảm batch 20.000 -> 10.000 để
    // giảm MỘT NỬA biên độ "vượt quá" tối đa có thể xảy ra ở batch cuối cùng.
    var _batchRows = 10000;
    var numRows = lastRow - 2; // từ row 3 (data thật) .. lastRow
    var _reachedRow = 2;
    var _budgetExceeded = false;
    var byStation = Object.create(null); // { normKey: { name, rows:[] } }

    // [SỬA] Dò cột theo TIÊU ĐỀ (dòng 2) — xem _spx_findCols_(). Trước đây đọc A-K cố định.
    var _hdrA = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
    var A = _spx_findCols_(_hdrA, _SPX_SPEC_FMACT_);
    _spx_requireCols_("Sheet '3. FM action realtime'", A, _SPX_REQ_FMACT_, _hdrA);
    var _wA = Math.min(sheet.getMaxColumns(), _spx_maxIdx_(A) + 1);
    var _ga = function (r, k) { return A[k] === undefined ? undefined : r[A[k]]; };

    var _row = 3;
    while (_row <= lastRow) {
      if (Date.now() - _startTime > _timeBudgetMs) { _budgetExceeded = true; break; }
      var _batchSize = Math.min(_batchRows, lastRow - _row + 1);
      // [FIX 2026-07-30] Thu hẹp phạm vi đọc từ 16 xuống 11 cột (A-K) — đối chiếu
      // JS_Pick.html + toàn bộ backend.gs xác nhận 8 field (shopId, pickupDone,
      // inboundTime, departTime1/2, lhPacked, aom, sup) KHÔNG được đọc ở BẤT KỲ
      // đâu (cả client lẫn server) — 5 field cuối (departTime1/2, lhPacked, aom,
      // sup, cột L-P) nằm cuối dải nên bỏ hẳn được khỏi phạm vi đọc; giảm ~31%
      // lượng dữ liệu tải về cho đúng lượt đọc nặng nhất hệ thống (>100k dòng).
      // [PERF] getValues() THÔ, KHÔNG getDisplayValues() — bỏ chi phí format từng
      // cell theo locale sheet, quan trọng ở quy mô >100k dòng.
      var values = sheet.getRange(_row, 1, _batchSize, _wA).getValues();

      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        var shipmentId = _ga(row, 'id');
        if (!shipmentId || shipmentId.toString().trim() === '') continue;
        var stationName = _ga(row, 'station') ? _ga(row, 'station').toString().trim() : '';
        var hubKey = _normStationKey_(stationName, { pakFix: false, stripSuffix: false });
        if (!hubKey) continue; // dòng không xác định được trạm -> bỏ qua

        var rec = {
          shipmentId:       shipmentId.toString().trim(),
          stationName:      stationName,
          createdTime:      _pickLiveCellOut_(_ga(row, 'created')),
          lastTouchAt:      _pickLiveCellOut_(_ga(row, 'last')),
          fleetFinalStatus: _ga(row, 'status') ? _ga(row, 'status').toString().trim() : '',
          productName:      _ga(row, 'product') ? _ga(row, 'product').toString().trim() : '',
          orderType:        _ga(row, 'otype') ? _ga(row, 'otype').toString().trim() : '',
          actionNeeded:     _ga(row, 'action') ? _ga(row, 'action').toString().trim() : ''
        };

        if (!byStation[hubKey]) byStation[hubKey] = { name: stationName, rows: [] };
        byStation[hubKey].rows.push(rec);
      }

      _reachedRow = _row + _batchSize - 1;
      _row += _batchSize;
    }

    var hubs = [];
    var counts = {};
    var dataByStationName = {};
    Object.keys(byStation).forEach(function (k) {
      var b = byStation[k];
      hubs.push(b.name);
      counts[b.name] = b.rows.length;
      dataByStationName[b.name] = b.rows;
    });
    hubs.sort();

    if (_budgetExceeded) {
      _LOG.d('[Pick Live Prewarm] Hết ngân sách thời gian ở dòng ' + _reachedRow + '/' + lastRow + ' — snapshot lần này thiếu 1 phần, tự đầy đủ lại ở chu kỳ 5 phút kế tiếp.');
    }

    return {
      success: true,
      hubs: hubs,
      counts: counts,
      data: dataByStationName,
      updatedNote: updatedNote,
      generatedAt: Date.now(),
      partial: _budgetExceeded
    };
  } catch (e) {
    return { success: false, error: e.message, stack: e.stack || '' };
  }
}

// Ghi index (nhẹ — chỉ danh sách trạm + đếm) + cache riêng từng trạm, cùng TTL.
function _pickLive_writeSnapshotPerHub_(fresh) {
  var indexPayload = {
    success: true,
    hubs: fresh.hubs,
    counts: fresh.counts,
    updatedNote: fresh.updatedNote,
    generatedAt: fresh.generatedAt
  };
  try { _fmsLive_writeChunkedJson_(PICK_LIVE_INDEX_KEY, JSON.stringify(indexPayload), PICK_LIVE_CACHE_TTL); } catch (e) {}
  // [FIX — đo thật: max 361.2s, VƯỢT trần cứng 360s (6 phút) của GAS] Bước đọc
  // sheet đã có ngân sách 4.5 phút (xem _pickLive_buildRawSnapshot_), nhưng bước
  // GHI CACHE RIÊNG TỪNG TRẠM này trước đây KHÔNG CÓ ngân sách gì — với mục tiêu
  // quy mô 1.000 trạm, forEach ghi JSON.stringify + cache phân mảnh cho từng trạm
  // có thể cộng thêm nhiều phút SAU KHI đọc đã dùng hết 4.5 phút, đẩy tổng vượt
  // trần. Nay có ngân sách RIÊNG cho bước ghi — dừng sớm nếu vượt, các trạm chưa
  // ghi kịp giữ nguyên cache cũ (chỉ "cũ hơn 1 chu kỳ"), tự đầy đủ lại ở lượt kế
  // tiếp — CÙNG cách đánh đổi đã áp dụng an toàn cho bước đọc phía trên.
  var _wStart = Date.now();
  var _wBudgetMs = 60000; // 1 phút — đủ cho đa số trạm, chừa biên độ an toàn thật cho bước đọc
  var _wSkipped = 0;
  for (var _wi = 0; _wi < fresh.hubs.length; _wi++) {
    if (Date.now() - _wStart > _wBudgetMs) { _wSkipped = fresh.hubs.length - _wi; break; }
    var h = fresh.hubs[_wi];
    try { _fmsLive_writeChunkedJson_(_pickLive_hubCacheKey_(h), JSON.stringify(fresh.data[h]), PICK_LIVE_CACHE_TTL); } catch (e) {}
  }
  if (_wSkipped > 0) {
    _LOG.d('[Pick Live Prewarm] Hết ngân sách ghi — bỏ qua ' + _wSkipped + '/' + fresh.hubs.length + ' trạm cuối, tự cập nhật ở chu kỳ kế tiếp.');
  }
}

// Biến tạm TRONG PHẠM VI 1 LẦN THỰC THI — nếu vừa build fresh trong CHÍNH
// request này (forceRefresh), các bước đọc dữ liệu ngay sau đó khỏi phải
// đọc lại cache vừa ghi. Mỗi request GAS chạy execution context riêng nên
// biến top-level này không rò rỉ/lẫn giữa các request khác nhau.
var _pickLive_lastFreshBuild_ = null;

// [FIX 2026-07-29] Khung giờ CHẮC CHẮN vắng user (theo xác nhận thực tế: 23:00 -
// 05:00) — dùng chung cho 4 trigger prewarm (kpifail/aging/fms_live/pick_live).
// Các trigger này chỉ tồn tại để làm nóng cache CHO REQUEST SẮP TỚI của user —
// nếu chắc chắn không có user nào trong khung giờ này, làm nóng cache là lãng
// phí thuần túy (vẫn tốn execution, cộng vào tổng thời lượng thực thi/ngày,
// góp phần vào áp lực giới hạn 1000 lệnh đồng thời). Bỏ qua theo lịch KHÔNG làm
// mất dữ liệu gì — nếu lỡ có ai mở app đúng lúc này, họ vẫn được phục vụ bình
// thường, chỉ là đọc cold (y hệt cache hết hạn bình thường) thay vì cache đã ấm sẵn.
function _spxIsPrewarmQuietHours_() {
  try {
    var h = Number(Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'H'));
    return (h >= 23 || h < 5);
  } catch (e) {
    return false; // lỗi đọc giờ -> an toàn hơn là KHÔNG bỏ qua, cứ chạy như bình thường
  }
}

// ============================================================
// [MỚI 2026-07-30] ĐO TẦN SUẤT SỬ DỤNG MODULE — theo (giờ, module, vai trò, trạm)
// ============================================================
var USAGE_STATS_SHEET   = 'Usage_Stats';
var USAGE_BUFFER_TTL_S  = 7200; // 2 tiếng — dư dả so với chu kỳ flush 10 phút

/**
 * spx_trackModuleOpen(moduleKey) — ĐIỂM GHI NHẬN DUY NHẤT của thống kê tần suất.
 * [SỬA LỖI THẬT — báo cáo: "1.509 lượt trong 7 ngày, làm sao mở nhiều vậy?"]
 * Trước đây lượt mở được ghi BÊN TRONG các hàm LẤY DỮ LIỆU. Nhiều hàm trong số đó
 * chạy mỗi lần tải Tổng quan (thẻ KPI Fail / Vi phạm / Cầu cứu) hoặc mỗi lượt đồng
 * bộ nền -> con số đo được là "số lần hệ thống lấy dữ liệu", KHÔNG phải "số lần
 * người dùng mở module". Admin mở Tổng quan nhiều nhất nên luôn đứng đầu bảng.
 * Nay CHỈ ghi khi người dùng bấm mở module thật (gọi từ openModule() ở giao diện),
 * kèm CHỐNG ĐẾM TRÙNG: mỗi người + mỗi module chỉ tính 1 lượt trong 10 phút, để
 * việc vẽ lại màn hình hay bấm qua lại không thổi phồng số.
 */
var SPX_OPEN_DEDUPE_SECONDS = 600;
function spx_trackModuleOpen(moduleKey) {
  try {
    moduleKey = String(moduleKey || '').trim();
    if (!moduleKey) return;
    var access = getModuleAccess();
    var email = (access && access.email) || 'unknown';
    var dedupeKey = 'open_seen_' + moduleKey + '_' + String(email).replace(/[^a-z0-9]/gi, '_');
    var sc = CacheService.getScriptCache();
    if (sc.get(dedupeKey)) return;                 // đã tính trong 10 phút gần đây
    sc.put(dedupeKey, '1', SPX_OPEN_DEDUPE_SECONDS);
    _spx_trackModuleUsage_(moduleKey, access);
  } catch (e) {}
}

function _spx_trackModuleUsage_(moduleKey, access) {
  try {
    var role = (access && access.role) || 'unknown';
    var email = (access && access.email) || 'unknown';
    var station;
    if (access && access.role === 'admin') {
      station = 'ALL(admin)';
    } else if (access && access.hubs && access.hubs.length === 1) {
      station = access.hubs[0];
    } else if (access && access.hubs && access.hubs.length > 1) {
      station = 'ALL(' + access.hubs.length + ' trạm)';
    } else {
      station = 'unknown';
    }
    var tz = 'Asia/Ho_Chi_Minh';
    var now = new Date();
    var hourKey = Utilities.formatDate(now, tz, 'yyyyMMddHH');
    var cacheKey = 'usage_buf_' + hourKey;
    // [FIX 2026-07-31] Thêm email vào tổ hợp đếm — trước chỉ có (module, vai
    // trò, trạm), không biết CHÍNH XÁC ai truy cập (đặc biệt user quản nhiều
    // trạm/admin đều gộp chung "ALL"). Email không chứa ký tự '|' nên an toàn
    // khi ghép/tách bằng dấu này.
    var comboKey = moduleKey + '|' + role + '|' + station + '|' + email;

    // [FIX HIỆU NĂNG THẬT — xác nhận qua báo cáo trực tiếp "gần như toàn bộ
    // module load chậm đồng bộ", đúng ngay sau khi tracking được mở rộng từ 3
    // lên 12 module] Buffer usage chỉ vài KB (không bao giờ gần ngưỡng chunk
    // 90KB) nhưng lại dùng getChunked/setChunked — tốn 3 lượt gọi CacheService
    // API/lần thay vì 1. Hàm này giờ chạy ở MỌI lần tải dữ liệu thật của cả 12
    // module (trước chỉ 3), nên overhead này nhân lên rõ rệt. Đổi sang get/set
    // đơn giản — đúng loại dữ liệu nhỏ này cần dùng.
    var buf = CacheMgr.get('USAGE', cacheKey) || {};
    buf[comboKey] = (buf[comboKey] || 0) + 1;
    CacheMgr.set('USAGE', cacheKey, buf, USAGE_BUFFER_TTL_S);
  } catch (e) {
    // Thống kê phụ — lỗi ở đây không được phép ảnh hưởng tới việc mở module thật.
  }
}

function _spx_getUsageStatsSheet_() {
  var ss = _DS.ss(ADMIN_DB_ID);
  var sheet = ss.getSheetByName(USAGE_STATS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(USAGE_STATS_SHEET);
    sheet.appendRow(['Ngày', 'Giờ', 'Module', 'Vai trò', 'Trạm', 'Email', 'Số lượt mở']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  return sheet;
}

/**
 * spx_diagUsageStats() — CHẠY THỦ CÔNG (chọn hàm rồi bấm Run).
 * [MỚI — kèm bản sửa "tần suất = 0"] Cho biết ngay: bộ đệm giờ này đang giữ bao
 * nhiêu lượt, sheet đã có bao nhiêu dòng, lần ghi xuống gần nhất là giờ nào — và
 * GHI XUỐNG LUÔN cả giờ hiện tại để kiểm chứng mà không phải đợi hết giờ.
 */
function spx_diagUsageStats() {
  var out = {};
  try {
    var tz = 'Asia/Ho_Chi_Minh', now = new Date();
    var hourNow = Utilities.formatDate(now, tz, 'yyyyMMddHH');
    var bufNow = CacheMgr.get('USAGE', 'usage_buf_' + hourNow) || {};
    out.gioHienTai = hourNow;
    out.luotDangChoTrongBoDem = Object.keys(bufNow).length;
    out.chiTietChoGhi = Object.keys(bufNow).slice(0, 10).map(function (k) { return k + ' = ' + bufNow[k]; });
    out.lanGhiGanNhat = PropertiesService.getScriptProperties().getProperty('usage_last_flushed_hour') || '(chưa lần nào)';
    var sheet = _spx_getUsageStatsSheet_();
    out.soDongTrongSheet = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;

    // Ghi xuống ngay cả giờ hiện tại (bình thường job chỉ ghi giờ TRƯỚC).
    if (Object.keys(bufNow).length) {
      var rows = [];
      var dateStr = hourNow.substring(0, 4) + '-' + hourNow.substring(4, 6) + '-' + hourNow.substring(6, 8);
      var hourStr = hourNow.substring(8, 10) + 'h';
      Object.keys(bufNow).forEach(function (comboKey) {
        var parts = comboKey.split('|');
        rows.push([dateStr, hourStr, parts[0] || '', parts[1] || '', parts[2] || '', parts[3] || '', bufNow[comboKey]]);
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
      try { CacheMgr.invalidate('USAGE', 'usage_buf_' + hourNow); } catch (eI) {}
      out.vuaGhiXuong = rows.length + ' dòng';
    } else {
      out.vuaGhiXuong = '0 dòng (bộ đệm giờ này đang trống)';
    }
    out.ketLuan = (out.soDongTrongSheet > 0 || Object.keys(bufNow).length)
      ? 'Luồng ghi nhận hoạt động. Mở lại tab Tần suất để xem.'
      : 'Chưa có lượt nào được ghi — hãy mở vài module rồi chạy lại hàm này.';
  } catch (e) { out.loi = e.message; }
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

function spx_usageStats_flushBuffer() {
  // [SECURITY FIX 2026-08] Trước đây không kiểm tra quyền. Rủi ro thấp (tự giới hạn
  // theo giờ + named lock) nhưng thêm chặn cho đồng bộ với các job nền khác.
  _requireAdminIfInteractive_(2);   // [SỬA] job nền không có người đăng nhập
  var gotLock = _anaAcquireNamedLock('usage_stats_flush_lock_v1', 5000);
  if (!gotLock) return;
  try {
    var tz = 'Asia/Ho_Chi_Minh';
    var now = new Date();
    var prevHourDate = new Date(now.getTime() - 3600000);
    var targetHourKey = Utilities.formatDate(prevHourDate, tz, 'yyyyMMddHH');

    var props = PropertiesService.getScriptProperties();
    var lastFlushed = props.getProperty('usage_last_flushed_hour') || '';
    if (targetHourKey <= lastFlushed) return;

    var buf = CacheMgr.get('USAGE', 'usage_buf_' + targetHourKey);
    if (buf) {
      var dateStr = targetHourKey.substring(0, 4) + '-' + targetHourKey.substring(4, 6) + '-' + targetHourKey.substring(6, 8);
      var hourStr = targetHourKey.substring(8, 10) + 'h';
      var rows = [];
      Object.keys(buf).forEach(function (comboKey) {
        var parts = comboKey.split('|');
        rows.push([dateStr, hourStr, parts[0] || '', parts[1] || '', parts[2] || '', parts[3] || '', buf[comboKey]]);
      });
      if (rows.length) {
        var sheet = _spx_getUsageStatsSheet_();
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
      }
      try { CacheMgr.invalidate('USAGE', 'usage_buf_' + targetHourKey); } catch (eInv) {}
    }
    props.setProperty('usage_last_flushed_hour', targetHourKey);
  } catch (e) {
    _LOG.d('[Usage Stats Flush] ERROR: ' + e.message);
  } finally {
    _anaReleaseNamedLock('usage_stats_flush_lock_v1');
  }
}

function setupUsageStatsFlushTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'spx_usageStats_flushBuffer') ScriptApp.deleteTrigger(t);
  });
  // [SỬA 2026-10] spx_usageStats_flushBuffer ĐÃ nằm trong spxDispatcher10Min() — tạo thêm trigger
  // riêng làm nó chạy 2 lần mỗi 10 phút (xác nhận qua Executions). Nay hàm này chỉ đảm bảo trigger
  // GỘP tồn tại, KHÔNG tạo trigger riêng nữa.
  var _hasDisp = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'spxDispatcher10Min'; });
  if (!_hasDisp) { spxInstallDispatcher10Min(); }
  _LOG.d('✅ spx_usageStats_flushBuffer chạy qua spxDispatcher10Min (mỗi 10 phút) — không cài trigger riêng.');
  return 'spx_usageStats_flushBuffer chạy trong spxDispatcher10Min (mỗi 10 phút); đã gỡ trigger riêng nếu có. Xem kết quả trong sheet "Usage_Stats".';
}

/**
 * spx_checkUsageStatsTriggerStatus()
 * [MỚI — phát hiện qua câu hỏi trực tiếp "có sai lệch gì không?"] setupUsageStatsFlushTrigger()
 * là hàm CÀI ĐẶT 1 LẦN, phải chạy tay trong Apps Script Editor — KHÔNG có cách
 * nào để biết từ giao diện liệu nó đã từng được chạy hay chưa. Nếu CHƯA từng
 * chạy, buffer cache (TTL 2 tiếng) sẽ tự xoá vĩnh viễn trước khi kịp ghi vào
 * sheet — toàn bộ dữ liệu tracking từ trước tới nay có thể đã mất hoàn toàn,
 * không phải chỉ "trễ vài giờ" như trường hợp trigger hoạt động bình thường.
 * Hàm này cho phép UI tự kiểm tra và cảnh báo đúng thực trạng, không đoán mò.
 */
function spx_checkUsageStatsTriggerStatus() {
  try {
    _requireAdmin_(2);
    var triggers = ScriptApp.getProjectTriggers();
    var found = triggers.some(function (t) { var h = t.getHandlerFunction(); return h === 'spx_usageStats_flushBuffer' || h === 'spxDispatcher10Min'; });
    var props = PropertiesService.getScriptProperties();
    var lastFlushed = props.getProperty('usage_last_flushed_hour') || '';
    return JSON.stringify({ success: true, installed: found, lastFlushedHour: lastFlushed });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_installUsageStatsTrigger()
 * [MỚI] Cho phép admin tự cài đặt trigger NGAY từ giao diện (nút bấm trong tab
 * "Tần suất sử dụng") thay vì phải vào Apps Script Editor thủ công — hàm gốc
 * setupUsageStatsFlushTrigger() giữ nguyên không đổi, chỉ bọc thêm kiểm tra quyền.
 */
function spx_installUsageStatsTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 10-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher10Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher10Min() thay thế.
  try {
    _requireAdmin_(2);
    var msg = setupUsageStatsFlushTrigger();
    return JSON.stringify({ success: true, message: msg });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_auditTriggers() — CHỈ XEM, không xoá gì. Chạy tay trong Apps Script Editor.
 * Liệt kê mọi trigger và đánh dấu: MỒ CÔI (hàm không còn trong mã nguồn — mỗi lượt chạy đều lỗi,
 * VD saveSnapshotTrigger), TRÙNG (spx_usageStats_flushBuffer khi đã có spxDispatcher10Min),
 * NGHI TRÙNG (cùng hàm + cùng loại sự kiện — chỉ báo, không tự xoá vì có thể cố ý).
 */
function spx_auditTriggers() { return _spxTriggerCleanup_(false); }

/**
 * spx_cleanRedundantTriggers() — XOÁ trigger MỒ CÔI và trigger TRÙNG đã xác nhận (xem trên).
 * Chạy tay 1 lần sau khi đã chạy spx_auditTriggers() và đồng ý với danh sách.
 */
function spx_cleanRedundantTriggers() { return _spxTriggerCleanup_(true); }

function _spxTriggerCleanup_(doDelete) {
  var triggers = ScriptApp.getProjectTriggers();
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var hasDisp10 = triggers.some(function (t) { return t.getHandlerFunction() === 'spxDispatcher10Min'; });
  var seen = {}, rows = [], removed = 0;
  triggers.forEach(function (t) {
    var h = t.getHandlerFunction();
    var sig = h + '|' + t.getEventType() + '|' + t.getTriggerSource();
    var defined = true;
    try { defined = (typeof g[h] === 'function'); } catch (eD) { defined = true; }
    var verdict = 'GIỮ', del = false;
    if (!defined) { verdict = 'MỒ CÔI — không có hàm "' + h + '" trong mã nguồn'; del = true; }
    else if (h === 'spx_usageStats_flushBuffer' && hasDisp10) { verdict = 'TRÙNG — đã chạy trong spxDispatcher10Min'; del = true; }
    else if (seen[sig]) { verdict = 'NGHI TRÙNG — cùng hàm + cùng loại sự kiện (không tự xoá)'; }
    seen[sig] = true;
    var row = { ham: h, loai: String(t.getEventType()), nguon: String(t.getTriggerSource()), ketLuan: verdict, daXoa: false };
    if (del && doDelete) { try { ScriptApp.deleteTrigger(t); row.daXoa = true; removed++; } catch (eX) { row.loi = eX.message; } }
    rows.push(row);
  });
  var res = { tongTrigger: triggers.length, daXoa: removed, cheDo: doDelete ? 'XOÁ' : 'CHỈ XEM', chiTiet: rows };
  Logger.log(JSON.stringify(res, null, 2));
  return JSON.stringify(res, null, 2);
}

/**
 * spx_listAllTriggers()
 * [MỚI — tab "Tuỳ chọn nâng cao", nhóm "Kiểm soát hệ thống & chẩn đoán"] Liệt
 * kê TOÀN BỘ trigger đang chạy trong project — mở rộng từ cách kiểm tra riêng
 * lẻ đã làm cho Usage Stats, giờ cho mọi trigger để admin thấy tổng quan 1 chỗ
 * thay vì phải đoán/vào tận Apps Script Editor.
 */
function spx_listAllTriggers() {
  try {
    // [SỬA — theo yêu cầu trực tiếp "loại bỏ Tuỳ chọn nâng cao khỏi admin
    // cấp 2"] Nâng từ _requireAdmin_(2) lên (1) — chỉ cấp 1 gọi được.
    _requireAdmin_(1);
    var triggers = ScriptApp.getProjectTriggers();
    var list = triggers.map(function (t) {
      var info = { handlerFunction: t.getHandlerFunction(), eventType: String(t.getEventType()) };
      try {
        if (t.getTriggerSource().toString() === 'CLOCK') {
          info.triggerSourceDetail = 'Định kỳ (time-based)';
        } else {
          info.triggerSourceDetail = t.getTriggerSource().toString();
        }
      } catch (e) { info.triggerSourceDetail = 'Không xác định'; }
      return info;
    });
    return JSON.stringify({ success: true, triggers: list, totalCount: list.length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_getRecentErrors()
 * [MỚI — tab "Tuỳ chọn nâng cao"] Trả về tối đa 50 lỗi gần nhất đã ghi qua
 * _LOG.e() trong 6 tiếng qua (xem giải thích đầy đủ ở _LOG object).
 */
function spx_getRecentErrors() {
  try {
    // [SỬA — theo yêu cầu trực tiếp "loại bỏ Tuỳ chọn nâng cao khỏi admin
    // cấp 2"] Nâng từ _requireAdmin_(2) lên (1) — chỉ cấp 1 gọi được.
    _requireAdmin_(1);
    return JSON.stringify({ success: true, errors: _LOG.getRecentErrors() });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_getSystemConfig() / spx_setSystemConfig(config)
 * [MỚI — tab "Tuỳ chọn nâng cao", nhóm "Cấu hình vận hành"] Cho phép admin
 * chỉnh vài ngưỡng đang HARDCODE ở frontend (badgeDays/autoCleanDays/
 * autoCleanMB trong index.html) mà không cần deploy lại code. Lưu qua
 * PropertiesService — dùng CHUNG cho toàn hệ thống (không phải localStorage
 * riêng từng trình duyệt), đúng bản chất "cấu hình vận hành áp dụng cho mọi
 * user". Chỉ đưa 3 ngưỡng đã xác nhận rõ ràng, KHÔNG động vào toàn bộ hằng số
 * khác trong hệ thống — an toàn, có phạm vi rõ ràng.
 */
var SPX_CONFIG_DEFAULTS = { badgeDays: 14, autoCleanDays: 30, autoCleanMB: 5 };

function spx_getSystemConfig() {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty('spx_system_config_v1');
    var saved = raw ? JSON.parse(raw) : {};
    var merged = {};
    Object.keys(SPX_CONFIG_DEFAULTS).forEach(function (k) {
      merged[k] = (saved[k] !== undefined && saved[k] !== null) ? saved[k] : SPX_CONFIG_DEFAULTS[k];
    });
    return JSON.stringify({ success: true, config: merged, defaults: SPX_CONFIG_DEFAULTS });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message, config: SPX_CONFIG_DEFAULTS });
  }
}

function spx_setSystemConfig(config) {
  try {
    _requireAdmin_(2);
    var badgeDays = Number(config && config.badgeDays);
    var autoCleanDays = Number(config && config.autoCleanDays);
    var autoCleanMB = Number(config && config.autoCleanMB);
    if (!(badgeDays > 0) || !(autoCleanDays > 0) || !(autoCleanMB > 0)) {
      return JSON.stringify({ success: false, error: 'Giá trị phải là số dương.' });
    }
    var toSave = { badgeDays: badgeDays, autoCleanDays: autoCleanDays, autoCleanMB: autoCleanMB };
    PropertiesService.getScriptProperties().setProperty('spx_system_config_v1', JSON.stringify(toSave));
    return JSON.stringify({ success: true, config: toSave });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_getModuleStatusPublic() / spx_adminListModuleStatus() / spx_adminSetModuleStatus()
 * [MỚI — tab "Quản lý Module", theo yêu cầu trực tiếp "khoá/ẩn/thông báo cho
 * module chưa hoàn thiện hoặc đang bảo trì"] Cho Admin cấp 1 tạm khoá hoặc ẩn
 * 1 module đã hoàn thiện (status 'ok' trong NAV) đang cần sửa/bảo trì — KHÔNG
 * cần deploy lại code. User thường bấm vào sẽ thấy thông báo thay vì vào giữa
 * chừng lúc dữ liệu/logic chưa ổn định. Lưu qua PropertiesService — cùng
 * pattern spx_getSystemConfig/spx_setSystemConfig ở trên (nhẹ, không tốn quota
 * Sheets/Firestore cho việc đọc mỗi lần tải trang).
 */
var MODULE_STATUS_PROP_KEY = 'spx_module_status_v1';
// [SỬA — theo phản hồi trực tiếp "module WIP/RAW cũng phải khoá/ẩn được như
// module đã xây"] Trước đây CHỈ liệt kê 11 module đã hoàn thiện (status 'ok').
// Mở rộng ra ĐỦ 24 mục trong NAV (index.html) — kể cả module chưa xây (wip/raw)
// vì chúng vẫn hiện trên sidebar và có thể cần ẩn/khoá y hệt (VD sắp demo cho
// khách, muốn tạm ẩn bớt các mục "đang xây" để đỡ rối). Value đổi từ chuỗi
// nhãn đơn thuần sang {label, section} — section dùng để nhóm hiển thị ở tab
// Quản lý Module cho khỏi rối mắt với danh sách dài (giống cách sidebar nhóm
// theo section). Key dùng ĐÚNG toolKey thật mà spxJumpToNav()/openModule() xử
// lý (xem REAL_MODULE_MAP ở index.html — module có mapping dùng toolKey đã
// mapping, module WIP/RAW không có mapping thì key NAV chính là toolKey).
// CỐ Ý KHÔNG đưa 'adminzone' vào đây — không được để Admin tự khoá luôn màn
// quản trị của chính mình.
var MODULE_LOCKABLE_KEYS = {
  quahan:    { label: 'Kiểm soát Giao hàng',        section: 'Kiểm soát vận hành' },
  pickup:    { label: 'Tồn đọng FirstMile',          section: 'Kiểm soát vận hành' },
  pick:      { label: 'Quản lý Pick',                section: 'Kiểm soát vận hành' },
  tondong:   { label: 'Tồn Đọng LastMile',           section: 'Kiểm soát vận hành' },
  workforce: { label: 'Kiểm soát nhân lực',          section: 'Kiểm soát vận hành' },
  rescue:    { label: 'Đơn cần cầu cứu',             section: 'Kiểm soát vận hành' },
  lost:      { label: 'Phòng ngừa thất lạc',         section: 'Kiểm soát vận hành' },
  kpifail:   { label: 'Theo dõi KPI',                section: 'Quản lý hiệu suất' },
  riderperf: { label: 'Hiệu suất Rider',             section: 'Quản lý hiệu suất' },
  monitor:   { label: 'Giám sát hiệu suất',          section: 'Quản lý hiệu suất' },
  forecast:  { label: 'Dự báo sản lượng',            section: 'Lập kế hoạch & Năng lực' },
  market:    { label: 'Phân tích thị trường',        section: 'Lập kế hoạch & Năng lực' },
  riderplan: { label: 'Lập kế hoạch nhân lực',       section: 'Lập kế hoạch & Năng lực' },
  dispute:   { label: 'Tranh chấp & Lạm dụng',       section: 'Rủi ro & Tuân thủ' },
  incident:  { label: 'Quản lý sự cố',               section: 'Rủi ro & Tuân thủ' },
  violation: { label: 'Vi phạm',                     section: 'Rủi ro & Tuân thủ' },
  luong:     { label: 'Hiệu quả chi phí (Lương)',    section: 'Chi phí & Hiệu quả' },
  asset:     { label: 'Hiệu quả cơ sở',              section: 'Chi phí & Hiệu quả' },
  analytics: { label: 'Báo cáo (BI)',                section: 'Báo cáo & Dữ liệu' },
  tracuu:    { label: 'Tra cứu',                     section: 'Báo cáo & Dữ liệu' },
  tailieu:   { label: 'Tài Liệu',                    section: 'Báo cáo & Dữ liệu' },
  dataquality:{ label: 'Data Quality',               section: 'Báo cáo & Dữ liệu' },
  config:    { label: 'Rule Config',                 section: 'Hệ thống' },
  action:    { label: 'Action Center',               section: 'Hệ thống' }
};

function _spxGetModuleStatusMap_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(MODULE_STATUS_PROP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

/**
 * spx_getModuleStatusPublic()
 * Gọi lúc tải trang, CHO MỌI USER đã duyệt (không cần quyền admin) — cần biết
 * module nào đang khoá/ẩn để vẽ đúng sidebar + chặn đúng ở openModule() phía
 * client. Chỉ trả về status+message, KHÔNG trả ai sửa lúc nào (không cần thiết
 * cho user thường, và tránh lộ thông tin nội bộ không liên quan).
 */
function spx_getModuleStatusPublic() {
  try {
    _requireApproved_();
    var map = _spxGetModuleStatusMap_();
    var out = {};
    Object.keys(MODULE_LOCKABLE_KEYS).forEach(function (k) {
      if (map[k] && map[k].status && map[k].status !== 'normal') {
        out[k] = { status: map[k].status, message: map[k].message || '' };
      }
    });
    return JSON.stringify({ success: true, statuses: out });
  } catch (e) {
    // Lỗi đọc trạng thái KHÔNG được chặn cả trang tải — fail-open: coi như
    // không module nào bị khoá, còn hơn khoá NHẦM toàn bộ hệ thống.
    // [SỬA] Nhưng PHẢI trả kèm LÝ DO — trước đây trả rỗng im lặng, nên khi admin
    // ẩn module mà người dùng vẫn thấy đủ thì không có cách nào biết vì sao
    // (thường gặp: tài khoản chưa có dòng "Duyệt" trong Admin_Access khiến
    // _requireApproved_() ném lỗi ngay đầu hàm).
    return JSON.stringify({ success: false, statuses: {}, error: e.message });
  }
}

/**
 * spx_adminListModuleStatus()
 * [Tab "Quản lý Module"] Cả 2 cấp admin đều XEM được (giống các bảng thống kê
 * khác) — chỉ SỬA (spx_adminSetModuleStatus) mới giới hạn cấp 1, cùng mức
 * nhạy cảm đã áp dụng cho Trạm quản lý/Dọn dẹp hệ thống/Tuỳ chọn nâng cao.
 */
function spx_adminListModuleStatus() {
  try {
    _requireAdmin_(1);
    var map = _spxGetModuleStatusMap_();
    var list = Object.keys(MODULE_LOCKABLE_KEYS).map(function (k) {
      var st = map[k] || {};
      return {
        key: k, label: MODULE_LOCKABLE_KEYS[k].label, section: MODULE_LOCKABLE_KEYS[k].section,
        status: st.status || 'normal', message: st.message || '',
        updatedBy: st.updatedBy || '', updatedAt: st.updatedAt || ''
      };
    });
    return JSON.stringify({ success: true, list: list });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_adminSetModuleStatus(toolKey, status, message)
 * status: 'normal' | 'locked' | 'hidden'.
 * — 'locked': vẫn hiện trên sidebar (nhãn "BẢO TRÌ"), bấm vào hiện thông báo
 *   (message tuỳ chỉnh nếu có), KHÔNG vào được — trừ Admin (mọi cấp, để tự
 *   kiểm tra module trong lúc sửa mà không cần tắt khoá trước).
 * — 'hidden': ẩn hẳn khỏi sidebar với user thường; Admin vẫn thấy (mờ + nhãn
 *   "ẨN") để biết đang ẩn gì, mở được để kiểm tra như 'locked'.
 * Giới hạn admin cấp 1 — đây là cấu hình ảnh hưởng TOÀN BỘ user hệ thống.
 */
function spx_adminSetModuleStatus(toolKey, status, message) {
  try {
    var email = _requireAdmin_(1);
    if (!MODULE_LOCKABLE_KEYS[toolKey]) throw new Error('Module không hợp lệ: ' + toolKey);
    if (['normal', 'locked', 'hidden'].indexOf(status) < 0) throw new Error('Trạng thái không hợp lệ.');
    var map = _spxGetModuleStatusMap_();
    if (status === 'normal') {
      delete map[toolKey]; // dọn gọn — không cần lưu trạng thái mặc định
    } else {
      map[toolKey] = {
        status: status,
        message: String(message || '').slice(0, 300), // giới hạn độ dài, tránh lưu tràn lan
        updatedBy: email,
        updatedAt: new Date().toISOString()
      };
    }
    PropertiesService.getScriptProperties().setProperty(MODULE_STATUS_PROP_KEY, JSON.stringify(map));
    return spx_adminListModuleStatus();
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_getSystemAnnouncement() / spx_adminSetBanner() / spx_adminSetMaintenance()
 * [MỚI — theo yêu cầu trực tiếp "gửi thông báo popup real-time cho user +
 * chế độ bảo trì toàn hệ thống, chuyển hết user đang dùng sang màn bảo trì"]
 * Khác "Quản lý Module" (khoá TỪNG module riêng lẻ) — đây là 2 kênh TOÀN HỆ
 * THỐNG:
 *   (1) banner/popup thông báo — KHÔNG chặn thao tác, chỉ để user biết trước
 *       (VD "sắp bảo trì lúc 22h, nhớ lưu việc đang làm").
 *   (2) khoá bảo trì toàn hệ thống — chặn HẲN mọi module, mọi user thường
 *       (Admin tự bypass được, theo đúng quyết định trực tiếp).
 * Apps Script KHÔNG hỗ trợ push/WebSocket — client phải TỰ POLL định kỳ (xem
 * spxInitAnnouncement() ở index.html, chu kỳ 120s theo quyết định trực tiếp
 * "tiết kiệm quota nhất") nên có độ trễ tối đa = 1 chu kỳ polling, KHÔNG phải
 * tức thời 100% — đã trao đổi rõ giới hạn này với user trước khi làm.
 */
var SYSTEM_ANNOUNCEMENT_PROP_KEY = 'spx_system_announcement_v1';

function _spxGetAnnouncementState_() {
  var empty = {
    banner: { active: false, message: '', severity: 'info', id: '', updatedBy: '', updatedAt: '' },
    maintenance: { active: false, message: '', updatedBy: '', updatedAt: '' }
  };
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(SYSTEM_ANNOUNCEMENT_PROP_KEY);
    var st = raw ? JSON.parse(raw) : {};
    return {
      banner: st.banner || empty.banner,
      maintenance: st.maintenance || empty.maintenance
    };
  } catch (e) { return empty; }
}
function _spxSaveAnnouncementState_(st) {
  PropertiesService.getScriptProperties().setProperty(SYSTEM_ANNOUNCEMENT_PROP_KEY, JSON.stringify(st));
  // [MỚI — "tận dụng Firebase để thông báo" theo yêu cầu trực tiếp] Đẩy thêm
  // lên Firestore để client nhận được GẦN NHƯ TỨC THỜI qua onSnapshot, thay vì
  // đợi tối đa 120s như polling cũ (xem spxInitAnnouncement() ở index.html —
  // VẪN GIỮ NGUYÊN làm lưới an toàn, tự động dùng nếu realtime lỗi/tắt).
  // PropertiesService ở trên vẫn là NGUỒN SỰ THẬT chính (đọc lúc tải trang
  // qua spx_getSystemAnnouncement(), không phụ thuộc Firestore còn sống hay
  // không) — Firestore chỉ là kênh ĐẨY nhanh, ghi lỗi KHÔNG được làm hỏng
  // luồng lưu chính (try/catch nuốt lỗi, giống mọi điểm ghi Firestore khác
  // trong hệ thống — ưu tiên tuyệt đối không làm gãy tính năng gốc).
  try {
    if (typeof _fsUpsertDoc_ === 'function') {
      _fsUpsertDoc_('system_status', 'state', st);
    }
  } catch (eFsPush) {
    console.warn('[Announcement] Đẩy Firestore lỗi (bỏ qua, polling vẫn hoạt động): ' + eFsPush.message);
  }
}

/**
 * spx_getSystemAnnouncement()
 * Gọi lúc tải trang VÀ định kỳ (polling mỗi 120s khi user đang dùng app) —
 * CHO MỌI USER đã duyệt (không cần quyền admin — mọi người đều cần biết bảo
 * trì, không riêng admin). Fail-open nếu lỗi: coi như không có gì mới, KHÔNG
 * được để lỗi đọc biến thành khoá NHẦM toàn hệ thống.
 */
function spx_getSystemAnnouncement() {
  try {
    var _email = _requireApproved_();
    // [MỚI — "biết bao nhiêu user đang online" theo yêu cầu trực tiếp, nhớ
    // hạn mức] "Bám" vào ĐÚNG lượt gọi định kỳ đã có sẵn (mọi user tự gọi hàm
    // này lúc tải trang + poll 120s/600s tuỳ realtime) — KHÔNG tạo thêm 1
    // request mới nào, không tốn thêm ngân sách thực thi Apps Script. Dùng
    // CacheService (miễn phí, KHÔNG phải Firestore) — tránh đúng rủi ro hạn
    // mức ghi Firestore (heartbeat 300+ user sẽ vượt xa 20K ghi/ngày nếu lỡ
    // dùng Firestore cho việc này).
    _spxTouchOnlinePresence_(_email);
    return JSON.stringify({ success: true, state: _spxGetAnnouncementState_() });
  } catch (e) {
    return JSON.stringify({ success: false, state: { banner: { active: false }, maintenance: { active: false } } });
  }
}

// [MỚI — "biết bao nhiêu user đang online"] Lưu { email: lastSeenEpochMs }
// trong ĐÚNG 1 cache entry (không phải 1 entry/user — tránh CacheService
// không có API liệt kê key theo mẫu, và giữ chi phí đọc/ghi cố định dù bao
// nhiêu user). Ngưỡng "online" 15 phút — đủ rộng để không hiện SAI "offline"
// cho user đang bật realtime (poll fallback giãn ra 600s = 10 phút, cộng
// thêm biên độ).
var SPX_ONLINE_CACHE_KEY = 'spx_online_users_v1';
var SPX_ONLINE_TTL_MIN = 15;

function _spxTouchOnlinePresence_(email) {
  try {
    if (!email) return;
    var cache = CacheService.getScriptCache();
    var raw = cache.get(SPX_ONLINE_CACHE_KEY);
    var map = {};
    try { map = raw ? JSON.parse(raw) : {}; } catch (eParse) { map = {}; }
    var now = Date.now();
    map[email.toLowerCase().trim()] = now;
    // Dọn bớt entry đã quá cũ trước khi ghi lại — tránh blob phình to vô hạn
    // nếu nhiều user luân phiên trong ngày (mỗi entry chỉ ~40-60 byte, dọn cho
    // gọn chứ không phải vì lo vượt giới hạn dung lượng CacheService).
    var cutoff = now - (SPX_ONLINE_TTL_MIN + 10) * 60 * 1000;
    Object.keys(map).forEach(function (e) { if (map[e] < cutoff) delete map[e]; });
    cache.put(SPX_ONLINE_CACHE_KEY, JSON.stringify(map), 3600); // TTL cache 1h, dài hơn hẳn ngưỡng online 15 phút ở trên
  } catch (eTouch) { /* lỗi ghi presence KHÔNG được làm gãy luồng thông báo chính */ }
}

/**
 * spx_adminGetOnlineUsers()
 * [Tab "Quản lý Module"] Admin cấp 1 — cùng mức nhạy cảm các thẻ hệ thống
 * khác trong tab này (Thông báo/Bảo trì, Hạn mức Firestore).
 */
function spx_adminGetOnlineUsers() {
  try {
    _requireAdmin_(1);
    var cache = CacheService.getScriptCache();
    var raw = cache.get(SPX_ONLINE_CACHE_KEY);
    var map = raw ? JSON.parse(raw) : {};
    var now = Date.now();
    var cutoff = now - SPX_ONLINE_TTL_MIN * 60 * 1000;
    var online = Object.keys(map)
      .filter(function (e) { return map[e] >= cutoff; })
      .map(function (e) { return { email: e, lastSeenSec: Math.round((now - map[e]) / 1000) }; })
      .sort(function (a, b) { return a.lastSeenSec - b.lastSeenSec; });
    return JSON.stringify({ success: true, count: online.length, users: online, thresholdMin: SPX_ONLINE_TTL_MIN });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_adminSetBanner(message, severity)
 * message rỗng => TẮT banner đang hiện (nếu có). severity: 'info'|'warning'|'critical'.
 * Mỗi lần gửi banner MỚI, đổi "id" (timestamp) để client phân biệt được "đây
 * là thông báo MỚI cần hiện lại popup" khác với thông báo cũ user đã bấm "Đã
 * hiểu" trong phiên hiện tại của họ (xem _spxLastSeenBannerId ở index.html).
 * Giới hạn admin cấp 1 — cùng mức nhạy cảm các cấu hình toàn hệ thống khác.
 */
function spx_adminSetBanner(message, severity) {
  try {
    var email = _requireAdmin_(1);
    var st = _spxGetAnnouncementState_();
    message = String(message || '').trim();
    if (!message) {
      st.banner = { active: false, message: '', severity: 'info', id: '', updatedBy: email, updatedAt: new Date().toISOString() };
    } else {
      if (['info', 'warning', 'critical'].indexOf(severity) < 0) severity = 'info';
      st.banner = {
        active: true,
        message: message.slice(0, 500),
        severity: severity,
        id: 'ann_' + Date.now(),
        updatedBy: email,
        updatedAt: new Date().toISOString()
      };
    }
    _spxSaveAnnouncementState_(st);
    // [MỚI — "FCM foreground" theo yêu cầu trực tiếp] Chỉ gửi push cho mức
    // Cảnh báo/Khẩn cấp — mức Thông tin chỉ cần popup trong app là đủ, không
    // cần làm phiền thêm 1 thông báo hệ thống. Best-effort — lỗi FCM KHÔNG
    // được làm gãy việc lưu banner chính (đã lưu xong ở dòng trên).
    if (st.banner && st.banner.active && (severity === 'warning' || severity === 'critical')) {
      try {
        if (typeof _fsSendFcmTopic_ === 'function') {
          var _fcmTitle = severity === 'critical' ? '🔴 Khẩn cấp — SPX HUB' : '⚠️ Lưu ý — SPX HUB';
          _fsSendFcmTopic_(_fcmTitle, st.banner.message);
        }
      } catch (eFcm) {
        console.warn('[Announcement] Gửi FCM lỗi (bỏ qua, banner vẫn lưu OK): ' + eFcm.message);
      }
    }
    return JSON.stringify({ success: true, state: st });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_adminSetMaintenance(active, message)
 * Khoá bảo trì TOÀN HỆ THỐNG — khác hẳn khoá từng module ("Quản lý Module").
 * User thường bị che TOÀN BỘ app bởi màn "Đang bảo trì", mọi module. Admin
 * (mọi cấp) tự bypass được (theo đúng quyết định trực tiếp) để tự kiểm
 * tra/tắt bảo trì mà không cần thao tác qua Apps Script Editor.
 */
function spx_adminSetMaintenance(active, message) {
  try {
    var email = _requireAdmin_(1);
    var st = _spxGetAnnouncementState_();
    st.maintenance = {
      active: !!active,
      message: String(message || '').trim().slice(0, 500),
      updatedBy: email,
      updatedAt: new Date().toISOString()
    };
    _spxSaveAnnouncementState_(st);
    return JSON.stringify({ success: true, state: st });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_exportUsageStatsRaw(daysBack)
 * [MỚI — theo yêu cầu "export ra file toàn bộ lịch sử theo khung thời gian"]
 * Trả về TOÀN BỘ dòng THÔ (không tổng hợp) trong daysBack ngày gần nhất — để
 * frontend tự dựng CSV và tải xuống, đúng pattern đã có sẵn ở KPI Fail/Rider
 * Plan (new Blob + URL.createObjectURL), không cần cách riêng.
 */
function spx_exportUsageStatsRaw(daysBack) {
  try {
    _requireAdmin_(2);
    daysBack = Number(daysBack) || 7;
    var tz = 'Asia/Ho_Chi_Minh';
    var sheet = _spx_getUsageStatsSheet_();
    var lastRow = sheet.getLastRow();
    var rows = [], everSeen = {}, activeInRange = {}, dataSince = '';

    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
      var cutoff = _spxVnMidnight_(-daysBack); // [SỬA] 00:00 GIỜ VIỆT NAM của (hôm nay − daysBack), không theo múi giờ dự án

      data.forEach(function (row) {
        var dateStr = row[0];
        var rowDate = (dateStr instanceof Date) ? dateStr : new Date(String(dateStr));
        if (isNaN(rowDate.getTime())) return;
        var dOut = (dateStr instanceof Date) ? Utilities.formatDate(dateStr, tz, 'yyyy-MM-dd') : String(dateStr);
        var emailL = String(row[5] || '').toLowerCase().trim();
        var cnt = Number(row[6]) || 0;

        // [MỚI] "đã từng dùng" tính trên toàn bộ lịch sử, không chỉ trong daysBack
        if (!dataSince || dOut < dataSince) dataSince = dOut;
        if (emailL && cnt) everSeen[emailL] = true;

        if (rowDate < cutoff) return;
        if (emailL && cnt) activeInRange[emailL] = true;
        rows.push([
          dOut, String(row[1] || ''), String(row[2] || ''), String(row[3] || ''),
          String(row[4] || ''), String(row[5] || ''), cnt
        ]);
      });
    }

    // [MỚI] Kèm danh sách người được duyệt nhưng chưa dùng / không hoạt động trong kỳ
    var g = { approvedTotal: 0, neverUsed: [], inactive: [] };
    try { g = _spx_usageApprovedGroups_(everSeen, activeInRange); } catch (eG) {}

    return JSON.stringify({
      success: true, rows: rows, daysBack: daysBack, dataSince: dataSince,
      approvedTotal: g.approvedTotal, neverUsed: g.neverUsed, inactive: g.inactive
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_clearUsageStatsHistory()
 * [MỚI — theo yêu cầu "thêm phần xoá lịch sử để recheck lại"] Xoá TOÀN BỘ dữ
 * liệu đã ghi (giữ header) + xoá luôn mọi buffer cache đang chờ flush — đảm
 * bảo "sạch hoàn toàn" để kiểm tra lại từ đầu, không để sót dữ liệu cũ bị
 * flush chèn vào sau khi đã xoá. Yêu cầu admin CẤP 1 (nghiêm ngặt hơn xem/cài
 * trigger) vì đây là hành động phá huỷ dữ liệu KHÔNG THỂ hoàn tác.
 */
function spx_clearUsageStatsHistory() {
  try {
    _requireAdmin_(1);
    var sheet = _spx_getUsageStatsSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 7).clearContent();
    }
    // Xoá buffer cache đang chờ flush của vài giờ gần nhất — tránh dữ liệu CŨ
    // (trước khi xoá) bị flush chèn ngược lại sau khi sheet đã sạch.
    try {
      var tz = 'Asia/Ho_Chi_Minh';
      var now = new Date();
      for (var h = 0; h < 3; h++) {
        var hourDate = new Date(now.getTime() - h * 3600000);
        var hourKey = Utilities.formatDate(hourDate, tz, 'yyyyMMddHH');
        CacheMgr.invalidate('USAGE', 'usage_buf_' + hourKey);
      }
    } catch (eClearBuf) {}
    // Xoá cache tổng hợp đã lưu (mọi khoảng ngày) để lần xem tiếp theo đọc lại
    // đúng dữ liệu mới (rỗng), không trả về bản cache cũ còn hạn.
    try {
      CacheMgr.invalidateAll('ANALYTICS', ['usage_stats_v1_7', 'usage_stats_v1_30', 'usage_stats_v1_90', 'usage_stats_v2_7', 'usage_stats_v2_30', 'usage_stats_v2_90']);
    } catch (eClearCache) {}
    return JSON.stringify({ success: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_getUsageStats(daysBack)
 * [MỚI — theo yêu cầu "tab Tần suất sử dụng trong Quản trị hệ thống, chỉ admin
 * xem được"] Phần GHI (tracking + flush + trigger) đã có sẵn từ trước (xem
 * _spx_trackModuleUsage_/spx_usageStats_flushBuffer ở trên) nhưng CHƯA từng có
 * hàm ĐỌC LẠI cho UI — hàm này bổ sung đúng phần còn thiếu đó. Tổng hợp theo
 * module (tổng lượt mở + số user khác nhau) và theo user (tổng lượt mở + top
 * module hay dùng nhất), trong daysBack ngày gần nhất. Cache 5 phút để tránh
 * đọc lại sheet có thể đã lớn theo thời gian mỗi lần admin mở tab.
 */
/**
 * spx_trackLuongUsage()
 * [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"] Lương
 * hoạt động HOÀN TOÀN client-side (xử lý file CSV người dùng tự upload ngay
 * trong trình duyệt) — không có bất kỳ RPC nào để gắn tracking vào như 8
 * module còn lại. Thêm 1 endpoint RIÊNG, CHỈ để ghi nhận "đã upload file
 * thành công" — đây là hành động "sử dụng thật" rõ ràng nhất của module này,
 * tương đương ý nghĩa với "tải dữ liệu thật" ở các module khác.
 */
function spx_trackLuongUsage() {
  return 'ok';
}

/**
 * _spx_usageApprovedGroups_(everSeen, activeInRange)
 * [MỚI — theo yêu cầu "người được duyệt mà chưa bao giờ sử dụng thì sao?"]
 * Tạo "mẫu số" cho thống kê tần suất: danh sách người ĐÃ ĐƯỢC DUYỆT truy cập,
 * đối chiếu với Usage_Stats (chỉ có dòng khi user thật sự mở module) để tách:
 *   - neverUsed : được duyệt nhưng KHÔNG có dòng nào trong toàn bộ lịch sử Usage_Stats
 *   - inactive  : từng có lượt mở trong lịch sử nhưng KHÔNG có lượt nào trong kỳ đang xem
 * "Được duyệt" định nghĩa ĐÚNG như checkUserAccess()/_requireApproved_():
 *   (1) Admin_Access cột B = "Duyệt"  (2) admin mọi cấp trong _admin_getAdminMap()
 *       (admin mặc nhiên được duyệt, có thể không có dòng trong Admin_Access).
 * Email chuẩn hoá toLowerCase().trim() ở CẢ HAI phía — Admin_Access do người nhập
 * tay nên có thể lẫn hoa/thường, trong khi tracking ghi email đã chuẩn hoá.
 * Lưu ý: cột C Admin_Access bị ghi đè thành "thời điểm thao tác gần nhất" mỗi lần
 * duyệt/thu hồi — nên approvedTs là "thao tác gần nhất", KHÔNG phải ngày duyệt gốc.
 */
function _spx_usageApprovedGroups_(everSeen, activeInRange) {
  var out = { approvedTotal: 0, neverUsed: [], inactive: [] };
  var tz = 'Asia/Ho_Chi_Minh';
  var approved = {}; // email -> { kind, hub, ts }

  var adm = {};
  try { adm = _admin_getAdminMap() || {}; } catch (eAdm) {}
  Object.keys(adm).forEach(function (em) {
    approved[em] = { kind: 'Admin cấp ' + adm[em], hub: '', ts: 0 };
  });

  var accSheet = _DS.ss(ADMIN_DB_ID).getSheetByName('Admin_Access');
  if (accSheet) {
    var acc = accSheet.getDataRange().getValues();
    for (var i = 1; i < acc.length; i++) {
      var em = String(acc[i][0] || '').toLowerCase().trim();
      if (!em || String(acc[i][1] || '').trim() !== 'Duyệt') continue;
      var raw = acc[i][2];
      var ts = raw ? (raw instanceof Date ? raw.getTime() : (new Date(raw).getTime() || 0)) : 0;
      var prev = approved[em] || {};
      approved[em] = { kind: prev.kind || 'User', hub: String(acc[i][4] || '').trim(), ts: ts };
    }
  }

  Object.keys(approved).forEach(function (em) {
    out.approvedTotal++;
    if (activeInRange[em]) return;
    var a = approved[em];
    var item = {
      email: em, kind: a.kind, hub: a.hub, approvedTs: a.ts,
      approvedDate: a.ts ? Utilities.formatDate(new Date(a.ts), tz, 'yyyy-MM-dd') : ''
    };
    (everSeen[em] ? out.inactive : out.neverUsed).push(item);
  });
  // Người có thao tác duyệt LÂU NHẤT mà vẫn chưa dùng -> lên đầu (đáng quan tâm nhất)
  var byOld = function (x, y) { return (x.approvedTs || 0) - (y.approvedTs || 0); };
  out.neverUsed.sort(byOld);
  out.inactive.sort(byOld);
  return out;
}

function spx_getUsageStats(daysBack) {
  try {
    _requireAdmin_(2); // cả admin cấp 1 và cấp 2 đều xem được, đúng yêu cầu "chỉ admin"
    daysBack = Number(daysBack) || 7;
    // [SỬA] v1 -> v2: kết quả nay có thêm approvedTotal/neverUsed/inactive/dataSince,
    // bỏ qua cache cũ thiếu các trường này.
    var cacheKey = 'usage_stats_v2_' + daysBack;
    var cached = CacheMgr.get('ANALYTICS', cacheKey);
    if (cached) return JSON.stringify(cached);

    var sheet = _spx_getUsageStatsSheet_();
    var lastRow = sheet.getLastRow();
    var result = {
      success: true, daysBack: daysBack, totalOpens: 0, byModule: [], byUser: [],
      approvedTotal: 0, neverUsed: [], inactive: [], dataSince: '',
      generatedAt: new Date().toISOString()
    };
    var everSeen = {};       // email -> true: có dòng trong TOÀN BỘ lịch sử còn lưu
    var activeInRange = {};  // email -> true: có lượt mở trong daysBack

    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
      var cutoff = _spxVnMidnight_(-daysBack); // [SỬA] 00:00 GIỜ VIỆT NAM của (hôm nay − daysBack), không theo múi giờ dự án

      var byModule = {}; // module -> { opens, users: {email:true} }
      var byUser = {};   // email -> { opens, role, modules: {module: count} }

      data.forEach(function (row) {
        var dateStr = row[0]; // "yyyy-MM-dd" hoặc Date object tuỳ Sheets tự parse
        var rowDate = (dateStr instanceof Date) ? dateStr : new Date(String(dateStr));
        if (isNaN(rowDate.getTime())) return;

        var moduleKey = String(row[2] || '');
        var role = String(row[3] || '');
        var email = String(row[5] || '').toLowerCase().trim();
        var count = Number(row[6]) || 0;

        // [MỚI] Ghi nhận TRƯỚC khi lọc theo kỳ: "đã từng dùng" tính trên toàn bộ lịch sử.
        var dStr = (dateStr instanceof Date) ? Utilities.formatDate(dateStr, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd') : String(dateStr);
        if (!result.dataSince || dStr < result.dataSince) result.dataSince = dStr;
        if (email && count) everSeen[email] = true;

        if (rowDate < cutoff) return;
        if (!moduleKey || !count) return;

        result.totalOpens += count;

        if (!byModule[moduleKey]) byModule[moduleKey] = { opens: 0, users: {} };
        byModule[moduleKey].opens += count;
        if (email) byModule[moduleKey].users[email] = true;

        if (email) {
          activeInRange[email] = true;
          if (!byUser[email]) byUser[email] = { opens: 0, role: role, modules: {} };
          byUser[email].opens += count;
          byUser[email].modules[moduleKey] = (byUser[email].modules[moduleKey] || 0) + count;
        }
      });

      result.byModule = Object.keys(byModule).map(function (m) {
        return { module: m, opens: byModule[m].opens, uniqueUsers: Object.keys(byModule[m].users).length };
      }).sort(function (a, b) { return b.opens - a.opens; });

      result.byUser = Object.keys(byUser).map(function (e) {
        var mods = byUser[e].modules;
        var topModule = Object.keys(mods).sort(function (a, b) { return mods[b] - mods[a]; })[0] || '';
        return { email: e, role: byUser[e].role, opens: byUser[e].opens, topModule: topModule };
      }).sort(function (a, b) { return b.opens - a.opens; });
    }

    // [MỚI] Đối chiếu với danh sách người được duyệt — KHÔNG phụ thuộc lastRow>=2,
    // vì khi Usage_Stats rỗng (vừa xoá lịch sử) thì mọi người được duyệt đều "chưa dùng".
    try {
      var g = _spx_usageApprovedGroups_(everSeen, activeInRange);
      result.approvedTotal = g.approvedTotal;
      result.neverUsed = g.neverUsed;
      result.inactive = g.inactive;
    } catch (eG) { result.approvedError = eG.message; }

    CacheMgr.set('ANALYTICS', cacheKey, result, 300);
    return JSON.stringify(result);
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * pick_live_prewarmCache()
 * Chạy NỀN qua time-driven trigger (5 phút/lần — pick_live_installPrewarmTrigger)
 * hoặc thủ công qua pick_live_forceRefreshNow(). Có LockService bảo vệ nên nếu
 * nhiều lần gọi chồng lấn (trigger trùng lúc user bấm "Làm mới"), chỉ 1 lần
 * thực sự quét sheet.
 */
function pick_live_prewarmCache() {
  // [FIX 2026-08-01] BẬT LẠI khung giờ vắng — trước đây (2026-07-30) phải tắt
  // vì pick_live_getStations() báo lỗi cứng khi cache trống, không có build dự
  // phòng. Giờ đã thêm build dự phòng (có khóa bảo vệ) vào pick_live_getStations()
  // — nếu lỡ có user mở đúng lúc 23h-5h, module vẫn phục vụ được (build live,
  // chỉ chậm hơn 1 chút), không còn lỗi cứng nữa — an toàn để nghỉ giờ vắng.
  if (_spxIsPrewarmQuietHours_()) { _LOG.d('[Pick Live Prewarm] Bỏ qua — khung giờ vắng user (23h-5h).'); return; }
  // [FIX NGHẼN LOCK 2026-07-24] TRƯỚC ĐÂY dùng thẳng LockService.getScriptLock() —
  // hàm này chạy NỀN MỖI 5 PHÚT và giữ lock TRONG SUỐT thời gian quét sheet FM Live
  // (có thể mất nhiều giây với sheet lớn) — nghĩa là cứ mỗi 5 phút, TOÀN BỘ hệ thống
  // (Rider Plan, Admin Access, Quá Hạn note...) có thể bị chặn theo 1 chu kỳ đều đặn,
  // kể cả khi không có nhiều user cùng thao tác. Đổi sang named lock riêng — chỉ cần
  // tự chặn chính nó chạy chồng lấn (trigger trùng lúc user bấm "Làm mới"), không đụng
  // gì tới phần còn lại của hệ thống.
  // [FIX 2026-07-30] BUG: trước đây không truyền staleMs, dùng mặc định 90s của
  // _anaAcquireNamedLock() (chọn cho các use case khác, tối đa ~45s) — nhưng log
  // Executions xác nhận lượt build của CHÍNH hàm này có thể hợp lệ mất tới 606.9s
  // (>10 phút, sheet '3. FM action realtime' đã lớn). Sau đúng 90s, bất kỳ lượt
  // trigger nào bắn tiếp theo đều tưởng lượt trước đã crash và CƯỚP LUÔN khóa —
  // 2 lượt cùng build song song, tranh nhau tài nguyên, càng chồng càng chậm.
  // [FIX 2026-08-01] Trigger đổi tiếp từ 15 -> 30 phút — staleMs cũ 1800s (30
  // phút) lại TRÙNG chu kỳ mới, nâng tiếp lên 3600s (60 phút, gấp đôi) để giữ
  // đúng biên độ an toàn.
  var gotLock = _anaAcquireNamedLock('pick_live_prewarm_lock_v1', 20000, 3600000);
  if (!gotLock) return { success: false, busy: true };
  try {
    var fresh = _pickLive_buildRawSnapshot_();
    if (!fresh.success) return fresh;
    _pickLive_lastFreshBuild_ = fresh;
    _pickLive_writeSnapshotPerHub_(fresh);
    return { success: true, hubCount: fresh.hubs.length, generatedAt: fresh.generatedAt };
  } finally {
    _anaReleaseNamedLock('pick_live_prewarm_lock_v1');
  }
}

/**
 * pick_live_installPrewarmTrigger()
 * Chạy TAY 1 LẦN từ Apps Script editor (sau khi deploy bản này) để cài trigger
 * nền 5 phút/lần — xoá trigger trùng tên cũ (nếu có) trước khi tạo mới, tránh
 * bị nhân đôi trigger nếu chạy lại hàm này nhiều lần. Build ngay 1 lần sau khi
 * cài để có dữ liệu tức thì, khỏi phải đợi tới chu kỳ 5 phút đầu tiên.
 */
function pick_live_installPrewarmTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 30-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher30Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher30Min() thay thế.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pick_live_prewarmCache') ScriptApp.deleteTrigger(t);
  });
  // [FIX 2026-07-31] Đổi 5 phút -> 15 phút. Log Executions xác nhận đây là trigger
  // TỐN NHIỀU NHẤT trong toàn hệ thống (~485 phút/ngày ở chu kỳ 5 phút — MỘT MÌNH
  // đã vượt hẳn quota 360 phút/ngày của tài khoản Workspace cho TỔNG mọi trigger
  // cộng lại). Đổi sang 15 phút giảm ~1/3 (còn ~162 phút/ngày). Đồng bộ tăng
  // PICK_LIVE_CACHE_TTL từ 600s lên 1800s (xem hằng số) — nếu không tăng TTL,
  // cache sẽ hết hạn trước lượt trigger kế tiếp, tái phát lỗi "chưa sẵn sàng".
  // [FIX 2026-08-01] Đổi 15 phút -> 30 phút (mốc lớn nhất ScriptApp chấp nhận) —
  // đây là trigger tốn nhiều nhất hệ thống, giảm thêm 1 nửa. Cộng với việc bật
  // lại khung giờ vắng (23h-5h, ~25% thời gian/ngày) nhờ build dự phòng mới có
  // ở pick_live_getStations() — tổng 2 thay đổi giảm đóng góp của trigger này
  // từ ~162 phút/ngày xuống còn ~61 phút/ngày. Đồng bộ tăng PICK_LIVE_CACHE_TTL
  // lên 3600s (xem hằng số) để vẫn dư biên độ với chu kỳ mới.
  ScriptApp.newTrigger('pick_live_prewarmCache').timeBased().everyMinutes(30).create();
  return pick_live_prewarmCache();
}

/**
 * pick_live_getStations()
 * Public entry — gọi từ JS_Pick.html khi mở tab Live. Trả DANH SÁCH TRẠM
 * (+ số đơn mỗi trạm) mà user hiện tại ĐƯỢC PHÉP xem, để FE hiển thị bộ chọn
 * trạm — KHÔNG chứa dữ liệu chi tiết. Admin thấy toàn bộ trạm có dữ liệu.
 * KHÔNG BAO GIỜ tự quét sheet — cache miss thì báo "chưa sẵn sàng" ngay.
 */
function pick_live_getStations() {
  var access = getModuleAccess();
  if (access.role === 'denied') {
    return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
  }

  var idxStr = _fmsLive_readChunkedJson_(PICK_LIVE_INDEX_KEY);
  if (!idxStr) {
    // [FIX 2026-08-01] TRƯỚC ĐÂY: cache trống -> báo lỗi cứng ngay, KHÔNG BAO
    // GIỜ tự build. Đây là lý do KHÔNG thể áp khung giờ vắng cho
    // pick_live_prewarmCache (đã từng làm module "chết" hẳn suốt 23h-5h, user
    // báo cáo thật). Giờ THỬ TỰ BUILD 1 LẦN (có khóa bảo vệ, double-check sau
    // khi giành khóa) trước khi báo lỗi — cho phép bật lại khung giờ vắng cho
    // trigger nền mà module vẫn luôn phục vụ được (build live có ngân sách
    // thời gian riêng, không rủi ro treo — xem _pickLive_buildRawSnapshot_).
    var gotLockLive = _anaAcquireNamedLock('pick_live_prewarm_lock_v1', 20000, 3600000);
    if (gotLockLive) {
      try {
        var idxStrRecheck = _fmsLive_readChunkedJson_(PICK_LIVE_INDEX_KEY);
        if (idxStrRecheck) { idxStr = idxStrRecheck; }
        else {
          var freshLive = _pickLive_buildRawSnapshot_();
          if (freshLive && freshLive.success) {
            _pickLive_lastFreshBuild_ = freshLive;
            try { _pickLive_writeSnapshotPerHub_(freshLive); } catch (eWr) {}
            // [FIX] Xây thẳng idxStr từ freshLive thay vì đọc lại cache vừa ghi —
            // nếu _pickLive_writeSnapshotPerHub_ lỡ ghi thất bại (vd payload vượt
            // trần chunk cache), đọc lại sẽ ra null dù build đã thành công thật,
            // khiến user vẫn thấy lỗi "chưa sẵn sàng" một cách oan uổng.
            idxStr = JSON.stringify({
              success: true, hubs: freshLive.hubs, counts: freshLive.counts,
              updatedNote: freshLive.updatedNote, generatedAt: freshLive.generatedAt
            });
          }
        }
      } catch (eLive) {
        // rơi xuống báo lỗi bên dưới nếu idxStr vẫn rỗng — không throw ra ngoài
      } finally {
        _anaReleaseNamedLock('pick_live_prewarm_lock_v1');
      }
    }
  }
  if (!idxStr) {
    return JSON.stringify({ success: false, notReady: true, error: 'Dữ liệu Live chưa sẵn sàng — tiến trình cập nhật nền chạy mỗi 30 phút, vui lòng thử lại sau ít phút.' });
  }
  var idx;
  try { idx = JSON.parse(idxStr); } catch (e) {
    return JSON.stringify({ success: false, error: 'Dữ liệu tạm bị lỗi, vui lòng thử lại sau ít phút.' });
  }

  var counts = idx.counts || {};
  var hubs;
  if (access.role === 'admin') {
    hubs = idx.hubs || [];
  } else {
    var allowedSet = Object.create(null);
    (access.hubs || []).forEach(function (s) { allowedSet[_normStationKey_(s, { pakFix: false, stripSuffix: false })] = true; });
    hubs = (idx.hubs || []).filter(function (h) {
      return allowedSet[_normStationKey_(h, { pakFix: false, stripSuffix: false })] === true;
    });
  }

  return JSON.stringify({
    success: true,
    hubs: hubs.map(function (h) { return { name: h, count: counts[h] || 0 }; }),
    updatedNote: idx.updatedNote || '',
    generatedAt: idx.generatedAt,
    role: access.role
  });
}

/**
 * pick_live_getStationData(stationNames)
 * Public entry — dữ liệu chi tiết CHỈ cho các trạm user chủ động chọn trong
 * bộ chọn trạm ở FE. ADMIN CŨNG PHẢI truyền danh sách trạm cụ thể — không còn
 * nhánh "lấy tất cả" ngầm định. Server luôn ép giao (intersect) với quyền
 * thực tế: non-admin không thể "xin" trạm ngoài quyền dù FE gửi gì lên.
 * Giới hạn PICK_LIVE_MAX_HUBS_PER_CALL trạm/lần gọi — FE nên gọi theo đợt
 * nếu user chọn nhiều trạm hơn mức này.
 */
function pick_live_getStationData(stationNames) {
  var access = getModuleAccess();
  if (access.role === 'denied') {
    return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
  }
  if (!Array.isArray(stationNames) || stationNames.length === 0) {
    return JSON.stringify({ success: true, data: [], stationsReturned: [], fetchedAt: Date.now() });
  }

  var idxStr = _fmsLive_readChunkedJson_(PICK_LIVE_INDEX_KEY);
  if (!idxStr) {
    return JSON.stringify({ success: false, notReady: true, error: 'Dữ liệu Live chưa sẵn sàng — tiến trình cập nhật nền chạy mỗi 5 phút, vui lòng thử lại sau ít phút.' });
  }
  var idx;
  try { idx = JSON.parse(idxStr); } catch (e) {
    return JSON.stringify({ success: false, error: 'Dữ liệu tạm bị lỗi, vui lòng thử lại sau ít phút.' });
  }
  var allHubs = idx.hubs || [];

  var requestedSet = Object.create(null);
  stationNames.forEach(function (s) { requestedSet[_normStationKey_(s, { pakFix: false, stripSuffix: false })] = true; });

  var allowedHubs;
  if (access.role === 'admin') {
    allowedHubs = allHubs.filter(function (h) { return requestedSet[_normStationKey_(h, { pakFix: false, stripSuffix: false })] === true; });
  } else {
    var myAllowed = Object.create(null);
    (access.hubs || []).forEach(function (s) { myAllowed[_normStationKey_(s, { pakFix: false, stripSuffix: false })] = true; });
    allowedHubs = allHubs.filter(function (h) {
      var k = _normStationKey_(h, { pakFix: false, stripSuffix: false });
      return myAllowed[k] === true && requestedSet[k] === true;
    });
  }

  var truncated = false;
  if (allowedHubs.length > PICK_LIVE_MAX_HUBS_PER_CALL) { allowedHubs = allowedHubs.slice(0, PICK_LIVE_MAX_HUBS_PER_CALL); truncated = true; }

  if (!allowedHubs.length) {
    return JSON.stringify({ success: true, data: [], stationsReturned: [], updatedNote: idx.updatedNote || '', generatedAt: idx.generatedAt, fetchedAt: Date.now() });
  }

  var keys = allowedHubs.map(_pickLive_hubCacheKey_);
  var batch = _fmsLive_readChunkedJsonBatch_(keys);
  var data = [];
  allowedHubs.forEach(function (h, i) {
    var raw = batch[keys[i]];
    if (!raw) return;
    try {
      var rows = JSON.parse(raw);
      if (rows && rows.length) data = data.concat(rows);
    } catch (e) {}
  });

  return JSON.stringify({
    success: true,
    data: data,
    stationsReturned: allowedHubs,
    truncated: truncated,
    updatedNote: idx.updatedNote || '',
    generatedAt: idx.generatedAt,
    fetchedAt: Date.now()
  });
}

/**
 * pick_live_forceRefreshNow()
 * Nút "Làm mới" chủ động của user — build lại NGAY (đồng bộ) thay vì đợi chu
 * kỳ trigger 5 phút. Nếu đang có tiến trình khác build song song (busy), đọc
 * lại index 1 lần nữa (có thể vừa xong) thay vì báo lỗi ngay. Đây vẫn là 1
 * lần full-scan sheet nên CHỈ nên là hành động thủ công của user, không nên
 * tự động lặp lại.
 */
/**
 * pick_live_getHubSummary(stationName)
 * [2026-07-24] Bản tóm tắt SIÊU NHẸ cho ĐÚNG 1 trạm — phục vụ badge cảnh báo
 * trên card "Quản lý Pick" ở trang chủ, KHÔNG cần mở module Pick. Chỉ đọc lại
 * 1 chunk cache của trạm đó (đã có sẵn nhờ pick_live_prewarmCache chạy nền mỗi
 * 5 phút) — không quét sheet, an toàn gọi mỗi lần tải trang chủ.
 * Trước đây có badge-pick trên card này nhưng đã bị GỠ vì lấy nhầm số liệu từ
 * data Quá Hạn (sai). Hàm này lấy đúng nguồn Pick Live thật nên khắc phục được.
 */
function pick_live_getHubSummary(stationName) {
  var access = getModuleAccess();
  if (access.role === 'denied' || !stationName) {
    return JSON.stringify({ success: true, total: 0, problem: 0 });
  }
  // Ép quyền: non-admin chỉ được xem tóm tắt đúng trạm mình quản lý.
  if (access.role !== 'admin') {
    var myAllowed = Object.create(null);
    (access.hubs || []).forEach(function (s) { myAllowed[_normStationKey_(s, { pakFix: false, stripSuffix: false })] = true; });
    if (myAllowed[_normStationKey_(stationName, { pakFix: false, stripSuffix: false })] !== true) {
      return JSON.stringify({ success: true, total: 0, problem: 0 });
    }
  }

  var idxStr = _fmsLive_readChunkedJson_(PICK_LIVE_INDEX_KEY);
  if (!idxStr) return JSON.stringify({ success: true, total: 0, problem: 0, notReady: true });
  var idx;
  try { idx = JSON.parse(idxStr); } catch (e) { return JSON.stringify({ success: true, total: 0, problem: 0 }); }

  var targetKey = _normStationKey_(stationName, { pakFix: false, stripSuffix: false });
  var match = (idx.hubs || []).filter(function (h) { return _normStationKey_(h, { pakFix: false, stripSuffix: false }) === targetKey; })[0];
  if (!match) return JSON.stringify({ success: true, total: 0, problem: 0 });

  var raw = _fmsLive_readChunkedJson_(_pickLive_hubCacheKey_(match));
  if (!raw) return JSON.stringify({ success: true, total: 0, problem: 0 });
  var rows;
  try { rows = JSON.parse(raw); } catch (e) { return JSON.stringify({ success: true, total: 0, problem: 0 }); }

  var total = rows.length, problem = 0;
  rows.forEach(function (r) {
    var s = (r.fleetFinalStatus || '').toLowerCase();
    // Nhóm "cần chú ý": fail/lost/cancel/onhold — khớp đúng logic tô màu đỏ
    // đang dùng ở card trạng thái Pick Live (updateLiveStatusChipsPICK).
    if (s.indexOf('fail') > -1 || s.indexOf('lost') > -1 || s.indexOf('cancel') > -1 || s.indexOf('onhold') > -1) problem++;
  });

  return JSON.stringify({ success: true, total: total, problem: problem, station: match, generatedAt: idx.generatedAt });
}

function pick_live_forceRefreshNow() {
  var res = pick_live_prewarmCache();
  if (res && res.busy) {
    var idxStr = _fmsLive_readChunkedJson_(PICK_LIVE_INDEX_KEY);
    if (idxStr) {
      try { var idx = JSON.parse(idxStr); return JSON.stringify({ success: true, generatedAt: idx.generatedAt }); } catch (e) {}
    }
  }
  return JSON.stringify(res);
}


// Xóa cache aging_getMasterData — gọi sau mỗi write operation (saveNote, syncNotes)

/**
 * qh_getBacklogByStation()
 * [MỚI — khai thác sheet 'Backlog FM+LM' chưa từng được dùng]
 * Trả về phân bố backlog LastMile theo 5 mốc tuổi cho TỪNG TRẠM — thứ mà
 * module Quá hạn còn thiếu: hiện chỉ có danh sách đơn, chưa có bức tranh
 * "trạm mình đang nặng ở mốc nào so với các trạm khác".
 *
 * CẤU TRÚC SHEET (đã xác minh trực tiếp trên file thật, không suy đoán):
 *   - Dòng 3 (index 2): tiêu đề — cột 1 'Station' (FirstMile), cột 8 'Station' (LastMile)
 *   - Sheet có 3 KHỐI LỒNG NHAU, phân cách bằng dòng trống:
 *       d4-d11   : cấp AOM  (8 dòng, gồm 'Grand Total')
 *       d15-d47  : cấp SUP  (33 dòng)
 *       d51-d420 : cấp HUB  (370 dòng) <- KHỐI TA CẦN
 *     Bằng chứng khối lồng nhau: cộng TẤT CẢ dòng ra 110.940 = ~3x Grand Total
 *     37.335, và 1 tên xuất hiện ở cả khối AOM lẫn SUP với số liệu y hệt.
 *   - Cột LastMile: [8]=tên, [9]='>7 Day', [10]='5-7 Day', [11]='2-5 Day',
 *     [12]='37H - 2 Day', [13]='<= 37H'
 *   - Kiểm chứng: cộng riêng khối HUB = [1255,3456,21002,971,10653], khớp
 *     Grand Total [1255,3456,21002,971,10651] (lệch 2 đơn = 0.005%, do thời
 *     điểm chốt số khác nhau).
 *
 * KHÔNG dò theo số dòng cứng (sheet có thể thêm/bớt trạm) — thay vào đó nhận
 * diện khối HUB bằng đặc điểm dữ liệu: tên chứa 'Hub'/'SOC' (tên trạm thật),
 * khác hẳn khối AOM/SUP vốn là tên người.
 */
function qh_getBacklogByStation(scopeStationsJson) {
  try {
    _requireApproved_();

    // [SỬA LỖI THIẾT KẾ — báo cáo trực tiếp kèm ảnh: "Lead quản 1 trạm mà show
    // cả nước? AOM/SUP cần khu vực mình quản lý chứ đâu cần coi cả nước"]
    // TRƯỚC ĐÂY hàm không nhận tham số phạm vi nào -> luôn trả về CẢ 371 trạm
    // toàn quốc cho MỌI cấp. Sai cả về nghiệp vụ (người dùng cần so sánh trong
    // phạm vi mình quản, không phải toàn quốc) lẫn về quyền dữ liệu (Lead thấy
    // được số liệu của 370 trạm không thuộc quyền mình).
    //
    // NAY: lọc theo ĐÚNG phạm vi được phân quyền của người gọi.
    //   - Admin            -> toàn hệ thống (giữ nguyên, để kiểm tra tổng thể)
    //   - ROM/AOM/SUP/Lead -> chỉ các trạm trong perm.stations
    //   - scopeStationsJson: khi Admin đang "xem thử" theo vai 1 AOM/SUP cụ thể,
    //     frontend truyền danh sách trạm của người đó để mô phỏng đúng góc nhìn.
    var email = Session.getActiveUser().getEmail();
    var perm  = checkAnalyticsPermission(email);
    if (!perm || !perm.allowed) return JSON.stringify({ success: false, error: 'Không có quyền truy cập.' });

    var scopeSet = null;   // null = không giới hạn (toàn hệ thống)
    var scopeList = null;
    try {
      if (scopeStationsJson) {
        var arr = JSON.parse(scopeStationsJson);
        if (Array.isArray(arr) && arr.length) scopeList = arr;
      }
    } catch (eParse) { scopeList = null; }

    // Không truyền scope -> dùng đúng quyền thật của người gọi.
    // Admin (isAdmin) và KHÔNG có scope -> xem toàn hệ thống.
    if (!scopeList && !perm.isAdmin) scopeList = perm.stations || [];

    if (scopeList) {
      scopeSet = {};
      scopeList.forEach(function(s) {
        var k = String(s || '').trim().toLowerCase();
        if (k) scopeSet[k] = true;
      });
      if (!Object.keys(scopeSet).length) scopeSet = null;
    }

    // [PERF 2026-10] TRƯỚC ĐÂY cache theo TỪNG phạm vi (mỗi user/phạm vi khác nhau = 1 khoá
    // riêng) nên mỗi phạm vi mới đều phải đọc lại cả sheet nguồn (~5 giây) — đỉnh đồng thời
    // 27 lượt trong Executions có 8 lượt đúng hàm này (8 phạm vi khác nhau cùng "miss").
    // NAY: đọc + phân tích sheet đúng 1 lần, cache dữ liệu THÔ (toàn bộ trạm), mọi phạm vi
    // chỉ lọc trong bộ nhớ. TTL 10 phút (trước 30 phút): nguồn cập nhật 8:00/14:00 nên số
    // liệu mới hiện chậm tối đa 10 phút thay vì 30.
    var RAW_KEY = 'qh_backlog_raw_v3';
    var raw = CacheMgr.getChunked('ANALYTICS', RAW_KEY);
    if (!raw || !raw.stations) {
      var ss = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
      var sheet = ss.getSheetByName('Backlog FM+LM');
      if (!sheet) return JSON.stringify({ success: false, error: "Không thấy sheet 'Backlog FM+LM'" });

      var lastRow = sheet.getLastRow();
      if (lastRow < 5) return JSON.stringify({ success: true, stations: [], total: null });
      // [SỬA] Dò khối LastMile + các cột mốc tuổi theo TIÊU ĐỀ (dòng 2 = nhãn khối, dòng 3 = tiêu đề cột).
      // Chấp nhận cả tên mốc cũ ('37H - 2 Day', '<= 37H') lẫn mới ('1-2 Day', '<= 1 Day').
      var _lastCol = sheet.getLastColumn();
      var _hdr2 = sheet.getRange(2, 1, 1, _lastCol).getValues()[0];
      var _hdr3 = sheet.getRange(3, 1, 1, _lastCol).getValues()[0];
      var _lm = -1;
      for (var _c = 0; _c < _hdr2.length; _c++) {
        var _nn = _spx_normHdr_(_hdr2[_c]);
        if (_nn === 'lastmile' || _nn === 'last mile') { _lm = _c; break; }
      }
      if (_lm < 0) throw new Error("Sheet 'Backlog FM+LM': không thấy ô 'LastMile' ở dòng 2. Dòng 2 hiện có: " + _hdr2.map(function (x) { return String(x || '').trim(); }).filter(String).join(' | '));
      var B = _spx_findCols_(_hdr3, _SPX_SPEC_BKLM_, { from: _lm });
      _spx_requireCols_("Sheet 'Backlog FM+LM' (khối LastMile)", B, _SPX_REQ_BKLM_, _hdr3);
      var values = sheet.getRange(1, 1, lastRow, Math.min(sheet.getMaxColumns(), _spx_maxIdx_(B) + 1)).getValues();

      var allStations = [];
      var grandTotal = null;
      for (var i = 3; i < values.length; i++) {
        var nm = values[i][B.station];
        if (!nm || typeof nm !== 'string') continue;
        nm = nm.trim();
        if (!nm) continue;

        var b = [];
        var sum = 0;
        var _bc = [B.over7, B.d57, B.d25, B.mid, B.low];
        for (var kk = 0; kk < _bc.length; kk++) {
          var v = values[i][_bc[kk]];
          var n = (typeof v === 'number') ? v : 0;
          b.push(n); sum += n;
        }

        if (nm === 'Grand Total') {
          // Dòng này là tổng TOÀN QUỐC — chỉ dùng khi KHÔNG giới hạn phạm vi (xem bên dưới).
          grandTotal = { over7: b[0], d57: b[1], d25: b[2], h37_2d: b[3], h37: b[4], sum: sum };
          continue;
        }
        // Chỉ lấy khối HUB — tên trạm luôn chứa 'Hub' hoặc 'SOC' (VD '45-DLK Krong Pak 02 Hub'),
        // trong khi khối AOM/SUP là tên người. Ổn định hơn dò theo số dòng cố định.
        var up = nm.toUpperCase();
        if (up.indexOf('HUB') < 0 && up.indexOf('SOC') < 0) continue;
        if (sum <= 0) continue;

        allStations.push({
          station: nm,
          over7:  b[0],   // >7 Day    (Critical)
          d57:    b[1],   // 5-7 Day
          d25:    b[2],   // 2-5 Day   (Moderate)
          h37_2d: b[3],   // 37H - 2 Day
          h37:    b[4],   // <= 37H    (Green)
          sum:    sum
        });
      }
      raw = { stations: allStations, grandTotal: grandTotal, asOf: Date.now() };
      CacheMgr.setChunked('ANALYTICS', RAW_KEY, raw, 600);
    }

    var stations = raw.stations;
    var total = null;
    if (scopeSet) {
      // Có giới hạn phạm vi -> chỉ giữ trạm trong phạm vi, tự cộng tổng từ đúng các trạm đó
      // để mọi tỉ lệ/xếp hạng tính trên đúng mẫu số của phạm vi (không dùng Grand Total toàn quốc).
      stations = raw.stations.filter(function (st) { return scopeSet[String(st.station).toLowerCase()]; });
      var t = { over7: 0, d57: 0, d25: 0, h37_2d: 0, h37: 0, sum: 0 };
      stations.forEach(function (st) {
        t.over7 += st.over7; t.d57 += st.d57; t.d25 += st.d25;
        t.h37_2d += st.h37_2d; t.h37 += st.h37; t.sum += st.sum;
      });
      total = t;
    } else {
      total = raw.grandTotal || null;
    }

    var out = JSON.stringify({ success: true, stations: stations, total: total, scoped: !!scopeSet, asOf: raw.asOf || null });
    return out;
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * _aging_lmColumnMap_(headerRow)
 * [SỬA LỖI THẬT — "Quá Hạn trắng dù nguồn có dữ liệu"] Trước đây sheet '1. LM high aging'
 * được đọc theo VỊ TRÍ cột cố định (trạm = cột K...). Sheet nguồn đã đổi bố cục: thêm cột
 * order_status ở J, bỏ cột cogs và cột nhãn mốc -> mọi cột từ J trở đi lệch 1 vị trí, tên
 * trạm bị đọc thành trạng thái đơn ('Delivering'...) nên không trạm nào lọc ra đơn.
 * Nay dò theo TÊN TIÊU ĐỀ ở dòng 2 (spx_shipment_id, fleet_final_station, ...), nên sheet
 * thêm/bớt cột về sau không làm sai số liệu âm thầm nữa. Cột không tồn tại -> -1.
 * Không tìm thấy tiêu đề then chốt -> lùi về bố cục cũ (fallback=true) để không gãy hẳn.
 * Bố cục cũ (trạm ở K) vẫn nhận ra được: cột nhãn mốc khi đó nằm ở R.
 */
function _aging_lmColumnMap_(hdr) {
  var norm = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var pos = {};
  var set = function (k, c) { if (pos[k] === undefined) pos[k] = c; };
  for (var c = 0; c < (hdr ? hdr.length : 0); c++) {
    var h = norm(hdr[c]);
    if (!h) continue;
    if (h === 'spx_shipment_id') set('ship', c);
    else if (h === 'fleet_final_status') set('status', c);
    else if (h === 'fleet_final_station') set('hub', c);
    else if (h.indexOf('inbound_date_current') === 0) set('inbound', c);
    else if (h.indexOf('deliver_attempt') === 0) set('att', c);
    else if (h.indexOf('timing_date') === 0) set('timing', c);
    else if (/^aging(\(sum\))?$/.test(h)) set('aging', c);
    else if (h.indexOf('cogs') === 0) set('cogs', c);
    else if (/bucket|nhóm tồn|nhãn mốc/.test(h)) set('bucket', c);
    else if (h === 'aom') set('aom', c);
    else if (h === 'sup') set('sup', c);
    else if (h.indexOf('đến hạn lost') === 0) set('lost', c);
    else if (h.indexOf('trạng thái xử lý') === 0) set('proc', c);
  }
  var M;
  if (pos.ship === undefined || pos.hub === undefined) {
    M = { ship: 5, status: 9, hub: 10, inbound: 11, att: 13, timing: 14, aging: 15, cogs: 16, bucket: 17,
          lost: 0, proc: 1, aom: 2, sup: 3, fallback: true };
  } else {
    var g = function (k, d) { return pos[k] !== undefined ? pos[k] : d; };
    M = { ship: pos.ship, status: g('status', -1), hub: pos.hub, inbound: g('inbound', -1), att: g('att', -1),
          timing: g('timing', -1), aging: g('aging', -1), cogs: g('cogs', -1),
          bucket: g('bucket', pos.hub === 10 ? 17 : -1),
          lost: g('lost', 0), proc: g('proc', 1), aom: g('aom', 2), sup: g('sup', 3), fallback: false };
  }
  M.width = Math.max(M.ship, M.status, M.hub, M.inbound, M.att, M.timing, M.aging, M.cogs, M.bucket,
                     M.lost, M.proc, M.aom, M.sup) + 1;
  return M;
}

function _aging_getCoreDataFromSS(ss) {
  try {
    const sheet = ss.getSheetByName('1. LM high aging');
    if (!sheet) return JSON.stringify({ success: false, error: "Không thấy sheet '1. LM high aging'" });
    const lastRow = sheet.getLastRow();
    if (lastRow < 3) return JSON.stringify({ success: true, data: [], hubs: [] });
    const nCols = Math.min(sheet.getMaxColumns(), Math.max(sheet.getLastColumn(), 18));
    const values  = sheet.getRange(1, 1, lastRow, nCols).getValues();
    // [SỬA] Dò cột theo tiêu đề dòng 2 — xem _aging_lmColumnMap_().
    const M = _aging_lmColumnMap_(values[1]);
    if (M.fallback) { try { _LOG.d('[Aging Core] Không dò được tiêu đề cột — dùng bố cục cũ, CÓ THỂ SAI.'); } catch (eLg) {} }
    const data = []; const hubs = new Set();
    for (let i = 2; i < values.length; i++) {
      const row = values[i];
      if (!row[M.ship] || row[M.ship].toString().trim() === "") continue;
      const hub = row[M.hub] ? row[M.hub].toString().trim() : "";
      // [TỐI ƯU DUNG LƯỢNG — giữ nguyên] bản chụp ghi vào Google Sheet chia khối 45.000 ký tự,
      // mỗi byte thêm vào 1 bản ghi nhân với hàng chục nghìn dòng: hasAttempt bỏ hẳn (suy ra
      // từ att), inboundAt cắt tới phút, deliverAttempt đặt tên ngắn 'att'.
      const rec = {
        lostToday: row[M.lost], processStatus: row[M.proc],
        aom: row[M.aom] ? row[M.aom].toString().trim() : "",
        sup: row[M.sup] ? row[M.sup].toString().trim() : "",
        shipmentId: row[M.ship].toString().trim(),
        finalStatus: M.status >= 0 ? row[M.status] : "",
        hubName: hub,
        // timingDate = số ngày tồn TẠI TRẠM HIỆN TẠI. Nhãn mốc (agingBucket) chỉ có khi sheet
        // còn cột đó; thiếu thì frontend tự chia mốc từ timingDate (đã có sẵn đường dự phòng).
        timingDate: M.timing >= 0 ? row[M.timing] : "",
        aging: M.aging >= 0 ? row[M.aging] : "",
        agingBucket: (M.bucket >= 0 && row[M.bucket]) ? row[M.bucket].toString().trim() : "",
        att: M.att >= 0 ? row[M.att] : "",
        inboundAt: (M.inbound >= 0 && row[M.inbound] instanceof Date && !isNaN(row[M.inbound]))
          ? Utilities.formatDate(row[M.inbound], 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm")
          : ''
      };
      // cogs chỉ có khi sheet còn cột này — vắng thì BỎ HẲN field (tiết kiệm dung lượng, và
      // frontend nhận ra "nguồn không có COGS" để ẩn thẻ/hiện "—" thay vì hiện 0 đ sai lệch).
      if (M.cogs >= 0) rec.cogs = row[M.cogs];
      data.push(rec);
      if (hub) hubs.add(hub);
    }
    // [MỚI] Chốt chặn: cột "trạm" phải chứa tên trạm. Nếu hầu hết dòng không có chữ Hub/SOC/Station
    // (VD cột bị lệch, đọc ra trạng thái đơn) thì TỪ CHỐI — giữ bản chụp tốt trước đó và báo lỗi rõ,
    // thay vì xuất bản dữ liệu rác khiến bảng trắng mà không ai biết nguyên nhân.
    if (data.length >= 50) {
      let _okHub = 0;
      for (let k = 0; k < data.length; k++) { if (/hub|soc|station/i.test(data[k].hubName)) _okHub++; }
      // Đo thật: bố cục đúng = 100% dòng có chữ Hub/SOC/Station; đọc nhầm sang cột trạng thái đơn = ~12%
      // (vì có 'LMHub_Received'...). Ngưỡng 60% nằm giữa, chừa biên rộng cho cả hai phía.
      if (_okHub / data.length < 0.6) {
        return JSON.stringify({ success: false, error: 'Cột trạm không chứa tên trạm (' + _okHub + '/' + data.length + ' dòng có chữ Hub/SOC/Station) — sheet nguồn có thể đã đổi bố cục. Giữ nguyên bản chụp trước đó.' });
      }
    }
    return JSON.stringify({ success: true, data, hubs: Array.from(hubs).sort() });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

function _aging_getLostDataFromSS(ss) {
  try {
    const sheetLost = ss.getSheetByName('Raw');
    if (!sheetLost || sheetLost.getLastRow() < 1) return JSON.stringify({ success: true, data: [] });
    // [SỬA] Dò cột theo TIÊU ĐỀ đã ghim (xem _spx_pinnedCols_) thay vì cột C/D/F/J/K cố định.
    // Thử lại 1 lần sau vài giây: nguồn ghi đè đẩy dần nên tiêu đề có thể trống thoáng qua.
    let LC = null, lcErr = null;
    for (let attempt = 0; attempt < 2 && !LC; attempt++) {
      try { LC = _aging_lostCols_(sheetLost); } catch (eLc) { lcErr = eLc; if (attempt === 0) Utilities.sleep(4000); }
    }
    if (!LC) {
      // KHÔNG làm hỏng cả bản chụp Quá Hạn (phần LM vẫn đúng): bỏ riêng phần Chốt Lost và BÁO RÕ.
      _spx_setColWarn_('aging:lost_raw', 'Sheet Raw (Chốt Lost) đang bị bỏ qua: ' + (lcErr ? lcErr.message : ''));
      return JSON.stringify({ success: true, data: [], hubs: [], warning: lcErr ? lcErr.message : '' });
    }
    const values = sheetLost.getRange(1, 1, sheetLost.getLastRow(), Math.min(sheetLost.getMaxColumns(), _spx_maxIdx_(LC) + 1)).getValues();
    const data   = [];
    for (let i = 1; i < values.length; i++) {
      if (!values[i][LC.ship]) continue;
      let shipmentId = values[i][LC.ship].toString().trim();
      if (['spx_shipment_id','mã đơn hàng','spx tracking'].includes(shipmentId.toLowerCase())) continue;
      data.push({
        isChotLost: true, lostToday: "", processStatus: values[i][LC.proc] ? values[i][LC.proc].toString() : "",
        aom: "-", sup: "-", shipmentId,
        finalStatus: values[i][LC.status] ? values[i][LC.status].toString() : "",
        hubName: values[i][LC.hub]  ? values[i][LC.hub].toString()  : "",
        aging: "CHỐT LOST",
        cogs: values[i][LC.cogs] ? Number(values[i][LC.cogs]).toLocaleString('vi-VN')+' đ' : "0 đ"
      });
    }
    // Chốt chặn: cột trạm phải chứa tên trạm; nếu không, tiêu đề đã ghim có thể SAI -> bỏ ghim, bỏ phần này.
    if (data.length >= 20) {
      let ok = 0;
      for (let k = 0; k < data.length; k++) { if (/hub|soc|station/i.test(data[k].hubName)) ok++; }
      if (ok / data.length < 0.6) {
        try { PropertiesService.getScriptProperties().deleteProperty('spx_colpin_lost_raw'); } catch (eDp) {}
        const msg = 'Cột trạm của sheet Raw không giống tên trạm (' + ok + '/' + data.length + ') — đã bỏ ghim tiêu đề, phần Chốt Lost tạm bị bỏ qua; chạy spx_diagAllColumns() để kiểm tra.';
        _spx_setColWarn_('aging:lost_raw', msg);
        return JSON.stringify({ success: true, data: [], hubs: [], warning: msg });
      }
    }
    _spx_setColWarn_('aging:lost_raw', null);
    return JSON.stringify({ success: true, data, hubs: [] });
  } catch (e) { return JSON.stringify({ error: e.message }); }
}

/**
 * pick_getFmHighAging()
 * [MỚI — khai thác sheet '2. FM high aging' đang bị bỏ phí]
 * Trả về CHI TIẾT các đơn FirstMile tồn đọng kéo dài, kèm THAO TÁC CẦN XỬ LÝ
 * (cột 'action' — đã xác nhận với nghiệp vụ đây là việc nhân viên trạm phải
 * làm, không phải nhãn phân loại nội bộ).
 *
 * VÌ SAO VIẾT HÀM RIÊNG, KHÔNG SỬA _aging_getFMDataFromSS():
 *   Hàm đó CỐ Ý chỉ đọc 1 cột (shipment_id) để đếm badge — comment tại chỗ ghi
 *   rõ đã giảm ~21 lần lượng dữ liệu sau khi xác nhận "không nơi nào đọc field
 *   cụ thể". Sửa nó sẽ phá tối ưu đó và làm nặng luồng Quá Hạn vốn đã tải
 *   37.336 bản ghi LM. Tách riêng để JS_Pick tự gọi khi cần.
 *
 * CHI PHÍ (đo thật trên file nguồn, không ước lượng):
 *   - Sheet chỉ có 113 dòng dữ liệu (so với 37.336 dòng của LM — nhỏ hơn 330 lần)
 *   - Đọc 113 x 27 = 3.051 ô (LM đọc 672.048 ô)
 *   - Trả về ~28.6 KB = 0.26% payload của LM
 *   => Không ảnh hưởng trần thời gian/dung lượng của Apps Script.
 *
 * CẤU TRÚC SHEET (xác minh trực tiếp):
 *   dòng 1 = ghi chú, dòng 2 (index 1) = TIÊU ĐỀ, dữ liệu từ dòng 3.
 *   [0]shipment_id [1]station_name [8]status_desc [10]pickup_station_name
 *   [12]order_type [13]action [19]timing_day [20]cogs [23]risk level
 */
/**
 * pick_getFmSummary(stationFilter)
 * [MỚI — khai thác sheet 'summary FM realtime' chưa từng được đọc]
 * Trả về số liệu FirstMile tổng hợp sẵn theo 4 GIAI ĐOẠN và 5 LOẠI ĐƠN.
 *
 * VÌ SAO DÙNG SHEET NÀY THAY VÌ TỰ CỘNG TỪ SHEET CHI TIẾT:
 *   Đã đối chiếu toàn diện 2 nguồn, khớp TUYỆT ĐỐI:
 *     - 4 giai đoạn: 102.597 / 22.533 / 1.482 / 9.981 (khớp 100%)
 *     - Cấp từng trạm: 319/319 trạm khớp, không lệch dòng nào
 *     - 5 loại đơn: MP 68.572 · Social 31.923 · Reverse 36.075 · CB 23 · WH 0
 *   => Nội dung KHÔNG mới, nhưng chênh lệch HIỆU NĂNG rất lớn:
 *     - '3. FM action realtime': 136.594 dòng, phải đọc theo lô kèm ngân sách
 *       thời gian, CÓ THỂ ĐỌC KHÔNG HẾT khi hết giờ (xem pick_getLiveFmActions)
 *     - 'summary FM realtime'  : 327 dòng, đọc 1 lần — nhẹ hơn 418 lần, số
 *       liệu chắc chắn đầy đủ, không phụ thuộc ngân sách thời gian.
 *   Dùng sheet tổng hợp cho CON SỐ, giữ sheet chi tiết cho TRA CỨU TỪNG ĐƠN.
 *
 * CẤU TRÚC (xác minh trực tiếp): dòng 2 (index 1) = tiêu đề, dữ liệu từ dòng 3.
 *   Sheet có 2 KHỐI LỒNG NHAU như 'Backlog FM+LM' — 7 dòng đầu là AOM, phần
 *   còn lại (319 dòng) là Hub; cộng riêng mỗi khối đều ra 136.593 (tức trùng
 *   nhau, KHÔNG được cộng cả hai). Phân biệt bằng tên chứa 'Hub'/'SOC'.
 *   [1]AOM/Station [2]Pending Pickup [3]Pending Inbound [4]Pending Packed
 *   [5]Pending Seal [6]MP [7]Social [8]Reverse [9]CB [10]WH
 */
function pick_getFmSummary(stationFilter, scopeStationsJson) {
  try {
    _requireApproved_();

    // [SỬA LỖI THIẾT KẾ — báo cáo trực tiếp kèm ảnh: "chọn trạm cụ thể, level
    // Lead mà ra dữ liệu toàn quốc 319 trạm"] TRƯỚC ĐÂY hàm này KHÔNG kiểm tra
    // phạm vi nào — luôn cộng cả 319 trạm toàn hệ thống cho MỌI cấp. Sai cả
    // nghiệp vụ (Lead cần số của trạm mình, không phải cả nước) lẫn quyền dữ
    // liệu. Áp ĐÚNG cơ chế đã dùng ở qh_getBacklogByStation.
    var email = Session.getActiveUser().getEmail();
    var perm  = checkAnalyticsPermission(email);
    if (!perm || !perm.allowed) return JSON.stringify({ success: false, error: 'Không có quyền truy cập.' });

    var scopeList = null;
    try {
      if (scopeStationsJson) {
        var arr = JSON.parse(scopeStationsJson);
        if (Array.isArray(arr) && arr.length) scopeList = arr;
      }
    } catch (eP) { scopeList = null; }
    // Không truyền scope + không phải Admin -> dùng đúng quyền thật.
    if (!scopeList && !perm.isAdmin) scopeList = perm.stations || [];

    var scopeSet = null;
    if (scopeList && scopeList.length) {
      scopeSet = {};
      scopeList.forEach(function(s){
        var k = String(s || '').trim().toLowerCase();
        if (k) scopeSet[k] = true;
      });
      if (!Object.keys(scopeSet).length) scopeSet = null;
    }

    var want = String(stationFilter || '').trim().toLowerCase();
    var cacheKey = 'pick_fm_summary_v2_' + (want || 'ALL') + '_' +
      (scopeSet ? Utilities.base64EncodeWebSafe(Object.keys(scopeSet).sort().join('|')).slice(0, 60) : 'ALL');
    var cache = CacheService.getScriptCache();
    var hit = cache.get(cacheKey);
    if (hit) return hit;

    var ss = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
    var sheet = ss.getSheetByName('summary FM realtime');
    if (!sheet) return JSON.stringify({ success: false, error: "Không thấy sheet 'summary FM realtime'" });

    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return JSON.stringify({ success: true, mine: null, total: null });
    // [SỬA] Dò cột theo TIÊU ĐỀ (dòng 2) — xem _spx_findCols_().
    var _hdrS = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
    var S = _spx_findCols_(_hdrS, _SPX_SPEC_FMSUM_);
    _spx_requireCols_("Sheet 'summary FM realtime'", S, _SPX_REQ_FMSUM_, _hdrS);
    var values = sheet.getRange(1, 1, lastRow, Math.min(sheet.getMaxColumns(), _spx_maxIdx_(S) + 1)).getValues();

    function emptyAgg() {
      return { pickup: 0, inbound: 0, packed: 0, seal: 0,
               mp: 0, social: 0, reverse: 0, cb: 0, wh: 0, sum: 0 };
    }
    function addRow(agg, row) {
      function n(v) { return (typeof v === 'number') ? v : 0; }
      agg.pickup  += n(row[S.pickup]); agg.inbound += n(row[S.inbound]);
      agg.packed  += n(row[S.packed]); agg.seal    += n(row[S.seal]);
      agg.mp      += n(row[S.mp]); agg.social  += n(row[S.social]);
      agg.reverse += n(row[S.reverse]); agg.cb      += n(row[S.cb]); agg.wh += n(row[S.wh]);
      agg.sum = agg.pickup + agg.inbound + agg.packed + agg.seal;
      return agg;
    }

    var total = emptyAgg();
    var mine = null;
    var nStations = 0;

    for (var i = 2; i < values.length; i++) {
      var nm = values[i][S.name];
      if (!nm || typeof nm !== 'string') continue;
      nm = nm.trim();
      if (!nm || nm === 'Hub') continue;
      // CHỈ lấy khối Hub — khối AOM phía trên là CÙNG dữ liệu gộp lại, cộng cả
      // hai sẽ ra gấp đôi (đã kiểm chứng: mỗi khối đều ra đúng 136.593).
      var up = nm.toUpperCase();
      if (up.indexOf('HUB') < 0 && up.indexOf('SOC') < 0) continue;
      // [SỬA] Chỉ cộng trạm trong phạm vi được phân quyền — xem ghi chú đầu hàm.
      if (scopeSet && !scopeSet[nm.toLowerCase()]) continue;

      addRow(total, values[i]);
      nStations++;
      if (want && nm.toLowerCase() === want) {
        mine = addRow(emptyAgg(), values[i]);
        mine.station = nm;
      }
    }

    var out = JSON.stringify({ success: true, mine: mine, total: total, nStations: nStations, scoped: !!scopeSet });
    // Sheet cập nhật theo lịch (ghi trên chính sheet), cache 15 phút là đủ
    // tươi mà vẫn tránh đọc lặp khi nhiều người cùng mở module.
    try { cache.put(cacheKey, out, 900); } catch (eC) {}
    return out;
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

function pick_getFmHighAging(stationFilter, scopeStationsJson) {
  try {
    _requireApproved_();
    // [SỬA — cùng đợt sửa phạm vi] TRƯỚC ĐÂY chỉ lọc khi có tên trạm cụ thể;
    // nếu người dùng ở chế độ ALL thì trả về đơn của TOÀN HỆ THỐNG. Nay giới
    // hạn theo đúng quyền, giống pick_getFmSummary/qh_getBacklogByStation.
    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm || !_perm.allowed) return JSON.stringify({ success: false, error: 'Không có quyền truy cập.' });

    var _scopeList = null;
    try {
      if (scopeStationsJson) {
        var _arr = JSON.parse(scopeStationsJson);
        if (Array.isArray(_arr) && _arr.length) _scopeList = _arr;
      }
    } catch (eP2) { _scopeList = null; }
    if (!_scopeList && !_perm.isAdmin) _scopeList = _perm.stations || [];

    var scopeSet = null;
    if (_scopeList && _scopeList.length) {
      scopeSet = {};
      _scopeList.forEach(function(s){
        var k = String(s || '').trim().toLowerCase();
        if (k) scopeSet[k] = true;
      });
      if (!Object.keys(scopeSet).length) scopeSet = null;
    }

    var ss = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
    var sheet = ss.getSheetByName('2. FM high aging');
    if (!sheet) return JSON.stringify({ success: false, error: "Không thấy sheet '2. FM high aging'" });

    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return JSON.stringify({ success: true, data: [], byAction: {}, byRisk: {} });

    // Đọc tới cột 24 (index 23 = 'risk level') — không đọc thừa 3 cột cuối
    // (kí tự/AOM/SUP) vì AOM/SUP đã có sẵn ở nguồn khác trong hệ thống.
    // [SỬA] Dò cột theo TIÊU ĐỀ (dòng 2) thay vì vị trí cố định — xem _spx_findCols_().
    var _hdrFm = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
    var F = _spx_findCols_(_hdrFm, _SPX_SPEC_FMHA_);
    _spx_requireCols_("Sheet '2. FM high aging'", F, _SPX_REQ_FMHA_, _hdrFm);
    var _cell = function (r, k) { return F[k] === undefined ? undefined : r[F[k]]; };
    var values = sheet.getRange(2, 1, lastRow - 1, Math.min(sheet.getMaxColumns(), _spx_maxIdx_(F) + 1)).getValues();

    var wantStation = String(stationFilter || '').trim().toLowerCase();
    var data = [], byAction = {}, byRisk = {};

    for (var i = 1; i < values.length; i++) { // i=0 là dòng tiêu đề
      var row = values[i];
      var id = _cell(row, 'id');
      if (!id || String(id).trim() === '') continue;

      var station = _cell(row, 'station') ? String(_cell(row, 'station')).trim() : '';
      // Lọc theo trạm NGAY TẠI BACKEND — tránh gửi cả 113 đơn của toàn hệ
      // thống về client rồi mới lọc bỏ đi.
      if (wantStation && station.toLowerCase() !== wantStation) continue;
      // [SỬA] Kể cả khi không chọn trạm cụ thể (ALL), vẫn phải giới hạn trong
      // phạm vi được phân quyền — xem ghi chú đầu hàm.
      if (scopeSet && !scopeSet[station.toLowerCase()]) continue;

      var action = _cell(row, 'action') ? String(_cell(row, 'action')).trim() : '';
      var risk   = _cell(row, 'risk') ? String(_cell(row, 'risk')).trim() : '';

      if (action) byAction[action] = (byAction[action] || 0) + 1;
      if (risk)   byRisk[risk]     = (byRisk[risk] || 0) + 1;

      data.push({
        id: String(id).trim(),
        station: station,
        action: action,                                          // THAO TÁC CẦN LÀM
        risk: risk,                                              // mức tuổi (2-5 Day, >7 Day...)
        status: _cell(row, 'status') ? String(_cell(row, 'status')).trim() : '',              // status_desc
        pickupStation: _cell(row, 'pickup') ? String(_cell(row, 'pickup')).trim() : '',
        orderType: _cell(row, 'otype') ? String(_cell(row, 'otype')).trim() : '',
        days: (typeof _cell(row, 'days') === 'number') ? _cell(row, 'days') : null,     // timing_day
        cogs: (typeof _cell(row, 'cogs') === 'number') ? _cell(row, 'cogs') : 0
      });
    }

    return JSON.stringify({ success: true, data: data, byAction: byAction, byRisk: byRisk });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// =========================================================================
// [MỚI — "cấu trúc sheet nguồn đổi (VD cột Trạm từ K sang N) thì không lẽ lại sửa code?"]
// DÒ CỘT THEO TIÊU ĐỀ cho MỌI sheet nguồn thay vì vị trí cố định:
//   - _spx_findCols_()    : tìm cột theo tên tiêu đề (không phân biệt hoa/thường, dấu, khoảng trắng)
//   - _spx_requireCols_() : thiếu cột bắt buộc -> báo LỖI RÕ (nêu cột nào + tiêu đề đang có),
//                           KHÔNG đoán vị trí cũ rồi đọc ra dữ liệu sai âm thầm
//   - _spx_pinnedCols_()  : cho sheet chưa biết chắc tên tiêu đề (VD 'Raw' ở file Lost): lần đầu
//                           "học" tên tiêu đề đang ở các vị trí cũ rồi ghim lại; về sau tìm theo
//                           tên đã ghim -> cột dịch chỗ (K -> N) vẫn đọc đúng.
// Cột chỉ ĐỔI VỊ TRÍ thì code tự theo. Cột bị ĐỔI TÊN / XOÁ thì báo lỗi rõ để sửa 1 chỗ (spec).
// =========================================================================
function _spx_normHdr_(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
}
function _spx_colLetter_(n) {
  var s = ''; n++;
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
/** spec: { field: [ 'tên đã chuẩn hoá' | RegExp, ... ] } — thử lần lượt, lấy cột TRÁI NHẤT khớp. opts.from/to giới hạn dải cột. */
function _spx_findCols_(hdr, spec, opts) {
  opts = opts || {};
  var h = hdr || [];
  var from = opts.from || 0, to = (opts.to == null) ? h.length - 1 : Math.min(opts.to, h.length - 1);
  var norm = [];
  for (var c = from; c <= to; c++) norm[c] = _spx_normHdr_(h[c]);
  var out = {};
  Object.keys(spec).forEach(function (f) {
    var cands = spec[f];
    for (var ci = 0; ci < cands.length && out[f] === undefined; ci++) {
      for (var c2 = from; c2 <= to; c2++) {
        if (!norm[c2]) continue;
        var hit = (cands[ci] instanceof RegExp) ? cands[ci].test(norm[c2]) : (norm[c2] === cands[ci]);
        if (hit) { out[f] = c2; break; }
      }
    }
  });
  return out;
}
function _spx_requireCols_(label, found, required, hdr) {
  var miss = required.filter(function (f) { return found[f] === undefined; });
  if (miss.length) {
    var have = (hdr || []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(String).slice(0, 40).join(' | ');
    throw new Error(label + ': không tìm thấy cột [' + miss.join(', ') + '] theo tiêu đề. Tiêu đề hiện có: ' + have);
  }
}
function _spx_maxIdx_(F) {
  var m = 0; Object.keys(F).forEach(function (k) { if (F[k] > m) m = F[k]; });
  return m;
}
function _spx_pinnedCols_(key, hdr, legacy, nameSpec) {
  var props = PropertiesService.getScriptProperties();
  var propKey = 'spx_colpin_' + key;
  var pinned = {};
  try { pinned = JSON.parse(props.getProperty(propKey) || '{}'); } catch (e0) { pinned = {}; }
  var h = hdr || [];
  var norm = h.map(_spx_normHdr_);
  var out = {}, learned = false, problems = [];
  Object.keys(legacy).forEach(function (f) {
    if (nameSpec && nameSpec[f]) {                       // 1) tên đã biết chắc
      var spec = {}; spec[f] = nameSpec[f];
      var fo = _spx_findCols_(h, spec);
      if (fo[f] !== undefined) { out[f] = fo[f]; return; }
    }
    if (pinned[f]) {                                     // 2) tên đã ghim từ lần trước
      var seen = 0, idx = -1;
      for (var c = 0; c < norm.length; c++) {
        if (norm[c] === pinned[f].h) { if (seen === pinned[f].n) { idx = c; break; } seen++; }
      }
      if (idx >= 0) { out[f] = idx; return; }
      problems.push(f + ' (tiêu đề đã ghim: "' + pinned[f].raw + '")');
      return;
    }
    var li = legacy[f];                                  // 3) chưa ghim: học từ vị trí cũ
    if (norm[li]) {
      var n = 0; for (var c2 = 0; c2 < li; c2++) if (norm[c2] === norm[li]) n++;
      pinned[f] = { h: norm[li], n: n, raw: String(h[li]) };
      learned = true;
    }
    out[f] = li;
  });
  if (problems.length) {
    throw new Error('không tìm thấy các cột đã ghim: ' + problems.join(', ') + '. Tiêu đề hiện có: ' +
      h.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(String).slice(0, 30).join(' | ') +
      '. Nếu chủ ý đổi tên cột, chạy spx_resetColumnAnchors() để học lại.');
  }
  if (learned) { try { props.setProperty(propKey, JSON.stringify(pinned)); } catch (e1) {} }
  return out;
}
var SPX_COLWARN_KEY = 'spx_col_warn_v1';
function _spx_setColWarn_(key, msg) {
  try {
    var p = PropertiesService.getScriptProperties();
    var cur = p.getProperty(SPX_COLWARN_KEY) || '{}';
    var m = {}; try { m = JSON.parse(cur); } catch (e0) { m = {}; }
    if (msg) m[key] = String(msg).slice(0, 300); else delete m[key];
    var s = JSON.stringify(m);
    if (s !== cur) p.setProperty(SPX_COLWARN_KEY, s);
  } catch (e) {}
}
function _spx_getColWarn_(prefix) {
  try {
    var m = JSON.parse(PropertiesService.getScriptProperties().getProperty(SPX_COLWARN_KEY) || '{}');
    return Object.keys(m).filter(function (k) { return !prefix || k.indexOf(prefix) === 0; }).map(function (k) { return m[k]; }).join(' | ');
  } catch (e) { return ''; }
}
// ---- Đặc tả cột từng sheet (tên tiêu đề THẬT, đối chiếu file export) ----
var _SPX_SPEC_FMHA_  = { id: ['shipment_id', 'spx_shipment_id'], station: ['station_name'], status: ['status_desc'],
                         pickup: ['pickup_station_name'], otype: ['order_type'], action: ['action'],
                         days: ['timing_day', 'timing_day(sum)'], cogs: ['cogs', 'cogs(sum)'], risk: ['risk level', 'risk_level'] };
var _SPX_REQ_FMHA_   = ['id', 'station', 'action', 'risk'];
var _SPX_SPEC_FMACT_ = { id: ['shipment_id', 'spx_shipment_id'], station: ['station_name'], created: ['created_time'],
                         last: ['last_touch_at'], status: ['fleet_final_status'], product: ['product_name'],
                         otype: ['order_type'], action: ['action_needed'] };
var _SPX_REQ_FMACT_  = ['id', 'station'];
var _SPX_SPEC_FMSUM_ = { name: ['aom', 'hub'], pickup: [/pending pickup/], inbound: [/pending inbound/], packed: [/pending packed/],
                         seal: [/pending seal/], mp: ['mp'], social: ['social'], reverse: ['reverse'], cb: ['cb'], wh: ['wh'] };
var _SPX_REQ_FMSUM_  = ['name', 'pickup', 'inbound', 'packed', 'seal', 'mp', 'social', 'reverse', 'cb', 'wh'];
var _SPX_SPEC_BKLM_  = { station: ['station'], over7: [/^>\s*7/], d57: [/^5\s*-\s*7/], d25: [/^2\s*-\s*5/],
                         mid: [/^(37h|1)\s*-\s*2/], low: [/^<\s*=?\s*(37h|1)\b/] };
var _SPX_REQ_BKLM_   = ['station', 'over7', 'd57', 'd25', 'mid', 'low'];
var _SPX_LOST_LEGACY_ = { ship: 2, proc: 3, hub: 5, cogs: 9, status: 10 };
function _aging_lostCols_(sheet) {
  var nc = Math.min(sheet.getMaxColumns(), Math.max(sheet.getLastColumn(), 11));
  var hdr = sheet.getRange(1, 1, 1, nc).getValues()[0];
  return _spx_pinnedCols_('lost_raw', hdr, _SPX_LOST_LEGACY_, { ship: ['spx_shipment_id', 'ma don hang', 'spx tracking'] });
}

function _aging_getFMDataFromSS(ss) {
  try {
    // [FIX 2026-07] Sheet thật tên '2. FM high aging' (đã đổi cấu trúc cột nhưng GIỮ
    // NGUYÊN thứ tự cột cũ — xem mapping row[] bên dưới, đã đối chiếu khớp với sheet
    // thật). Trước đây code tìm sheet tên 'FM realtime' — sheet này không tồn tại
    // (đã đổi tên/không còn dùng), khiến getSheetByName() trả về null và toàn bộ
    // luồng aging_getMasterData() (nguồn dữ liệu chính của Module Quá Hạn, tab Hàng
    // Lấy) bị lỗi "Không thấy sheet FM realtime", không trả được dữ liệu nào.
    const sheet = ss.getSheetByName('2. FM high aging');
    if (!sheet) return JSON.stringify({ success: false, error: "Không thấy sheet '2. FM high aging'" });
    const lastRow = sheet.getLastRow();
    if (lastRow < 3) return JSON.stringify({ success: true, count: 0 });
    // [FIX 2026-07-30] Trước đây đọc TOÀN BỘ 21 cột rồi dựng object 9 field/dòng —
    // nhưng đối chiếu kỹ index.html + JS_FMS.html + aging_getMasterData() xác nhận
    // KHÔNG NƠI NÀO đọc field cụ thể, chỉ dùng .length (đếm badge). Giờ chỉ đọc
    // ĐÚNG cột A (shipment_id, để giữ nguyên điều kiện "dòng có id mới tính") —
    // giảm ~21 lần lượng dữ liệu tải về cho đúng phần dữ liệu này, không đổi kết
    // quả trả về (aging_getMasterData() vẫn tự dựng lại đúng số lượng object rỗng
    // như cũ dựa trên count này).
    // [SỬA] Dò cột mã đơn theo TIÊU ĐỀ (dòng 2). Đồng thời sửa lỗi lệch 1: trước đây đọc từ dòng 2 —
    // chính là dòng TIÊU ĐỀ ('shipment_id') — nên badge đếm dư 1; dữ liệu thật bắt đầu từ dòng 3.
    const _hdrCnt = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
    const _Fc = _spx_findCols_(_hdrCnt, { id: _SPX_SPEC_FMHA_.id });
    _spx_requireCols_("Sheet '2. FM high aging'", _Fc, ['id'], _hdrCnt);
    const idCol = sheet.getRange(3, _Fc.id + 1, lastRow - 2, 1).getValues();
    let count = 0;
    for (let i = 0; i < idCol.length; i++) { if (idCol[i][0]) count++; }
    return JSON.stringify({ success: true, count: count });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

// [OPT] Cache wrapper cho notes — TTL 600s (10 phút), cache key cố định.
// Không truyền activeIds vào để tránh dọn orphan trong cold path chính.
// Orphan sẽ được dọn bởi trigger aging_orphanCleanup() chạy riêng (mỗi 6h).
// Cache bị xóa chủ động trong aging_saveNote() → data vẫn near-realtime.
function _aging_getNotesWithCache(ss, activeIds) {
  const sc        = CacheService.getScriptCache();
  const NOTES_KEY = 'aging_notes_v2';
  const NOTES_TTL = 600; // 10 phút

  try {
    const cached = sc.get(NOTES_KEY);
    if (cached) return cached; // cache hit — không mở ssNote
  } catch(ce) {}

  // Cache miss — đọc sheet thật, NHƯNG không dọn orphan (tránh clearContents trong cold path)
  const result = _aging_getNotesFromSS(ss, null); // null = không dọn orphan
  try { sc.put(NOTES_KEY, result, NOTES_TTL); } catch(ce) {}
  return result;
}

// Invalidate notes cache — gọi sau mỗi write operation
function _aging_invalidateNotesCache() {
  try { CacheService.getScriptCache().remove('aging_notes_v2'); } catch(e) {}
}

function _aging_getNotesFromSS(ss, activeIds) {
  try {
    const sheet = ss.getSheetByName('App_Notes');
    if (!sheet) return JSON.stringify({ success: true, notes: {} });
    const data  = sheet.getDataRange().getDisplayValues();

    var notesDict = {};
    var keepRows  = [];   // rows được giữ lại sau khi dọn orphan
    var hasOrphan = false;

    for (var i = 0; i < data.length; i++) {
      var id = data[i][0].toString().trim();

      // Giữ nguyên header row
      if (!id || id.toUpperCase() === 'TRACKING ID' || id.toUpperCase() === 'MÃ ĐƠN HÀNG') {
        keepRows.push(data[i]);
        continue;
      }

      // Nếu có activeIds và mã đơn KHÔNG còn trong data → orphan, bỏ qua (xóa)
      if (activeIds && activeIds.size > 0 && !activeIds.has(id)) {
        hasOrphan = true;
        _LOG.d('[Notes] Xóa note orphan: ' + id);
        continue;
      }

      notesDict[id] = { text: data[i][1], user: data[i][2], time: data[i][3] };
      keepRows.push(data[i]);
    }

    // Chỉ ghi lại sheet khi thực sự có orphan bị dọn (tránh write thừa)
    if (hasOrphan) {
      // [FIX NGHẼN LOCK 2026-07-24] Dùng CHUNG named lock 'aging_notes_write_lock_v1'
      // với aging_saveNote() (cùng ghi sheet App_Notes) — không còn kéo cả hệ thống chờ.
      if (_anaAcquireNamedLock('aging_notes_write_lock_v1', 8000, 15000)) {
        try {
          // [SỬA — cùng lỗi đã phát hiện và sửa ở phần archive đơn hàng:
          // clearContents() TOÀN BỘ sheet RỒI MỚI ghi lại — nếu bị ngắt giữa
          // chừng (lock timeout, lỗi API tạm thời) thì mất trắng toàn bộ ghi
          // chú (kể cả header), không còn ở đâu khôi phục. Đảo thứ tự: ghi
          // keepRows TRƯỚC (đè đúng vị trí cũ, kể cả header vì header đã nằm
          // sẵn trong keepRows[0]), rồi mới dọn phần dư phía dưới.
          if (keepRows.length > 0) {
            sheet.getRange(1, 1, keepRows.length, keepRows[0].length).setValues(keepRows);
          }
          if (keepRows.length < data.length) {
            sheet.getRange(1 + keepRows.length, 1, data.length - keepRows.length, keepRows[0].length).clearContent();
          }
        } catch(le) { _LOG.d('[Notes] Lock error khi dọn orphan: ' + le.message); }
        finally { _anaReleaseNamedLock('aging_notes_write_lock_v1'); }
      }
    }

    return JSON.stringify({ success: true, notes: notesDict });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

/**
 * rq_getIndexSummary()
 * [MỚI — theo yêu cầu "Tổng quan phải trả lời được khu vực này đang có vấn đề
 * gì NGAY TỪ ĐẦU, không đợi user tự mở module"] Trước đây số liệu "đơn Đỏ khẩn
 * cấp" CHỈ có sau khi user tự mở Đơn cầu cứu (đọc window.RQ_allOrders, biến
 * do CHÍNH module đó tạo ra khi tải — module này KHÔNG được tải nền vì "ít
 * dùng hơn"). Hàm này tái dùng ĐÚNG các hàm nội bộ đã có sẵn trong getOrders()
 * thật (fetchOrderRows_/filterRowsForStations_/computeUrgencyLevel_/
 * getResolvedOrdersAndCleanup_) — KHÔNG viết lại công thức tính urgency, chỉ
 * gọi lại để có SỐ THẬT ngay từ Tổng quan, độc lập với việc module đã tải hay
 * chưa. Nhẹ hơn getOrders() thật — bỏ qua phần mail/trend không cần cho mục
 * đích chỉ đếm số.
 */
function rq_getIndexSummary(overrideHub) {
  try {
    var access = getCurrentUserAccess_();
    if (!access.email || access.role === 'UNAUTHORIZED') {
      return JSON.stringify({ success: false, redCount: 0 });
    }
    var fetched = fetchOrderRows_();
    // [MỚI — theo yêu cầu trực tiếp "Tổng quan không đổi theo level"] Chỉ khi
    // thật sự ADMIN (unrestricted) mới cho phép overrideHub — không phải lỗ
    // hổng cho AOM/SUP lách qua để xem hub ngoài quyền của họ.
    var rows;
    // [SỬA — cùng lỗi với các thẻ khác] Người dùng thường cũng được lọc theo
    // trạm đang chọn, NHƯNG chỉ khi trạm đó nằm trong tập được phép
    // (access.stations) — thu hẹp, không vượt quyền.
    // [SỬA — hỗ trợ nhiều trạm] Xem thử cấp SUP/AOM/ROM truyền DANH SÁCH trạm.
    // Mọi trạm trong danh sách đều phải nằm trong phạm vi được phép, nếu không thì
    // bỏ qua toàn bộ (không hạ thấp yêu cầu quyền chỉ vì có nhiều trạm).
    var _rqSc = _spxScopeHubs_(overrideHub);
    var _rqKeys = Object.keys(_rqSc.keys);
    var _rqOvOk = _rqKeys.length > 0 && (access.unrestricted ||
      (access.stations && typeof access.stations.has === 'function' &&
       _rqKeys.every(function (k) { return access.stations.has(k); })));
    if (_rqOvOk) {
      rows = filterRowsForStations_(fetched.rows, new Set(_rqKeys));
    } else {
      rows = access.unrestricted ? fetched.rows : filterRowsForStations_(fetched.rows, access.stations);
    }
    var resolvedList = [];
    try { resolvedList = getResolvedOrdersAndCleanup_(fetched.rows); } catch (eRes) {}
    var resolvedSet = {};
    resolvedList.forEach(function (t) { resolvedSet[t] = true; });
    var now = new Date();
    var redCount = 0;
    rows.forEach(function (r) {
      if (resolvedSet[r.tracking_no]) return; // đã xử lý — không tính
      if (computeUrgencyLevel_(r.export_date, now) === 'red') redCount++;
    });
    return JSON.stringify({ success: true, redCount: redCount, totalCount: rows.length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message, redCount: 0 });
  }
}

/**
 * vp_getIndexSummary()
 * [MỚI — cùng mục đích với rq_getIndexSummary() ở trên, áp dụng cho Vi phạm]
 * Tái dùng THẲNG getComplaintData(false) thật (đã có sẵn đầy đủ logic lọc
 * quyền + cache) — chỉ đếm thêm số case chưa gắn ticket_no, không viết lại
 * bất kỳ logic đọc/lọc dữ liệu nào.
 */
function vp_getIndexSummary(overrideHub) {
  // [SỬA — chẩn đoán "Tổng quan tải rất lâu": Vi phạm đo được 30-42 giây, KỂ CẢ
  // lần tải thứ hai] Hàm này phụ thuộc bộ nhớ đệm DỮ LIỆU THÔ (~20.000 dòng,
  // ~9MB, chia ~90 khúc) — không chắc lưu được (dung lượng tổng lớn, sát giới
  // hạn 100KB/khúc với tiếng Việt có dấu), nên thực tế gần như lần nào cũng đọc
  // lại cả sheet. Tổng quan chỉ cần 2 CON SỐ -> lưu thẳng kết quả tóm tắt (vài
  // chục byte, chắc chắn lưu được) theo đúng phạm vi quyền + trạm đang chọn.
  var _vpCk = '';
  try {
    var _vpA = getUserAccess();   // đã có bộ nhớ đệm 5 phút
    var _vpScope = (_vpA && _vpA.viewAll) ? 'ALL'
                 : ((_vpA && _vpA.allowedHubs) || []).map(function (h) { return normStationKey_(h); }).sort().join('~');
    // [SỬA — hỗ trợ nhiều trạm] Khoá đệm phải phản ánh ĐÚNG tập trạm, nếu không
    // kết quả của 1 trạm sẽ bị dùng lại cho cả nhóm trạm (và ngược lại).
    var _vpScopeHubs = _spxScopeHubs_(overrideHub);
    _vpCk = _spxSafeCacheKey_('vp_idx_v1_' + _vpScope + '_' + (_vpScopeHubs.empty ? 'ALL' : _vpScopeHubs.cacheKey()) + '_s' + _spxSrcStamp_(DATA_SPREADSHEET_ID));
    var _vpHit = _SPX_OV_FORCE_ ? null : CacheService.getScriptCache().get(_vpCk);
    if (_vpHit) { try { var _vh = JSON.parse(_vpHit); _vh._cacheHit = true; return JSON.stringify(_vh); } catch (eVh) { return _vpHit; } }
  } catch (eVc) { _vpCk = ''; }
  var _vpOut = _vpGetIndexSummaryUncached_(overrideHub);
  try {
    if (_vpCk && _vpOut && _vpOut.indexOf('"success":true') >= 0) {
      CacheService.getScriptCache().put(_vpCk, _vpOut, 600);   // 10 phút
    }
  } catch (eVp) {}
  return _vpOut;
}

function _vpGetIndexSummaryUncached_(overrideHub) {
  try {
    var rows = getComplaintData(!!_SPX_OV_FORCE_);   // force (Làm mới / có bản mới) -> đọc lại sheet thay vì dùng cache thô
    if (rows && rows.error) return JSON.stringify({ success: false, noTicketCount: 0 });
    // [MỚI — theo yêu cầu trực tiếp "Tổng quan không đổi theo level"] Lọc
    // thêm 1 lớp SAU khi đã có kết quả — an toàn hơn sửa sâu vào
    // getComplaintData() (hàm dùng chung phức tạp, có cache riêng). Chỉ Admin
    // thật (viewAll) mới dùng được overrideHub — không phải lỗ hổng cho AOM/
    // SUP lách qua để xem hub ngoài quyền của họ.
    // [SỬA LỖI THẬT — báo cáo: Tổng quan hiện "Vi phạm 20.118 vụ" trong khi
    // module Vi phạm của đúng trạm đó chỉ có 182 vụ]
    // TRƯỚC ĐÂY chỉ ADMIN mới được lọc theo trạm đang chọn ở header. Người dùng
    // khác nhận NGUYÊN phạm vi quyền (VD cả khu vực AOM) -> Tổng quan hiện tổng
    // nhiều trạm dù header đang chọn đúng 1 trạm.
    // Chặn người thường lọc là KHÔNG CẦN: getComplaintData() đã giới hạn theo
    // quyền TRƯỚC bước này, nên lọc thêm theo 1 trạm chỉ THU HẸP tập đã được
    // phép — không thể dùng để xem trạm ngoài quyền. An toàn cho mọi cấp.
    if (overrideHub) {
      try {
        var _vpSc = _spxScopeHubs_(overrideHub);
        rows = (rows || []).filter(function (r) { return _vpSc.has(r.station_name); });
      } catch (eVpAcc) {}
    }
    var noTicketCount = 0;
    (rows || []).forEach(function (r) { if (!r.ticket_no) noTicketCount++; });
    return JSON.stringify({ success: true, noTicketCount: noTicketCount, totalCount: (rows || []).length });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message, noTicketCount: 0 });
  }
}

/**
 * rp_getIndexSummary()
 * [MỚI — hoàn thành yêu cầu "Rider Plan cũng phải cần" trong Tổng quan] Đếm số
 * trạm CHƯA NHẬP Inbound hôm nay — tái dùng THẲNG loadRiderPlan()/
 * getCurrentUserAccess()/_rp_getAllHubsFromSA() đã có sẵn, không viết lại bất
 * kỳ logic đọc sheet nào. Mẫu số PHẢI lấy từ access.hubs/_rp_getAllHubsFromSA()
 * (toàn bộ trạm được phân quyền) — KHÔNG lấy từ Object.keys(kết quả trả về),
 * vì trạm CHƯA TỪNG nhập gì sẽ KHÔNG có dòng nào trong sheet Rider_Plan cả,
 * đếm theo cách đó sẽ bỏ sót đúng những trạm cần cảnh báo nhất. Ngày "hôm nay"
 * ép cứng Asia/Ho_Chi_Minh — cùng kỹ thuật _rp_currentMonth() đã dùng để tránh
 * lặp lại đúng lỗi lệch timezone đã từng sửa trong chính module này.
 */
function rp_getIndexSummary(overrideHub) {
  try {
    var access = getCurrentUserAccess();
    if (access.role === 'denied') return JSON.stringify({ success: false, missingCount: 0 });
    var monthStr = _rp_currentMonth();
    var planRes = loadRiderPlan(monthStr, access, overrideHub);
    if (!planRes.success) return JSON.stringify({ success: false, missingCount: 0 });
    // [MỚI — theo yêu cầu trực tiếp "Tổng quan không đổi theo level"] Khi có
    // overrideHub hợp lệ (chỉ Admin), mẫu số cũng phải thu hẹp về đúng 1 Hub
    // đó — giữ nguyên hành vi cũ (toàn bộ hub) khi không preview.
    // [SỬA LỖI THẬT — cùng lỗi với Vi phạm] Trước đây chỉ ADMIN mới lọc theo
    // trạm đang chọn ở header; người khác nhận nguyên phạm vi quyền. Lọc thêm
    // theo 1 trạm chỉ THU HẸP tập đã được phép -> an toàn cho mọi cấp. Vẫn kiểm
    // tra trạm đó nằm trong quyền để không ai lọc ra trạm ngoài phạm vi.
    // [SỬA HỒI QUY do chính lượt trước gây ra] Bản trước LUÔN đọc toàn bộ danh
    // sách trạm của Admin (_rp_getAllHubsFromSA — đọc sheet tổ chức) kể cả khi
    // đã chọn sẵn 1 trạm -> thêm 1 lượt đọc sheet thừa mỗi lần tải Tổng quan.
    // Nay chỉ đọc khi thật sự cần: Admin + KHÔNG chọn trạm cụ thể.
    var isAdm = (access.role === 'admin');
    var allHubs;
    if (overrideHub) {
      // [SỬA — hỗ trợ nhiều trạm] Xem thử cấp SUP/AOM/ROM gửi DANH SÁCH trạm.
      var _rpSc = _spxScopeHubs_(overrideHub);
      var _inScope = isAdm || _rpSc.list.every(function (oh) {
        return (access.hubs || []).some(function (h) {
          return String(h).trim().toLowerCase() === String(oh).trim().toLowerCase();
        });
      });
      allHubs = _inScope ? _rpSc.list.slice() : (isAdm ? _rp_getAllHubsFromSA() : (access.hubs || []));
    } else {
      allHubs = isAdm ? _rp_getAllHubsFromSA() : (access.hubs || []);
    }
    var todayIdx = parseInt(Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'd'), 10) - 1; // mảng 31 phần tử theo ngày
    var missingCount = 0;
    allHubs.forEach(function (hub) {
      var m = planRes.data[hub];
      var val = (m && m['Inbound TT']) ? m['Inbound TT'][todayIdx] : null;
      if (val === null || val === undefined || !(val > 0)) missingCount++;
    });

    // [MỚI — theo yêu cầu trực tiếp: "quản lý 1 trạm thì hiện 0 trạm làm gì?"]
    // Với ĐÚNG 1 trạm, đếm "số trạm chưa nhập" là vô nghĩa (chỉ ra 0 hoặc 1).
    // Trả thêm CHỈ SỐ THẬT của trạm hôm nay để thẻ Tổng quan hiện thứ hữu ích:
    // Inbound thực tế so với dự báo (FC) và số rider — đúng các con số người
    // quản trạm nhìn hằng ngày trong Rider Plan.
    var single = null;
    if (allHubs.length === 1) {
      var _m1 = planRes.data[allHubs[0]] || {};
      var _pick = function (k) {
        var arr = _m1[k];
        var v = (arr && arr.length > todayIdx) ? arr[todayIdx] : null;
        return (typeof v === 'number' && isFinite(v)) ? v : null;
      };
      var inb = _pick('Inbound TT'), fc = _pick('FC LM');
      single = {
        hub:       allHubs[0],
        inbound:   inb,
        fc:        fc,
        pct:       (inb != null && fc) ? Math.round(inb / fc * 100) : null,
        riders:    _pick('Rider TT'),
        ridersFc:  _pick('Riders FC'),
        entered:   !!(inb && inb > 0)
      };
    }
    return JSON.stringify({ success: true, missingCount: missingCount, totalCount: allHubs.length, single: single });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message, missingCount: 0 });
  }
}

/**
 * _spxSafeCacheKey_(key)
 * [MỚI — nguyên nhân thật của "Tổng quan tải rất lâu" với AOM/ROM]
 * CacheService của Apps Script giới hạn khoá TỐI ĐA 250 KÝ TỰ. Một số khoá
 * được ghép từ tên TOÀN BỘ trạm người dùng quản — đo thật: 40 trạm = 665 ký tự,
 * toàn vùng 383 trạm = 6.543 ký tự. Vượt giới hạn -> lệnh lưu ném lỗi, bị
 * try/catch nuốt im lặng -> KHÔNG BAO GIỜ có bộ nhớ đệm -> mỗi lần mở Tổng quan
 * đều đọc lại ~37.000 dòng (đo được 23-47 giây).
 * Admin không bị vì khoá của Admin chỉ là chữ 'ADMIN' ngắn.
 * Cách sửa: khoá dài thì thay phần đuôi bằng mã băm MD5 (cố định với cùng đầu
 * vào -> cùng phạm vi luôn ra cùng khoá, bộ nhớ đệm dùng lại được). Cùng ý
 * tưởng với _kpifail_scopeKey_() vốn đã làm đúng ở chỗ khác.
 */
function _spxSafeCacheKey_(key) {
  key = String(key == null ? '' : key);
  if (key.length <= 200) return key;
  try {
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key, Utilities.Charset.UTF_8);
    var hex = d.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
    return key.substring(0, 60).replace(/[^A-Za-z0-9_]/g, '_') + '_h' + hex;
  } catch (e) {
    var h = 0;
    for (var i = 0; i < key.length; i++) { h = ((h << 5) - h + key.charCodeAt(i)) | 0; }
    return key.substring(0, 60).replace(/[^A-Za-z0-9_]/g, '_') + '_j' + (h >>> 0).toString(36) + '_' + key.length;
  }
}

/**
 * spx_diagOverdueLost() — CHẠY THỦ CÔNG (chọn hàm rồi bấm Run).
 * [MỚI — báo cáo: "Tổng quan hiện 1 đơn quá hạn/chốt Lost nhưng mở module tìm
 * không ra"] Liệt kê ĐÚNG những đơn đang bị đếm, kèm giá trị cờ trên cột A của
 * file nguồn — để biết đơn đó là gì và vì sao module không hiện.
 * Đổi trạm cần tra ở SPX_DIAG_HUB bên dưới (để trống = mọi trạm trong quyền).
 */
var SPX_DIAG_HUB = '45-DLK Buon Ho Hub';

/**
 * spx_diagFindOrders() — CHẠY THỦ CÔNG (chọn hàm rồi bấm Run).
 * [MỚI — báo cáo: "UI hiện 2 đơn tồn >7 ngày nhưng tra file nguồn không có"]
 * Tra thẳng các mã đơn trong CẢ HAI nguồn thật (sheet tồn đọng và file đã chốt
 * Lost) tại thời điểm chạy — để phân biệt "dữ liệu ảo do bản tạm cũ trong trình
 * duyệt" với "đơn có thật mà tra sót".
 * Sửa danh sách mã cần tra ở SPX_DIAG_ORDERS bên dưới.
 */
var SPX_DIAG_ORDERS = ['SPXVN061367448829', 'SPXVN060001521429'];

function spx_diagFindOrders() {
  var want = {};
  SPX_DIAG_ORDERS.forEach(function (x) { var k = String(x || '').trim().toUpperCase(); if (k) want[k] = { maDon: k, trongSheetTonDong: null, trongFileLost: null }; });
  if (!Object.keys(want).length) return 'Chưa nhập mã đơn nào ở SPX_DIAG_ORDERS.';
  try {
    var sh = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA').getSheetByName('1. LM high aging');
    if (sh && sh.getLastRow() >= 3) {
      var _nc = Math.min(sh.getMaxColumns(), Math.max(sh.getLastColumn(), 18));
      var _M = _aging_lmColumnMap_(sh.getRange(2, 1, 1, _nc).getValues()[0]);
      var v = sh.getRange(3, 1, sh.getLastRow() - 2, _nc).getValues();
      for (var i = 0; i < v.length; i++) {
        var id = v[i][_M.ship] ? String(v[i][_M.ship]).trim().toUpperCase() : '';
        if (id && want[id]) {
          want[id].trongSheetTonDong = { dong: i + 3, tram: String(v[i][_M.hub] || ''), nhomTon: String(_M.bucket >= 0 ? (v[i][_M.bucket] || '') : ''), soNgayTon: (_M.aging >= 0 ? v[i][_M.aging] : ''), trangThai: String(v[i][_M.proc] || ''), coLostToday: String(v[i][_M.lost] || '') };
        }
      }
    }
  } catch (e) { return 'Lỗi đọc sheet tồn đọng: ' + e.message; }
  try {
    var shL = _DS.ss('1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE').getSheetByName('Raw');
    if (shL && shL.getLastRow() >= 2) {
      var _lc1 = null; try { _lc1 = _aging_lostCols_(shL); } catch (eLc3) { _lc1 = _SPX_LOST_LEGACY_; }
      var vl = shL.getRange(1, 1, shL.getLastRow(), Math.min(shL.getMaxColumns(), _spx_maxIdx_(_lc1) + 1)).getValues();
      for (var k = 1; k < vl.length; k++) {
        var idL = vl[k][_lc1.ship] ? String(vl[k][_lc1.ship]).trim().toUpperCase() : '';
        if (idL && want[idL]) want[idL].trongFileLost = { dong: k + 1, tram: String(vl[k][_lc1.hub] || '') };
      }
    }
  } catch (e) { /* file Lost lỗi -> vẫn trả phần đã tra được */ }
  var out = { thoiDiemTra: Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss'), ketQua: [] };
  Object.keys(want).forEach(function (k) {
    var r = want[k];
    r.ketLuan = (!r.trongSheetTonDong && !r.trongFileLost)
      ? 'KHÔNG có trong cả 2 nguồn -> đơn hiện trên màn hình là DỮ LIỆU CŨ trong trình duyệt, cần tải lại (Ctrl+Shift+R).'
      : (r.trongSheetTonDong ? 'Có thật trong sheet tồn đọng.' : 'Chỉ có trong file đã chốt Lost.');
    out.ketQua.push(r);
  });
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

/**
 * spx_diagKpiFailHealth() — CHẠY THỦ CÔNG để kiểm tra KPI Fail sau khi triển khai (hoặc khi nghi số liệu thiếu).
 * Cho biết: bản lưu đã có VÂN TAY chưa, mốc dòng đã đọc so với số dòng nguồn hiện tại, nguồn có bị ghi lại
 * (trượt cửa sổ) không, lần đọc-lại-đầy-đủ gần nhất, và cảnh báo cột.
 */
function spx_diagKpiFailHealth() {
  var out = { canhBao: [] };
  var warn = function (m) { out.canhBao.push(m); };
  var ss = _DS.ss(KPIFAIL_SS_ID);
  var snap = null;
  try { snap = _kpifail_readPersistentSnapshot_(); } catch (e) { warn('Không đọc được bản lưu: ' + e.message); }
  if (!snap) { out.ketLuan = 'Chưa có bản lưu KPI Fail.'; return JSON.stringify(out, null, 2); }
  var cur = _kpifail_getSourceRowCounts_(ss);
  var prev = { FM: snap.lastRowFM || 0, LM: snap.lastRowLM || 0, SOP: snap.lastRowSOP || 0 };
  out.banLuu = { soBanGhi: (snap.records || []).length, ngayMoiNhat: snap.maxDate || '', phienBanDuLieu: _kpifail_dataVersionString_() };
  out.soDong = { daDoc: prev, nguonHienTai: cur };
  out.vanTay = snap.fp ? 'ĐÃ có' : 'CHƯA có (sẽ đọc gộp một lần ở lượt làm mới kế tiếp để lấy mốc chuẩn)';
  var chk = { rewritten: false };
  try { chk = _kpifail_sourceRewritten_(ss, snap, prev); } catch (e2) { warn('Không đối soát được vân tay: ' + e2.message); }
  out.nguonBiGhiLai = chk.rewritten ? ('CÓ — ' + chk.why) : 'Không';
  var lastFp = Number(PropertiesService.getScriptProperties().getProperty('kpifail_fp_rebuild_at') || 0);
  out.lanDocLaiDayDuDoVanTayGanNhat = lastFp ? Utilities.formatDate(new Date(lastFp), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss') : '(chưa có)';
  ['FM', 'LM', 'SOP'].forEach(function (k) { if (cur[k] > prev[k]) warn(k + ': nguồn còn ' + (cur[k] - prev[k]) + ' dòng chưa đọc (đang đọc dở hoặc đợi lượt làm mới).'); });
  if (chk.rewritten && snap.fp) warn('Nguồn đã đổi vị trí dòng — lượt làm mới kế tiếp sẽ đọc lại đầy đủ và gộp (tối đa 1 lần / 20 phút).');
  var cw = _spx_getColWarn_('kpifail:'); if (cw) warn('Cảnh báo cột: ' + cw);
  out.ketLuan = out.canhBao.length ? 'CÓ ' + out.canhBao.length + ' ĐIỂM CẦN XEM — đọc mục canhBao.' : 'Bản lưu khớp nguồn.';
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

/**
 * spx_diagTimezone() — CHẠY THỦ CÔNG để xác nhận MÚI GIỜ của dự án và của TỪNG file nguồn đều là giờ Việt Nam.
 * Múi giờ file nguồn quan trọng: ô ngày-giờ đọc từ sheet là thời điểm tính theo múi giờ CỦA FILE ĐÓ; file đặt sai
 * múi giờ thì ngày/giờ các đơn sát nửa đêm bị lệch sang ngày khác.
 */
function spx_diagTimezone() {
  // [SỬA] So theo ĐỘ LỆCH SO VỚI UTC, không so tên múi giờ: Asia/Bangkok (và Asia/Jakarta, Asia/Phnom_Penh...) cũng là UTC+7
  // quanh năm, không có giờ mùa hè -> cho kết quả ngày giờ GIỐNG HỆT giờ Việt Nam, không cần đổi. Chỉ cảnh báo khi lệch thật
  // (độ lệch khác +0700 ở BẤT KỲ mùa nào, kể cả múi giờ có giờ mùa hè).
  var isUtc7 = function (tz) {
    try {
      return Utilities.formatDate(new Date(Date.UTC(2026, 0, 15, 12)), tz, 'Z') === '+0700' &&
             Utilities.formatDate(new Date(Date.UTC(2026, 6, 15, 12)), tz, 'Z') === '+0700';
    } catch (e) { return false; }
  };
  var out = { canhBao: [] };
  var warn = function (m) { out.canhBao.push(m); };
  var scriptTz = Session.getScriptTimeZone();
  out.duAn = { muiGioDuAn: scriptTz, mong_doi: SPX_TZ, bayGioTheoGioVN: Utilities.formatDate(new Date(), SPX_TZ, 'yyyy-MM-dd HH:mm:ss'),
               bayGioTheoMuiGioDuAn: Utilities.formatDate(new Date(), scriptTz, 'yyyy-MM-dd HH:mm:ss') };
  out.duAn.laUTC7 = isUtc7(scriptTz);
  if (!out.duAn.laUTC7) warn('Múi giờ DỰ ÁN là "' + scriptTz + '" (KHÔNG phải UTC+7) — nên đặt Asia/Ho_Chi_Minh (Project Settings → Time zone) để trigger/ngày giờ mặc định khớp. Code đã dùng SPX_TZ tường minh ở các chỗ quan trọng.');
  var ids = {
    'Báo cáo Backlog (LM/FM)': typeof PICK_LIVE_SS_ID !== 'undefined' ? PICK_LIVE_SS_ID : null,
    'KPI Fail': typeof KPIFAIL_SS_ID !== 'undefined' ? KPIFAIL_SS_ID : null,
    'FMS Live': typeof FMS_LIVE_SHEET_ID !== 'undefined' ? FMS_LIVE_SHEET_ID : null,
    'Khiếu nại (CXL)': typeof DATA_SPREADSHEET_ID !== 'undefined' ? DATA_SPREADSHEET_ID : null,
    'Admin DB': typeof ADMIN_DB_ID !== 'undefined' ? ADMIN_DB_ID : null,
    'Master DB': typeof MASTER_DB_ID !== 'undefined' ? MASTER_DB_ID : null,
    'Tra cứu': typeof TRACUU_SHEET_ID !== 'undefined' ? TRACUU_SHEET_ID : null,
    'Phân quyền / Rider': typeof RP_SOURCE_ID !== 'undefined' ? RP_SOURCE_ID : null,
    'File Lost': '1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE'
  };
  out.fileNguon = {};
  Object.keys(ids).forEach(function (k) {
    if (!ids[k]) { out.fileNguon[k] = '(không có ID)'; return; }
    try {
      var tz = SpreadsheetApp.openById(ids[k]).getSpreadsheetTimeZone();
      var ok = isUtc7(tz);
      out.fileNguon[k] = tz + (ok ? (tz === 'Asia/Ho_Chi_Minh' || tz === 'Asia/Saigon' ? '  ✓' : '  ✓ (UTC+7, cùng giờ VN)') : '  ✗ LỆCH GIỜ VN');
      if (!ok) warn('File "' + k + '" đặt múi giờ "' + tz + '" — KHÁC UTC+7. Đổi trong File → Settings → Time zone sang Asia/Ho_Chi_Minh (nếu bạn là chủ file) để ngày giờ không lệch.');
    } catch (e) { out.fileNguon[k] = 'không mở được: ' + e.message; }
  });
  out.ketLuan = out.canhBao.length ? 'CÓ ' + out.canhBao.length + ' ĐIỂM CẦN XEM — đọc mục canhBao.' : 'Dự án và mọi file nguồn đều theo UTC+7 (giờ Việt Nam).';
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

/**
 * spx_resetColumnAnchors() — CHỈ chạy khi CHỦ Ý đổi tên cột tiêu đề ở sheet có ghim (VD 'Raw'): xoá
 * tiêu đề đã ghim để lần đọc kế tiếp học lại từ vị trí cũ. Không cần chạy khi cột chỉ đổi vị trí.
 */
function spx_resetColumnAnchors() {
  var p = PropertiesService.getScriptProperties();
  var all = p.getKeys().filter(function (k) { return k.indexOf('spx_colpin_') === 0; });
  all.forEach(function (k) { p.deleteProperty(k); });
  p.deleteProperty(SPX_COLWARN_KEY);
  return 'Đã xoá ' + all.length + ' tiêu đề ghim: ' + all.join(', ');
}

/**
 * spx_diagAllColumns() — cho biết MỌI sheet nguồn đang được đọc từ cột nào (chữ cột + tên tiêu đề thật).
 * Chạy sau khi nguồn đổi cấu trúc, hoặc khi nghi số liệu sai, để thấy ngay cột nào dịch chỗ / mất.
 */
function spx_diagAllColumns() {
  var out = {};
  var ss = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
  var show = function (hdr, F) {
    var o = {};
    Object.keys(F).forEach(function (k) { o[k] = F[k] === undefined ? 'KHÔNG THẤY' : (_spx_colLetter_(F[k]) + ' = ' + String(hdr[F[k]])); });
    return o;
  };
  var run = function (label, fn) { try { out[label] = fn(); } catch (e) { out[label] = 'LỖI: ' + e.message; } };
  run('1. LM high aging', function () {
    var sh = ss.getSheetByName('1. LM high aging');
    var hdr = sh.getRange(2, 1, 1, Math.min(sh.getMaxColumns(), Math.max(sh.getLastColumn(), 18))).getValues()[0];
    var M = _aging_lmColumnMap_(hdr); var o = { cachDoc: M.fallback ? 'LÙI BỐ CỤC CŨ' : 'theo tiêu đề' };
    ['ship', 'status', 'hub', 'inbound', 'att', 'timing', 'aging', 'cogs', 'bucket'].forEach(function (k) { o[k] = M[k] >= 0 ? _spx_colLetter_(M[k]) + ' = ' + hdr[M[k]] : 'KHÔNG CÓ'; });
    return o;
  });
  run('2. FM high aging', function () { var h = ss.getSheetByName('2. FM high aging').getRange(2, 1, 1, 30).getValues()[0]; return show(h, _spx_findCols_(h, _SPX_SPEC_FMHA_)); });
  run('3. FM action realtime', function () { var h = ss.getSheetByName('3. FM action realtime').getRange(2, 1, 1, 20).getValues()[0]; return show(h, _spx_findCols_(h, _SPX_SPEC_FMACT_)); });
  run('summary FM realtime', function () { var h = ss.getSheetByName('summary FM realtime').getRange(2, 1, 1, 14).getValues()[0]; return show(h, _spx_findCols_(h, _SPX_SPEC_FMSUM_)); });
  run('Backlog FM+LM (khối LastMile)', function () {
    var sh = ss.getSheetByName('Backlog FM+LM'); var lc = sh.getLastColumn();
    var h2 = sh.getRange(2, 1, 1, lc).getValues()[0], h3 = sh.getRange(3, 1, 1, lc).getValues()[0];
    var lm = -1; for (var c = 0; c < h2.length; c++) { var n = _spx_normHdr_(h2[c]); if (n === 'lastmile' || n === 'last mile') { lm = c; break; } }
    return lm < 0 ? 'KHÔNG THẤY ô LastMile' : show(h3, _spx_findCols_(h3, _SPX_SPEC_BKLM_, { from: lm }));
  });
  ['FM', 'LM', 'SOP'].forEach(function (k) {
    run('KPI Fail — ' + k, function () {
      var sh = _DS.ss(KPIFAIL_SS_ID).getSheetByName(k);
      var h = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
      var F = _spx_findCols_(h, _SPX_KPI_SPEC_[k].spec); var o = show(h, F);
      var miss = _SPX_KPI_SPEC_[k].req.filter(function (f) { return F[f] === undefined; });
      o.ketLuan = miss.length ? 'THIẾU cột bắt buộc: ' + miss.join(', ') : 'Đủ cột bắt buộc';
      return o;
    });
  });
  run('Raw (file Lost)', function () {
    var sh = _DS.ss('1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE').getSheetByName('Raw');
    var h = sh.getRange(1, 1, 1, Math.min(sh.getMaxColumns(), 20)).getValues()[0];
    var LC = _aging_lostCols_(sh); var o = {};
    Object.keys(LC).forEach(function (k) { o[k] = _spx_colLetter_(LC[k]) + ' = ' + String(h[LC[k]]); });
    o.canhBao = _spx_getColWarn_() || '(không)';
    return o;
  });
  var txt = JSON.stringify(out, null, 2); Logger.log(txt); return txt;
}

/**
 * spx_diagLmColumns() — CHẠY THỦ CÔNG sau khi triển khai (hoặc khi nghi sheet nguồn đổi cột).
 * Cho biết mỗi trường dữ liệu đang được đọc từ cột nào (kèm tên tiêu đề thật), và đọc thử
 * 2.000 dòng đầu để kiểm tra cột "trạm" có thật sự chứa tên trạm hay không.
 */
function spx_diagLmColumns() {
  var sh = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA').getSheetByName('1. LM high aging');
  if (!sh) return 'Không mở được sheet nguồn "1. LM high aging".';
  var nCols = Math.min(sh.getMaxColumns(), Math.max(sh.getLastColumn(), 18));
  var hdr = sh.getRange(2, 1, 1, nCols).getValues()[0];
  var M = _aging_lmColumnMap_(hdr);
  var letter = function (n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  var describe = function (c) { return c >= 0 ? (letter(c) + ' = ' + String(hdr[c] || '(không có tiêu đề)')) : 'KHÔNG CÓ cột này'; };
  var sampleN = Math.min(2000, Math.max(0, sh.getLastRow() - 2));
  var v = sampleN ? sh.getRange(3, 1, sampleN, nCols).getValues() : [];
  var hubs = {}, withShip = 0, looksStatus = 0, hubHasWord = 0;
  v.forEach(function (r) {
    if (!r[M.ship]) return;
    withShip++;
    var h = String(r[M.hub] || '').trim();
    hubs[h] = (hubs[h] || 0) + 1;
    if (/^[A-Za-z]+(_[A-Za-z]+)+$/.test(h) || /^(Delivering|Missing|OnHold)$/i.test(h)) looksStatus++;
    if (/hub|soc/i.test(h)) hubHasWord++;
  });
  var out = {
    cachDocCot: M.fallback ? 'LÙI VỀ BỐ CỤC CŨ (không dò được tiêu đề then chốt) — kiểm tra lại dòng 2 của sheet' : 'Theo tên tiêu đề dòng 2',
    maDon: describe(M.ship), tram: describe(M.hub), trangThaiCuoi: describe(M.status), ngayVeTram: describe(M.inbound),
    soLanGiao: describe(M.att), timingDate: describe(M.timing), aging: describe(M.aging),
    cogs: describe(M.cogs), nhanMoc: describe(M.bucket),
    docThu: { soDongCoMaDon: withShip, soTramKhacNhau: Object.keys(hubs).length, dongCoChuHubHoacSOC: hubHasWord, dongTramGiongTrangThai: looksStatus,
              mauTram: Object.keys(hubs).slice(0, 5) }
  };
  out.ketLuan = M.fallback ? 'CẢNH BÁO: đang dùng bố cục cũ.'
    : (withShip && looksStatus / withShip > 0.3) ? 'SAI: cột "trạm" đang chứa trạng thái đơn — kiểm tra tiêu đề cột.'
    : (withShip && hubHasWord / withShip < 0.5) ? 'NGHI NGỜ: dưới nửa số dòng có tên trạm dạng "... Hub/SOC" — xem mauTram.'
    : 'Bình thường — cột trạm chứa tên trạm.';
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

function spx_diagOverdueLost() {
  var hub = String(SPX_DIAG_HUB || '').trim();
  var target = hub ? _normStationKey_(hub) : '';
  var out = { tram: hub || '(mọi trạm)', tongDongCoCo: 0, chotLostHomNay: [], coKhac: [], daChotLost: [] };
  var sh = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA').getSheetByName('1. LM high aging');
  if (!sh) return 'Không mở được sheet nguồn "1. LM high aging".';
  var last = sh.getLastRow();
  if (last >= 3) {
    var _nc2 = Math.min(sh.getMaxColumns(), Math.max(sh.getLastColumn(), 18));
    var _M2 = _aging_lmColumnMap_(sh.getRange(2, 1, 1, _nc2).getValues()[0]);
    var v = sh.getRange(3, 1, last - 2, _nc2).getValues();
    for (var i = 0; i < v.length; i++) {
      var flag = v[i][_M2.lost] ? String(v[i][_M2.lost]).trim() : '';
      if (!flag) continue;
      var rowHub = v[i][_M2.hub] ? String(v[i][_M2.hub]).trim() : '';
      if (target && _normStationKey_(rowHub) !== target) continue;
      out.tongDongCoCo++;
      var rec = { maDon: v[i][_M2.ship] ? String(v[i][_M2.ship]).trim() : '', tram: rowHub, giaTriCotA: flag, trangThai: v[i][_M2.proc] ? String(v[i][_M2.proc]).trim() : '' };
      if (flag.toLowerCase().indexOf('today') >= 0) out.chotLostHomNay.push(rec);
      else out.coKhac.push(rec);
    }
  }
  var shL = _DS.ss('1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE').getSheetByName('Raw');
  if (shL && shL.getLastRow() >= 2) {
    var _lc2 = null; try { _lc2 = _aging_lostCols_(shL); } catch (eLc4) { _lc2 = _SPX_LOST_LEGACY_; }
    var vl = shL.getRange(2, 1, shL.getLastRow() - 1, Math.min(shL.getMaxColumns(), Math.max(_lc2.ship, _lc2.hub) + 1)).getValues();
    for (var k = 0; k < vl.length; k++) {
      var hubL = vl[k][_lc2.hub] ? String(vl[k][_lc2.hub]).trim() : '';
      if (target && _normStationKey_(hubL) !== target) continue;
      out.daChotLost.push({ maDon: vl[k][_lc2.ship] ? String(vl[k][_lc2.ship]).trim() : '', tram: hubL });
    }
  }
  out.ketLuan = 'Thẻ Tổng quan = ' + out.chotLostHomNay.length + ' (chốt Lost hôm nay) + ' +
                out.daChotLost.length + ' (đã chốt Lost). Ngoài ra ' + out.coKhac.length +
                ' đơn mang cờ khác trên cột A — không phải đến hạn hôm nay.';
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

/**
 * _spxScopeHubs_(overrideHub)
 * [MỚI — theo yêu cầu: "SUP/AOM/ROM phải thấy số của TOÀN KHU VỰC mình quản"]
 * Trước đây 5 hàm tổng hợp của Tổng quan chỉ nhận MỘT trạm, nên khi Admin xem thử
 * cấp SUP/AOM/ROM (mỗi cấp quản nhiều trạm) thì các thẻ rơi về số TOÀN HỆ THỐNG —
 * sai phạm vi, và sai theo hướng nguy hiểm: số to hơn thực tế rất nhiều.
 * Hàm này cho phép truyền DANH SÁCH TRẠM, giữ nguyên tương thích với lời gọi cũ:
 *   · '' hoặc null      -> không lọc thêm (giữ nguyên hành vi cũ)
 *   · 'Tên trạm'        -> đúng 1 trạm  (giữ nguyên hành vi cũ)
 *   · 'A||B||C'         -> nhiều trạm   (dạng mới, dùng cho SUP/AOM/ROM)
 *   · ['A','B']         -> nhiều trạm   (dạng mới, khi gọi nội bộ)
 * Trả về { list: [tên gốc...], keys: {khoá chuẩn hoá: true}, has(hub), empty }.
 */
function _spxScopeHubs_(overrideHub) {
  var list = [];
  if (Array.isArray(overrideHub)) list = overrideHub.slice();
  else if (overrideHub) {
    var s = String(overrideHub).trim();
    list = (s.indexOf('||') >= 0) ? s.split('||') : [s];
  }
  list = list.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  var keys = {};
  list.forEach(function (h) { keys[_normStationKey_(h)] = true; });
  return {
    list: list,
    keys: keys,
    empty: list.length === 0,
    has: function (hub) { return !list.length || !!keys[_normStationKey_(hub)]; },
    // Khoá bộ đệm: nhiều trạm -> chuỗi ổn định, không phụ thuộc thứ tự người dùng chọn.
    cacheKey: function () { return list.length ? Object.keys(keys).sort().join('~') : ''; }
  };
}

function aging_getIndexSummary(hubName, overrideHub) {

  // [SECURITY FIX 2026-08] Trước đây hàm này KHÔNG kiểm tra quyền — bất kỳ ai
  // (kể cả AOM/SUP chỉ được cấp 1 hub, hoặc user gọi thẳng qua console) đều lấy
  // được summary quá hạn/lost của TOÀN BỘ hub bằng cách để hubName rỗng, hoặc
  // xem trộm hub khác bằng cách truyền đúng tên hub đó. Thêm chặn theo
  // getModuleAccess() + lọc từng dòng theo hub được cấp. Cache key cũng phải
  // thêm phạm vi quyền (_scopeKey) — nếu không, kết quả admin (toàn bộ hub) bị
  // cache chung key với non-admin sẽ vô tình phục vụ nhầm dữ liệu ngoài quyền
  // cho lần gọi tiếp theo dù đã lọc đúng ở đây.
  const _access = getModuleAccess();
  if (_access.role === 'denied') return JSON.stringify({ success: false, error: 'Không có quyền truy cập.' });
  const _isAdmin = (_access.role === 'admin');
  const _allowedNormHubs = new Set((_access.hubs || []).map(function(h){ return _normStationKey_(h); }));
  if (!_isAdmin && hubName && !_allowedNormHubs.has(_normStationKey_(hubName))) {
    return JSON.stringify({ success: false, error: 'Không có quyền xem dữ liệu hub này.' });
  }
  // [MỚI — theo yêu cầu trực tiếp "Tổng quan không đổi theo level, sao biết
  // đúng sai"] Khi Admin thật đang "Xem thử Lead/Staff" ở 1 Hub cụ thể,
  // frontend truyền overrideHub — cho phép lọc đúng theo Hub đó dù access
  // thật là admin (không hạn chế). Chỉ Admin mới được dùng tham số này (không
  // phải lỗ hổng cho phép non-admin lách qua hubName ở trên).
  // [SỬA LỖI THẬT — Tổng quan không theo trạm đang chọn với người dùng thường]
  // Trước đây CHỈ Admin được lọc theo trạm; người quản nhiều trạm chọn 1 trạm ở
  // header vẫn nhận tổng cả phạm vi. Nay cho lọc khi trạm NẰM TRONG quyền —
  // chỉ thu hẹp, không thể vượt quyền.
  // [SỬA — hỗ trợ NHIỀU TRẠM] Xem thử cấp SUP/AOM/ROM: mỗi cấp quản nhiều trạm, nên
  // phạm vi phải là DANH SÁCH. Trước đây chỉ nhận 1 trạm -> các thẻ rơi về số toàn
  // hệ thống, sai theo hướng nguy hiểm (số to hơn thực tế rất nhiều).
  const _ovScope = _spxScopeHubs_(overrideHub);
  const _ovOk = !_ovScope.empty && (_isAdmin || _ovScope.list.every(function (h) {
    return _allowedNormHubs.has(_normStationKey_(h));
  }));
  const _effectiveHub = _ovOk ? overrideHub : hubName;
  // Khoá cache PHẢI gồm trạm đang lọc — nếu không, kết quả nhiều trạm đã lưu
  // sẽ bị trả nhầm cho yêu cầu 1 trạm (và ngược lại).
  const _scopeKey = _isAdmin
    ? ('ADMIN' + (_ovOk ? '_PV_' + _ovScope.cacheKey() : ''))

    : (Array.from(_allowedNormHubs).sort().join('~') + (_ovOk ? '_PV_' + _ovScope.cacheKey() : ''));


  // ============================================================
  // STALE-WHILE-REVALIDATE:
  // - Kiểm tra CacheService trước (cache 60 giây)
  // - Nếu có cache → trả về ngay, đồng thời vẫn đọc Sheets thật bên dưới
  //   để lần gọi sau có data mới hơn (GAS không hỗ trợ async, nên cache
  //   sẽ được làm mới ngay trong cùng lần gọi nếu hết hạn)
  // - Nếu Sheets lỗi → fallback về cache cũ thay vì trả lỗi
  // ============================================================

  const cache      = CacheService.getScriptCache();
  // Normalize key: bỏ dấu tiếng Việt + ký tự đặc biệt để tránh cache miss do encoding
  const _normalizeKey = s => s ? s.toString().trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // bỏ dấu
    .replace(/đ/g, 'd').replace(/[^a-z0-9_-]/g, '_')  // thay ký tự lạ
    .replace(/_+/g, '_').replace(/^_|_$/g, '')         // dọn underscore thừa
    : 'all';
  // [MỚI 2026-10-24] Khoá gắn phiên bản bản chụp + mốc sửa file nguồn: nguồn/bản chụp đổi -> khoá đổi -> tính lại ngay,
  // thay vì giữ số cũ tới hết 15 phút.
  const cacheKey   = _spxSafeCacheKey_('aging_idx_' + _normalizeKey(hubName) + '_' + _scopeKey + '_v' + _spxAgingVerTag_() + '_s' + _spxSrcStamp_('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA'));
  const cachedStr  = cache.get(cacheKey);

  // [SỬA LỖI THẬT — nguyên nhân chính của "Tổng quan tải rất lâu"]
  // Trước đây bộ nhớ đệm được ĐỌC ra ở đây nhưng chỉ được DÙNG trong nhánh
  // catch bên dưới — tức CHỈ KHI đọc sheet bị lỗi. Luồng bình thường LUÔN đọc
  // lại ~37.000 dòng (đo được 18-49 giây), bất kể bộ nhớ đệm có sẵn hay không.
  // Ghi chú cũ "có cache -> trả về ngay" mô tả SAI hành vi thật của code.
  // Nay: có bộ nhớ đệm hợp lệ thì trả về NGAY. Nguồn chỉ cập nhật 8:00 và
  // 14:00 mỗi ngày nên dùng lại kết quả trong 15 phút là an toàn.
  if (cachedStr && !_SPX_OV_FORCE_) {
    try {
      const _hit = JSON.parse(cachedStr);
      if (_hit && _hit.success) { _hit._cacheHit = true; return JSON.stringify(_hit); }
    } catch (eHit) {}
  }

  try {

    const t0       = Date.now();
    const hubSet   = new Set();
    // [FIX 2026-06] Trước đây so khớp bằng lowercase thô, không strip hậu tố
    // "Hub/LM/FM" → trạm ghi "Krông Pắk LM Hub" sẽ KHÔNG khớp với input "Krông Pắk",
    // khiến overdueCount/closedLostCount bị đếm thiếu khi lọc theo trạm cụ thể.
    // Nay dùng chung _normStationKey_() như các module khác (FMS, KPI Fail, Quá hạn JS).
    // Phạm vi lọc: danh sách trạm (Xem thử) hoặc 1 trạm như trước.
  const _scope = _ovOk ? _ovScope : _spxScopeHubs_(hubName);

    const summary = {
      success: true,
      overdueCount: 0,
      otherFlaggedCount: 0,   // don co co khac tren cot A (khong phai 'today')
      closedLostCount: 0,
      processingCount: 0,
      hubs: [],
      elapsedMs: 0,
      timestamp: Date.now(),
      // Nhiều trạm (Xem thử SUP/AOM/ROM) -> hiện số lượng thay vì ghép chuỗi khó đọc.
      hubName: (_ovOk && _ovScope.list.length > 1)
        ? (_ovScope.list.length + ' trạm')
        : (_effectiveHub ? String(_effectiveHub).split('||')[0].trim() : "")
    };

    // --- ĐỌC FILE CORE: dùng getSheetByName thay vì vòng for tìm sheet ---
    const ssCore   = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
    const coreSheet = ssCore.getSheetByName('1. LM high aging');

    if (coreSheet) {
      const lastRow = coreSheet.getLastRow();
      if (lastRow >= 3) {
        // [SỬA] Dò cột theo tiêu đề (cùng bản đồ với bộ nạp chính) — trước đây đọc cột K
        // cố định nên sau khi sheet nguồn đổi bố cục, phạm vi trạm lọc ra rỗng.
        const _lmM = _aging_lmColumnMap_(coreSheet.getRange(2, 1, 1, Math.min(coreSheet.getMaxColumns(), Math.max(coreSheet.getLastColumn(), 18))).getValues()[0]);
        const values = coreSheet.getRange(3, 1, lastRow - 2, Math.min(coreSheet.getMaxColumns(), Math.max(_lmM.ship, _lmM.hub, _lmM.lost) + 1)).getValues();
        for (let i = 0; i < values.length; i++) {
          const row        = values[i];
          const shipmentId = row[_lmM.ship] ? row[_lmM.ship].toString().trim() : "";
          if (!shipmentId) continue;

          const rowHub = row[_lmM.hub] ? row[_lmM.hub].toString().trim() : "";
          if (!_isAdmin && !_allowedNormHubs.has(_normStationKey_(rowHub))) continue;
          if (rowHub) hubSet.add(rowHub);
          if (!_scope.has(rowHub)) continue;

          const lostToday  = row[_lmM.lost] ? row[_lmM.lost].toString().trim() : "";
          // "Quá hạn" trên header = đơn có cột A (lostToday) mang giá trị bất kỳ
          // Đây là cờ hệ thống đánh dấu đơn quá hạn, khác agingValue (số ngày tồn kho)
          summary.processingCount++;
          // [SỬA LỖI THẬT — báo cáo: Tổng quan hiện "1 đơn" nhưng mở module tìm
          // không ra đơn nào] Hai nơi đếm CÙNG cột A nhưng KHÁC quy tắc:
          //   · Tổng quan (cũ): cột A khác rỗng -> đếm, bất kể giá trị gì
          //   · Module Kiểm soát Giao hàng: chỉ đếm khi giá trị CÓ CHỮ "today"
          // -> đơn mang cờ khác bị đếm ở Tổng quan mà không hiện trong module.
          // Nay Tổng quan dùng ĐÚNG quy tắc của module để con số luôn tra ra được.
          // Đơn mang cờ khác KHÔNG bị bỏ im lặng: đếm riêng vào otherFlaggedCount
          // để hiển thị rõ, tránh giấu mất đơn thật sự cần xử lý.
          if (lostToday) {
            if (lostToday.toLowerCase().indexOf('today') >= 0) summary.overdueCount++;
            else summary.otherFlaggedCount++;
          }
        }
      }
    }

    // --- ĐỌC FILE LOST ---
    const ssLost   = _DS.ss('1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE');
    const lostSheet = ssLost.getSheetByName('Raw');
    if (lostSheet) {
      const lastRow = lostSheet.getLastRow();
      if (lastRow >= 2) {
        // [SỬA] Cột mã đơn + trạm theo TIÊU ĐỀ đã ghim (cùng bộ dò với _aging_getLostDataFromSS).
        let _LC = null;
        try { _LC = _aging_lostCols_(lostSheet); } catch (eLc2) { _LC = null; }
        const values = _LC ? lostSheet.getRange(2, 1, lastRow - 1, Math.min(lostSheet.getMaxColumns(), Math.max(_LC.ship, _LC.hub) + 1)).getValues() : [];
        for (let i = 0; i < values.length; i++) {
          const shipmentId = values[i][_LC.ship] ? values[i][_LC.ship].toString().trim() : "";
          if (!shipmentId || ['spx_shipment_id', 'ma don hang', 'mã đơn hàng', 'spx tracking'].includes(shipmentId.toLowerCase())) continue;
          const rowHub = values[i][_LC.hub] ? values[i][_LC.hub].toString().trim() : "";
          if (!_isAdmin && !_allowedNormHubs.has(_normStationKey_(rowHub))) continue;
          if (rowHub) hubSet.add(rowHub);
          if (!_scope.has(rowHub)) continue;
          summary.closedLostCount++;
        }
      }
    }

    summary.hubs      = Array.from(hubSet).sort();
    summary.elapsedMs = Date.now() - t0;

    const result = JSON.stringify(summary);

    // Lưu cache 60 giây — đủ để giảm tải Sheets API
    // mà vẫn đảm bảo data cũ tối đa 1 phút trong giờ vận hành ca
    // [SỬA — chẩn đoán Tổng quan chậm: phần này chiếm 23,6 giây] 60 giây -> 15
    // phút. Nguồn chính là sheet Backlog monitor, chỉ CẬP NHẬT 8:00 và 14:00
    // mỗi ngày — trước đây đọc lại ~37.000 dòng MỖI PHÚT cho dữ liệu 2 lần/ngày
    // mới đổi. Module Kiểm soát Giao hàng vẫn đọc dữ liệu mới khi mở trực tiếp.
    try { cache.put(cacheKey, result, 900); } catch(ce) {}

    return result;

  } catch (e) {

    // Sheets lỗi hoặc timeout → trả cache cũ nếu có, tránh màn hình trắng
    if (cachedStr) {
      try {
        const old = JSON.parse(cachedStr);
        old.fromCache = true;
        old.cacheError = e.message;
        return JSON.stringify(old);
      } catch(pe) {}
    }

    return JSON.stringify({ success: false, error: e.message, timestamp: Date.now() });
  }

}

// ============================================================

// --- NOTES CRM (AGING) ---

// ============================================================

function aging_syncNotes(activeIdsStr) {

  try {

    // [SECURITY FIX 2026-08] Trước đây không kiểm tra quyền — bất kỳ ai gọi được
    // cũng đọc/dọn được toàn bộ note quá hạn của mọi trạm. Sheet App_Notes hiện
    // không có cột hub/trạm nên chưa thể lọc chi tiết theo hub ngay tại đây (cần
    // đổi schema sheet mới làm được) — trước mắt chặn tối thiểu ở mức "đã được
    // duyệt dùng hệ thống" để không còn public hoàn toàn.
    _requireApproved_();

    const ss = _DS.ss(ADMIN_DB_ID);

    let sheet = ss.getSheetByName('App_Notes');

    if (!sheet) {

      sheet = ss.insertSheet('App_Notes');

      sheet.appendRow(['Tracking ID','Nội Dung Note','Người Note','Thời Gian']);

    }

    let data = sheet.getDataRange().getDisplayValues();

    if (!data || data.length === 0) return JSON.stringify({ success: true, notes: {} });

    let activeIds  = JSON.parse(activeIdsStr) || [];

    let activeSet  = new Set(activeIds);

    let newData    = []; let notesDict = {};

    for (let i = 0; i < data.length; i++) {

      if (!data[i] || !data[i][0]) continue;

      let id = data[i][0].toString().trim();

      if (!id) continue;

      if (id.toUpperCase() === 'TRACKING ID' || id.toUpperCase() === 'MÃ ĐƠN HÀNG') { newData.push(data[i]); continue; }

      if (activeIds.length === 0 || activeSet.has(id)) {

        newData.push(data[i]);

        notesDict[id] = { text: data[i][1], user: data[i][2], time: data[i][3] };

      }

    }

    if (activeIds.length > 0 && newData.length < data.length) {

      sheet.clearContents();

      if (newData.length > 0) sheet.getRange(1, 1, newData.length, newData[0].length).setValues(newData);

    }

    return JSON.stringify({ success: true, notes: notesDict });

  } catch (e) { return JSON.stringify({ error: e.message }); }

}

// Xóa cache aging_getMasterData của user đang gọi — gọi sau mỗi write operation
// (saveNote, syncNotes) để lần đọc tiếp theo của user đó thấy dữ liệu mới ngay.
// [FIX 2026-07] Trước đây hàm này xoá key 'aging_master_v1_*' — key đời CŨ mà
// aging_getMasterData() không còn ghi vào từ khi chuyển sang cache theo user (v3).
// Tức là gọi hàm này sau khi lưu note KHÔNG hề xoá cache thật đang dùng — user vừa
// lưu note vẫn có thể thấy dữ liệu cũ tới hết TTL (5 phút). Sửa lại để xoá đúng key
// v3 theo user hiện tại, đồng bộ với key mà aging_getMasterData()/aging_clearCache()
// đang dùng (qua CacheMgr — xem CacheMgr ở đầu file).
// [FIX 2026-07-28] Trỏ lại sang cache CHUNG 'raw_v1' (thay vì key theo từng user
// đã bỏ — xem aging_getMasterData()). Không còn được gọi từ aging_saveNote() nữa
// (xem giải thích ở đó) — giờ chỉ dùng cho aging_clearCache() khi cần ép đọc lại
// dữ liệu Core/Lost/FM thật sự (hiếm khi cần, vì cache chung tự làm mới mỗi 5
// phút qua aging_prewarmCache()).
function _aging_invalidateMasterCache() {
  try {
    CacheMgr.invalidateChunked('AGING', 'raw_v1');
  } catch(e) {}
}

function aging_getNotesOnly() {

  try {

    // [SECURITY FIX 2026-08] Xem chú thích ở aging_syncNotes() — cùng lớp lỗi.
    _requireApproved_();

    const ss    = _DS.ss(ADMIN_DB_ID);

    let sheet   = ss.getSheetByName('App_Notes');

    if (!sheet) return JSON.stringify({ success: true, notes: {} });

    const data  = sheet.getDataRange().getDisplayValues();

    let notesDict = {};

    for (let i = 0; i < data.length; i++) {

      let id = data[i][0].toString().trim();

      if (id && id.toUpperCase() !== 'TRACKING ID' && id.toUpperCase() !== 'MÃ ĐƠN HÀNG') {

        notesDict[id] = { text: data[i][1], user: data[i][2], time: data[i][3] };

      }

    }

    return JSON.stringify({ success: true, notes: notesDict });

  } catch (e) { return JSON.stringify({ error: e.message }); }

}

// Tra cứu hub theo Tracking ID — dùng cho ALERT HOOK trong aging_saveNote().
// Tái dùng aging_getMasterData() (đã có cache CacheMgr 300s theo user) nên hầu hết
// các lần gọi là cache-hit, không tốn thêm chi phí đọc sheet Core/Lost.
// Trả về '' nếu không tìm thấy hoặc có lỗi — caller phải tự kiểm tra rỗng, không throw.
function _aging_findHubById_(cleanId) {
  try {
    var raw = _aging_getMasterDataCore_();
    var data = JSON.parse(raw);
    if (!data || !data.success) return '';
    var lists = [data.coreData || [], data.lostData || []];
    for (var li = 0; li < lists.length; li++) {
      var arr = lists[li];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].shipmentId === cleanId) {
          return arr[i].hubName || arr[i].hub || arr[i].Hub || '';
        }
      }
    }
  } catch (e) {}
  return '';
}

function aging_saveNote(id, noteText, hubName) {

  // [FIX NGHẼN LOCK 2026-07-24] TRƯỚC ĐÂY dùng thẳng LockService.getScriptLock() —
  // đây là hàm lưu note Quá Hạn, dùng THƯỜNG XUYÊN NHẤT trong cả app (mọi trạm, mọi
  // ca, liên tục cả ngày) nên gần như chắc chắn góp phần vào tình trạng nghẽn chung
  // (cùng nhóm bệnh với saveRiderPlan/Admin Access — xem giải thích đầy đủ ở đó).
  // Đổi sang named lock riêng cho App_Notes qua _anaAcquireNamedLock() (đã có sẵn).
  var cleanId, shortUser, timestamp, hubForAlert = (hubName||'').toString().trim();

  // [FIX BẢO MẬT NGHIÊM TRỌNG — phát hiện qua rà soát chủ động theo yêu cầu quét
  // IDOR toàn diện] Hàm này TRƯỚC ĐÂY hoàn toàn KHÔNG kiểm tra quyền — bất kỳ ai
  // đăng nhập được (kể cả Staff cấp thấp nhất) đều có thể ghi ĐÈ ghi chú của BẤT
  // KỲ đơn hàng nào tại BẤT KỲ trạm nào, không giới hạn theo quyền hub thật của họ
  // (Session.getActiveUser() ở dòng dưới CHỈ dùng để hiển thị tên người ghi, KHÔNG
  // dùng để kiểm tra quyền — dễ nhầm là "đã có kiểm tra" khi quét tự động, phải đọc
  // kỹ mới phát hiện). Sửa: chuyển bước tra cứu hub LÊN TRƯỚC (để luôn có đúng hub
  // thật của đơn hàng dù client cũ có gửi hubName hay không), rồi kiểm tra hub đó
  // có thuộc quyền người gọi (getModuleAccess(), cache 120s — không ảnh hưởng hiệu
  // năng hàm dùng thường xuyên nhất app) hay không TRƯỚC KHI cho phép ghi. Nếu
  // KHÔNG xác định được hub (trường hợp hiếm — đơn chưa có trong hệ Quá Hạn), vẫn
  // cho ghi (tránh chặn nhầm use case hợp lệ chưa lường hết) nhưng ghi log cảnh báo.
  if (!hubForAlert) {
    try { hubForAlert = _aging_findHubById_((id||'').toString().trim().toUpperCase()); } catch (eHubEarly) {}
  }
  try {
    var _noteAccess = getModuleAccess();
    if (_noteAccess.role === 'denied') {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền ghi chú.' });
    }
    // [CẬP NHẬT — theo quy tắc nghiệp vụ đã xác nhận: "Ghi chú Quá Hạn chỉ dành
    // cho Lead/Staff, các cấp cao (ROM/AOM/SUP) KHÔNG ghi chú tới nó"] Chỉ kiểm
    // tra hub-membership KHÔNG đủ — 1 AOM/SUP về lý thuyết "quản lý" hub đó
    // (hub nằm trong access.hubs của họ) vẫn KHÔNG được phép ghi chú, vì đây là
    // hành động cấp vận hành (station-level), không phải cấp quản lý. Admin vẫn
    // giữ toàn quyền bypass — nhất quán với nguyên tắc "chỉ admin là 1 và duy
    // nhất" đã xác lập (phục vụ xử lý khẩn cấp/hỗ trợ khi cần).
    if (_noteAccess.role !== 'admin' && _noteAccess.levelCode !== 'lead' && _noteAccess.levelCode !== 'staff') {
      return JSON.stringify({ success: false, error: 'Chỉ cấp Lead/Staff mới được ghi chú Quá Hạn — cấp ' + (_noteAccess.levelLabel || _noteAccess.levelCode) + ' không có quyền này.' });
    }
    if (_noteAccess.role !== 'admin' && hubForAlert) {
      var _noteHasHub = (_noteAccess.hubs || []).some(function(h){
        return (typeof cleanHubString === 'function' ? cleanHubString(h) === cleanHubString(hubForAlert) : h.trim().toLowerCase() === hubForAlert.trim().toLowerCase());
      });
      if (!_noteHasHub) {
        return JSON.stringify({ success: false, error: 'Không có quyền ghi chú cho trạm: ' + hubForAlert });
      }
    } else if (_noteAccess.role !== 'admin' && !hubForAlert) {
      Logger.log('[aging_saveNote CẢNH BÁO] Không xác định được hub cho đơn ' + id + ' — cho phép ghi (không chặn), user=' + _noteAccess.email);
    }
  } catch (eNotePerm) {
    return JSON.stringify({ success: false, error: 'Lỗi kiểm tra quyền: ' + eNotePerm.message });
  }

  if (!_anaAcquireNamedLock('aging_notes_write_lock_v1', 10000, 15000)) {
    return JSON.stringify({ success: false, error: 'Hệ thống đang bận lưu note, vui lòng thử lại sau ít giây.' });
  }

  try {

    const ss = _DS.ss(ADMIN_DB_ID);

    let sheet = ss.getSheetByName('App_Notes');

    if (!sheet) {

      sheet = ss.insertSheet('App_Notes');

      sheet.appendRow(['Tracking ID','Nội Dung Note','Người Note','Thời Gian']);

    }

    const data     = sheet.getDataRange().getDisplayValues();

    let rowIndexes = [];

    cleanId = id.toString().trim().toUpperCase();

    for (let i = 0; i < data.length; i++) {

      if (data[i][0].toString().trim().toUpperCase() === cleanId) rowIndexes.push(i + 1);

    }

    timestamp  = Utilities.formatDate(new Date(), "GMT+7", "dd/MM HH:mm");

    let userEmail  = Session.getActiveUser().getEmail() || "";

    shortUser  = userEmail ? userEmail.split('@')[0].toUpperCase() : "ADMIN";

    // [DỌN — đã chuyển lên đầu hàm, xem đoạn kiểm tra quyền phía trên] Việc tra
    // cứu hubForAlert (khi client cũ chưa gửi hubName) giờ chạy SỚM HƠN, TRƯỚC
    // bước kiểm tra quyền — không cần lặp lại ở đây nữa.

    if (rowIndexes.length > 0) {

      sheet.getRange(rowIndexes[0], 2).setValue(noteText);

      sheet.getRange(rowIndexes[0], 3).setValue(shortUser);

      sheet.getRange(rowIndexes[0], 4).setValue(timestamp);

      for (let j = rowIndexes.length - 1; j >= 1; j--) sheet.deleteRow(rowIndexes[j]);

    } else {

      sheet.appendRow([cleanId, noteText, shortUser, timestamp]);

    }

    // [FIX 2026-07-28] KHÔNG còn gọi _aging_invalidateMasterCache() ở đây nữa —
    // trước đây mỗi lần lưu note (hành động dùng thường xuyên nhất cả app) đều
    // xoá luôn cache Core/Lost/FM (giờ đã tách thành cache CHUNG, dùng chung cho
    // mọi user — xem aging_getMasterData()), ép TẤT CẢ user đọc cold ngay sau đó
    // dù dữ liệu Core/Lost/FM chẳng thay đổi gì khi lưu note. Notes đã có cache
    // riêng, invalidate đúng lúc ngay dưới đây — không cần đụng tới cache dữ liệu thô.
    _aging_invalidateNotesCache();  // Xóa cache notes riêng → lần đọc tiếp lấy note mới

  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }

  finally { _anaReleaseNamedLock('aging_notes_write_lock_v1'); }

  // ── ALERT HOOK: đẩy RA NGOÀI lock ghi note (giống hệt kpifail_saveNote) ──
  // Chạy sau khi lock đã release — dù _aging_findHubById_ ở trên hiếm khi chậm (cache
  // thường nóng sẵn), việc push alert vẫn không được phép giữ khóa ghi note của các
  // user khác, và không được phép làm hỏng kết quả lưu note (đã thành công ở trên)
  // nếu Alert_Aggregate có vấn đề gì đó — nên bọc try/catch im lặng riêng.
  try {
    if (hubForAlert) {
      _pushAlert_({
        stationName: hubForAlert,
        source:      'aging',
        severity:    2,
        entityRef:   id,
        message:     'Quá hạn note: ' + noteText.substring(0, 80)
      });
    }
  } catch (eAlert) {}

  return JSON.stringify({ success: true, user: shortUser, time: timestamp });

}

