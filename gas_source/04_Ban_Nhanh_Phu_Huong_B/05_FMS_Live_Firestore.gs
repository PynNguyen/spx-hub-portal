// ============================================================
// [ĐÃ XOÁ TOÀN BỘ — MODULE 7: BÁO CÁO PHÂN TÍCH (TỪ BỔ SUNG)]
// Gồm getReportData()/getTrendData()/getCodData() + 5 hàm phụ trợ nội bộ
// (_bc_parseRows/_bc_buildSummary/_bc_buildDriverStats/_bc_buildZoneStats/
// _bc_buildTimingStats) — backend cho tab "Báo cáo" cũ đã gỡ khỏi giao diện
// từ trước (cùng đợt xoá mascotRefreshReport() đã ghi chú ở index.html).
// Xác nhận qua grep toàn bộ 4 file .gs (backend.gs/Firestore_bridge.gs/
// Multi_DB_Router.gs/StationConfig.gs) + toàn bộ .html — không còn nơi nào
// gọi tới bất kỳ hàm nào trong nhóm này.

// ============================================================

// --- QUYỀN TRUY CẬP & TIỆN ÍCH ---

// ============================================================

// [PERF 2026-10] TRƯỚC ĐÂY hàm này mở file ADMIN_DB + đọc TOÀN BỘ sheet Admin_Access
// ở MỌI lần gọi (doGet, getModuleHtml, include, _requireApproved_ trong ~10 RPC polling...).
// Executions đo thật: lệnh polling "nhẹ" (spx_getModuleStatusPublic, spx_getSystemAnnouncement...)
// mất trung bình 3,3 giây, phần lớn là bước này. Nay: đọc 1 lần rồi cache danh sách email
// đã "Duyệt" trong CacheService 60 giây, dùng chung mọi user.
//
// ĐẢM BẢO ĐÚNG/MỚI:
//  - Mọi hàm GHI vào Admin_Access (duyệt/thu hồi/+Lương/yêu cầu mới) gọi _accInvalidate_()
//    ngay sau khi ghi -> thu hồi quyền có hiệu lực ngay ở lượt gọi kế tiếp.
//  - Sửa tay trực tiếp trên Google Sheet: chậm tối đa 60 giây (TTL).
//  - Ngữ nghĩa giữ NGUYÊN như bản cũ: dòng ĐẦU TIÊN của mỗi email quyết định; chỉ "Duyệt" mới qua.
//  - Lỗi đọc sheet: dùng bản "lần cuối đọc được" (tối đa 6 giờ) thay vì từ chối oan tất cả mọi người.
var _ACC_NS      = 'PERMISSION';
var _ACC_KEY     = 'acc_approved_v1';
var _ACC_LKG_KEY = 'acc_approved_lkg_v1';
var _ACC_TTL     = 60;
var _ACC_LKG_TTL = 21600;
var _accSetMemo_ = null; // chỉ sống trong 1 lần thực thi

function _accReadApprovedFromSheet_() {
  var sheet = _DS.ss(ADMIN_DB_ID).getSheetByName('Admin_Access');
  if (!sheet) throw new Error('Không thấy sheet Admin_Access.');
  var data = sheet.getDataRange().getValues();
  var seen = {}, out = [];
  for (var i = 1; i < data.length; i++) {
    var e = String(data[i][0] == null ? '' : data[i][0]).toLowerCase().trim();
    if (!e || seen[e]) continue;                 // dòng đầu tiên của email quyết định
    seen[e] = true;
    if (String(data[i][1] == null ? '' : data[i][1]).trim() === 'Duyệt') out.push(e);
  }
  return out;
}

function _accGetApprovedSet_() {
  if (_accSetMemo_) return _accSetMemo_;
  var arr = CacheMgr.getChunked(_ACC_NS, _ACC_KEY);
  if (!arr || !Array.isArray(arr)) {
    try {
      arr = _accReadApprovedFromSheet_();
      CacheMgr.setChunked(_ACC_NS, _ACC_KEY, arr, _ACC_TTL);
      CacheMgr.setChunked(_ACC_NS, _ACC_LKG_KEY, arr, _ACC_LKG_TTL);
    } catch (eRead) {
      arr = CacheMgr.getChunked(_ACC_NS, _ACC_LKG_KEY);
      if (!arr || !Array.isArray(arr)) throw eRead;
    }
  }
  var set = {};
  for (var i = 0; i < arr.length; i++) set[arr[i]] = true;
  _accSetMemo_ = set;
  return set;
}

/** Gọi NGAY SAU mọi thao tác ghi vào Admin_Access — best-effort, không bao giờ throw. */
function _accInvalidate_() {
  _accSetMemo_ = null;
  try { CacheMgr.invalidateChunked(_ACC_NS, _ACC_KEY); } catch (e1) {}
  try { CacheMgr.invalidateChunked(_ACC_NS, _ACC_LKG_KEY); } catch (e2) {}
  try { CacheMgr.invalidateChunked('ADMIN', 'spx_pending_access_list_v1'); } catch (e3) {}
}

function checkUserAccess(email) {
  try {
    var em = String(email == null ? '' : email).toLowerCase().trim();
    if (!em) return false;
    return !!_accGetApprovedSet_()[em];
  } catch (e) { return false; }
}

function submitAccessRequest() {

  const email = Session.getActiveUser().getEmail();

  const sheet = _DS.ss(ADMIN_DB_ID).getSheetByName('Admin_Access');

  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) { if (data[i][0] === email) return "Bạn đã gửi yêu cầu rồi!"; }

  sheet.appendRow([email, "Chờ", new Date()]);
  try { _accInvalidate_(); } catch (eAccInv2) {}

  return "Gửi yêu cầu thành công!";

}

// [ĐÃ XOÁ — xacThucQuyenLuong(), đã thay thế bởi spx_checkLuongAccess() (dùng
// qua spx_getBootstrap()) — xác nhận qua grep toàn bộ 4 file .gs + .html,
// không còn nơi nào gọi tới]

function layEmailWatermark() {

  try { return Session.getActiveUser().getEmail(); }

  catch (e) { return "Unknown User"; }

}

/**
 * spx_getBootstrap()
 * ------------------------------------------------------------
 * [PERF] Gộp 4 lệnh google.script.run độc lập trước đây bắn ĐỒNG THỜI ngay
 * lúc trang vừa load (layEmailWatermark → initAnalyticsBlockPermission →
 * spxInitModuleAccess → spxPrefetchLuongAccess ở index.html) thành 1 round-trip
 * DUY NHẤT — giảm tải cho máy yếu / mạng chậm lúc mở trang. KHÔNG đổi logic
 * nghiệp vụ: hàm này chỉ GỌI LẠI nguyên các hàm cũ (getModuleAccess,
 * checkAnalyticsPermission, spx_checkLuongAccess) rồi gộp kết quả vào 1 JSON.
 * Các hàm cũ vẫn được giữ nguyên, không xoá — chỗ nào còn gọi riêng lẻ
 * (nếu có) vẫn hoạt động bình thường.
 */
function spx_getBootstrap() {
  // [SỬA — báo cáo: "trạm của user load khá chậm, lần đầu lẫn lần sau đều chậm"]
  // Hàm này chạy NỐI TIẾP 3 bước phân quyền, mỗi bước đọc sheet riêng. Hai việc:
  //   (1) ĐO thời gian từng bước -> biết chính xác bước nào chậm, không phải đoán.
  //   (2) LƯU ĐỆM cả gói theo từng người 5 phút -> các lần tải sau gần như tức thì.
  //       5 phút đủ ngắn để đổi quyền có hiệu lực nhanh, đủ dài để F5 liên tục
  //       không phải tính lại. Đổi quyền cần hiệu lực NGAY thì dùng
  //       getModuleAccess_invalidate(email) như trước.
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (eEmail) { email = 'Unknown User'; }

  var _bKey = 'spx_bootstrap_v1_' + String(email).toLowerCase().replace(/[^a-z0-9]/g, '_');
  try {
    var _hit = CacheService.getScriptCache().get(_bKey);
    if (_hit) return _hit;
  } catch (eC) {}

  var _t = {}, _last = Date.now(), _t0 = _last;
  var _mark = function (k) { var n = Date.now(); _t[k] = n - _last; _last = n; };

  var moduleAccess = { role: 'denied', email: '', hubs: [] };
  try { moduleAccess = getModuleAccess(); } catch (eMod) {
    moduleAccess = { role: 'denied', email: '', hubs: [], error: eMod.message };
  }
  _mark('quyenModule');

  var analyticsPerm = { allowed: false, stations: [] };
  try { analyticsPerm = checkAnalyticsPermission(email); } catch (eAna) {
    analyticsPerm = { allowed: false, stations: [], error: eAna.message };
  }
  _mark('danhSachTram');

  var luongAccess = 'denied';
  try { luongAccess = spx_checkLuongAccess(); } catch (eLuong) { luongAccess = 'denied'; }
  _mark('quyenLuong');

  _t.tong = Date.now() - _t0;
  var out = JSON.stringify({
    email: email,
    moduleAccess: moduleAccess,
    analyticsPerm: analyticsPerm,
    luongAccess: luongAccess,
    _timing: _t
  });
  try { CacheService.getScriptCache().put(_bKey, out, 300); } catch (eP) {}
  return out;
}

// [ĐÃ XOÁ — removeVietnameseTones(str), xác nhận qua grep toàn bộ 4 file .gs
// + .html — không còn nơi nào gọi tới]
/**Block 8 */

/**
 * Đồng bộ dữ liệu Pick/FMS lên Sheet trung tâm (UPSERT theo Order ID)
 */
function syncSmartData(hubName, payloadString) {
  // [SECURITY FIX 2026-08] Hàm GHI dữ liệu vào sheet DATA_<HUB> — trước đây không
  // kiểm tra quyền, ai cũng ghi/đè được dữ liệu của bất kỳ hub nào (kể cả hub mình
  // không quản lý) bằng cách chỉ đổi tham số hubName.
  const _syncAccess = getModuleAccess();
  if (_syncAccess.role === 'denied') return { success: false, msg: 'Không có quyền truy cập.' };
  if (_syncAccess.role !== 'admin' &&
      (_syncAccess.hubs || []).map(function(h){ return _normStationKey_(h); }).indexOf(_normStationKey_(hubName)) === -1) {
    return { success: false, msg: 'Không có quyền ghi dữ liệu cho hub này.' };
  }

  const SHEET_ID = '1Q9Hw2sLxkJZg9MSP1EzfkB_-IvknDRhNwrKAzHQE4pw';
  const safeHubName = hubName ? hubName.replace(/[\/\s]+/g,'_').toUpperCase() : "HUB_CHUA_DAT_TEN";

  // FIX: getScriptLock() là lock TOÀN CỤC dùng chung mọi user/mọi trạm.
  // Mỗi hub ghi vào sheet riêng (DATA_<HUB>) nên không cần chặn nhau.
  // Dùng "named lock" giả lập qua PropertiesService: chỉ chặn các request
  // CÙNG hubName ghi đồng thời, hub khác chạy song song không bị ảnh hưởng.
  // Bước check-and-set named lock được bọc trong ScriptLock NGẮN (vài ms)
  // để tránh race condition 2 request cùng hub đọc "trống" đồng thời.
  var props = PropertiesService.getScriptProperties();
  var lockKey = 'syncSmartData_lock_' + safeHubName;
  var lockAcquired = false;
  var waitStart = Date.now();
  while (Date.now() - waitStart < 30000) {
    var acquireLock = LockService.getScriptLock();
    try {
      acquireLock.waitLock(2000);
      var existing = props.getProperty(lockKey);
      if (!existing || (Date.now() - parseInt(existing, 10)) > 35000) {
        // Lock trống, hoặc lock cũ đã quá 35s (process trước đó crash) → chiếm lock
        props.setProperty(lockKey, String(Date.now()));
        lockAcquired = true;
      }
    } catch(eAcquire) {
      // ScriptLock ngắn bị timeout (hiếm) — coi như chưa lấy được, thử lại ở vòng sau
    } finally {
      try { acquireLock.releaseLock(); } catch(e2) {}
    }
    if (lockAcquired) break;
    Utilities.sleep(300);
  }
  if (!lockAcquired) {
    return { success: false, msg: "Hệ thống đang bận ghi dữ liệu trạm " + hubName + ", sếp vui lòng thử lại sau 20s!" };
  }

  try {
    let csvDataArray = JSON.parse(payloadString);
    const ss = _DS.ss(SHEET_ID);
    const sheetName = "DATA_"+safeHubName;
    let sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      let headers = [
        "Order ID", "Trạng thái", "Mã tài xế", "Tên tài xế", "Khu vực", 
        "Khối lượng", "COD", "Lần giao", "SLA Tag", "Lý do Hold", 
        "Phí ASF", "Đồng kiểm", "Vĩ độ (Lat)", "Kinh độ (Lng)", "Timestamp cập nhật"
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight("bold").setBackground("#1e293b").setFontColor("white").setHorizontalAlignment("center");
      sheet.setFrozenRows(1);
    }

    let existingValues = sheet.getDataRange().getValues();
    let dataMap = {};
    for (let i = 1; i < existingValues.length; i++) {
      let id = existingValues[i][0];
      if (id) dataMap[id] = existingValues[i];
    }

    let upCount = 0, insCount = 0, now = new Date();
    csvDataArray.forEach(item => {
      let rowData = [
        item.id, item.status, item.driver, item.ward, item.type,
        item.weight, item.cod, item.attempts, item.risk, item.reason,
        item.asf, item.cocheck, item.lat, item.lng, now
      ];
      if (dataMap[item.id]) { dataMap[item.id] = rowData; upCount++; }
      else                  { dataMap[item.id] = rowData; insCount++; }
    });

    let finalOutput = [existingValues[0]];
    for (let orderId in dataMap) finalOutput.push(dataMap[orderId]);

    sheet.clearContents();
    sheet.getRange(1, 1, finalOutput.length, finalOutput[0].length).setValues(finalOutput);
    sheet.autoResizeColumns(1, 15);

    return { success: true, msg: `Đã đồng bộ! Trạm: ${hubName}. (Mới: ${insCount}, Cập nhật: ${upCount})` };
  } catch (e) { 
    return { success: false, msg: "Lỗi Server: " + e.message }; 
  } finally { 
    props.deleteProperty(lockKey);
  }
}

// ============================================================
// --- INCLUDE (SPA) ---
// ============================================================
function include(filename) {
  // [SECURITY FIX 2026-08] Hàm này trả về TOÀN BỘ mã nguồn (HTML+JS) của bất kỳ
  // file .html nào trong project theo tên — trước đây không kiểm tra quyền, nên
  // người CHƯA được duyệt (vẫn dùng chung google.script.run bridge qua trang
  // UI_RequestAccess) có thể gọi thẳng google.script.run.include('index') hoặc
  // include('Analytics_Block') v.v. để đọc toàn bộ mã nguồn ứng dụng (kiến trúc
  // nội bộ, tên hàm, comment giải thích logic bảo mật...) mà không cần được duyệt.
  // An toàn khi thêm chặn "đã duyệt" vì UI_RequestAccess.html (trang duy nhất hiển
  // thị cho user CHƯA duyệt) không gọi include() ở bất kỳ đâu.
  _requireApproved_();
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

var MASTER_DB_ID = "1Q9Hw2sLxkJZg9MSP1EzfkB_-IvknDRhNwrKAzHQE4pw";

/**
 * B6-FIX: Guard kiểm tra getStationSS tồn tại trước khi bất kỳ hàm analytics nào chạy.
 * getStationSS() phải được định nghĩa trong file .gs riêng (VD: StationConfig.gs).
 * Nếu thiếu file đó → mọi hàm analytics (save/load/inbound/supplement/trend) sẽ crash
 * với ReferenceError ngay tại dòng đầu tiên gọi getStationSS().
 *
 * Stub này đảm bảo:
 *  1. Nếu getStationSS ĐÃ được định nghĩa ở file khác → stub không ghi đè (vì typeof check).
 *  2. Nếu CHƯA có → stub trả về MASTER_DB_ID spreadsheet làm fallback (1 spreadsheet cho mọi trạm),
 *     log warning rõ ràng để dễ phát hiện trong GAS console.
 *  3. Các hàm analytics tiếp tục chạy không crash, thay vì throw ReferenceError im lặng.
 *
 * QUAN TRỌNG: Stub này chỉ là lưới an toàn — vẫn cần tạo StationConfig.gs với
 * getStationSS() thực sự map từng trạm sang đúng Spreadsheet ID.
 */
if (typeof getStationSS !== 'function') {
  function getStationSS(stationName) {
    console.warn('[B6-GUARD] getStationSS() chưa được định nghĩa trong project! ' +
      'Hãy tạo StationConfig.gs với hàm getStationSS(stationName). ' +
      'Hiện dùng MASTER_DB_ID làm fallback cho trạm: ' + stationName);
    return _DS.ss(MASTER_DB_ID);
  }
}

/**
 * migrateInboundLockKeys()
 * ------------------------------------------------------------------
 * Chạy 1 LẦN thủ công sau khi deploy fix _anaSafeStationKey mới.
 * Đọc từng row trong Inbound_Lock, lấy Station Name (cột B) để
 * tái tạo Station Key (cột A) đúng theo _anaSafeStationKey mới.
 * KHÔNG dùng tên hub đang loop để ghi — tránh overwrite nhầm toàn bộ sheet.
 */
function migrateInboundLockKeys() {
  // [SECURITY FIX 2026-08] Công cụ di trú ghi lại dữ liệu Inbound_Lock trên MỌI
  // trạm — trước đây không kiểm tra quyền. Chỉ admin mới được chạy.
  _requireAdmin_(2);
  var report = { updated: 0, skipped: 0, errors: [] };
  // Lấy tất cả spreadsheet chứa Inbound_Lock (theo danh sách hub từ SA)
  var allHubs = _rp_getAllHubsFromSA();
  var seenSS = {}; // tránh xử lý cùng 1 spreadsheet 2 lần
  allHubs.forEach(function(hub) {
    try {
      var ss = getStationSS(hub);
      if (!ss) return;
      var ssId = ss.getId();
      if (seenSS[ssId]) return;
      seenSS[ssId] = true;

      var sheet = ss.getSheetByName('Inbound_Lock');
      if (!sheet || sheet.getLastRow() <= 1) return;
      var lastRow = sheet.getLastRow();
      // Đọc cả cột A (key cũ) và cột B (Station Name – nguồn sự thật)
      var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      var updates = [];
      data.forEach(function(row, i) {
        var stationName = String(row[1] || '').trim();
        if (!stationName) return;
        var correctKey = _anaSafeStationKey(stationName); // tái tạo từ tên trạm
        var currentKey = String(row[0] || '').trim();
        if (currentKey === correctKey) { report.skipped++; return; }
        updates.push({ rowNum: i + 2, key: correctKey });
        report.updated++;
      });
      // Ghi từng cell (không ghi hàng loạt tránh lệch index)
      updates.forEach(function(u) {
        sheet.getRange(u.rowNum, 1).setValue(u.key);
      });
    } catch(e) {
      report.errors.push(hub + ': ' + e.message);
    }
  });
  var msg = 'Migrate Inbound_Lock Keys xong:\n' +
    '✅ Đã sửa: ' + report.updated + ' rows\n' +
    '⏭ Đã đúng (bỏ qua): ' + report.skipped + ' rows\n' +
    (report.errors.length ? '❌ Lỗi (' + report.errors.length + '): ' + report.errors.slice(0,5).join(', ') : '');
  _LOG.d(msg);
  // Standalone script (không bound Sheet cố định) → getUi() luôn lỗi, xem log qua Execution log
  return msg;
}

/**
 * migrateInboundLockToDateMap()
 * ------------------------------------------------------------------
 * Chạy 1 LẦN THỦ CÔNG sau khi deploy bản redesign inbound (2026-07).
 * Chuyển toàn bộ dữ liệu Inbound_Lock hiện có từ định dạng CŨ (mảng ID phẳng
 * ở cột E, reset theo ngày) sang định dạng MỚI (idDates map ở cột F,
 * luỹ kế toàn thời gian, không reset).
 *
 * QUY TẮC GÁN NGÀY CHO DỮ LIỆU CŨ: vì dữ liệu cũ không lưu ngày riêng cho
 * từng ID, toàn bộ ID hiện có trong 1 row sẽ được gán chung "Ngày" (cột C)
 * của chính row đó — đây là xấp xỉ hợp lý vì dưới hệ thống cũ, cả mảng allIds
 * của 1 row vốn đã được (re)tạo/khoá trong đúng ngày ghi ở cột C.
 *
 * An toàn khi chạy nhiều lần: nếu row đã có idDates hợp lệ ở cột F → bỏ qua.
 */
function migrateInboundLockToDateMap() {
  // [SECURITY FIX 2026-08] Cùng lớp lỗi với migrateInboundLockKeys() — công cụ di
  // trú ghi lại dữ liệu trên mọi trạm, trước đây không kiểm tra quyền.
  _requireAdmin_(2);
  var report = { migrated: 0, skipped: 0, emptyRows: 0, errors: [] };
  var allHubs = _rp_getAllHubsFromSA();
  var seenSS = {};
  allHubs.forEach(function(hub) {
    try {
      var ss = getStationSS(hub);
      if (!ss) return;
      var ssId = ss.getId();
      if (seenSS[ssId]) return;
      seenSS[ssId] = true;

      var sheet = ss.getSheetByName('Inbound_Lock');
      if (!sheet || sheet.getLastRow() <= 1) return;
      var lastRow = sheet.getLastRow();
      var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

      data.forEach(function(row, i) {
        try {
          var rowNum = i + 2;
          var stationName = String(row[1] || '').trim();
          if (!stationName) { report.emptyRows++; return; }

          // Đã có idDates hợp lệ (không rỗng) ở cột F → coi như đã migrate, bỏ qua
          var existingIdDates = {};
          try { existingIdDates = JSON.parse(row[5] || '{}'); } catch(e) { existingIdDates = {}; }
          if (existingIdDates && typeof existingIdDates === 'object' && !Array.isArray(existingIdDates)
              && Object.keys(existingIdDates).length > 0) {
            report.skipped++;
            return;
          }

          var legacyIds = [];
          try { legacyIds = JSON.parse(row[4] || '[]'); } catch(e) { legacyIds = []; }
          if (!Array.isArray(legacyIds) || legacyIds.length === 0) { report.emptyRows++; return; }

          var _rawDate = row[2];
          var legacyDate;
          if (_rawDate instanceof Date) {
            legacyDate = Utilities.formatDate(_rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
          } else {
            legacyDate = String(_rawDate || '').slice(0, 10) || _anaTodayKey();
          }

          var idDates = {};
          legacyIds.forEach(function(id) { if (id && id !== '__trimmed__') idDates[id] = legacyDate; });
          var idDatesJson = JSON.stringify(idDates);
          // Cùng ngưỡng trim với _anaSaveInboundState — phòng trường hợp row cũ quá lớn
          if (idDatesJson.length > 45000) {
            idDatesJson = _anaTrimIdDatesBySize(idDates, 45000);
          }

          sheet.getRange(rowNum, 6).setValue(idDatesJson); // cột F
          report.migrated++;
        } catch(eRow) {
          report.errors.push(hub + ' row' + (i + 2) + ': ' + eRow.message);
        }
      });
    } catch(e) {
      report.errors.push(hub + ': ' + e.message);
    }
  });
  var msg = 'Migrate Inbound_Lock → idDates map xong:\n' +
    '✅ Đã chuyển: ' + report.migrated + ' rows\n' +
    '⏭ Đã sẵn có (bỏ qua): ' + report.skipped + ' rows\n' +
    '➖ Rỗng: ' + report.emptyRows + ' rows\n' +
    (report.errors.length ? '❌ Lỗi (' + report.errors.length + '): ' + report.errors.slice(0, 5).join(', ') : '');
  _LOG.d(msg);
  // KHÔNG dùng SpreadsheetApp.getUi().alert() ở đây — đây là standalone script (không bound
  // vào 1 Sheet cố định, dùng getStationSS(hub) mở nhiều spreadsheet qua ID) nên không có UI
  // để bám vào, gọi getUi() sẽ luôn ném lỗi "Cannot call SpreadsheetApp.getUi() from this context".
  // Xem kết quả qua: Apps Script Editor > Execution log (hoặc View > Logs) sau khi chạy hàm này.
  return msg;
}

// =========================================================================
// [FIX] Trim theo ĐỘ DÀI KÝ TỰ THỰC TẾ, không phải số lượng ID cố định.
// GSheet cell limit CỨNG là 50.000 ký tự — nếu orderId dài hơn dự kiến, một
// ngưỡng cắt cố định (vd "giữ 2000 ID cuối") vẫn có thể vượt giới hạn và ném
// lỗi "Your input contains more than the maximum of 50000 characters..."
// Hàm dưới tính lại kích thước SAU KHI cắt và lặp giảm dần nếu vẫn còn vượt,
// đảm bảo luôn ghi được vào cell dù orderId dài bất thường.
// =========================================================================
function _anaTrimIdDatesBySize(idDates, maxLen) {
  var keys = Object.keys(idDates);
  var full = JSON.stringify(idDates);
  if (full.length <= maxLen) return full;

  var pairs = keys.map(function(id) { return [id, idDates[id] || '']; });
  pairs.sort(function(a, b) { return a[1] < b[1] ? 1 : (a[1] > b[1] ? -1 : 0); }); // ngày gần nhất trước

  var avgLen = full.length / Math.max(keys.length, 1);
  var keepCount = Math.max(1, Math.floor((maxLen - 20) / avgLen)); // trừ hao cho sentinel
  if (keepCount > pairs.length) keepCount = pairs.length;

  var json;
  do {
    var kept = {};
    for (var i = 0; i < keepCount; i++) kept[pairs[i][0]] = pairs[i][1];
    kept.__trimmed__ = '1';
    json = JSON.stringify(kept);
    if (json.length <= maxLen) break;
    keepCount = Math.floor(keepCount * 0.8); // ước lượng sai (orderId bất thường dài) → giảm dần và đo lại
  } while (keepCount > 0);

  if (keepCount <= 0) json = JSON.stringify({ __trimmed__: '1' }); // trường hợp cực đoan: 1 ID cũng đã quá dài

  return json;
}

function _anaTrimIdArrayBySize(idsArray, maxLen) {
  var full = JSON.stringify(idsArray);
  if (full.length <= maxLen) return full;

  var avgLen = full.length / Math.max(idsArray.length, 1);
  var keepCount = Math.max(1, Math.floor(maxLen / avgLen));
  var tail = idsArray.slice(-keepCount);

  var json;
  do {
    json = JSON.stringify(tail);
    if (json.length <= maxLen) break;
    tail = tail.slice(Math.ceil(tail.length * 0.2)); // giảm dần và đo lại nếu vẫn vượt
  } while (tail.length > 0);

  return json || '[]';
}

function _anaSafeStationKey(stationName) {
  // [FIX 2026-06] Trước đây chỉ replace ký tự đặc biệt thành "_" mà KHÔNG bỏ dấu tiếng Việt
  // → "Krông Pắk" và "Krong Pak" tạo ra 2 key khác nhau (Kr_ng_P_k vs Krong_Pak)
  // → _anaFindInboundRow không tìm thấy row → inboundLock luôn = 0 → đếm lại từ đầu mỗi lần load
  // Nay dùng chung _normStationKey_() rồi đổi dấu "_" ngăn cách cho dễ đọc trong sheet
  return _normStationKey_(stationName).replace(/[^a-z0-9]/g, '_');
}

/**
 * ANTI-DATA-RESURRECTION (FIX 2026-07): "Clear Epoch" theo trạm.
 * ---------------------------------------------------------------
 * VẤN ĐỀ: 1 trạm thường có NHIỀU người/tab cùng mở dashboard. Khi 1 người bấm
 * "Xóa dữ liệu" (clearStationData), thao tác đó CHỈ dọn sạch RAM/IndexedDB của
 * đúng tab vừa bấm + Data_/Sup_ trên Cloud. Các tab khác (chưa F5 lại trang) vẫn
 * giữ nguyên DS.primary CŨ trong bộ nhớ — và vì saveStationData() merge kiểu
 * "lũy tiến, chỉ tăng không giảm" (bắt đầu từ toàn bộ đơn cũ trong RAM rồi mới đắp
 * dữ liệu mới lên), chỉ cần tab đó upload/lưu thêm 1 lần là dữ liệu vừa xóa bị đẩy
 * ngược trở lại Cloud — trông như "bị cộng dồn dữ liệu ngày cũ" dù đã xóa.
 *
 * GIẢI PHÁP: mỗi lần clearStationData() chạy thành công, "bump" 1 mốc epoch
 * (timestamp) riêng cho trạm đó lên PropertiesService. Mọi lượt gọi
 * saveStationData()/saveSupplementData() PHẢI gửi kèm epoch mà client đang biết
 * (đọc được từ lần getStationData()/save gần nhất) — nếu epoch client gửi lên
 * NHỎ HƠN epoch hiện tại trên server (tức là dữ liệu trong tay client cũ hơn lần
 * xóa gần nhất), server SẼ TỪ CHỐI ghi (không merge, không union) và trả về cờ
 * staleEpoch để client tự làm mới lại toàn bộ từ Cloud — chặn đứng việc dữ liệu
 * cũ len lỏi trở lại bất kể có bao nhiêu tab/người dùng đang mở song song.
 *
 * [FIX 2026-08-13 — QUAN TRỌNG] TRƯỚC ĐÂY mỗi trạm dùng 1 PROPERTY RIÊNG
 * ('ana_clear_epoch_' + tên trạm), ghi thì có nhưng KHÔNG BAO GIỜ xoá — tích luỹ
 * VĨNH VIỄN theo số trạm từng dùng nút "Xoá dữ liệu" ít nhất 1 lần trong suốt
 * vòng đời hệ thống. PropertiesService giới hạn CỨNG 500 property/script (không
 * phụ thuộc gói Workspace) — khi chạm trần, MỌI setProperty() ở BẤT KỲ đâu trong
 * toàn bộ project (lock đa người dùng, cursor job nền, cờ tự-phục-hồi Firestore...)
 * đồng loạt lỗi, không chỉ riêng cơ chế này — 1 lỗi "âm ỉ" trở thành sập dây
 * chuyền toàn hệ thống khi đủ tích luỹ, không liên quan gì tới tải truy cập.
 *
 * SỬA: gộp TẤT CẢ epoch của mọi trạm vào ĐÚNG 1 property duy nhất (JSON map
 * {tênTrạm: epoch}) — số property dùng cho cơ chế này luôn = 1 bất kể có bao
 * nhiêu trạm. Để value của 1 property không vượt trần 9KB khi có nhiều trạm,
 * tự động: (1) dọn entry cũ hơn CLEAR_EPOCH_RETENTION_DAYS ngày — hợp lý vì mục
 * đích chỉ cần chặn tab CŨ chưa kịp F5, không cần nhớ mãi mãi; (2) nếu vẫn còn
 * quá CLEAR_EPOCH_MAX_ENTRIES entry (trường hợp cực hiếm nhiều trạm cùng bị xoá
 * trong 1 khung thời gian ngắn), chỉ giữ lại các entry MỚI NHẤT. Đã tự kiểm
 * chứng bằng mô phỏng Node (1000 trạm cùng clear liên tiếp): kích thước tối đa
 * ~6KB, dưới xa trần 9KB.
 */
var CLEAR_EPOCH_MAP_KEY        = 'ana_clear_epoch_map_v1';
var CLEAR_EPOCH_RETENTION_DAYS = 14;
var CLEAR_EPOCH_MAX_ENTRIES    = 100;

// [ĐÃ XOÁ — _anaClearEpochPropKey_(stationName), comment cũ ghi "giữ lại để
// không phá vỡ chữ ký gọi ở nơi khác nếu có" nhưng grep toàn dự án xác nhận
// không còn nơi nào gọi tới nữa]

function _anaClearEpochReadMap_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(CLEAR_EPOCH_MAP_KEY);
    if (!raw) return {};
    var m = JSON.parse(raw);
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  } catch (e) { return {}; }
}

function _anaClearEpochPruneAndCap_(map, now) {
  var cutoff = now - CLEAR_EPOCH_RETENTION_DAYS * 86400000;
  var kept = {};
  Object.keys(map).forEach(function(k) { if (map[k] >= cutoff) kept[k] = map[k]; });
  var keys = Object.keys(kept);
  if (keys.length > CLEAR_EPOCH_MAX_ENTRIES) {
    keys.sort(function(a, b) { return kept[b] - kept[a]; }); // mới nhất trước
    var capped = {};
    keys.slice(0, CLEAR_EPOCH_MAX_ENTRIES).forEach(function(k) { capped[k] = kept[k]; });
    return capped;
  }
  return kept;
}

function _anaGetClearEpoch_(stationName) {
  try {
    var stationKey = _anaSafeStationKey(stationName);
    var map = _anaClearEpochReadMap_();
    return map[stationKey] || 0;
  } catch (e) { return 0; }
}

function _anaBumpClearEpoch_(stationName) {
  var epoch = Date.now();
  var stationKey = _anaSafeStationKey(stationName);
  // [FIX 2026-08-13] Trước đây mỗi trạm 1 property riêng nên không có rủi ro đụng
  // độ khi 2 trạm KHÁC NHAU bị xoá cùng lúc. Giờ dùng CHUNG 1 property cho mọi
  // trạm — cần khoá ngắn (đọc-sửa-ghi rất nhanh, không có I/O Sheet/Firestore nào
  // ở giữa) để 2 request xoá 2 trạm khác nhau, xảy ra gần như đồng thời, không
  // ghi đè mất epoch của nhau.
  var gotLock = false;
  var acquireLock = LockService.getScriptLock();
  try {
    acquireLock.waitLock(5000);
    gotLock = true;
    var map = _anaClearEpochReadMap_();
    map[stationKey] = epoch;
    map = _anaClearEpochPruneAndCap_(map, epoch);
    PropertiesService.getScriptProperties().setProperty(CLEAR_EPOCH_MAP_KEY, JSON.stringify(map));
  } catch (e) {
    // [AN TOÀN] Nếu không lấy được khoá kịp (hiếm) — KHÔNG chặn luồng xoá dữ liệu
    // chính (đã xoá Data_/Sup_ thật xong trước khi gọi hàm này), chỉ mất tác dụng
    // "chặn tab cũ ghi đè" cho lần xoá NÀY — chấp nhận được so với việc làm cả
    // luồng xoá dữ liệu thất bại vì 1 cơ chế phụ trợ.
  } finally {
    if (gotLock) { try { acquireLock.releaseLock(); } catch (e2) {} }
  }
  return epoch;
}

/**
 * spx_migrateClearEpochProperties()
 * [CÔNG CỤ DI TRÚ — chạy 1 LẦN, admin cấp 1] Gom toàn bộ property kiểu cũ
 * 'ana_clear_epoch_<trạm>' (rải rác, mỗi trạm 1 property, không bao giờ tự xoá —
 * xem giải thích ở trên) vào đúng 1 property JSON map mới, rồi XOÁ SẠCH các
 * property cũ để giải phóng lại đúng số slot đã bị chiếm trong trần 500/script.
 * An toàn: chỉ đọc property có prefix đúng, không đụng property nào khác; nếu 1
 * trạm vừa có property cũ vừa đã có trong map mới (do lần chạy trước bị ngắt
 * giữa chừng), giữ epoch LỚN HƠN (mới hơn).
 */
function spx_migrateClearEpochProperties() {
  _requireAdmin_(1);
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var map = _anaClearEpochReadMap_();
  var migrated = 0, deleted = 0;
  Object.keys(all).forEach(function(key) {
    if (key === CLEAR_EPOCH_MAP_KEY) return;
    if (key.indexOf('ana_clear_epoch_') !== 0) return;
    var stationKey = key.substring('ana_clear_epoch_'.length);
    var epoch = parseInt(all[key], 10) || 0;
    if (epoch > 0 && (!map[stationKey] || epoch > map[stationKey])) {
      map[stationKey] = epoch;
      migrated++;
    }
    props.deleteProperty(key);
    deleted++;
  });
  map = _anaClearEpochPruneAndCap_(map, Date.now());
  props.setProperty(CLEAR_EPOCH_MAP_KEY, JSON.stringify(map));
  var msg = 'Đã di trú ' + migrated + ' epoch vào map mới, xoá ' + deleted +
    ' property cũ — giải phóng lại ' + deleted + ' slot trong trần 500 property/script. ' +
    'Map mới còn ' + Object.keys(map).length + ' entry (đã áp retention ' + CLEAR_EPOCH_RETENTION_DAYS + ' ngày + trần ' + CLEAR_EPOCH_MAX_ENTRIES + ').';
  _LOG.d('[spx_migrateClearEpochProperties] ' + msg);
  return msg;
}
/**
 * Kiểm tra epoch client gửi lên so với epoch hiện tại trên server.
 * Trả về object lỗi nếu dữ liệu client cũ hơn lần xóa gần nhất — chỉ áp dụng khi
 * server ĐÃ TỪNG có 1 lần xóa (serverEpoch > 0), đảm bảo tương thích ngược cho
 * các trạm chưa từng dùng nút "Xóa dữ liệu" kể từ khi có cơ chế này.
 */
function _anaCheckClearEpochOrReject_(stationName, clientEpoch) {
  var serverEpoch = _anaGetClearEpoch_(stationName);
  var clEpoch = parseInt(clientEpoch, 10) || 0;
  if (serverEpoch > 0 && clEpoch < serverEpoch) {
    return {
      success: false,
      staleEpoch: true,
      clearEpoch: serverEpoch,
      msg: 'Dữ liệu trên máy đã cũ hơn lần "Xóa dữ liệu" gần nhất của trạm ' + stationName +
           ' — hệ thống đã CHẶN không cho ghi đè để tránh cộng dồn dữ liệu ngày cũ. ' +
           'Vui lòng tải lại trang (F5) rồi upload lại.'
    };
  }
  return null; // hợp lệ, cho phép ghi
}

/**
 * FIX NGHẼN CỔ CHAI ĐA TRẠM: "named lock" theo từng trạm, mô phỏng qua PropertiesService —
 * cùng pattern đã dùng trong syncSmartData(). LockService.getScriptLock() là lock TOÀN CỤC
 * của cả script: dùng trực tiếp cho save/clear sẽ khiến Trạm A ghi xong mới tới lượt Trạm B,
 * dù 2 trạm ghi vào sheet hoàn toàn khác nhau (getStationSS khác nhau) — không cần chặn nhau.
 * Hàm này chỉ chặn các request CÙNG lockKey (cùng trạm) ghi đồng thời; trạm khác chạy song
 * song. Bước check-and-set named lock vẫn được bọc trong ScriptLock NGẮN (vài ms) để tránh
 * race condition 2 request cùng trạm đọc "trống" đồng thời.
 * Dùng cặp đôi với _anaReleaseNamedLock() trong finally.
 */
function _anaAcquireNamedLock(lockKey, maxWaitMs, staleMs) {
  maxWaitMs = maxWaitMs || 30000;
  // [FIX 2026-07-21] TRƯỚC ĐÂY staleMs mặc định = 35000 (35s) trong khi các nơi gọi hàm
  // này (VD saveStationData) truyền maxWaitMs = 45000 (45s) — nghĩa là 1 lượt ghi hợp lệ
  // nhưng chạy lâu hơn 35s (trạm lớn, Firestore chậm/đang retry) có thể bị 1 request KHÁC
  // đang chờ tưởng nhầm là "process trước đã crash" và CƯỚP LUÔN lock giữa chừng — dẫn tới
  // 2 tiến trình cùng tưởng mình đang giữ quyền ghi độc quyền trên CÙNG 1 trạm, ghi đè /
  // đọc-sửa-ghi chồng lên nhau (mất cập nhật, đúng kiểu "chập chờn, có khi không ghi nhận
  // số liệu mới"). SỬA: staleMs mặc định nâng lên 90s — dư dả so với mọi maxWaitMs đang
  // dùng trong hệ thống (tối đa 45s), chỉ coi là "crash" khi thực sự vượt xa mọi kịch bản
  // hợp lệ, đồng thời vẫn đủ nhanh để tự phục hồi nếu có tiến trình thật sự crash.
  staleMs   = staleMs   || 90000;
  var props = PropertiesService.getScriptProperties();
  var waitStart = Date.now();
  while (Date.now() - waitStart < maxWaitMs) {
    var acquireLock = LockService.getScriptLock();
    var gotIt = false;
    try {
      acquireLock.waitLock(2000);
      var existing = props.getProperty(lockKey);
      if (!existing || (Date.now() - parseInt(existing, 10)) > staleMs) {
        // Lock trống, hoặc lock cũ đã quá staleMs (process trước đó crash) → chiếm lock
        props.setProperty(lockKey, String(Date.now()));
        gotIt = true;
      }
    } catch(eAcquire) {
      // ScriptLock ngắn bị timeout (hiếm) — coi như chưa lấy được, thử lại ở vòng sau
    } finally {
      try { acquireLock.releaseLock(); } catch(e2) {}
    }
    if (gotIt) return true;
    Utilities.sleep(300);
  }
  return false;
}
function _anaReleaseNamedLock(lockKey) {
  try { PropertiesService.getScriptProperties().deleteProperty(lockKey); } catch(e) {}
}

/**
 * spx_forceClearAdminLocks_()
 * [2026-07-24] Công cụ gỡ kẹt TAY — chỉ chạy trực tiếp từ Apps Script editor (Run),
 * KHÔNG gọi từ frontend. Dùng khi nghi ngờ 1 trong các named lock admin bị "dính"
 * (VD 1 lần thực thi trước đó bị Apps Script ngắt giữa chừng do timeout/dừng tay,
 * khiến finally{} không kịp chạy để giải phóng lock) — xoá sạch cả 3 key liên quan
 * tới modal "Duyệt đăng nhập"/Admin để lần thử tiếp theo chắc chắn không bị chặn bởi
 * lock cũ. An toàn tuyệt đối: chỉ xoá property, không đụng dữ liệu thật trong Sheet.
 */
function spx_forceClearAdminLocks_() {
  _anaReleaseNamedLock('admin_access_write_lock_v1');
  _anaReleaseNamedLock('admin_roles_write_lock_v1');
  _anaReleaseNamedLock('aging_notes_write_lock_v1');
  Logger.log('Đã xoá 3 lock: admin_access_write_lock_v1, admin_roles_write_lock_v1, aging_notes_write_lock_v1');
}

function _anaTodayKey() {
  // Luôn dùng múi giờ Việt Nam để tránh lệch ngày khi GGScript chạy ở server UTC
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
}

// =========================================================================
// [FIX 2026-08-13] "CẦU DAO" NGÂN SÁCH RUNTIME/NGÀY — rào chắn cho ngưỡng DUY
// NHẤT trong toàn hệ thống mà KHÔNG có try/catch nào bên trong code cứu được:
// khi tài khoản Workspace vượt quota tổng runtime/ngày (360 phút — xem các
// comment "quota 360 phút/ngày" rải rác trong code, đã được đội vận hành xác
// nhận là trần thật), Apps Script từ chối THỰC THI (không phải throw lỗi bên
// trong 1 hàm cụ thể) — nghĩa là doGet()/mọi trigger của CẢ NGÀY CÒN LẠI đều
// không chạy được, không có cách nào code tự bắt lỗi này vì code chưa kịp
// chạy đã bị chặn từ bên ngoài.
//
// KHÔNG THỂ "sửa" ngưỡng này bằng code (chỉ nâng cấp gói Workspace mới tăng
// được trần thật) — nhưng CÓ THỂ tự theo dõi (ước lượng) đã dùng bao nhiêu
// trong ngày, và chủ động NHƯỜNG QUOTA: các job NỀN không quan trọng (prewarm
// cache — phục vụ mục đích tối ưu tốc độ, không phải nghiệp vụ cốt lõi; mất 1
// lượt prewarm chỉ khiến cache nguội đi chút, không hỏng dữ liệu) tự bỏ qua
// lượt chạy khi ngân sách ngày đã cao, thay vì tiếp tục đốt vào phần quota ít
// ỏi còn lại mà lẽ ra cần dành cho user đang thao tác thật (lưu dữ liệu, tải
// trang) — đó mới là việc không thể trì hoãn.
//
// LƯU Ý QUAN TRỌNG: đây là ƯỚC LƯỢNG (self-tracking dựa trên đo elapsed time
// của chính các job có gọi _spxTrackExecMinutes_), KHÔNG PHẢI số liệu quota
// thật từ Google (Apps Script không có API nào để hỏi "còn lại bao nhiêu
// quota hôm nay"). Ước lượng này CHỈ tính được phần các job nền tự nguyện báo
// cáo — không tính được traffic người dùng thật (mỗi lần user bấm lưu/tải
// trang cũng tốn vào CÙNG ngân sách 360 phút này, nhưng không có cách nào
// hàm nền tự biết được). Vì vậy: đây là 1 lớp giảm rủi ro CÓ ÍCH nhưng KHÔNG
// PHẢI đảm bảo tuyệt đối — vẫn cần theo dõi Executions dashboard thật định kỳ.
var SPX_DAILY_BUDGET_KEY            = 'spx_daily_exec_budget_v1';
var SPX_DAILY_BUDGET_TOTAL_MINUTES  = 360; // trần thật của tài khoản — ĐỔI THEO GÓI WORKSPACE THẬT nếu khác
var SPX_DAILY_BUDGET_SAFE_MARGIN    = 60;  // luôn chừa ít nhất 60 phút cho traffic user + job quan trọng
var SPX_DAILY_BUDGET_SKIP_THRESHOLD = SPX_DAILY_BUDGET_TOTAL_MINUTES - SPX_DAILY_BUDGET_SAFE_MARGIN; // 300

function _spxReadDailyBudget_() {
  var today = _anaTodayKey();
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(SPX_DAILY_BUDGET_KEY);
    if (!raw) return { date: today, usedMinutes: 0 };
    var obj = JSON.parse(raw);
    if (!obj || obj.date !== today) return { date: today, usedMinutes: 0 }; // sang ngày mới (giờ VN) → tự reset
    return obj;
  } catch (e) { return { date: today, usedMinutes: 0 }; }
}

/**
 * Gọi ở CUỐI 1 job nền (đo elapsed time bằng Date.now() ở đầu job) để cộng dồn
 * vào ước lượng ngân sách hôm nay. Best-effort tuyệt đối — không bao giờ throw,
 * lỗi ghi property không được phép làm hỏng luồng chính của job đang chạy.
 */
function _spxTrackExecMinutes_(minutesUsed) {
  if (!minutesUsed || minutesUsed <= 0) return;
  try {
    var b = _spxReadDailyBudget_();
    b.usedMinutes += minutesUsed;
    PropertiesService.getScriptProperties().setProperty(SPX_DAILY_BUDGET_KEY, JSON.stringify(b));
  } catch (e) { /* best-effort — không chặn job chính */ }
}

// =========================================================================
// [MỚI — GỘP TRIGGER, theo yêu cầu trực tiếp "gộp trigger tương đồng, tránh
// chạm ngưỡng 20 trigger/script của GAS"] Đã tra cứu xác nhận: Google tính
// CHUNG 1 ngưỡng 20 cho MỌI loại trigger trong 1 script (time-based, onChange,
// onEdit...), không tách riêng theo loại. Trước đây có 5 trigger RIÊNG cùng
// chạy đúng mỗi 10 phút, và 4 trigger RIÊNG cùng chạy đúng mỗi 30 phút — gộp
// mỗi nhóm thành 1 trigger duy nhất, KHÔNG đổi hành vi bên trong (mỗi hàm con
// đã tự có khoá + cầu dao ngân sách riêng từ trước, gộp chỉ đổi "cái vỏ
// trigger gọi nó"). Có tiền lệ đã làm y hệt trong dự án này — xem
// spx_nightlyMaintenanceRunner (từng thay 2 trigger 6-tiếng cũ bằng 1).
// Gọi RÕ TÊN từng hàm (không dùng this[fnName]() tra cứu động — an toàn hơn
// trong sandbox GAS), mỗi hàm bọc try/catch RIÊNG để 1 hàm lỗi không chặn các
// hàm còn lại trong cùng đợt chạy.
// =========================================================================

/** spxDispatcher10Min() — gộp 5 trigger 10-phút riêng lẻ trước đây. */
// [MỚI — theo yêu cầu trực tiếp "cần đo chính xác từng hàm con trước khi
// quyết định"] GAS KHÔNG ghi log riêng cho từng hàm con bên trong 1
// dispatcher — Executions log chỉ thấy TỔNG thời gian của cả
// spxDispatcher10Min/30Min, không tách được hàm nào chiếm bao nhiêu. Đo trực
// tiếp bằng Date.now() quanh mỗi lệnh gọi, tích luỹ vào ScriptProperties
// (BỀN qua nhiều lần chạy — khác biến JS thường, mất ngay sau mỗi lần thực
// thi) — gọi spxGetDispatcherTimingReport() bất cứ lúc nào để xem báo cáo,
// không cần export lại Executions log và tự đối chiếu thủ công nữa.
// TẮT ĐI (false) sau khi đã đo đủ — mỗi lần ghi tốn thêm chút I/O, không nên
// bật vĩnh viễn một khi đã có đủ số liệu để quyết định.
var SPX_DISPATCH_TIMING_ENABLED = true;
var SPX_DISPATCH_TIMING_KEY = 'spx_dispatch_timing_v1';

// Cờ chặn job nền tự tạo file trạm mới — xem getStationSS() trong StationConfig.gs.
var _SPX_BG_NO_SHARD_CREATE = false;

/** Lỗi dịch vụ Google TẠM THỜI (đáng thử lại). Không gồm: tài liệu bị xoá/thiếu quyền, hết quota, lỗi logic. */
function _spxIsTransientErr_(msg) {
  var m = String(msg || '');
  if (/is missing|no longer exists|do not have permission|You do not have access|quota|Service invoked too many times|too many simultaneous/i.test(m)) return false;
  return /Service (Spreadsheets|Drive|Documents|Sheets) failed|Service timed out|Server error occurred|Internal error|Unexpected error while|Bad Gateway|Service Unavailable/i.test(m);
}

function _spxTimedCall_(dispatcherName, fnName, fn) {
  if (!SPX_DISPATCH_TIMING_ENABLED) {
    var _pnc0 = _SPX_BG_NO_SHARD_CREATE; _SPX_BG_NO_SHARD_CREATE = true;
    try { fn(); } catch (e) { try { Logger.log(dispatcherName + ' -> ' + fnName + ' lỗi: ' + e.message); } catch (e2) {} }
    finally { _SPX_BG_NO_SHARD_CREATE = _pnc0; }
    return;
  }
  var t0 = Date.now();
  var errMsg = null;
  // [SỬA KHẨN] Trong lúc chạy job nền: cấm getStationSS() tự tạo file mới.
  var _prevNoCreate = _SPX_BG_NO_SHARD_CREATE;
  _SPX_BG_NO_SHARD_CREATE = true;
  try {
    fn();
  } catch (e) {
    errMsg = e.message || String(e);
    // [MỚI 2026-10-24] Log Executions: aging_lmFullPicPrewarm lỗi 9/4.432 lượt, đều kiểu "Service Spreadsheets failed" (tạm
    // thời). Thử lại ĐÚNG 1 lần sau 3 giây nếu là lỗi dịch vụ tạm thời và job mới chạy < 60 giây; lỗi vĩnh viễn (tài liệu
    // bị xoá, thiếu quyền, hết quota) thì KHÔNG thử lại.
    if (_spxIsTransientErr_(errMsg) && (Date.now() - t0) < 60000) {
      try {
        Utilities.sleep(3000);
        fn();
        try { Logger.log(dispatcherName + ' -> ' + fnName + ' lỗi tạm thời, đã thử lại và chạy xong: ' + errMsg); } catch (eL) {}
        errMsg = null;
      } catch (e2) {
        errMsg = (e2.message || String(e2)) + ' (đã thử lại 1 lần)';
      }
    }
  } finally {
    _SPX_BG_NO_SHARD_CREATE = _prevNoCreate;
  }
  var elapsedS = (Date.now() - t0) / 1000;
  _spxTrackFnTiming_(fnName, elapsedS, !!errMsg);
  // [SỬA] Bọc try: dòng đếm ngân sách em thêm trước đây KHÔNG được bảo vệ —
  // nếu nó ném lỗi, dòng ghi nội dung lỗi bên dưới bị bỏ qua và các job sau
  // trong cùng lượt điều phối không chạy.
  if (fnName !== 'kpifail_prewarmCache') {
    try { _spxTrackExecMinutes_(elapsedS / 60); } catch (eBud) {}
  }
  if (errMsg) {
    try { Logger.log(dispatcherName + ' -> ' + fnName + ' lỗi: ' + errMsg); } catch (e2) {}
    // [MỚI — truy 33 lỗi ở 3 job nền] Trước đây nội dung lỗi CHỈ ghi vào nhật ký của
    // từng lượt chạy: báo cáo tổng chỉ đếm số lỗi, muốn biết lỗi gì phải mở Executions
    // rồi bấm từng lượt. Nay lưu lại 5 lỗi gần nhất của mỗi hàm để báo cáo in ra thẳng.
    try {
      var _pE  = PropertiesService.getScriptProperties();
      var _all = JSON.parse(_pE.getProperty('spx_fn_last_errors') || '{}');
      var _arr = _all[fnName] || [];
      _arr.unshift({
        luc: Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM HH:mm'),
        loi: String(errMsg).slice(0, 300)
      });
      _all[fnName] = _arr.slice(0, 5);
      _pE.setProperty('spx_fn_last_errors', JSON.stringify(_all));
    } catch (e3) {}
  }
}

function _spxTrackFnTiming_(fnName, elapsedS, hadError) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(SPX_DISPATCH_TIMING_KEY);
    var stats = raw ? JSON.parse(raw) : {};
    if (!stats[fnName]) stats[fnName] = { count: 0, totalS: 0, minS: null, maxS: 0, errCount: 0 };
    var s = stats[fnName];
    s.count++;
    s.totalS += elapsedS;
    s.minS = (s.minS === null) ? elapsedS : Math.min(s.minS, elapsedS);
    s.maxS = Math.max(s.maxS, elapsedS);
    if (hadError) s.errCount++;
    props.setProperty(SPX_DISPATCH_TIMING_KEY, JSON.stringify(stats));
  } catch (e) { /* best-effort — không chặn job chính vì lỗi ghi thống kê */ }
}

/**
 * spxGetDispatcherTimingReport() — CHẠY THỦ CÔNG (Apps Script Editor, chọn
 * hàm rồi bấm Run, xem kết quả trả về hoặc Logger). Xếp theo tổng thời gian
 * chiếm dụng giảm dần — hàm đứng đầu là thủ phạm lớn nhất cần xử lý trước.
 */
/**
 * spx_diagRunBackgroundJobs() — CHẠY THỦ CÔNG (chọn hàm rồi bấm Run).
 * [MỚI — truy 33 lỗi ở 3 job nền chạy chung bộ điều phối 30 phút]
 * Chạy NGAY từng job và bắt lỗi trực tiếp, thay vì đợi lượt trigger tiếp theo rồi
 * mở Executions bấm từng lượt. In ra thời gian chạy + câu lỗi đầy đủ của từng job.
 * Lưu ý: chạy thật nên có thể mất vài phút; nếu quá 6 phút sẽ bị Apps Script cắt.
 */
/**
 * spx_diagDataFreshness() — CHẠY THỦ CÔNG (chọn hàm rồi bấm Run).
 * [MỚI — theo câu hỏi "giảm ngân sách thì hiệu quả đo bằng gì?"]
 * Phút chạy nền KHÔNG phải thứ người dùng cảm nhận. Thứ họ cảm nhận là:
 *   (1) số trên màn hình CŨ bao nhiêu phút, (2) mở module chờ bao lâu.
 * Hàm này đo (1) cho từng module — số nền để so trước/sau mỗi lần tối ưu, thay vì
 * đánh giá bằng cảm tính hay bằng chỉ số không liên quan tới trải nghiệm.
 */
function spx_diagDataFreshness() {
  var out = { docLuc: Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM HH:mm:ss'), module: [] };
  function phut(ms) { return (ms && isFinite(ms)) ? Math.round((Date.now() - ms) / 60000) : null; }

  // Module Kiểm soát Giao hàng — bản chụp tồn đọng
  try {
    var mA = _kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))) || {};
    out.module.push({
      ten: 'Kiểm soát Giao hàng (tồn đọng)',
      duLieuCu_phut: phut(Number(mA.snapshot_version)),
      nguonLuc: String(mA.snapshot_source_version || '').split('|')[0] || '(chưa ghi)',
      nhipNguon: 'mỗi giờ, 7:00-18:00'
    });
  } catch (e) { out.module.push({ ten: 'Kiểm soát Giao hàng', loi: e.message }); }

  // Module KPI Fail — bản chụp bền
  try {
    var mK = _kpifail_getMetaMap_(_kpifail_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))) || {};
    var savedK = Date.parse(mK.snapshot_saved_at || '');
    out.module.push({
      ten: 'Theo dõi KPI (KPI Fail)',
      duLieuCu_phut: phut(savedK),
      soDongNguon: { FM: mK.lastrow_fm || '?', LM: mK.lastrow_lm || '?', SOP: mK.lastrow_sop || '?' },
      nhipNguon: 'vài lần/ngày'
    });
  } catch (e) { out.module.push({ ten: 'Theo dõi KPI', loi: e.message }); }

  // Đánh giá: ngưỡng chấp nhận = 2 lần nhịp cập nhật của nguồn.
  out.module.forEach(function (m) {
    if (m.duLieuCu_phut === null || m.duLieuCu_phut === undefined) { m.danhGia = 'không đọc được mốc'; return; }
    m.danhGia = (m.duLieuCu_phut <= 75) ? 'TỐT — trong 1 nhịp cập nhật'
              : (m.duLieuCu_phut <= 180) ? 'CHẤP NHẬN ĐƯỢC — trễ hơn 1 nhịp'
              : 'XẤU — dữ liệu cũ hơn 3 giờ, người dùng đang ra quyết định bằng số cũ';
  });
  out.huongDan = 'Chạy hàm này vài lần trong ngày (sáng/trưa/chiều) trước và sau mỗi thay đổi. ' +
                 'Nếu "duLieuCu_phut" tăng lên sau khi tối ưu ngân sách => tối ưu đó GÂY HẠI cho người dùng, phải hoàn lại.';
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

function spx_diagRunBackgroundJobs() {
  var jobs = [
    ['ana_archiveOldOrdersRunner', function () { return ana_archiveOldOrdersRunner(); }],
    ['stationStatus_crawlBatch',   function () { return stationStatus_crawlBatch(); }],
    ['trendNightlyPurgeRunner',    function () { return trendNightlyPurgeRunner(); }]
  ];
  var out = { chayLuc: Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd/MM HH:mm:ss'), ketQua: [] };
  for (var i = 0; i < jobs.length; i++) {
    var t0 = Date.now(), rec = { job: jobs[i][0] };
    try {
      var r = jobs[i][1]();
      rec.ketQua = 'CHẠY XONG';
      if (r !== undefined && r !== null) rec.traVe = String(typeof r === 'object' ? JSON.stringify(r) : r).slice(0, 200);
    } catch (e) {
      rec.ketQua = 'LỖI';
      rec.loi = String(e && e.message ? e.message : e).slice(0, 400);
      rec.viTri = String((e && e.stack) || '').split('\n').slice(0, 3).join(' | ').slice(0, 300);
    }
    rec.thoiGian_giay = Math.round((Date.now() - t0) / 100) / 10;
    out.ketQua.push(rec);
  }
  var loi = out.ketQua.filter(function (r) { return r.ketQua === 'LỖI'; });
  out.ketLuan = loi.length
    ? (loi.length + '/3 job lỗi. Xem trường "loi" và "viTri" của từng job để biết nguyên nhân.')
    : '3/3 job chạy xong ngay lúc này — lỗi có thể chỉ xảy ra vào khung giờ/điều kiện nhất định. Chạy spxGetDispatcherTimingReport() để xem nội dung lỗi đã lưu từ các lượt trigger thật.';
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

function spxGetDispatcherTimingReport() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(SPX_DISPATCH_TIMING_KEY);
  var stats = raw ? JSON.parse(raw) : {};
  var keys = Object.keys(stats);
  if (!keys.length) { var msg = 'Chưa có số liệu — đợi vài lượt trigger chạy rồi thử lại.'; Logger.log(msg); return msg; }
  var lines = ['=== Báo cáo thời gian từng hàm con (tích luỹ từ lúc bật đo, xếp theo tổng thời gian giảm dần) ==='];
  keys.sort(function (a, b) { return stats[b].totalS - stats[a].totalS; }).forEach(function (fn) {
    var s = stats[fn];
    var avg = s.totalS / s.count;
    lines.push(fn + ': ' + s.count + ' lần | TB ' + avg.toFixed(1) + 's | min ' + s.minS.toFixed(1) + 's | max ' + s.maxS.toFixed(1) + 's | tổng ' + (s.totalS / 60).toFixed(1) + ' phút' + (s.errCount ? ' | LỖI: ' + s.errCount + ' lần' : ''));
  });
  // [MỚI] In kèm NỘI DUNG LỖI gần nhất của từng hàm — trước đây báo cáo chỉ đếm
  // số lỗi, muốn biết lỗi gì phải mở Executions bấm từng lượt.
  try {
    var errAll = JSON.parse(props.getProperty('spx_fn_last_errors') || '{}');
    var errKeys = Object.keys(errAll);
    if (errKeys.length) {
      lines.push('');
      lines.push('=== Nội dung lỗi gần nhất (tối đa 5 lượt mỗi hàm) ===');
      errKeys.forEach(function (fn) {
        lines.push('· ' + fn + ':');
        (errAll[fn] || []).forEach(function (e) { lines.push('    [' + e.luc + '] ' + e.loi); });
      });
    } else {
      lines.push('');
      lines.push('(Chưa ghi nhận nội dung lỗi nào — nếu báo cáo có cột LỖI, đợi lượt lỗi tiếp theo sau khi deploy bản này.)');
    }
  } catch (eRep) {}
  var report = lines.join('\n');
  Logger.log(report);
  return report;
}

/** spxResetDispatcherTimingStats() — xoá số liệu cũ, bắt đầu đo lại từ đầu. */
function spxResetDispatcherTimingStats() {
  PropertiesService.getScriptProperties().deleteProperty(SPX_DISPATCH_TIMING_KEY);
  return 'Đã xoá thống kê cũ — bắt đầu đo lại từ đầu.';
}

var _SPX_DISPATCH_T0 = 0; // mốc bắt đầu lượt gộp — để job dài biết còn bao nhiêu thời gian của 6 phút
function spxDispatcher10Min() {
  _SPX_DISPATCH_T0 = Date.now();
  try {
    // [SỬA] aging_prewarmCache LÊN ĐẦU. Trước đây nó đứng thứ 4 sau 3 job khác trong CÙNG 1 lần
    // thực thi 6 phút: khi các job trước ăn nhiều thời gian, nó bị cắt giữa chu kỳ dựng — chính
    // là cơ chế sinh ra chu kỳ dang dở kéo qua nhiều lượt. Phần lớn lượt nó chỉ kiểm tra rồi nghỉ
    // (~10 giây), nên đặt đầu không làm các job còn lại bị đói.
    _spxTimedCall_('spxDispatcher10Min', 'aging_prewarmCache', aging_prewarmCache);
    _spxTimedCall_('spxDispatcher10Min', 'aging_lmFullPicPrewarm', aging_lmFullPicPrewarm);
    _spxTimedCall_('spxDispatcher10Min', 'spx_usageStats_flushBuffer', spx_usageStats_flushBuffer);
    _spxTimedCall_('spxDispatcher10Min', 'kpifail_prewarmCache', kpifail_prewarmCache);
    _spxTimedCall_('spxDispatcher10Min', 'fms_live_prewarmCache', fms_live_prewarmCache);
  } finally { _SPX_DISPATCH_T0 = 0; }
}

/**
 * spxInstallDispatcher10Min() — CHẠY THỦ CÔNG 1 LẦN (Apps Script Editor, chọn
 * hàm rồi bấm Run): xoá 5 trigger 10-phút RIÊNG cũ (nếu còn tồn tại) + cài 1
 * trigger DUY NHẤT gọi spxDispatcher10Min() mỗi 10 phút. Idempotent — chạy
 * lại nhiều lần vẫn an toàn (luôn dọn sạch trước khi tạo mới).
 * [QUAN TRỌNG] Sau khi chạy hàm này, KHÔNG chạy lại các installer cũ riêng lẻ
 * (aging_installLmFullPicTrigger, setupAgingPrewarmTrigger, v.v.) — sẽ tạo
 * lại đúng những trigger vừa gộp, làm mất tác dụng gộp.
 */
function spxInstallDispatcher10Min() {
  var oldHandlers = ['aging_lmFullPicPrewarm', 'spx_usageStats_flushBuffer', 'kpifail_prewarmCache', 'aging_prewarmCache', 'fms_live_prewarmCache', 'spxDispatcher10Min'];
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (oldHandlers.indexOf(t.getHandlerFunction()) !== -1) { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger('spxDispatcher10Min').timeBased().everyMinutes(10).create();
  return 'Đã xoá ' + removed + ' trigger cũ (tối đa 5 trigger 10-phút riêng lẻ, nếu có) và cài 1 trigger gộp "spxDispatcher10Min" (mỗi 10 phút).';
}

/** spxDispatcher30Min() — gộp 4 trigger 30-phút riêng lẻ trước đây. */
function spxDispatcher30Min() {
  _spxTimedCall_('spxDispatcher30Min', 'pick_live_prewarmCache', pick_live_prewarmCache);
  _spxTimedCall_('spxDispatcher30Min', 'ana_archiveOldOrdersRunner', ana_archiveOldOrdersRunner);
  _spxTimedCall_('spxDispatcher30Min', 'stationStatus_crawlBatch', stationStatus_crawlBatch);
  _spxTimedCall_('spxDispatcher30Min', 'trendNightlyPurgeRunner', trendNightlyPurgeRunner);
  // [MỚI 2026-10] Fail KPI Order: chỉ đọc "vân tay" 4 nguồn Ontime/SOP/Success; dựng lại khi nguồn đổi (xem FlmKpi_Backend.gs)
  _spxTimedCall_('spxDispatcher30Min', 'flm_kpi_refreshIfDue_', function () { return flm_kpi_refreshIfDue_(false); });
  // [MỚI — Hướng B] Gộp dghPurgeOldMonthsRunner (trước đây chạy trigger riêng 30 phút, chỉ thực chạy trong khung 23h-5h)
  _spxTimedCall_('spxDispatcher30Min', 'dghPurgeOldMonthsRunner', dghPurgeOldMonthsRunner);
}

/**
 * spxInstallDispatcher30Min() — tương tự spxInstallDispatcher10Min(), cho
 * nhóm 30 phút. Idempotent, chạy thủ công 1 lần từ Apps Script Editor.
 */
function spxInstallDispatcher30Min() {
  var oldHandlers = ['pick_live_prewarmCache', 'ana_archiveOldOrdersRunner', 'stationStatus_crawlBatch', 'trendNightlyPurgeRunner', 'dghPurgeOldMonthsRunner', 'spxDispatcher30Min'];
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (oldHandlers.indexOf(t.getHandlerFunction()) !== -1) { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger('spxDispatcher30Min').timeBased().everyMinutes(30).create();
  return 'Đã xoá ' + removed + ' trigger cũ (tối đa 5 trigger 30-phút riêng lẻ, nếu có) và cài 1 trigger gộp "spxDispatcher30Min" (mỗi 30 phút).';
}

/**
 * Gọi ở ĐẦU 1 job nền KHÔNG QUAN TRỌNG (prewarm cache, dọn dẹp định kỳ) — trả
 * về true nếu ngân sách ước lượng hôm nay đã vượt ngưỡng an toàn, job nên tự
 * bỏ qua lượt này (return sớm) để nhường quota cho traffic user thật. TUYỆT
 * ĐỐI KHÔNG dùng hàm này để chặn các luồng nghiệp vụ CỐT LÕI (saveStationData,
 * getStationData...) — những luồng đó phải luôn được thử, kể cả khi ngân sách
 * đã cao, vì bỏ qua chúng gây hại nhiều hơn để chúng tự thử và có thể thất bại.
 */
function _spxShouldSkipForBudget_() {
  try {
    return _spxReadDailyBudget_().usedMinutes >= SPX_DAILY_BUDGET_SKIP_THRESHOLD;
  } catch (e) { return false; } // lỗi đọc → mặc định KHÔNG skip (an toàn theo hướng "cứ chạy" hơn "im lặng bỏ qua mãi")
}

// =========================================================================
// [FIX 2026-08-13] "DANH SÁCH NÓNG" — phát hiện + XỬ LÝ NGAY trạm đang chậm bất
// thường, không dừng ở mức cảnh báo suông. Cảnh báo mà không ai/không có gì xử
// lý kịp trong lúc đang chậm thì bản chất đã là nghẽn — nên khi saveStationData()
// tự đo thấy 1 lượt lưu vượt ngưỡng, TỰ ĐỘNG đưa trạm đó vào hàng ưu tiên archive
// ở lượt job nền KẾ TIẾP (không đợi tới lượt xoay vòng bình thường — có thể vài
// đêm sau mới tới nếu trạm đó ở cuối danh sách 1.000 trạm).
//
// Vì sao 8 giây: mô phỏng tải đồng thời cho thấy hệ thống chỉ thật sự bắt đầu có
// user gặp lỗi "đang bận" khi 1 lượt lưu vượt ~16-18 giây — chọn 8s (nửa ngưỡng
// nguy hiểm) để có đủ thời gian phản ứng TRƯỚC KHI chạm ngưỡng thật, không phải
// lúc đã cận kề.
//
// Dùng ĐÚNG pattern gộp-1-property-tự-giới-hạn đã kiểm chứng ở ana_clear_epoch_
// (bài học: mỗi trạm 1 property riêng sẽ có ngày chạm trần 500/script) — danh
// sách nóng gộp vào 1 property JSON duy nhất, tự giới hạn tối đa
// SPX_HOT_STATIONS_MAX entry (trạm nóng nhất được giữ nếu vượt trần).
// =========================================================================
var SPX_HOT_STATIONS_KEY       = 'spx_hot_stations_v1';
var SPX_HOT_STATION_THRESHOLD_MS = 8000;  // lượt lưu >= 8s -> đánh dấu nóng
var SPX_HOT_STATIONS_MAX       = 50;      // trần an toàn — 50 trạm cùng "nóng" 1 lúc là kịch bản đã rất bất thường

function _spxReadHotStations_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(SPX_HOT_STATIONS_KEY);
    if (!raw) return {};
    var m = JSON.parse(raw);
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  } catch (e) { return {}; }
}

/** Gọi ở finally của saveStationData() — best-effort tuyệt đối, không bao giờ throw. */
function _spxFlagHotStationIfSlow_(stationName, elapsedMs) {
  if (!elapsedMs || elapsedMs < SPX_HOT_STATION_THRESHOLD_MS) return;
  var stationKey = _anaSafeStationKey(stationName);
  var gotLock = false;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(3000);
    gotLock = true;
    var map = _spxReadHotStations_();
    map[stationKey] = { ts: Date.now(), elapsedMs: elapsedMs, name: stationName };
    var keys = Object.keys(map);
    if (keys.length > SPX_HOT_STATIONS_MAX) {
      // Vượt trần hiếm gặp — giữ lại các trạm NÓNG NHẤT (elapsedMs cao nhất), bỏ bớt trạm đỡ nóng hơn
      keys.sort(function(a, b) { return (map[b].elapsedMs || 0) - (map[a].elapsedMs || 0); });
      var capped = {};
      keys.slice(0, SPX_HOT_STATIONS_MAX).forEach(function(k) { capped[k] = map[k]; });
      map = capped;
    }
    PropertiesService.getScriptProperties().setProperty(SPX_HOT_STATIONS_KEY, JSON.stringify(map));
    _LOG.d('[Hot Station] ⚠️ Trạm "' + stationName + '" lưu mất ' + (elapsedMs/1000).toFixed(1) +
      's (ngưỡng ' + (SPX_HOT_STATION_THRESHOLD_MS/1000) + 's) — đã đưa vào hàng ưu tiên archive lượt kế tiếp.');
  } catch (e) { /* best-effort — không chặn kết quả trả về cho user */ }
  finally { if (gotLock) { try { lock.releaseLock(); } catch (e2) {} } }
}

/** Trả về danh sách tên trạm đang nóng, NÓNG NHẤT TRƯỚC — dùng để ưu tiên archive. */
function _spxGetPriorityStations_() {
  var map = _spxReadHotStations_();
  return Object.keys(map)
    .sort(function(a, b) { return (map[b].elapsedMs || 0) - (map[a].elapsedMs || 0); })
    .map(function(k) { return map[k].name || k; });
}

/** Gọi sau khi đã xử lý xong 1 trạm trong hàng ưu tiên — best-effort, không throw. */
function _spxClearHotStation_(stationName) {
  var stationKey = _anaSafeStationKey(stationName);
  var gotLock = false;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(3000);
    gotLock = true;
    var map = _spxReadHotStations_();
    if (map[stationKey]) {
      delete map[stationKey];
      PropertiesService.getScriptProperties().setProperty(SPX_HOT_STATIONS_KEY, JSON.stringify(map));
    }
  } catch (e) { /* best-effort */ }
  finally { if (gotLock) { try { lock.releaseLock(); } catch (e2) {} } }
}

// =========================================================================
// [FIX 2026-08-14] "CẦU DAO" QUOTA UrlFetch/NGÀY — cùng triết lý cầu dao runtime
// (_spxShouldSkipForBudget_) nhưng cho quota RIÊNG của UrlFetchApp (mọi lệnh gọi
// Firestore đều đi qua đây). Xác nhận qua tài liệu chính thức Google: tài khoản
// Workspace = 100.000 lượt UrlFetch/ngày (deploy "Execute as: Me" → TOÀN BỘ app
// dùng chung 1 hạn ngạch, bất kể có bao nhiêu user thật — 2.000 user vẫn cùng ăn
// vào đúng 100.000 này, không nhân theo số user như 1 số quota khác).
//
// KHÁC VỚI cầu dao runtime: quota UrlFetch hết KHÔNG làm sập cả hệ thống — mọi
// lệnh gọi Firestore đã có fallback về Sheet cache từ trước (xem
// _anaReadInboundState/_anaSaveInboundState), nên đây là lớp "tiết kiệm chủ
// động" (tránh cố gọi Firestore biết trước nhiều khả năng sẽ hết hạn ngạch giữa
// chừng, chủ động chuyển sang Sheet ngay từ đầu thay vì để thất bại rồi mới
// fallback) — không phải lớp chống sập.
//
// KHÔNG khoá (LockService) khi đếm — đây là bộ đếm TẦN SUẤT CAO (mỗi lượt lưu
// Firestore của MỌI user đều chạm), thêm khoá đồng bộ vào đúng đường lưu dữ liệu
// nóng nhất hệ thống lợi bất cập hại (thêm độ trễ cho user thật để đổi lấy đếm
// chính xác tuyệt đối cho 1 con số chỉ mang tính TỰ THEO DÕI/CẢNH BÁO SỚM). Chấp
// nhận đếm thiếu nhẹ khi nhiều request đụng độ ghi cùng lúc — không ảnh hưởng
// mục đích cảnh báo sớm.
// =========================================================================
var SPX_URLFETCH_BUDGET_KEY       = 'spx_urlfetch_budget_v1';
var SPX_URLFETCH_DAILY_LIMIT      = 100000; // Workspace — xác nhận qua tài liệu chính thức Google, tháng 8/2026
var SPX_URLFETCH_SAFE_MARGIN      = 20000;  // luôn chừa 20.000 lượt cho các lệnh Firestore quan trọng nhất (save Inbound của user thật)
var SPX_URLFETCH_SKIP_THRESHOLD   = SPX_URLFETCH_DAILY_LIMIT - SPX_URLFETCH_SAFE_MARGIN; // 80.000

/** Gọi ngay TRƯỚC mỗi UrlFetchApp.fetch(...) thật trong Firestore bridge.gs. Best-effort, không throw, không khoá. */
function _spxTrackUrlFetch_() {
  try {
    var today = _anaTodayKey();
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty(SPX_URLFETCH_BUDGET_KEY);
    var obj = raw ? JSON.parse(raw) : null;
    if (!obj || obj.date !== today) obj = { date: today, calls: 0 };
    obj.calls++;
    props.setProperty(SPX_URLFETCH_BUDGET_KEY, JSON.stringify(obj));
  } catch (e) { /* best-effort tuyệt đối — không được phép làm hỏng lệnh Firestore thật đang chuẩn bị gọi */ }
}

/**
 * Dùng ở các điểm CÓ FALLBACK AN TOÀN sẵn (đọc/ghi Inbound qua Firestore đã có
 * đường lùi về Sheet) để CHỦ ĐỘNG bỏ qua Firestore, dùng luôn Sheet — tiết kiệm
 * hạn ngạch cho phần còn lại trong ngày. TUYỆT ĐỐI KHÔNG dùng ở nơi KHÔNG có
 * fallback an toàn.
 */
function _spxShouldSkipUrlFetchForBudget_() {
  try {
    var today = _anaTodayKey();
    var raw = PropertiesService.getScriptProperties().getProperty(SPX_URLFETCH_BUDGET_KEY);
    if (!raw) return false;
    var obj = JSON.parse(raw);
    if (obj.date !== today) return false;
    return obj.calls >= SPX_URLFETCH_SKIP_THRESHOLD;
  } catch (e) { return false; } // lỗi đọc → mặc định KHÔNG skip (ưu tiên thử Firestore hơn im lặng bỏ qua)
}

// =========================================================================
// [FIX 2026-07-B] CHỐT INBOUND TẬP TRUNG TẠI SERVER — 1 LẦN DUY NHẤT KHI LƯU
// -------------------------------------------------------------------------
// TRƯỚC ĐÂY: mỗi user MỞ dashboard tự tính lại (logic _isInboundNew phía
// client) dựa trên TRẠNG THÁI SỐNG của đơn tại THỜI ĐIỂM XEM, rồi tự đẩy
// idDates lên cloud (saveInboundLockToCloud). Hệ quả 2 lỗi anh gặp:
//   1) ĐA USER: mỗi user mở dashboard vào thời điểm khác nhau → tính ra kết
//      quả khác nhau (vì dữ liệu/trạng thái đã đổi giữa các lần), rồi CÙNG
//      ghi vào 1 sổ chung theo kiểu "ai tính sau/ai mở sau" → không có 1
//      nguồn duy nhất, số hiển thị phụ thuộc ngẫu nhiên vào user nào vừa mở.
//   2) SỐ ẢO KHI CHỈ ĐỔI TRẠNG THÁI: 1 đơn CŨ đã có sẵn, lúc cập nhật đầu
//      ngày bị xét là OLD (không tính) — nhưng vì nó CHƯA từng được ghi vào
//      sổ (idDates chỉ lưu đơn ĐƯỢC TÍNH, không nhớ đơn đã xét mà bị loại),
//      nên khi trạng thái đơn đó đổi sau này (VD onHoldTime bị ghi lại) và
//      có user mở dashboard tính lại → đơn này có thể bị tính NHẦM thành NEW
//      → số Inbound tăng dù không hề có đơn mới thật, chỉ đổi trạng thái.
//
// SỬA: việc XÉT + CHỐT giờ chạy DUY NHẤT 1 LẦN Ở SERVER, ngay tại thời điểm
// saveStationData()/saveSupplementData() ghi dữ liệu thật — KHÔNG còn phụ
// thuộc user nào/lúc nào mở dashboard. Sổ luỹ kế mở rộng thêm "seenIds":
// nhớ CẢ những đơn ĐÃ TỪNG ĐƯỢC XÉT dù kết quả là OLD (không tính) — để
// những đơn đó KHÔNG BAO GIỜ bị xét lại lần nữa, dù trạng thái sau này đổi
// thế nào. Dashboard phía client giờ CHỈ ĐỌC số đã chốt, không tự tính/đẩy
// lên cloud nữa (xem ana_renderKPI() trong Analytics_Block.html).
// =========================================================================

function _anaIsOnHoldEmpty_(onHoldTime) {
  var s = (onHoldTime || '').toString().trim().toLowerCase();
  return s === '' || s === 'nan' || s === '/' || s === 'none' || s === 'null';
}

function _anaIsTodayVN_(dateStr, todayKey) {
  if (!dateStr || dateStr.toString().trim() === '') return false;
  var s = dateStr.toString().trim();
  if (s.indexOf('-') === -1 && s.indexOf('/') > -1) {
    var parts = s.split(/[\s,]+/)[0].split('/');
    if (parts.length === 3) {
      var m = ('0' + parts[0]).slice(-2);
      var d = ('0' + parts[1]).slice(-2);
      var y = parts[2];
      s = y + '-' + m + '-' + d;
    }
  }
  return s.indexOf(todayKey) !== -1;
}

function _anaExtractDateVN_(dateStr) {
  if (!dateStr || dateStr.toString().trim() === '') return null;
  var s = dateStr.toString().trim();
  var sLow = s.toLowerCase();
  if (sLow === 'nan' || sLow === '/' || sLow === 'none' || sLow === 'null') return null;
  if (s.indexOf('-') === -1 && s.indexOf('/') > -1) {
    var parts = s.split(/[\s,]+/)[0].split('/');
    if (parts.length === 3) {
      var m = ('0' + parts[0]).slice(-2);
      var d = ('0' + parts[1]).slice(-2);
      var y = parts[2];
      if (y.length === 4) return y + '-' + m + '-' + d;
    }
    return null;
  }
  var m2 = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m2 ? m2[1] : null;
}

/** Ngày quy thuộc thực tế của 1 đơn — PORT Y HỆT logic client _inboundDateOf() */
function _anaInboundDateOf_(r, todayKey) {
  var d = _anaExtractDateVN_((r.deliveringTime || '').toString().trim());
  if (d) return d;
  d = _anaExtractDateVN_((r.onHoldTime || '').toString().trim());
  if (d) return d;
  d = _anaExtractDateVN_((r.stationRecvTime || r.receivedTime || '').toString().trim());
  if (d) return d;
  return todayKey;
}

/** PORT Y HỆT logic client _isInboundNew() — true=NEW, false=OLD, null=bỏ qua (khác trạm) */
function _anaClassifyInboundOrder_(r, isPrimary, currentStationNorm, todayKey) {
  // [FIX 2026-07-17] TRƯỚC ĐÂY dùng .trim().toLowerCase() thô — KHÔNG bỏ dấu
  // tiếng Việt, KHÔNG bỏ gạch ngang/khoảng trắng, KHÔNG cắt hậu tố "Hub" như
  // _normStationKey_() (hàm đang dùng để tạo stationKey ghi Firestore). Hệ quả:
  // hễ currentStation/destinationStation trong dữ liệu đơn không khớp Y HỆT
  // từng ký tự với stationName truyền vào (vd "45DLK Krong Nang" vs "45-DLK
  // Krông Năng Hub") thì MỌI đơn của trạm đó bị coi là "khác trạm" → không
  // đơn nào được xét → _anaComputeAndLockInboundServer_ trả về existing mà
  // KHÔNG ghi Firestore → field "date" đứng yên ở lần ghi thành công gần nhất
  // (nhìn như "vẫn là ngày hôm qua") và Inbound hôm nay luôn = 0 cho các trạm
  // bị lệch định dạng tên. SỬA: dùng CHUNG _normStationKey_() với 2 phía so
  // sánh, để nhất quán với _anaSafeStationKey() (dùng để tạo Firestore docId).
  var curStat  = _normStationKey_((r.currentStation     || '').toString());
  var destStat = _normStationKey_((r.destinationStation || '').toString());

  if (isPrimary) {
    if (curStat !== currentStationNorm) return null;
    var recvTime   = (r.stationRecvTime || r.receivedTime || '').toString().trim();
    var onHoldTime = (r.onHoldTime || '').toString().trim();
    var onHoldEmpty = _anaIsOnHoldEmpty_(onHoldTime);
    var totalHoldTimes = parseInt(r.totalOnHold || r['Total of On Hold Times'] || 0, 10) || 0;

    if (totalHoldTimes >= 2) return false;
    if (_anaIsTodayVN_(recvTime, todayKey)) return true;
    if (recvTime && recvTime.slice(0, 10) < todayKey) {
      if (onHoldEmpty) return true;
      if (_anaIsTodayVN_(onHoldTime, todayKey)) return true;
      return false;
    }
    return onHoldEmpty;
  } else {
    if (curStat !== currentStationNorm || destStat !== currentStationNorm) return null;
    var reason = (r.onholdReason || '').toString().trim().toLowerCase();
    return reason === 'normal';
  }
}

// [FIX 2026-08-13] CỬA SỔ ÂN HẠN chống loại nhầm đơn MỚI THẬT bị đếm thiếu vĩnh viễn.
// -------------------------------------------------------------------------------
// BỐI CẢNH: seenIds (ở trên) khoá VĨNH VIỄN kết quả xét đầu tiên của 1 ID — kể cả khi
// kết quả đó là "false" (OLD, không tính). Cơ chế này đúng cho phần lớn trường hợp,
// NHƯNG có rủi ro: nếu lần xét ĐẦU TIÊN của 1 đơn diễn ra khi dữ liệu đơn đó CHƯA đầy
// đủ/chưa chốt (VD file CSV upload sớm trong ngày, trước khi hệ thống nguồn ghi xong
// stationRecvTime/onHoldTime, hoặc field "Total of On Hold Times" đang phản ánh hành
// trình TRƯỚC KHI đơn thực sự về trạm này — dễ gặp ở trạm xử lý đơn CHUYỂN TIẾP), đơn
// đó bị gắn "false" NGAY LẦN ĐẦU và kẹt sai vĩnh viễn — không CSV đầy đủ nào tải lên
// sau đó cứu được, vì ID đã nằm trong seenIds. Triệu chứng thực tế: số Inbound đúng
// vào lúc mới upload đầu ngày nhưng "tụt" so với thực tế khi so với dữ liệu đầy đủ hơn
// giữa/cuối ngày — và chỉ xoá sạch Firestore + xử lý lại từ đầu mới ra đúng số.
//
// GIẢI PHÁP: đơn bị xét "false" lần đầu KHÔNG khoá ngay vào seenIds — chuyển vào sổ
// "chờ xác nhận" (pendingFalseIds) và được XÉT LẠI ở lần lưu kế tiếp có mặt đơn đó
// trong dữ liệu upload. Chỉ khi bị xét "false" LẦN THỨ 2 (2 lần liên tiếp cùng kết
// quả) mới khoá vĩnh viễn vào seenIds như cũ. Nếu lần xét lại ra "true" (dữ liệu đã
// đầy đủ hơn, đúng là đơn mới hôm nay) → tính vào Inbound ngay, khoá luôn (không cần
// chờ thêm — chỉ "false" mới cần xác nhận 2 lần, "true" tin ngay vì không có rủi ro
// đếm thiếu khi tin "true" sớm, chỉ có rủi ro đếm thiếu khi tin "false" quá sớm).
// LƯU Ý: cách này KHÔNG sửa được trường hợp field quyết định (VD totalHoldTimes>=2)
// vẫn giữ nguyên giá trị ổn định qua 2 lần xét — khi đó lần 2 vẫn ra "false" và đơn
// vẫn bị khoá OLD như thiết kế gốc (đây có thể là đúng ý nghiệp vụ với đơn thực sự đã
// onhold ≥2 lần, cần xác nhận lại nếu vẫn còn nghi ngờ diện rộng).
function _anaClassifyWithGraceWindow_(id, res, r, todayKey, pendingSet, newIdDates, newlySeenIds, newPendingFalseIds, resolvedPendingIds) {
  if (res === true) {
    newIdDates[id] = _anaInboundDateOf_(r, todayKey);
    newlySeenIds.push(id);
    if (pendingSet[id]) resolvedPendingIds.push(id); // từng "false" 1 lần, nay xác nhận "true" → xoá khỏi sổ chờ
    return;
  }
  // res === false
  if (pendingSet[id]) {
    // Đã "false" lần trước rồi — lần này VẪN "false" → xác nhận đủ 2 lần, khoá vĩnh viễn.
    newlySeenIds.push(id);
    resolvedPendingIds.push(id);
  } else {
    // "false" lần ĐẦU TIÊN — chưa khoá, đưa vào sổ chờ để xét lại lần sau.
    newPendingFalseIds.push(id);
  }
}

/**
 * Tính + CHỐT sổ Inbound MỘT LẦN DUY NHẤT tại thời điểm lưu dữ liệu thật.
 * - Đơn đã có trong "seenIds" (đã từng được xét, KỂ CẢ bị loại OLD) sẽ KHÔNG
 *   bao giờ được xét lại nữa, bất kể trạng thái sau này đổi ra sao.
 * - Chỉ đơn CHƯA TỪNG xuất hiện mới được đưa vào xét → Inbound chỉ tăng khi
 *   có ĐƠN THẬT SỰ MỚI trong lần lưu dữ liệu này, không tăng vì đổi trạng
 *   thái của đơn cũ, và không phụ thuộc user nào gọi.
 * PHẢI được gọi bên trong cùng named-lock của trạm (đã acquire ở nơi gọi).
 */
function _anaComputeAndLockInboundServer_(ss, stationName, primaryOrders, supplementOrders) {
  var todayKey = _anaTodayKey();
  // [FIX 2026-07-17] Đổi sang _normStationKey_() — xem giải thích đầy đủ trong
  // comment của _anaClassifyInboundOrder_() phía trên.
  var currentStationNorm = _normStationKey_(stationName || '');

  var existing = _anaReadInboundState(ss, stationName);
  var seenSet = {};
  (existing.seenIds || []).forEach(function(id) { seenSet[id] = true; });
  Object.keys(existing.idDates || {}).forEach(function(id) { seenSet[id] = true; });

  // [FIX 2026-08-13] pendingSet — các ID mới bị xét "false" ĐÚNG 1 LẦN, chưa khoá vĩnh
  // viễn, cần xét lại lần này (xem _anaClassifyWithGraceWindow_ phía trên). QUAN TRỌNG:
  // các ID này KHÔNG được đưa vào seenSet ở trên — để vòng lặp bên dưới không bỏ qua
  // (skip) chúng như với ID đã khoá vĩnh viễn.
  var pendingSet = {};
  (existing.pendingFalseIds || []).forEach(function(id) { pendingSet[id] = true; });

  var primarySnap = {};
  (primaryOrders || []).forEach(function(o) { if (o && o.orderId) primarySnap[o.orderId] = true; });

  var newIdDates          = {};  // đơn MỚI thoả điều kiện — union vào idDates (đếm Inbound)
  var newlySeenIds        = [];  // ID vừa được KHOÁ VĨNH VIỄN lần này (NEW, hoặc OLD xác nhận đủ 2 lần)
  var newPendingFalseIds  = [];  // ID vừa bị xét "false" LẦN ĐẦU — chờ xét lại lần sau
  var resolvedPendingIds  = [];  // ID từng ở sổ chờ, nay đã được xác nhận xong (true hoặc false lần 2) → xoá khỏi sổ chờ
  var _processedThisRound = {};  // [FIX 2026-08-13] chống xử lý trùng nếu 1 ID xuất hiện ≥2 dòng trong CÙNG 1 lần upload (VD CSV có dòng trùng)

  (primaryOrders || []).forEach(function(r) {
    if (!r || !r.orderId || seenSet[r.orderId] || _processedThisRound[r.orderId]) return;
    var res = _anaClassifyInboundOrder_(r, true, currentStationNorm, todayKey);
    if (res === null) return; // khác trạm — chưa xét, để lần lưu sau (khi đơn thực sự về trạm này)
    _processedThisRound[r.orderId] = true;
    _anaClassifyWithGraceWindow_(r.orderId, res, r, todayKey, pendingSet, newIdDates, newlySeenIds, newPendingFalseIds, resolvedPendingIds);
  });

  (supplementOrders || []).forEach(function(r) {
    if (!r || !r.orderId || seenSet[r.orderId] || primarySnap[r.orderId] || _processedThisRound[r.orderId]) return;
    var res = _anaClassifyInboundOrder_(r, false, currentStationNorm, todayKey);
    if (res === null) return;
    _processedThisRound[r.orderId] = true;
    _anaClassifyWithGraceWindow_(r.orderId, res, r, todayKey, pendingSet, newIdDates, newlySeenIds, newPendingFalseIds, resolvedPendingIds);
  });

  if (Object.keys(newIdDates).length === 0 && newlySeenIds.length === 0 && newPendingFalseIds.length === 0 && resolvedPendingIds.length === 0) {
    return existing; // không có đơn nào mới để xét (kể cả sổ chờ không đổi) — giữ nguyên sổ hiện tại
  }

  return _anaSaveInboundState(ss, stationName, {
    idDates: newIdDates,
    seenIds: newlySeenIds,
    newPendingFalseIds: newPendingFalseIds,
    resolvedPendingIds: resolvedPendingIds
  });
}


function _anaVNNow() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ss'+07:00'");
}

function _anaInboundSheet(ss) {
  var HEADERS = [
    "Station Key", "Station Name", "Date (last updated)", "Inbound Lock (hôm nay)",
    "All Order IDs JSON (legacy, ≤3000 gần nhất)", "ID→Date Map JSON (nguồn sự thật)", "Updated At", "Cloud TS", "Total Drivers",
    "Seen IDs JSON (đã xét kể cả OLD — chống đếm lại khi chỉ đổi trạng thái)",
    "Pending False IDs JSON (chờ xét lại lần 2 trước khi khoá OLD vĩnh viễn)"
  ];
  var sheet = ss.getSheetByName("Inbound_Lock");
  if (!sheet) {
    sheet = ss.insertSheet("Inbound_Lock");
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#0d9488").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    // Trim cột thừa: mặc định 26 cột (1000x26=26.000 cells) -> chỉ giữ đúng số cột cần,
    // tiết kiệm ~73% ngân sách cell/sheet, quan trọng khi nhân với hàng trăm trạm.
    if (sheet.getMaxColumns() > HEADERS.length) {
      sheet.deleteColumns(HEADERS.length + 1, sheet.getMaxColumns() - HEADERS.length);
    }
  } else {
    var lastCol = sheet.getLastColumn();
    // MIGRATION UP: thêm cột còn thiếu
    if (lastCol < HEADERS.length) {
      for (var c = lastCol; c < HEADERS.length; c++) {
        sheet.getRange(1, c + 1).setValue(HEADERS[c])
          .setFontWeight("bold").setBackground("#0d9488").setFontColor("#ffffff");
      }
    }
    // MIGRATION DOWN: xóa cột "Suppl IDs JSON" (col 9) nếu còn từ phiên bản cũ
    if (sheet.getLastColumn() >= 9) {
      var col9 = sheet.getRange(1, 9).getValue();
      if (String(col9).indexOf('Suppl') !== -1) {
        sheet.deleteColumn(9);
      }
    }
  }
  return sheet;
}

function _anaFindInboundRow(sheet, stationKey) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  // MS-06: Đọc toàn bộ cột A 1 lần thay vì từng cell → giảm API calls
  var rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var keyNorm = stationKey.trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === keyNorm) {
      return i + 2;
    }
  }
  return 0;
}

function _anaDeleteDuplicateInboundRows(sheet, stationKey, keepRow) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var deleteRows = [];
  // B4-FIX: normalize toLowerCase() để khớp với _anaFindInboundRow (vốn cũng normalize)
  // Trước đây dùng === exact match → không xóa được duplicate nếu case khác nhau
  var stationKeyNorm = stationKey.trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    var rowNum = i + 2;
    if (rowNum !== keepRow && String(rows[i][0]).trim().toLowerCase() === stationKeyNorm) {
      deleteRows.push(rowNum);
    }
  }
  deleteRows.sort(function(a, b) { return b - a; }).forEach(function(rowNum) {
    sheet.deleteRow(rowNum);
  });
}

// =========================================================================
// [2026-07 REDESIGN] Inbound giờ là SỔ LUỸ KẾ TOÀN THỜI GIAN theo trạm:
//   idDates = { orderId: "yyyy-MM-dd" }  — "ngày nhận thực tế" của từng ID,
//   được chốt ĐÚNG 1 LẦN khi ID lần đầu xuất hiện, KHÔNG BAO GIỜ bị ghi đè
//   hay reset theo ngày calendar nữa (khắc phục lỗi đếm lại đơn tồn qua
//   nhiều ngày + lỗi lệch ngày D-1/D do đồng hồ máy chạy script).
//   inboundLock trả về = SỐ ID có date === hôm nay (tính động mỗi lần đọc),
//   dùng để hiển thị KPI "Inbound hôm nay" — không phải allIds.length toàn bộ.
// =========================================================================
// =========================================================================
// [2026-07 FIRESTORE LIVE] Nguồn sự thật giờ ưu tiên Firestore (collection
// inbound_live, field idDatesJson ~1 MiB) thay cho Sheet cell (trần cứng
// 45.000 ký tự). Gốc rễ bug "số Inbound thấp hơn thực tế + F5 vẫn sai" đã xác
// định qua điều tra 45-DLK Krong Pak 02 Hub (1631 đúng vs 1621 lưu, lệch đúng
// 10 ID Supplement bị _anaTrimIdDatesBySize() cắt khỏi Sheet do trạm >1600
// đơn/ngày vượt trần 45.000 ký tự gần như MỖI NGÀY): Firestore document field
// cho ~1 MiB, tăng ~20 lần sức chứa, đủ cho các trạm sản lượng lớn nhất hiện
// tại chạy nhiều tuần trước khi cần trim lại.
//
// Sheet Inbound_Lock giờ CHỈ còn là CACHE hiển thị + PHAO CỨU HỘ khi Firestore
// lỗi (mất mạng/quota) — không phải nguồn chính nữa. Theo yêu cầu, KHÔNG
// migrate dữ liệu idDates cũ đang nằm trên Sheet: trạm nào chưa có document
// trên Firestore coi như bắt đầu đếm lại từ 0 kể từ ngày áp dụng bản này.
// =========================================================================
function _anaReadInboundState(ss, stationName) {
  var stationKey = _anaSafeStationKey(stationName);
  var todayKey = _anaTodayKey();

  // [FIX 2026-07-21 — QUAN TRỌNG] Nếu lần GHI Firestore GẦN NHẤT của trạm này đã thất bại
  // (xem cờ 'ana_fs_stale_<trạm>' được set trong _anaSaveInboundState), Firestore đang giữ
  // dữ liệu CŨ HƠN Sheet cache — đọc thẳng Firestore lúc này (dù bản thân request ĐỌC có
  // thể thành công bình thường, trả về 200 OK) sẽ trả về NỘI DUNG SAI (cũ) mà không có gì
  // báo hiệu là sai, vì đây không phải lỗi mạng ở bước đọc. Đây CHÍNH LÀ nguyên nhân khiến
  // "chập chờn" kéo dài dai dẳng thay vì tự khỏi ngay lần đọc kế tiếp. SỬA: khi cờ này còn
  // hiệu lực, ưu tiên đọc Sheet cache (luôn là bản MỚI NHẤT vì được ghi ở CÙNG lượt lưu mà
  // Firestore bị lỗi) — đồng thời tranh thủ tự đẩy lại đúng dữ liệu đó lên Firestore ngay
  // tại đây (self-heal cơ hội, không cần đợi user upload thêm 1 lần nữa mới có cơ hội thử
  // lại), xóa cờ nếu đẩy lại thành công.
  try {
    var _staleFlag = PropertiesService.getScriptProperties().getProperty('ana_fs_stale_' + stationKey);
    if (_staleFlag) {
      console.warn('[Inbound] Trạm "' + stationName + '" đang có cờ Firestore lệch sau Sheet (set lúc ' + _staleFlag + ') — ưu tiên đọc Sheet cache, thử tự đồng bộ lại.');
      var _sheetState = _anaReadInboundStateFromSheet_(ss, stationName);
      // Tranh thủ tự đẩy lại lên Firestore ngay — best-effort, không chặn việc trả kết quả
      // (đã có kết quả ĐÚNG từ Sheet để trả về ngay cả khi lần tự đồng bộ này vẫn thất bại).
      var _selfHealOk = true;
      try {
        _fsSaveInboundLive_(stationKey, {
          station: stationName,
          date: _sheetState.date || todayKey,
          inboundLock: _sheetState.inboundLock || 0,
          idDatesJson: JSON.stringify(_sheetState.idDates || {}),
          seenIdsJson: JSON.stringify(_sheetState.seenIds || []),
          pendingFalseIdsJson: JSON.stringify(_sheetState.pendingFalseIds || []),
          totalDrivers: _sheetState.totalDrivers || 0,
          updatedAt: _anaVNNow()
        });
        PropertiesService.getScriptProperties().deleteProperty('ana_fs_stale_' + stationKey);
        console.log('[Inbound] Tự đồng bộ lại Firestore cho trạm "' + stationName + '" THÀNH CÔNG — đã xóa cờ lệch.');
      } catch (eSelfHeal) {
        _selfHealOk = false;
        console.warn('[Inbound] Tự đồng bộ lại Firestore cho trạm "' + stationName + '" vẫn thất bại, giữ nguyên cờ để thử tiếp lần sau: ' + eSelfHeal.message);
      }
      // [FIX 2026-07-21] Gắn cờ fsWriteOk vào kết quả trả về — nếu không, trường hợp
      // _anaComputeAndLockInboundServer_() gọi hàm này rồi early-return thẳng "existing"
      // (không có đơn mới để ghi thêm, không gọi lại _anaSaveInboundState) sẽ làm MẤT tín
      // hiệu "vẫn đang lệch" cho response phía saveStationData(), khiến user không được
      // báo dù trạm thực sự vẫn chưa đồng bộ xong. Dữ liệu vẫn ĐÚNG (đã dùng Sheet cache
      // mới nhất) — đây chỉ là khép kín tín hiệu cảnh báo, không ảnh hưởng tính đúng đắn.
      _sheetState.fsWriteOk = _selfHealOk;
      return _sheetState;
    }
  } catch (eStaleCheck) { /* lỗi đọc cờ — coi như không có cờ, đọc Firestore bình thường bên dưới */ }

  // [FIX 2026-08-14] Ngân sách UrlFetch/ngày đã cao → CHỦ ĐỘNG dùng Sheet cache
  // ngay, không mất 1 lượt UrlFetch để rồi thất bại (Firestore đã có fallback an
  // toàn về Sheet từ trước — chủ động bỏ qua sớm chỉ là tiết kiệm quota, không
  // đổi kết quả cuối cùng nhận được so với việc để nó tự thất bại rồi fallback).
  if (_spxShouldSkipUrlFetchForBudget_()) {
    console.warn('[Inbound] Ngân sách UrlFetch hôm nay đã cao — chủ động dùng Sheet cache cho trạm "' + stationName + '".');
    var _budgetSkipState = _anaReadInboundStateFromSheet_(ss, stationName);
    _budgetSkipState.fsWriteOk = false; // báo hiệu cho phía trên biết đang ở chế độ tiết kiệm, không phải lỗi thật
    return _budgetSkipState;
  }

  try {
    var live = _fsGetInboundLive_(stationKey);
    if (live) {
      return _anaParseInboundLiveDoc_(live, todayKey);
    }
    // [FIX LỖI THẬT — SỐ INBOUND LOCK NHẢY SAI Ở PHIÊN 2/3 TRONG NGÀY]
    // TRƯỚC ĐÂY: live===null bị coi CHẮC CHẮN là "trạm mới theo hệ thống mới",
    // KHÔNG kiểm tra Sheet cache, trả thẳng về 0 rồi tính lại TỪ ĐẦU dựa trên
    // dữ liệu file đang upload — nếu Firestore document bị mất/chưa đồng bộ
    // TẠM THỜI (mạng chập chờn, quota, lỗi ghi trước đó) dù Sheet ĐANG GIỮ ĐÚNG
    // số liệu từ phiên trước, hệ thống vẫn coi như "trạm mới" → tính ra số THẤP
    // HƠN số đúng đã có (không phải mọi đơn trong file đều đủ điều kiện tính lại
    // là "mới") → GHI ĐÈ CẢ Sheet lẫn Firestore bằng số sai → mất số đúng VĨNH
    // VIỄN (khớp đúng báo cáo thực tế: đúng 2k đầu ngày, phiên sau tụt còn 1k,
    // xoá dữ liệu làm lại vẫn ra 1k vì sổ Inbound_Lock — vốn KHÔNG bị xoá theo
    // đúng thiết kế "sổ lũy kế toàn thời gian" — đã bị ghi đè sai từ trước).
    // SỬA: live===null KHÔNG còn tự động kết luận "trạm mới" — kiểm tra thêm
    // Sheet cache TRƯỚC. Chỉ khi Sheet CŨNG không có dòng nào (_anaFindInboundRow
    // trả falsy, tín hiệu chính xác nhất cho "chưa từng có dữ liệu") mới thực sự
    // là trạm mới. Nếu Sheet CÓ dữ liệu, dùng Sheet làm nguồn — ĐÚNG NHƯ THẬT —
    // đồng thời tự đẩy lại lên Firestore ngay (self-heal, cùng pattern đã dùng
    // cho trường hợp cờ lệch ở trên), để lần đọc kế tiếp không còn lệch nữa.
    var _sheetFallback = _anaReadInboundStateFromSheet_(ss, stationName);
    var _sheetHasData = _sheetFallback && Object.keys(_sheetFallback.idDates || {}).length > 0;
    if (_sheetHasData) {
      console.warn('[Inbound] Trạm "' + stationName + '" — Firestore báo KHÔNG có document nhưng Sheet cache ĐANG CÓ ' +
        Object.keys(_sheetFallback.idDates).length + ' ID — đây KHÔNG PHẢI trạm mới, Firestore chỉ đang lệch/mất tạm thời. ' +
        'Dùng Sheet làm nguồn, tự đồng bộ lại Firestore ngay.');
      var _selfHealOk2 = true;
      try {
        _fsSaveInboundLive_(stationKey, {
          station: stationName,
          date: _sheetFallback.date || todayKey,
          inboundLock: _sheetFallback.inboundLock || 0,
          idDatesJson: JSON.stringify(_sheetFallback.idDates || {}),
          seenIdsJson: JSON.stringify(_sheetFallback.seenIds || []),
          pendingFalseIdsJson: JSON.stringify(_sheetFallback.pendingFalseIds || []),
          totalDrivers: _sheetFallback.totalDrivers || 0,
          updatedAt: _anaVNNow()
        });
        console.log('[Inbound] Tự đồng bộ lại Firestore cho trạm "' + stationName + '" (do document bị thiếu) THÀNH CÔNG.');
      } catch (eSelfHeal2) {
        _selfHealOk2 = false;
        console.warn('[Inbound] Tự đồng bộ lại Firestore cho trạm "' + stationName + '" (do document bị thiếu) vẫn thất bại: ' + eSelfHeal2.message);
      }
      _sheetFallback.fsWriteOk = _selfHealOk2;
      return _sheetFallback;
    }
    // Sheet CŨNG không có dữ liệu gì -> đây MỚI THỰC SỰ là trạm mới hoàn toàn.
    return { date: todayKey, inboundLock: 0, allIds: [], idDates: {}, seenIds: [], pendingFalseIds: [], newIds: [], ts: null, totalDrivers: 0 };
  } catch (eFs) {
    // Firestore lỗi thật (mạng/quota/auth) → fallback đọc Sheet cache để
    // không làm gián đoạn vận hành trạm đang cần lock inbound.
    console.warn('[Inbound] Đọc Firestore lỗi, fallback Sheet cache: ' + eFs.message);
    return _anaReadInboundStateFromSheet_(ss, stationName);
  }
}

/** Parse document Firestore inbound_live → object state (CÙNG shape với bản Sheet cũ). */
function _anaParseInboundLiveDoc_(live, todayKey) {
  var idDates = {};
  try { idDates = JSON.parse(live.idDatesJson || '{}'); } catch (e) { idDates = {}; }
  if (!idDates || typeof idDates !== 'object' || Array.isArray(idDates)) idDates = {};

  // [FIX 2026-07-B] seenIds — TẤT CẢ orderId đã từng được xét (kể cả OLD, không tính)
  var seenIds = [];
  try { seenIds = JSON.parse(live.seenIdsJson || '[]'); } catch (e2) { seenIds = []; }
  if (!Array.isArray(seenIds)) seenIds = [];

  // [FIX 2026-08-13] pendingFalseIds — ID bị xét "false" đúng 1 lần, đang chờ xét lại
  // lần sau trước khi khoá vĩnh viễn (xem _anaClassifyWithGraceWindow_).
  var pendingFalseIds = [];
  try { pendingFalseIds = JSON.parse(live.pendingFalseIdsJson || '[]'); } catch (e2b) { pendingFalseIds = []; }
  if (!Array.isArray(pendingFalseIds)) pendingFalseIds = [];

  var trimmed = false;
  if (Object.prototype.hasOwnProperty.call(idDates, '__trimmed__')) {
    trimmed = true;
    delete idDates.__trimmed__;
  }

  var allIds = Object.keys(idDates);
  var todayCountFromIdDates = 0;
  allIds.forEach(function(id) { if (idDates[id] === todayKey) todayCountFromIdDates++; });

  // Giữ nguyên logic "floor" chống tụt số giữa các lần đọc trong cùng 1 ngày
  // (xem giải thích gốc trong _anaReadInboundStateFromSheet_ bên dưới).
  var updatedDateKey = String(live.date || '').slice(0, 10);
  var storedLock = parseInt(live.inboundLock || 0, 10) || 0;
  var todayCount = (updatedDateKey === todayKey)
    ? Math.max(todayCountFromIdDates, storedLock)
    : todayCountFromIdDates;

  return {
    date: todayKey,
    inboundLock: todayCount,
    allIds: allIds,
    idDates: idDates,
    seenIds: seenIds,
    pendingFalseIds: pendingFalseIds,
    trimmed: trimmed,
    updatedAt: live.updatedAt || null,
    ts: live.updatedAt || null,
    totalDrivers: parseInt(live.totalDrivers || 0, 10) || 0
  };
}

/**
 * FALLBACK — chỉ dùng khi Firestore lỗi. Y HỆT logic đọc Sheet của bản trước
 * (giữ nguyên toàn bộ, kể cả fix "floor" chống tụt số qua F5), vì Sheet giờ là
 * cache/phao cứu hộ nên vẫn cần đúng như cũ để không tự tạo thêm lệch số khi
 * đang trong tình huống khẩn (Firestore down).
 */
function _anaReadInboundStateFromSheet_(ss, stationName) {
  var stationKey = _anaSafeStationKey(stationName);
  var todayKey = _anaTodayKey();
  var sheet = _anaInboundSheet(ss);
  var row = _anaFindInboundRow(sheet, stationKey);
  if (!row) {
    return { date: todayKey, inboundLock: 0, allIds: [], idDates: {}, seenIds: [], pendingFalseIds: [], newIds: [], ts: null };
  }

  var values = sheet.getRange(row, 1, 1, 11).getValues()[0];
  var idDates = {};
  try { idDates = JSON.parse(values[5] || '{}'); } catch(e) { idDates = {}; }
  if (!idDates || typeof idDates !== 'object' || Array.isArray(idDates)) idDates = {};

  // [FIX 2026-07-B] seenIds — cột 10, chỉ có khi ghi bằng bản mới; sheet cũ chưa có → mảng rỗng
  var seenIds = [];
  try { seenIds = JSON.parse(values[9] || '[]'); } catch(e3) { seenIds = []; }
  if (!Array.isArray(seenIds)) seenIds = [];

  // [FIX 2026-08-13] pendingFalseIds — cột 11, chỉ có khi ghi bằng bản mới; sheet cũ/dòng cũ
  // chưa có cột này → mảng rỗng (an toàn: coi như chưa có ID nào đang chờ xét lại).
  var pendingFalseIds = [];
  try { pendingFalseIds = JSON.parse(values[10] || '[]'); } catch(e3b) { pendingFalseIds = []; }
  if (!Array.isArray(pendingFalseIds)) pendingFalseIds = [];

  var trimmed = false;
  if (Object.prototype.hasOwnProperty.call(idDates, '__trimmed__')) {
    trimmed = true;
    delete idDates.__trimmed__;
  }

  if (Object.keys(idDates).length === 0) {
    var _legacyIds = [];
    try { _legacyIds = JSON.parse(values[4] || '[]'); } catch(e) { _legacyIds = []; }
    if (Array.isArray(_legacyIds) && _legacyIds.length > 0) {
      var _rawDate = values[2];
      var _legacyDate;
      if (_rawDate instanceof Date) {
        _legacyDate = Utilities.formatDate(_rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
      } else {
        _legacyDate = String(_rawDate || '').slice(0, 10) || todayKey;
      }
      _legacyIds.forEach(function(id) { if (id && id !== '__trimmed__') idDates[id] = _legacyDate; });
    }
  }

  var allIds = Object.keys(idDates);
  var todayCountFromIdDates = 0;
  allIds.forEach(function(id) { if (idDates[id] === todayKey) todayCountFromIdDates++; });

  var _rawUpdatedDate = values[2];
  var _updatedDateKey = (_rawUpdatedDate instanceof Date)
    ? Utilities.formatDate(_rawUpdatedDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
    : String(_rawUpdatedDate || '').slice(0, 10);
  var _storedLock = parseInt(values[3] || 0, 10) || 0;
  var todayCount = (_updatedDateKey === todayKey)
    ? Math.max(todayCountFromIdDates, _storedLock)
    : todayCountFromIdDates;

  return {
    date: todayKey,
    inboundLock: todayCount,
    allIds: allIds,
    idDates: idDates,
    seenIds: seenIds,
    pendingFalseIds: pendingFalseIds,
    trimmed: trimmed,
    updatedAt: values[6] || null,
    ts: values[7] || values[6] || null,
    totalDrivers: parseInt(values[8] || 0, 10) || 0
  };
}

// [FIX 2026-07-21 PERF] Cắt idDates về đúng cửa sổ N ngày gần nhất (mặc định 7 — đã xác
// nhận với business: đối chiếu Tồn chỉ cần nhìn lại 7 ngày là đủ). Đây là đòn bẩy giảm
// dung lượng LỚN NHẤT cho việc đồng bộ Firestore: trước đây idDates là SỔ LŨY KẾ TOÀN
// THỜI GIAN, có thể phình tới ~900.000 ký tự và bị gửi lại NGUYÊN VẸN mỗi lần lưu (dù đơn
// mới chỉ là 1 phần rất nhỏ) — đây là nguyên nhân chính khiến đồng bộ "rất chậm". Khác với
// hàm trim-theo-dung-lượng cũ (_anaTrimIdDatesBySize, chỉ kích hoạt khi VƯỢT TRẦN), hàm
// này LUÔN LUÔN áp dụng mỗi lần lưu, giữ payload nhỏ ổn định thay vì để phình dần rồi mới
// cắt đột ngột. CHỈ áp dụng cho idDates — TUYỆT ĐỐI KHÔNG áp dụng logic này cho seenIds
// (mảng chống đếm trùng) vì seenIds cần nhớ MÃI MÃI mọi ID từng bị loại "OLD", không giới
// hạn theo ngày — cắt nhầm seenIds có thể khiến 1 đơn cũ bị đếm trùng nhầm thành mới.
function _anaPruneIdDatesToWindow_(idDates, windowDays, todayKey) {
  // Tính ngưỡng ngày cũ nhất còn được giữ lại bằng cách trừ lùi windowDays-1 ngày từ hôm
  // nay (VN timezone) — VD windowDays=7, hôm nay 2026-07-21 → giữ từ 2026-07-15 trở về sau.
  var _todayDate = new Date(todayKey + 'T00:00:00+07:00');
  var _cutoffDate = new Date(_todayDate.getTime() - (windowDays - 1) * 86400000);
  var _cutoffKey = Utilities.formatDate(_cutoffDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  var kept = {}, dropped = {};
  Object.keys(idDates).forEach(function(id) {
    var d = idDates[id];
    // So sánh chuỗi ngày dạng yyyy-MM-dd hoạt động đúng như so sánh số (định dạng cố định
    // độ dài, thứ tự ký tự = thứ tự thời gian) — không cần parse Date cho từng phần tử,
    // giữ vòng lặp nhanh dù có hàng chục nghìn ID.
    if (typeof d === 'string' && d >= _cutoffKey) {
      kept[id] = d;
    } else {
      dropped[id] = d;
    }
  });
  return { kept: kept, dropped: dropped, cutoffKey: _cutoffKey };
}

function _anaSaveInboundState(ss, stationName, state) {
  var stationKey  = _anaSafeStationKey(stationName);
  var todayKey = _anaTodayKey();
  var now = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ss'+07:00'");

  // idDates từ client: { orderId: "yyyy-MM-dd" } — ngày nhận thực tế của từng ID MỚI
  // (do frontend tự xác định qua stationRecvTime/onHoldTime, KHÔNG phải ngày push).
  var incomingIdDates = (state && state.idDates && typeof state.idDates === 'object' && !Array.isArray(state.idDates))
    ? state.idDates : {};
  // BACKWARD-COMPAT: client cũ (chưa update) có thể vẫn gửi allIds phẳng — gán ngày=hôm nay
  if (Object.keys(incomingIdDates).length === 0 && state && Array.isArray(state.allIds)) {
    state.allIds.forEach(function(id) { if (id) incomingIdDates[id] = todayKey; });
  }

  // UNION VĨNH VIỄN theo ID — KHÔNG reset theo ngày, KHÔNG bao giờ ghi đè ngày đã
  // chốt của 1 ID đã tồn tại. _anaReadInboundState() đã tự ưu tiên Firestore, fallback
  // Sheet nếu lỗi — nơi gọi không cần biết chi tiết nguồn.
  var existing = _anaReadInboundState(ss, stationName);
  var existingIdDates = existing.idDates || {};

  var finalIdDates = {};
  Object.keys(existingIdDates).forEach(function(id) { finalIdDates[id] = existingIdDates[id]; });
  Object.keys(incomingIdDates).forEach(function(id) {
    if (!Object.prototype.hasOwnProperty.call(finalIdDates, id)) {
      finalIdDates[id] = incomingIdDates[id]; // ID mới → chốt ngày lần đầu
    }
    // ID đã có → giữ nguyên ngày cũ, bỏ qua ngày gửi lên lần này
  });

  var finalAllIds = Object.keys(finalIdDates);
  var todayCount = 0;
  finalAllIds.forEach(function(id) { if (finalIdDates[id] === todayKey) todayCount++; });
  var inboundLock = todayCount;

  // [MỚI — lớp bảo vệ bổ sung, phòng thủ theo chiều sâu] Dù đã sửa nguyên nhân
  // gốc (đọc sai "Firestore null" thành "trạm mới"), vẫn cảnh báo SỚM nếu số
  // hôm nay giảm so với lần lưu gần nhất — không chặn ghi (số giảm đôi khi hợp
  // lệ, VD dọn dẹp trùng lặp/sửa lỗi phân loại thủ công), chỉ ghi log rõ ràng
  // để phát hiện ngay nếu vấn đề còn tái diễn dưới dạng khác, không phải đợi
  // user tự nhận ra rồi báo lại nhiều ngày sau. Đếm THẲNG từ existingIdDates
  // (không dựa vào field "date" trả về — field đó LUÔN cố định = hôm nay,
  // không phản ánh ngày cập nhật thật, nên không dùng được để lọc).
  var _existingTodayCount = 0;
  Object.keys(existingIdDates).forEach(function(id) { if (existingIdDates[id] === todayKey) _existingTodayCount++; });
  if (_existingTodayCount > 0 && inboundLock < _existingTodayCount) {
    console.warn('[Inbound] ⚠️ CẢNH BÁO SỐ GIẢM — Trạm "' + stationName + '": số Inbound hôm nay VỪA GIẢM từ ' +
      _existingTodayCount + ' xuống ' + inboundLock + '. Số Inbound Lock chỉ nên TĂNG hoặc GIỮ NGUYÊN trong ngày theo đúng thiết kế "sổ lũy kế" — nếu đây không phải thao tác dọn dẹp/sửa lỗi thủ công có chủ đích, cần điều tra ngay.');
  }

  // [FIX 2026-07-21 PERF] Cắt idDates về cửa sổ 7 ngày gần nhất NGAY TẠI ĐÂY — SAU khi
  // todayCount đã tính xong (nên không có rủi ro gì tới độ chính xác số hôm nay), TRƯỚC
  // khi build payload gửi Firestore/Sheet. Đây là bước LUÔN CHẠY (không đợi vượt trần mới
  // cắt như trước), giữ dung lượng đồng bộ nhỏ và ổn định. Phần bị cắt được lưu vào kho lưu
  // trữ (archive) như cũ — không mất dữ liệu, chỉ chuyển ra khỏi "sổ nóng".
  var _pruneResult = _anaPruneIdDatesToWindow_(finalIdDates, 7, todayKey);
  var _droppedCount = Object.keys(_pruneResult.dropped).length;
  if (_droppedCount > 0) {
    finalIdDates = _pruneResult.kept;
    finalAllIds = Object.keys(finalIdDates);
    console.log('[Inbound] Cắt idDates về cửa sổ 7 ngày (từ ' + _pruneResult.cutoffKey + '): giữ ' +
      finalAllIds.length + ' ID, chuyển ' + _droppedCount + ' ID cũ hơn ra khỏi sổ nóng.');
    // [FIX 2026-07-21 PERF] CHỈ archive (thêm 1 round-trip Firestore riêng) khi lô bị cắt
    // đủ LỚN (≥20 ID) — vì hàm archive luôn tạo 1 document MỚI mỗi lần gọi (kèm UUID), nếu
    // archive ở MỌI lần lưu có cắt (sẽ là hầu hết các lần lưu 1 khi trạm có >7 ngày lịch
    // sử), sẽ vô tình THÊM 1 round-trip mạng mỗi lần — làm giảm bớt chính lợi ích tốc độ
    // vừa đạt được. Lô lớn (dọn dẹp lần đầu sau khi triển khai fix này, có thể cắt cả tháng
    // lịch sử 1 lúc) vẫn được archive đầy đủ; phần trôi nhỏ giọt hàng ngày (thường 1-5 ID
    // mỗi lần, do đơn vừa tròn 8 ngày) được CHẤP NHẬN bỏ qua audit trail để đổi lấy tốc độ —
    // đây chỉ là dữ liệu audit/tra cứu thủ công, KHÔNG ảnh hưởng gì tới việc đếm Inbound
    // hay chống đếm trùng (đã được seenIds đảm nhiệm riêng, không phụ thuộc archive).
    if (_droppedCount >= 20) {
      if (typeof _fsArchiveInboundDropped_ === 'function') {
        // [FIX 2026-07-21] Chia nhỏ (chunk) nếu lô bị cắt quá lớn — xảy ra ở LẦN DỌN DẸP
        // ĐẦU TIÊN sau khi triển khai fix này cho 1 trạm đã có nhiều tháng lịch sử (có thể
        // cắt tới hàng chục nghìn ID cùng lúc). Không chia nhỏ, JSON của cả lô có thể vượt
        // giới hạn ~1MiB/document của Firestore khiến archive thất bại (dù không ảnh hưởng
        // luồng lưu chính nhờ try/catch, vẫn nên tránh mất audit trail nếu tránh được).
        var _dropKeys = Object.keys(_pruneResult.dropped);
        var _CHUNK_SIZE = 5000; // ước lượng an toàn — ID + ngày ~30-40 ký tự/entry
        if (_dropKeys.length <= _CHUNK_SIZE) {
          try {
            _fsArchiveInboundDropped_(stationKey, stationName, _pruneResult.dropped);
          } catch (eArchiveWindow) {
            console.warn('[Inbound] Archive phần bị cắt theo cửa sổ 7 ngày lỗi (bỏ qua, vẫn tiếp tục lưu): ' + eArchiveWindow.message);
          }
        } else {
          // [FIX 2026-07-21] try/catch RIÊNG cho từng chunk — TRƯỚC ĐÂY dùng 1 try/catch
          // DUY NHẤT bọc cả vòng lặp: nếu chunk giữa chừng (VD chunk 3/10) lỗi, TOÀN BỘ các
          // chunk còn lại (4-10) sẽ KHÔNG BAO GIỜ được thử nữa (exception thoát khỏi vòng
          // lặp luôn) — mất audit trail nhiều hơn cần thiết dù chỉ 1 chunk thật sự lỗi. Giờ
          // mỗi chunk độc lập — 1 chunk lỗi chỉ mất đúng phần audit của chunk đó, các chunk
          // khác vẫn được lưu bình thường.
          for (var _ci = 0; _ci < _dropKeys.length; _ci += _CHUNK_SIZE) {
            var _chunkKeys = _dropKeys.slice(_ci, _ci + _CHUNK_SIZE);
            var _chunkObj = {};
            _chunkKeys.forEach(function(_ck) { _chunkObj[_ck] = _pruneResult.dropped[_ck]; });
            try {
              _fsArchiveInboundDropped_(stationKey, stationName, _chunkObj);
            } catch (eArchiveChunk) {
              console.warn('[Inbound] Archive chunk ' + (_ci / _CHUNK_SIZE + 1) + ' lỗi (bỏ qua chunk này, tiếp tục các chunk còn lại): ' + eArchiveChunk.message);
            }
          }
        }
      }
    }
  }

  // [FIX 2026-07-B] seenIds — UNION vĩnh viễn (chỉ thêm, không bao giờ xoá) danh sách
  // TẤT CẢ orderId đã từng được server xét qua (kể cả bị loại OLD) — chống việc 1 đơn
  // cũ bị xét lại và tính nhầm thành NEW chỉ vì trạng thái của nó đổi sau này.
  var incomingSeenIds = (state && Array.isArray(state.seenIds)) ? state.seenIds : [];
  var seenSetFinal = {};
  (existing.seenIds || []).forEach(function(id) { if (id) seenSetFinal[id] = true; });
  finalAllIds.forEach(function(id) { seenSetFinal[id] = true; }); // đơn đã tính chắc chắn đã "seen"
  incomingSeenIds.forEach(function(id) { if (id) seenSetFinal[id] = true; });
  var finalSeenIds = Object.keys(seenSetFinal);

  // [FIX 2026-08-13] pendingFalseIds — UNION (existing ∪ mới phát sinh false lần đầu) TRỪ
  // ĐI những ID vừa được giải quyết xong lần này (đã đủ 2 lần xét hoặc đã lật thành true).
  // Xem _anaClassifyWithGraceWindow_() để biết logic quyết định ID nào vào/ra sổ này.
  var incomingNewPending = (state && Array.isArray(state.newPendingFalseIds)) ? state.newPendingFalseIds : [];
  var incomingResolved   = (state && Array.isArray(state.resolvedPendingIds)) ? state.resolvedPendingIds : [];
  var resolvedSet = {};
  incomingResolved.forEach(function(id) { if (id) resolvedSet[id] = true; });
  var pendingSetFinal = {};
  (existing.pendingFalseIds || []).forEach(function(id) { if (id && !resolvedSet[id]) pendingSetFinal[id] = true; });
  incomingNewPending.forEach(function(id) { if (id && !resolvedSet[id]) pendingSetFinal[id] = true; });
  var finalPendingFalseIds = Object.keys(pendingSetFinal);

  var _incomingDrivers = parseInt((state && state.totalDrivers) || 0, 10) || 0;
  var _existingDrivers = parseInt(existing.totalDrivers || 0, 10) || 0;
  var totalDriversFinal = _incomingDrivers > 0 ? _incomingDrivers : _existingDrivers;

  // =========================================================================
  // GHI FIRESTORE (nguồn chính) — trần document field ~1 MiB thay vì 45.000 ký
  // tự của Sheet cell. Chốt trần thực tế 900.000 ký tự (~86% của 1 MiB) để dư
  // chỗ cho field khác + overhead JSON encode của Firestore REST.
  // =========================================================================
  var FS_MAX_LEN = 900000;
  var idDatesJsonFull = JSON.stringify(finalIdDates);
  var idDatesJsonForFs = idDatesJsonFull;
  if (idDatesJsonFull.length > FS_MAX_LEN) {
    idDatesJsonForFs = _anaTrimIdDatesBySize(finalIdDates, FS_MAX_LEN);
    console.log('[Inbound] idDates vượt trần Firestore (' + FS_MAX_LEN + '), trim: ' +
      finalAllIds.length + ' ID → còn ' + idDatesJsonForFs.length + ' ký tự (todayCount: ' + todayCount + ')');
    try {
      var keptFs = {};
      try { keptFs = JSON.parse(idDatesJsonForFs); } catch (eParseFs) {}
      var droppedFs = {};
      Object.keys(finalIdDates).forEach(function(id) {
        if (!Object.prototype.hasOwnProperty.call(keptFs, id)) droppedFs[id] = finalIdDates[id];
      });
      if (Object.keys(droppedFs).length > 0 && typeof _fsArchiveInboundDropped_ === 'function') {
        _fsArchiveInboundDropped_(stationKey, stationName, droppedFs);
      }
    } catch (eArchiveFs) {
      console.warn('[Inbound] Archive phần bị trim khỏi Firestore live lỗi (bỏ qua): ' + eArchiveFs.message);
    }
  }

  var seenIdsJsonFull = JSON.stringify(finalSeenIds);
  var seenIdsJsonForFs = seenIdsJsonFull.length > FS_MAX_LEN
    ? JSON.stringify(finalSeenIds.slice(-Math.floor(finalSeenIds.length * FS_MAX_LEN / seenIdsJsonFull.length)))
    : seenIdsJsonFull;

  // [FIX 2026-08-13] pendingFalseIds thường RẤT nhỏ (chỉ chứa ID đang chờ xác nhận lần 2,
  // được giải quyết ngay ở lần lưu kế tiếp có mặt ID đó) — không cần logic trim phức tạp
  // như idDates/seenIds, nhưng vẫn cắt phòng hờ nếu vì lý do gì đó phình bất thường.
  var pendingFalseIdsJsonFull = JSON.stringify(finalPendingFalseIds);
  var pendingFalseIdsJsonForFs = pendingFalseIdsJsonFull.length > FS_MAX_LEN
    ? JSON.stringify(finalPendingFalseIds.slice(-Math.floor(finalPendingFalseIds.length * FS_MAX_LEN / pendingFalseIdsJsonFull.length)))
    : pendingFalseIdsJsonFull;

  var fsWriteOk = true;
  var _fsWriteErr = null;
  // [FIX 2026-08-14] Ngân sách UrlFetch/ngày đã cao → CHỦ ĐỘNG bỏ qua HẲN vòng lặp
  // thử-lại-3-lần bên dưới (mỗi lần thất bại tốn nguyên 1 lượt UrlFetch, tối đa 3
  // lượt cho MỖI lượt lưu nếu Firestore đang thật sự có vấn đề) — tiết kiệm tới 3x
  // so với chỉ bỏ qua bước đọc. Sheet vẫn được ghi bình thường ngay dưới đây (luôn
  // là phao cứu hộ, không phụ thuộc điều kiện này) nên KHÔNG mất dữ liệu, chỉ tạm
  // thời không đồng bộ lên Firestore — cờ 'ana_fs_stale_' bên dưới sẽ tự lo việc
  // đồng bộ lại khi ngân sách ngày mới (hoặc khi đọc lại gặp cờ này) mà không cần
  // thay đổi gì logic self-heal đã có.
  if (_spxShouldSkipUrlFetchForBudget_()) {
    fsWriteOk = false;
    _fsWriteErr = 'Bỏ qua ghi Firestore — ngân sách UrlFetch hôm nay đã cao, ưu tiên dành cho lượt lưu khác.';
    console.warn('[Inbound] ' + _fsWriteErr + ' (trạm "' + stationName + '")');
  } else {
  // [FIX 2026-07-21] TRƯỚC ĐÂY chỉ thử ghi Firestore ĐÚNG 1 LẦN — bất kỳ trục trặc mạng/
  // quota thoáng qua nào (rất hay gặp với UrlFetchApp) đều khiến Firestore bị "treo" ở dữ
  // liệu CŨ ngay lập tức, và (xem fix quan trọng hơn ở _anaReadInboundState bên dưới) các
  // lần ĐỌC sau đó vẫn ưu tiên Firestore nên tiếp tục thấy dữ liệu cũ dù Sheet cache đã có
  // bản mới — đúng triệu chứng "chập chờn, xóa xong vẫn thấy dữ liệu cũ". SỬA: thử lại tối
  // đa 3 lần với backoff ngắn (300ms/700ms) NGAY TRONG LƯỢT NÀY — vì đang giữ named-lock
  // độc quyền của trạm, thử lại ở đây an toàn tuyệt đối (không ai khác ghi chen được) và
  // đóng ngay khoảng lệch trong đa số trường hợp lỗi mạng thoáng qua, không cần đợi lượt
  // ghi kế tiếp mới tự phục hồi.
  for (var _fsAttempt = 1; _fsAttempt <= 3; _fsAttempt++) {
    try {
      _fsSaveInboundLive_(stationKey, {
        station: stationName,
        date: todayKey,
        inboundLock: inboundLock,
        idDatesJson: idDatesJsonForFs,
        seenIdsJson: seenIdsJsonForFs,
        pendingFalseIdsJson: pendingFalseIdsJsonForFs,
        totalDrivers: totalDriversFinal,
        updatedAt: now
      });
      fsWriteOk = true;
      _fsWriteErr = null;
      break;
    } catch (eFsSave) {
      fsWriteOk = false;
      _fsWriteErr = eFsSave.message;
      if (_fsAttempt < 3) {
        console.warn('[Inbound] Ghi Firestore live lỗi (lần ' + _fsAttempt + '/3), thử lại: ' + eFsSave.message);
        Utilities.sleep(_fsAttempt === 1 ? 300 : 700);
      } else {
        console.warn('[Inbound] Ghi Firestore live LỖI sau 3 lần thử, vẫn tiếp tục ghi Sheet làm phao cứu hộ: ' + eFsSave.message);
      }
    }
  }
  }

  // =========================================================================
  // GHI SHEET (cache hiển thị + phao cứu hộ) — best-effort, KHÔNG được chặn
  // save dù lỗi, vì Firestore mới là nguồn chính. Vẫn dùng trần 45.000 ký tự
  // cũ riêng cho bản cache này (Sheet không cần giữ full lịch sử nữa, chỉ cần
  // đủ dùng khi Firestore sập tạm thời).
  // =========================================================================
  try {
    var sheet = _anaInboundSheet(ss);
    var row   = _anaFindInboundRow(sheet, stationKey);
    var idDatesJsonForSheet = idDatesJsonFull.length > 45000
      ? _anaTrimIdDatesBySize(finalIdDates, 45000)
      : idDatesJsonFull;
    var allIdsJson = _anaTrimIdArrayBySize(finalAllIds, 45000);
    var seenIdsJsonForSheet = _anaTrimIdArrayBySize(finalSeenIds, 45000);
    var pendingFalseIdsJsonForSheet = _anaTrimIdArrayBySize(finalPendingFalseIds, 45000);
    var rowData = [
      stationKey, stationName, todayKey, inboundLock,
      allIdsJson, idDatesJsonForSheet, now, now, totalDriversFinal, seenIdsJsonForSheet,
      pendingFalseIdsJsonForSheet
    ];
    if (row) {
      sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
      row = sheet.getLastRow();
    }
    _anaDeleteDuplicateInboundRows(sheet, stationKey, row);
    // [FIX 2026-07-21] Đánh dấu/dọn cờ "Firestore đang lệch sau Sheet" cho ĐÚNG trạm này —
    // đây là mấu chốt để _anaReadInboundState() (bên dưới) biết KHI NÀO phải ưu tiên đọc
    // Sheet cache (vừa ghi mới nhất) thay vì tin thẳng Firestore (đang giữ dữ liệu CŨ vì
    // lần ghi này thất bại cả 3 lần thử). Nếu không có cờ này, lần ĐỌC kế tiếp vẫn gọi
    // thẳng Firestore trước — Firestore trả về thành công (200) với NỘI DUNG CŨ (không
    // phải lỗi mạng ở bước đọc) nên hệ thống không có cách nào tự nhận ra đang đọc nhầm
    // nguồn — đây chính là nguyên nhân khiến tình trạng lệch kéo dài "chập chờn" thay vì
    // tự khỏi ngay ở lần đọc tiếp theo.
    try {
      var _staleProps = PropertiesService.getScriptProperties();
      var _staleKey = 'ana_fs_stale_' + stationKey;
      if (!fsWriteOk) {
        _staleProps.setProperty(_staleKey, String(Date.now()));
      } else {
        _staleProps.deleteProperty(_staleKey);
      }
    } catch (eStaleFlag) { /* best-effort — không chặn luồng chính dù lỗi */ }
  } catch (eSheetSave) {
    console.warn('[Inbound] Ghi Sheet cache lỗi (bỏ qua' +
      (fsWriteOk ? '' : ' — CẢNH BÁO: Firestore CŨNG lỗi lượt này, dữ liệu chưa được lưu ở đâu cả!') +
      '): ' + eSheetSave.message);
  }

  return { date: todayKey, inboundLock: inboundLock, allIds: finalAllIds, idDates: finalIdDates, seenIds: finalSeenIds, pendingFalseIds: finalPendingFalseIds, updatedAt: now, ts: now, fsWriteOk: fsWriteOk, fsWriteError: _fsWriteErr };
}

// [ĐÃ XOÁ — _anaClearInboundState(ss, stationName), xác nhận qua grep toàn bộ
// 4 file .gs (backend.gs/Firestore_bridge.gs/Multi_DB_Router.gs/StationConfig.gs)
// + toàn bộ .html — không còn nơi nào gọi tới]

/**
 * 1. Hàm kiểm tra quyền động cho riêng khối chức năng phân tích bưu cục
 */
/**
 * auditUserPermissionVsSA()
 * ------------------------------------------------------------
 * KHÔNG xoá hay sửa dữ liệu — chỉ TÔ MÀU từng dòng trong sheet
 * "UserPermission" (MASTER_DB_ID) để admin xem trước khi gộp/xoá.
 *
 * Nguồn đối chiếu ĐÚNG: gộp HUB từ CẢ 2 sheet trong RP_SOURCE_ID:
 *   - Sheet "SA"          : cột AOM email (col3) + SUP email (col5) + Hub (col6)
 *                           → 1 người có thể xuất hiện ở NHIỀU dòng (nhiều trạm)
 *                           → phải quét hết, gộp tất cả hub của cùng 1 email
 *   - Sheet "DS Nhân viên": fallback nếu email không có trong SA
 *
 * Màu:
 *  🟢 XANH (#C6EFCE) : email có trong SA, danh sách trạm KHỚP (qua _normStationKey_)
 *  🟡 VÀNG (#FFEB9C) : email có trong SA nhưng danh sách trạm LỆCH
 *                       (SA có nhiều hơn/ít hơn UserPermission)
 *  🔴 ĐỎ  (#FFC7CE) : email KHÔNG CÓ trong SA/DS Nhân viên → sẽ mất quyền nếu xoá
 *  🟠 CAM  (#FFD9A0) : email bị TRÙNG NHIỀU DÒNG trong chính sheet UserPermission
 *
 * Chạy thủ công: Apps Script Editor → chọn hàm này → Run
 */
function auditUserPermissionVsSA() {
  // [SECURITY FIX 2026-08] Hàm xuất ra toàn bộ bảng ánh xạ email ↔ hub/trạm của
  // MỌI nhân viên trong công ty (danh sách phân quyền nội bộ) — trước đây không
  // kiểm tra quyền, ai gọi cũng lấy được. Chỉ admin mới được xem báo cáo audit này.
  _requireAdmin_(2);
  // ── Bước 1: Gom đủ tất cả hub từ AOM SUP (cả AOM lẫn SUP) ──
  var srcSS = _DS.ss(RP_SOURCE_ID);
  var saSheet = srcSS.getSheetByName('AOM SUP') || srcSS.getSheetByName('SA');
  var hubsByEmail = {}; // { email → Set of normalized hub names (raw) }

  if (saSheet) {
    var saData = saSheet.getDataRange().getValues();
    for (var r = 1; r < saData.length; r++) {
      var hub = String(saData[r][RP_SA_COL_HUB] || '').trim();
      if (!hub) continue;
      var aomE = String(saData[r][RP_SA_COL_AOM_EMAIL] || '').toLowerCase().trim();
      var supE = String(saData[r][RP_SA_COL_SUP_EMAIL] || '').toLowerCase().trim();
      [aomE, supE].forEach(function(em) {
        if (!em) return;
        if (!hubsByEmail[em]) hubsByEmail[em] = [];
        if (hubsByEmail[em].indexOf(hub) < 0) hubsByEmail[em].push(hub);
      });
    }
  }

  // ── Bước 2: Gom thêm từ DS Nhân viên (fallback) ──
  const empSheet = srcSS.getSheetByName('DS Nhân viên');

  if (empSheet) {
    const empData = empSheet.getDataRange().getValues();
    
    // Chuẩn hóa header về chữ thường và xóa khoảng trắng thừa
    const hdrs = empData[0].map(h => String(h).toLowerCase().trim());
    
    // Xác định index cột Email và Nơi làm việc
    const emailIdx  = hdrs.indexOf('email') >= 0 ? hdrs.indexOf('email') : 7;        // Cột H
    const hubIdx    = hdrs.indexOf('nơi làm việc') >= 0 ? hdrs.indexOf('nơi làm việc') : 4; // Cột E

    for (let j = 1; j < empData.length; j++) {
      const row = empData[j];

      const em2 = String(row[emailIdx] || '').toLowerCase().trim();
      const h2  = String(row[hubIdx] || '').trim();

      // Chỉ cần thiếu Email hoặc thiếu Nơi làm việc thì mới bỏ qua (không cấp quyền)
      if (!em2 || !h2) continue;

      // Khởi tạo mảng nếu email chưa tồn tại trong object
      if (!hubsByEmail[em2]) {
        hubsByEmail[em2] = [];
      }

      // Thêm hub vào danh sách nếu chưa có (tránh trùng lặp)
      if (!hubsByEmail[em2].includes(h2)) {
        hubsByEmail[em2].push(h2);
      }
    }
  }

  // ── Bước 3: Tô màu từng dòng trong UserPermission ──
  var ss    = _DS.ss(MASTER_DB_ID);
  var sheet = ss.getSheetByName('UserPermission') || ss.getSheets()[0];
  var data  = sheet.getDataRange().getValues();
  var seenEmails = {};
  var summary = { green: 0, yellow: 0, red: 0, orange: 0 };
  var note = [['Trạng thái Audit']]; // ghi chú cột C

  for (var i = 1; i < data.length; i++) {
    var rawEmail = (data[i][0] || '').toString().trim().toLowerCase();
    var rowRange = sheet.getRange(i + 1, 1, 1, Math.max(2, data[i].length));
    if (!rawEmail) { note.push(['(bỏ trống)']); continue; }

    // Trùng lặp ngay trong UserPermission
    if (seenEmails[rawEmail]) {
      rowRange.setBackground('#FFD9A0');
      summary.orange++;
      note.push(['🟠 Trùng email (dòng thứ ' + (i + 1) + ')']);
      continue;
    }
    seenEmails[rawEmail] = true;

    var oldStations = ((data[i][1] || '').toString().trim())
      .split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    var oldNorm = oldStations.map(function(s){ return _normStationKey_(s); }).sort().join('|');

    var saHubs = hubsByEmail[rawEmail] || [];
    if (saHubs.length === 0) {
      rowRange.setBackground('#FFC7CE');
      summary.red++;
      note.push(['🔴 Không có trong SA — phải thêm vào SA trước khi xoá']);
      continue;
    }

    var saHubsNorm = saHubs.map(function(s){ return _normStationKey_(s); }).sort().join('|');
    if (oldNorm === saHubsNorm) {
      rowRange.setBackground('#C6EFCE');
      summary.green++;
      note.push(['🟢 Khớp SA (' + saHubs.length + ' trạm)']);
    } else {
      rowRange.setBackground('#FFEB9C');
      summary.yellow++;
      note.push(['🟡 Lệch — UserPerm: [' + oldStations.join('; ') + '] | SA: [' + saHubs.join('; ') + ']']);
    }
  }

  // Ghi cột ghi chú để xem chi tiết từng dòng
  if (note.length > 1) {
    sheet.getRange(1, 3, note.length, 1).setValues(note);
  }

  var msg = 'Audit UserPermission xong (đối chiếu đủ AOM + SUP):\n' +
    '🟢 Khớp hoàn toàn (an toàn xoá): ' + summary.green + '\n' +
    '🟡 Lệch trạm giữa 2 nguồn: ' + summary.yellow + '\n' +
    '🔴 Không có trong SA (sẽ MẤT quyền nếu xoá): ' + summary.red + '\n' +
    '🟠 Trùng lặp email trong UserPermission: ' + summary.orange + '\n\n' +
    'Chi tiết xem cột C trong sheet UserPermission.';
  _LOG.d(msg);
  // Standalone script (mở sheet qua openById(MASTER_DB_ID), không bound) → getUi() luôn lỗi.
  // Xem log qua Execution log, hoặc đọc cột C trong sheet UserPermission (đã ghi note ở trên).
  return summary;
}

// ════════════════════════════════════════════════════════════════════════════
// PHẦN 3 — ALERT AGGREGATE (TRỤC CẢNH BÁO TRUNG TÂM)
// ════════════════════════════════════════════════════════════════════════════
// Mục tiêu: mỗi module nguồn (KPI Fail, Quá Hạn, FMS) chỉ APPEND vào 1 bảng
// tổng hợp duy nhất "Alert_Aggregate" trong MASTER_DB_ID. Tab 10 (Operation
// Decision Center) chỉ ĐỌC bảng này — không tự gọi lại API của từng module.
//
// Schema (10 cột):
//  A: timestamp     — ISO8601 GMT+7 lúc sự kiện phát sinh
//  B: station_key   — _normStationKey_(stationName) để join chuẩn
//  C: station_name  — tên trạm gốc (hiển thị)
//  D: source_module — 'kpifail' | 'aging' | 'fms'
//  E: severity      — 1 (thông tin) | 2 (cần xử lý) | 3 (khẩn cấp)
//  F: entity_ref    — mã đơn / mã tài xế liên quan
//  G: message       — mô tả ngắn
//  H: status        — 'open' | 'resolved'
//  I: resolved_at   — timestamp giải quyết (rỗng nếu open)
//  J: resolved_by   — email người giải quyết (rỗng nếu open)
// ════════════════════════════════════════════════════════════════════════════
var ALERT_AGG_SHEET   = 'Alert_Aggregate';
var ALERT_AGG_MAX_ROWS = 5000; // tự dọn rows cũ (> 30 ngày) khi vượt quá

/**
 * _alertAggSheet_()
 * Lấy (hoặc tạo mới nếu chưa có) sheet Alert_Aggregate trong MASTER_DB_ID.
 * Header được đặt 1 lần duy nhất khi tạo mới.
 */
function _alertAggSheet_() {
  var ss    = _DS.ss(MASTER_DB_ID);
  var sheet = ss.getSheetByName(ALERT_AGG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ALERT_AGG_SHEET);
    sheet.appendRow(['Timestamp','Station Key','Station Name','Source Module',
                     'Severity','Entity Ref','Message','Status',
                     'Resolved At','Resolved By','Snapshot Luc Resolve (JSON)']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,11).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    return sheet;
  }
  // [BỔ SUNG] MIGRATE: sheet cũ chỉ có 10 cột (chưa có "Snapshot Luc Resolve") — đóng vòng
  // lặp Hiệu quả (mục VIII) cần lưu số liệu tại thời điểm resolve để so sánh sau này.
  // Chỉ thêm cột nếu thiếu, không đụng tới data cũ.
  if (sheet.getLastColumn() < 11) {
    sheet.getRange(1, 11).setValue('Snapshot Luc Resolve (JSON)')
      .setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  }
  return sheet;
}

/**
 * _pushAlert_(opts)
 * Hook nhẹ — append 1 dòng cảnh báo vào Alert_Aggregate.
 * Không dùng LockService (append là atomic trong GAS đơn luồng).
 * Tự dọn rows cũ > 30 ngày nếu sheet vượt ALERT_AGG_MAX_ROWS.
 *
 * @param {object} opts
 *   opts.stationName  {string}  — tên trạm gốc
 *   opts.source       {string}  — 'kpifail' | 'aging' | 'fms'
 *   opts.severity     {number}  — 1 | 2 | 3
 *   opts.entityRef    {string}  — mã đơn / mã tài xế
 *   opts.message      {string}  — mô tả ngắn
 */
function _pushAlert_(opts) {
  try {
    if (!opts || !opts.stationName || !opts.source) return;
    var sheet  = _alertAggSheet_();
    var now    = new Date();
    var nowStr = Utilities.formatDate(now, 'GMT+7', "yyyy-MM-dd'T'HH:mm:ss");
    var stKey  = _normStationKey_(opts.stationName);
    var severity  = opts.severity || 2;
    var entityRef = opts.entityRef || '';
    var message   = (opts.message || '').substring(0, 200);
    sheet.appendRow([
      nowStr,
      stKey,
      opts.stationName,
      opts.source,
      severity,
      entityRef,
      message,
      'open',
      '',
      ''
    ]);

    // Tự dọn rows cũ > 30 ngày khi vượt ngưỡng (tránh sheet phình vô hạn)
    if (sheet.getLastRow() > ALERT_AGG_MAX_ROWS + 1) {
      _alertAggPrune_(sheet, now);
    }

    // [2026-07] Đẩy song song lên Firestore alerts_active/{stKey} để client
    // nhận real-time qua onSnapshot — KHÔNG được để lỗi ở đây làm hỏng việc
    // ghi Sheet phía trên (đã appendRow xong trước khi vào đoạn này).
    _alertFsPush_(stKey, {
      timestamp: nowStr,
      stationKey: stKey,
      stationName: opts.stationName,
      source: opts.source,
      severity: severity,
      entityRef: entityRef,
      message: message
    });
  } catch(e) {
    // Alert hook không được crash module nguồn — luôn catch
    _LOG.d('[Alert] _pushAlert_ error: ' + e.message);
  }
}

/** Xoá các row có Timestamp cũ hơn 30 ngày (chạy từ _pushAlert_ khi cần) */
function _alertAggPrune_(sheet, refDate) {
  var cutoff = new Date(refDate.getTime() - 30 * 24 * 3600 * 1000);
  var data   = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  // Xoá từ dưới lên để không lệch index
  for (var i = data.length - 1; i >= 0; i--) {
    var ts = new Date(data[i][0]);
    if (!isNaN(ts) && ts < cutoff) sheet.deleteRow(i + 2);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// [2026-07] ALERTS_ACTIVE (Firestore) — cache SỐNG cho cảnh báo đang mở, đẩy
// real-time cho Alert Drawer/chuông thông báo thay vì poll 5 phút. Sheet
// Alert_Aggregate ở trên KHÔNG đổi gì — vẫn là nguồn audit đầy đủ duy nhất, ghi
// song song không thay thế. Toàn bộ 2 hàm dưới đây tự catch lỗi, KHÔNG BAO GIỜ
// làm hỏng luồng ghi Sheet chính nếu Firestore tạm thời lỗi (đúng nguyên tắc
// _pushAlert_ đã có).
// ────────────────────────────────────────────────────────────────────────────
var ALERT_FS_MAX_ITEMS = 200; // trần số alert đang mở lưu trong 1 document Firestore/trạm

/**
 * _alertFsPush_(stKey, alertObj)
 * Đọc-sửa-ghi document alerts_active/{stKey}: thêm 1 alert mới vào đầu mảng,
 * cắt bớt item CŨ NHẤT nếu vượt ALERT_FS_MAX_ITEMS. Không dùng LockService —
 * chấp nhận race hiếm khi 2 alert cùng trạm bắn gần như đồng thời (worst case:
 * 1 trong 2 bị ghi đè, sheet chính vẫn có đủ cả 2 nên không mất audit thật).
 */
function _alertFsPush_(stKey, alertObj) {
  try {
    var doc = _fsGetAlertsActive_(stKey);
    var list = [];
    if (doc && doc.activeAlertsJson) {
      try { list = JSON.parse(doc.activeAlertsJson) || []; } catch (eParse) { list = []; }
    }
    list.unshift(alertObj);
    if (list.length > ALERT_FS_MAX_ITEMS) list = list.slice(0, ALERT_FS_MAX_ITEMS);

    var openCount = list.length;
    var criticalCount = list.filter(function(a) { return Number(a.severity) === 3; }).length;

    _fsSaveAlertsActive_(stKey, {
      activeAlertsJson: JSON.stringify(list),
      openCount: openCount,
      criticalCount: criticalCount,
      updatedAt: Utilities.formatDate(new Date(), 'GMT+7', "yyyy-MM-dd'T'HH:mm:ss")
    });
  } catch (e) {
    _LOG.d('[Alert] _alertFsPush_ error: ' + e.message);
  }
}

/**
 * _alertFsResolve_(stKey, entityRef)
 * Đọc-sửa-ghi document alerts_active/{stKey}: bỏ TẤT CẢ item có entityRef khớp
 * ra khỏi mảng đang mở (thường chỉ 1, nhưng lọc hết cho an toàn nếu có trùng).
 */
function _alertFsResolve_(stKey, entityRef) {
  try {
    var doc = _fsGetAlertsActive_(stKey);
    if (!doc || !doc.activeAlertsJson) return; // chưa từng có gì trên Firestore cho trạm này — bỏ qua
    var list = [];
    try { list = JSON.parse(doc.activeAlertsJson) || []; } catch (eParse) { return; }

    var filtered = list.filter(function(a) { return String(a.entityRef) !== String(entityRef); });
    if (filtered.length === list.length) return; // không có gì thay đổi — khỏi ghi lại tốn quota

    var criticalCount = filtered.filter(function(a) { return Number(a.severity) === 3; }).length;
    _fsSaveAlertsActive_(stKey, {
      activeAlertsJson: JSON.stringify(filtered),
      openCount: filtered.length,
      criticalCount: criticalCount,
      updatedAt: Utilities.formatDate(new Date(), 'GMT+7', "yyyy-MM-dd'T'HH:mm:ss")
    });
  } catch (e) {
    _LOG.d('[Alert] _alertFsResolve_ error: ' + e.message);
  }
}

/**
 * alert_getForStation(stationName, limitDays)
 * Hàm Tab 10 gọi — trả về tất cả alert của 1 trạm trong N ngày gần nhất.
 * Không tự tính logic nghiệp vụ, chỉ đọc Alert_Aggregate và trả JSON.
 */
function alert_getForStation(stationName, limitDays) {
  try {
    // [SECURITY FIX 2026-08] Trước đây không kiểm tra quyền — truyền 'ALL' hoặc để
    // trống là lấy được cảnh báo vận hành của MỌI trạm trong công ty. Thêm chặn
    // theo getModuleAccess() + lọc theo hub được cấp cho AOM/SUP/station.
    var _access = getModuleAccess();
    if (_access.role === 'denied') return JSON.stringify({ alerts: [], total: 0, error: 'Không có quyền truy cập.' });
    var _isAdmin = (_access.role === 'admin');
    var _allowedNormHubs = new Set((_access.hubs || []).map(function(h){ return _normStationKey_(h); }));
    if (!_isAdmin && stationName && stationName !== 'ALL' && !_allowedNormHubs.has(_normStationKey_(stationName))) {
      return JSON.stringify({ alerts: [], total: 0, error: 'Không có quyền xem cảnh báo trạm này.' });
    }

    limitDays = limitDays || 7;
    var sheet   = _alertAggSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return JSON.stringify({ alerts: [], total: 0, _debug: 'sheet_empty' });

    // 'ALL' hoặc rỗng → trả về toàn bộ trạm (dùng cho AOM/admin chưa chọn trạm cụ thể)
    var showAll = (!stationName || stationName === 'ALL' || stationName.trim() === '');
    var stKey   = showAll ? null : _normStationKey_(stationName);
    var cutoff  = new Date(Date.now() - limitDays * 24 * 3600 * 1000);
    var data    = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    var alerts  = [];

    data.forEach(function(row) {
      if (!row[0]) return;
      var ts = new Date(row[0]);
      if (isNaN(ts) || ts < cutoff) return;
      // Lọc trạm — bỏ qua nếu không phải showAll và không khớp
      if (!showAll && _normStationKey_(row[2]) !== stKey) return;
      if (!_isAdmin && !_allowedNormHubs.has(_normStationKey_(row[2]))) return;
      alerts.push({
        timestamp:   String(row[0]),
        stationKey:  row[1],
        stationName: row[2],
        source:      row[3],
        severity:    Number(row[4]) || 2,
        entityRef:   row[5] || '',
        message:     row[6] || '',
        status:      row[7] || 'open',
        resolvedAt:  row[8] || '',
        resolvedBy:  row[9] || ''
      });
    });

    alerts.sort(function(a, b) {
      if (b.severity !== a.severity) return b.severity - a.severity;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    return JSON.stringify({ alerts: alerts, total: alerts.length });
  } catch(e) {
    return JSON.stringify({ alerts: [], total: 0, error: e.message });
  }
}

/**
 * getOperationSnapshot_(stationName)
 * ------------------------------------------------------------------
 * Hàm dành cho Alert Drawer trên index — gọi 1 lần, trả về danh sách
 * ACTIONS cần làm ngay (không lặp lại số liệu đã có trên card index).
 */
function getOperationSnapshot_(stationName) {
  try {
    var result = {
      station: stationName,
      ts: Utilities.formatDate(new Date(), 'GMT+7', "HH:mm dd/MM/yyyy"),
      alerts: []
    };

    // ── 1. Quá Hạn ──
    try {
      var agingRaw = aging_getIndexSummary(stationName);
      var aging = (typeof agingRaw === 'string') ? JSON.parse(agingRaw) : agingRaw;
      // Field names đúng: overdueCount, closedLostCount, processingCount
      var backlog   = aging.overdueCount    || 0;
      var lost      = aging.closedLostCount || 0;
      var avgAging  = aging.avgAgingDays    || 0;
      if (lost > 0) {
        result.alerts.push({
          source: 'aging', severity: 3, action: 'quahan',
          message: lost + ' đơn Lost hôm nay chưa chốt — ưu tiên xử lý ngay'
        });
      }
      if (backlog > 0) {
        result.alerts.push({
          source: 'aging', severity: backlog > 30 ? 3 : 2, action: 'quahan',
          message: backlog + ' đơn quá hạn đang tồn' +
                   (avgAging > 0 ? ', aging TB ' + (Math.round(avgAging * 10) / 10) + ' ngày' : '')
        });
      }
    } catch(e) { _LOG.d('Snapshot aging error: ' + e.message); }

    // ── 2. KPI Fail ──
    try {
      var kpiRaw = kpifail_getIndexSummary(stationName);
      var kpi = (typeof kpiRaw === 'string') ? JSON.parse(kpiRaw) : kpiRaw;
      // Field names đúng: totalFM, totalLM, totalSOP, totalFail, unresolvedCount
      var totalFail   = kpi.totalFail       || 0;
      var unresolved  = kpi.unresolvedCount || 0;
      var fmLate      = kpi.totalFM         || 0;
      var lmLate      = kpi.totalLM         || 0;
      var wrongSop    = kpi.totalSOP        || 0;
      if (unresolved > 0) {
        result.alerts.push({
          source: 'kpifail', severity: 3, action: 'kpifail',
          message: unresolved + '/' + totalFail + ' KPI Fail chưa giải trình' +
                   (fmLate > 0 ? ' | FM Late: ' + fmLate : '') +
                   (lmLate > 0 ? ' | LM Late: ' + lmLate : '')
        });
      } else if (totalFail > 0) {
        result.alerts.push({
          source: 'kpifail', severity: 2, action: 'kpifail',
          message: totalFail + ' KPI Fail tháng này — đã giải trình đủ'
        });
      }
    } catch(e) { _LOG.d('Snapshot kpifail error: ' + e.message); }

    // Sort: severity cao trước
    result.alerts.sort(function(a, b) { return b.severity - a.severity; });
    return JSON.stringify(result);
  } catch(e) {
    return JSON.stringify({ error: e.message, alerts: [] });
  }
}

/**
 * _vnTimeContext_()
 * ------------------------------------------------------------------
 * [BỔ SUNG] Trước đây KHÔNG có hàm nào gửi giờ hiện tại / khung ca vào
 * context cho AI phân tích cảnh báo — nên AI so số liệu với ngưỡng tĩnh,
 * dẫn tới báo "khẩn cấp" cả vào giờ nghỉ trưa khi onhold tăng tạm thời là
 * chuyện bình thường (rider tạm dừng giao). Hàm này trả về giờ VN hiện tại
 * + mô tả khung ca bằng ngôn ngữ tự nhiên để AI tự hiệu chỉnh mức độ khẩn
 * cấp theo ĐÚNG thời điểm, thay vì áp 1 ngưỡng cho mọi giờ trong ngày.
 */
function _vnTimeContext_() {
  var now  = new Date();
  var h    = Number(Utilities.formatDate(now, 'GMT+7', 'H'));
  var hhmm = Utilities.formatDate(now, 'GMT+7', 'HH:mm');
  var khungCa;
  if (h < 7)       khungCa = 'trước giờ làm việc (sáng sớm) — số liệu ca trước chưa cập nhật nhiều';
  else if (h < 11) khungCa = 'buổi sáng — cao điểm giao/lấy hàng';
  else if (h < 13) khungCa = 'giờ nghỉ trưa — rider tạm dừng giao, onhold/tồn có thể tăng tạm thời, KHÔNG mặc định coi là bất thường chỉ vì con số tăng so với sáng';
  else if (h < 17) khungCa = 'buổi chiều — cao điểm giao hàng';
  else if (h < 19) khungCa = 'cuối ca — thời điểm quan trọng để đánh giá khả năng clear kho trong ngày, tồn đọng lúc này có ý nghĩa cảnh báo thật hơn';
  else             khungCa = 'ngoài giờ làm việc chính — số liệu gần như đứng yên tới sáng hôm sau';
  return { gioHienTai: hhmm, khungCa: khungCa };
}

/**
 * _gatherAlertExtra_(hubs)
 * ------------------------------------------------------------------
 * Logic lõi lấy dữ liệu bổ sung cho cảnh báo — TÁCH RA từ getAlertExtraContext()
 * cũ để dùng chung được cho cả:
 *   (a) getAlertExtraContext() — giữ nguyên tên/API cũ, tránh phá chỗ nào khác
 *       còn gọi trực tiếp.
 *   (b) alert_getFullAnalysis() — đường mới, gộp bước lấy dữ liệu bổ sung này
 *       CÙNG 1 lần gọi server với bước hỏi AI, thay vì 2 round-trip tuần tự
 *       như trước (client phải chờ getAlertExtraContext xong mới gọi AI được,
 *       tổng cộng có lúc tới 35s và có timeout 10s làm rớt mất baseline/d1Plan
 *       một cách âm thầm không báo cho sếp biết).
 *
 * Nguồn dữ liệu (đều là dữ liệu THẬT đã có sẵn, không suy diễn):
 *   1. Station_Daily (Trend) → baseline hôm qua + TB 7 ngày, CỘNG THÊM dòng
 *      của HÔM NAY nếu trạm đã từng bấm lưu (saveSnapshot) trong ca — đây là
 *      cách duy nhất có onhold/total "hôm nay" cấp mạng lưới mà không phải
 *      quét trực tiếp hàng trăm sheet trạm (quá chậm để làm real-time). Luôn
 *      kèm mốc giờ lưu gần nhất để AI/sếp biết đây KHÔNG phải số liệu sống.
 *   2. Rider_Plan_Driver → số tài xế đi làm/off HÔM NAY, gộp theo trạm.
 *   3. AI_Feedback_Log → ghi chú đã được admin xác nhận đúng, tránh AI lặp lại
 *      đúng lỗi cũ đã bị bác bỏ.
 *   4. FC (auto) + Rider_Plan_Driver ngày mai → d1Plan (kế hoạch D+1).
 *
 * Có cache ScriptCache 180s theo danh sách hub — baseline/riderPlan/d1Plan
 * không đổi trong vài phút, bấm chuông lại nhiều lần trong ca không cần đọc
 * lại Station_Daily/Rider_Plan_Driver mỗi lần (giảm độ trễ + tải Sheets API).
 *
 * @param {string[]} hubs — mảng tên trạm cần lấy
 * @return {{data: object, thoiGianHienTai: {gioHienTai, khungCa}}}
 */
function _gatherAlertExtra_(hubs) {
  var thoiGianHienTai = _vnTimeContext_();
  if (!Array.isArray(hubs) || !hubs.length) return { data: {}, thoiGianHienTai: thoiGianHienTai };

  // [FIX MỚI] Bảo vệ theo THỜI GIAN THỰC TẾ, không chỉ theo số lượng hub — trước đây
  // chỉ có _skipDriverZoneDetail = hubs.length > 25 chặn khi hub NHIỀU, nhưng với
  // 10-24 hub (AOM/SUP cỡ vừa, dưới ngưỡng 25) vòng lặp mở sheet/đọc dữ liệu TỪNG HUB
  // vẫn chạy đủ, không có gì chặn nếu hệ thống đang tải chậm (Sheets API chậm giờ cao
  // điểm, mạng chậm...) — tổng thời gian có thể vượt quá 28s timeout phía client, khiến
  // sếp bấm "thử lại" bao nhiêu lần cũng vậy vì mỗi lần đều lại chạy chậm y hệt. Nay
  // theo dõi thời gian đã trôi qua thực tế và tự ngắt sớm các bước "bổ sung" (không
  // bắt buộc) nếu đã dùng quá nửa ngân sách thời gian cho phép.
  var _extraStartTime = Date.now();
  var _EXTRA_TIME_BUDGET_MS = 8000; // [FIX] 14s→8s: deadline insea=55s, gather cần xong trước 8s để còn 47s cho AI call
  function _overTimeBudget() { return (Date.now() - _extraStartTime) > _EXTRA_TIME_BUDGET_MS; }
  var _skippedByTimeBudget = [];

  var _ck = 'alertextra_' + hubs.slice().sort().join('|').replace(/\s/g,'_').substring(0, 200);
  try {
    var _cachedRaw = CacheService.getScriptCache().get(_ck);
    if (_cachedRaw) return { data: JSON.parse(_cachedRaw), thoiGianHienTai: thoiGianHienTai };
  } catch(ce) { /* cache miss/lỗi — tính lại bình thường */ }

  var hubsNorm = hubs.map(function(h) { return _normStationKey_(h); });
  // [FIX] Set tra cứu O(1) dùng song song với mảng hubsNorm (mảng vẫn giữ lại vì có chỗ
  // cần lấy lại index — xem hubsNorm.indexOf(stNorm) ở dưới). Với AOM/SUP/station nhiều
  // trạm, hubsNorm có thể dài hàng chục phần tử; dùng .indexOf() ngay trong forEach của
  // hàng nghìn dòng Station_Daily/Rider_Plan_Driver sẽ thành O(số dòng × số hub) — chỉ
  // cần kiểm tra "có thuộc phạm vi không" thì tra Set 1 lần là đủ, không cần indexOf.
  var hubsNormSet = Object.create(null);
  var hubsNormToRaw = Object.create(null); // hn → tên hub gốc (raw), dùng thay hubs[hubsNorm.indexOf(hn)]
  hubsNorm.forEach(function(hn, idx) { hubsNormSet[hn] = true; hubsNormToRaw[hn] = hubs[idx]; });
  var result = {};
  hubs.forEach(function(h) { result[h] = { baseline: null, riderPlan: null }; });

  var todayVN     = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
  var yesterdayVN = Utilities.formatDate(new Date(Date.now() - 86400000), 'GMT+7', 'yyyy-MM-dd');
  var sevenDaysAgo= Utilities.formatDate(new Date(Date.now() - 7*86400000), 'GMT+7', 'yyyy-MM-dd');

  // ── 1. BASELINE (7 ngày qua) + SỐ LIỆU HÔM NAY ĐÃ ĐỒNG BỘ ──
  var ssMaster; // dùng lại ở bước 3 (AI_Feedback_Log)
  try {
    ssMaster = _DS.ss(MASTER_DB_ID);
    var sdSheet = ssMaster.getSheetByName('Station_Daily');
    if (sdSheet && sdSheet.getLastRow() > 1) {
      // Đọc tới cột 19 (saved_at) — trước đây chỉ đọc tới cột 17, thiếu mốc giờ lưu
      // nên không thể ghi chú "số liệu hôm nay tính tới lúc mấy giờ" cho AI.
      var lastCol  = Math.min(19, sdSheet.getLastColumn());
      var sdValues = sdSheet.getRange(2, 1, sdSheet.getLastRow()-1, lastCol).getValues();
      var byHubDay = {};        // { hubNorm: { dateStr: {total,delivered,rate,onhold} } }
      var todayRowByHub = {};   // { hubNorm: {total,onhold,rate,savedAt,_t} } — dòng mới nhất hôm nay

      sdValues.forEach(function(row) {
        var rawDate = row[0];
        var rowDate = rawDate instanceof Date
          ? Utilities.formatDate(rawDate, 'GMT+7', 'yyyy-MM-dd')
          : String(rawDate||'').slice(0,10);
        var hubNorm = _normStationKey_(row[1]);
        if (!hubsNormSet[hubNorm]) return;

        if (rowDate === todayVN) {
          // [FIX] Trước đây dòng "hôm nay" bị loại bỏ hoàn toàn khỏi baseline mà
          // KHÔNG được dùng ở đâu khác — khiến onhold hôm nay hoàn toàn vắng mặt
          // trong context cảnh báo trừ khi module BI đang mở đúng trạm đó. Nay giữ
          // lại dòng mới nhất trong ngày (nếu trạm đã từng bấm lưu trong ca) làm
          // "todaySynced", KHÔNG trộn vào baseline 7 ngày (baseline phải là ngày
          // đã chốt xong, không phải ngày đang chạy dở).
          var savedAtRaw  = row[18];
          var savedAtDate = savedAtRaw instanceof Date ? savedAtRaw : new Date(savedAtRaw || 0);
          var savedAtTime = isNaN(savedAtDate.getTime()) ? 0 : savedAtDate.getTime();
          var prev = todayRowByHub[hubNorm];
          if (!prev || savedAtTime > prev._t) {
            // [BỔ SUNG] Trước đây chỉ lấy total/onhold/rate (3/19 cột) từ Station_Daily —
            // các cột delivered/delivering/reattempts/cod/driverCount ĐÃ ĐƯỢC LƯU SẴN mỗi
            // lần autosave (saveSnapshot ghi đủ 19 cột) nhưng chưa từng được đọc ra cho
            // alert, khiến AI phải chờ sếp tự mở tab BI mới có "KPI giao hàng hôm nay".
            // Đây là dữ liệu ĐÃ LƯU (không phải real-time tuyệt đối) — vẫn kèm 'luuLucNao'
            // như cũ để AI/sếp biết đúng tới giờ nào.
            todayRowByHub[hubNorm] = {
              total:       Number(row[2])  || 0,
              delivered:   Number(row[3])  || 0,
              rate:        Number(row[4])  || 0,
              delivering:  Number(row[5])  || 0,
              onhold:      Number(row[6])  || 0,
              hoan:        Number(row[7])  || 0,
              reattempts:  Number(row[8])  || 0,
              codTotal:    Number(row[9])  || 0,
              codDelivered:Number(row[10]) || 0,
              driverCount: Number(row[11]) || 0,
              savedAt: savedAtTime ? Utilities.formatDate(savedAtDate, 'GMT+7', "HH:mm dd/MM") : null,
              _t: savedAtTime
            };
          }
          return;
        }

        if (rowDate < sevenDaysAgo || rowDate > yesterdayVN) return; // chỉ lấy 7 ngày đã chốt xong
        if (!byHubDay[hubNorm]) byHubDay[hubNorm] = {};
        byHubDay[hubNorm][rowDate] = {
          total: Number(row[2])||0, delivered: Number(row[3])||0,
          rate: Number(row[4])||0, onhold: Number(row[6])||0
        };
      });

      hubs.forEach(function(h) {
        var hn = _normStationKey_(h);

        var days = byHubDay[hn];
        if (days) {
          var dateKeys = Object.keys(days);
          if (dateKeys.length) {
            var yesterday = days[yesterdayVN] || null;
            var rates = dateKeys.map(function(d){ return days[d].rate; }).filter(function(v){ return v > 0; });
            var avgRate7d = rates.length ? Math.round((rates.reduce(function(s,v){return s+v;},0)/rates.length)*10)/10 : null;
            var onholdVals = dateKeys.map(function(d){ return days[d].onhold; });
            var avgOnhold7d = onholdVals.length ? Math.round(onholdVals.reduce(function(s,v){return s+v;},0)/onholdVals.length) : null;
            // avg total/ngày — để AI so sánh FC ngày mai vs lượng thật trung bình 7 ngày
            var totalVals = dateKeys.map(function(d){ return days[d].total; }).filter(function(v){ return v > 0; });
            var avgTotal7d = totalVals.length ? Math.round(totalVals.reduce(function(s,v){return s+v;},0)/totalVals.length) : null;
            // Breakdown TB đơn theo từng thứ trong tuần — AI dùng để nhận biết chu kỳ:
            // thứ Hai/đầu tuần thường FC cao hơn TB, thứ Sáu/cuối tuần thường thấp hơn.
            // Nếu FC ngày mai lệch >20% so với avg_theo_thu của đúng thứ đó → tín hiệu bất thường.
            var dowMap = { 0:'CN', 1:'T2', 2:'T3', 3:'T4', 4:'T5', 5:'T6', 6:'T7' };
            var dowTotals = {};
            dateKeys.forEach(function(d) {
              var dow = dowMap[new Date(d + 'T00:00:00Z').getUTCDay()]; // [SỬA] thứ của NGÀY LỊCH (không lệch theo múi giờ)
              if (!dowTotals[dow]) dowTotals[dow] = [];
              if (days[d].total > 0) dowTotals[dow].push(days[d].total);
            });
            var dowAvg = {};
            Object.keys(dowTotals).forEach(function(dow) {
              var arr = dowTotals[dow];
              if (arr.length) dowAvg[dow] = Math.round(arr.reduce(function(s,v){return s+v;},0)/arr.length);
            });
            var sortedDatesDesc = dateKeys.slice().sort().reverse();
            var soNgayRateThapLienTiep = 0, soNgayOnholdCaoLienTiep = 0;
            if (avgRate7d != null) {
              for (var di = 0; di < sortedDatesDesc.length; di++) {
                var dv = days[sortedDatesDesc[di]];
                if (dv.rate > 0 && dv.rate < avgRate7d) soNgayRateThapLienTiep++; else break;
              }
            }
            if (avgOnhold7d != null) {
              for (var dj = 0; dj < sortedDatesDesc.length; dj++) {
                var dvo = days[sortedDatesDesc[dj]];
                if (dvo.onhold > avgOnhold7d) soNgayOnholdCaoLienTiep++; else break;
              }
            }
            result[h].baseline = {
              yesterday: yesterday ? { total: yesterday.total, delivered: yesterday.delivered, rate: yesterday.rate, onhold: yesterday.onhold } : null,
              avg7Days: { rate: avgRate7d, onhold: avgOnhold7d, total: avgTotal7d },
              // TB đơn theo thứ — AI so sánh FC ngày mai với đúng thứ đó (không dùng TB chung)
              avg_theo_thu: dowAvg,
              soNgayCoDuLieu: dateKeys.length,
              xuHuongLienTiep: {
                soNgayRateThapHonTB: soNgayRateThapLienTiep,
                soNgayOnholdCaoHonTB: soNgayOnholdCaoLienTiep,
                ghi_chu: 'Đếm số ngày GẦN NHẤT liên tiếp (lùi từ hôm qua) lệch so với TB 7 ngày — phân biệt sự cố 1 ngày (số nhỏ) với xu hướng kéo dài (số lớn, 3+).'
              }
            };
          }
        }

        var todayRow = todayRowByHub[hn];
        if (todayRow) {
          result[h].todaySynced = {
            onhold: todayRow.onhold,
            total:  todayRow.total,
            rate:   todayRow.rate,
            delivered:    todayRow.delivered,
            delivering:   todayRow.delivering,
            hoan:         todayRow.hoan,
            reattempts:   todayRow.reattempts,
            codPhaiThu:   todayRow.codTotal,
            codDaThu:     todayRow.codDelivered,
            soTaiXeCoDon: todayRow.driverCount,
            luuLucNao: todayRow.savedAt,
            ghi_chu: 'Số liệu HÔM NAY tính tới lần lưu gần nhất' +
              (todayRow.savedAt ? (' lúc ' + todayRow.savedAt) : '') +
              ' (nguồn: Station_Daily, đã lưu qua autosave/bấm lưu ca) — KHÔNG phải số liệu' +
              ' real-time tuyệt đối từng giây, chỉ đúng tới thời điểm lưu đó. Nếu cách xa giờ' +
              ' hiện tại, phải nói rõ có thể đã cũ. Đây là nguồn CHÍNH cho KPI giao hàng trong ca,' +
              ' KHÔNG cần đợi có bi_module_hien_tai mới trả lời được câu hỏi về KPI hôm nay.'
          };
        }
      });
    }
  } catch(e) { _LOG.d('[AlertExtra] baseline/todaySynced error: ' + e.message); }

  // ── 2. RIDER PLAN — số đi làm / off HÔM NAY, gộp theo trạm ──
  try {
    var monthStr = todayVN.slice(0,7); // yyyy-MM
    var dayIdx   = Number(todayVN.slice(8,10)) - 1; // 0-based index trong mảng 31 ngày
    var ssAdmin  = _DS.ss(ADMIN_DB_ID);
    var rpdSheet = ssAdmin.getSheetByName('Rider_Plan_Driver');
    if (rpdSheet && rpdSheet.getLastRow() > 1 && dayIdx >= 0) {
      var rpdValues = rpdSheet.getRange(2, 1, rpdSheet.getLastRow()-1, 3).getValues();
      rpdValues.forEach(function(row) {
        var rowMonth = _rp_monthCellToStr(row[0]);
        if (rowMonth !== monthStr) return;
        var station = String(row[1]||'').trim();
        var stNorm  = _normStationKey_(station);
        if (!hubsNormSet[stNorm]) return;
        var matchHub = hubsNormToRaw[stNorm];
        try {
          var parsed = JSON.parse(row[2] || '{}');
          var arr = Array.isArray(parsed) ? parsed : (parsed.drivers || []);
          var total = arr.length;
          // [FIX] attendance[dayIdx] === 1 nghĩa là checkbox ĐƯỢC TICK = NGHỈ (off),
          // KHÔNG PHẢI đi làm — xác nhận từ chính UI gốc (JS_RiderPlan.html):
          // "if(cb.checked) td.classList.add('att-td-off')". Trước đó bị hiểu ngược.
          var offToday = arr.filter(function(d) {
            var att = d.attendance || [];
            return Number(att[dayIdx]) === 1;
          }).length;
          var presentToday = total - offToday;
          result[matchHub].riderPlan = { tongSo: total, diLam: presentToday, off: offToday };
        } catch(pe) {}
      });
    }
  } catch(e) { _LOG.d('[AlertExtra] riderPlan error: ' + e.message); }

  // [BỔ SUNG] Giới hạn 2 block driver/zone hotspot + KPI Fail chi tiết chỉ khi phạm vi
  // KHÔNG quá lớn — prompt gửi AI đang bị cắt cứng ở 14.000 ký tự (xem ana_askMascotAssistant),
  // AOM/SUP quản hàng chục hub mà thêm chi tiết cấp driver cho MỌI hub sẽ đẩy payload vượt
  // ngưỡng rất nhanh và làm hỏng cả các field quan trọng hơn (d1Plan, baseline) do bị cắt giữa
  // chừng. Ngưỡng 25 hub là ước lượng an toàn — có thể chỉnh nếu thực tế context vẫn còn dư.
  var _skipDriverZoneDetail = hubs.length > 8; // [FIX] 25→8: mỗi hub mở 1 Sheets file riêng ~0.5-1s → 25 hub = +12-25s, thường timeout trước khi gọi AI

  // ── 2b. DRIVER/ZONE HOTSPOT HÔM NAY — trả lời mục "Đối tượng: Driver nào / Ward nào" ──
  // [BỔ SUNG] Driver_Daily đã lưu sẵn onhold/reattempts/top_zone theo TỪNG tài xế mỗi lần
  // autosave (saveSnapshot ghi Driver_Daily cùng lúc với Station_Daily) — dữ liệu này
  // trước đây CHƯA từng được đọc cho alert nên AI không bao giờ trả lời được "driver nào"
  // hay "khu vực nào" dù sếp hỏi. Đây KHÔNG phải dữ liệu cấp đơn hàng (không có tuyến/
  // khách hàng — hệ thống hiện chưa lưu 2 trường đó ở bất kỳ đâu), chỉ là dữ liệu cấp
  // TÀI XẾ đã tổng hợp — đủ để chỉ ra "ai" và "khu vực nào" đang gánh nặng nhất.
  try {
    if (!_skipDriverZoneDetail) hubs.forEach(function(h) {
      if (_overTimeBudget()) { _skippedByTimeBudget.push(h); return; }
      try {
        var ssStation = getStationSS(h);
        var drSheetToday = ssStation.getSheetByName('Driver_Daily');
        if (!drSheetToday || drSheetToday.getLastRow() <= 1) return;
        var drVals = drSheetToday.getRange(2, 1, drSheetToday.getLastRow() - 1, 14).getValues();
        var zoneCount = {};
        var driverRows = [];
        drVals.forEach(function(row) {
          var rowDate = row[0] instanceof Date
            ? Utilities.formatDate(row[0], 'GMT+7', 'yyyy-MM-dd')
            : String(row[0] || '').slice(0, 10);
          if (rowDate !== todayVN) return;
          var rowStation = String(row[1] || '').trim();
          if (_normStationKey_(rowStation) !== _normStationKey_(h)) return;
          var onholdD     = Number(row[8])  || 0;
          var reattemptsD = Number(row[10]) || 0;
          var zone        = String(row[13] || '').trim();
          if (zone) zoneCount[zone] = (zoneCount[zone] || 0) + 1;
          if (onholdD > 0 || reattemptsD > 0) {
            driverRows.push({
              ten: String(row[3] || row[2] || '').trim(),
              onhold: onholdD,
              reattempt: reattemptsD,
              apLuc: onholdD + reattemptsD
            });
          }
        });
        if (driverRows.length) {
          driverRows.sort(function(a, b) { return b.apLuc - a.apLuc; });
          result[h].driverHotspot = driverRows.slice(0, 3);
        }
        var zoneEntries = Object.keys(zoneCount).map(function(z) { return { khuVuc: z, soTaiXe: zoneCount[z] }; });
        if (zoneEntries.length) {
          zoneEntries.sort(function(a, b) { return b.soTaiXe - a.soTaiXe; });
          result[h].zoneHotspot = zoneEntries.slice(0, 3);
          result[h].zoneHotspotGhiChu = 'Khu vực tính theo "top_zone" của từng tài xế (khu vực giao nhiều nhất của tài xế đó hôm nay) — là XẤP XỈ theo tài xế, KHÔNG phải đếm trực tiếp theo từng đơn hàng.';
        }
      } catch(eh) { _LOG.d('[AlertExtra] driverHotspot hub=' + h + ' error: ' + eh.message); }
    });
  } catch(e) { _LOG.d('[AlertExtra] driverHotspot error: ' + e.message); }

  // ── 2c. NGUYÊN NHÂN CHI TIẾT FM LATE / SOP HÔM NAY ──
  // [BỔ SUNG] kpifail_getMasterDataLite() đã đọc sẵn cột "FM Late Reason" (FM) và
  // "Type" (SOP) vào record.reason / record.type nhưng chưa từng được tổng hợp riêng
  // cho alert — kpiFail trước đây chỉ có TỔNG SỐ (totalFM/totalLM/totalSOP), không nói
  // được "vì sao" hay "loại nào". Đọc lại đúng records của HÔM NAY, gom top lý do/loại.
  try {
    if (!_skipDriverZoneDetail) hubs.forEach(function(h) {
      if (_overTimeBudget()) { if (_skippedByTimeBudget.indexOf(h) < 0) _skippedByTimeBudget.push(h); return; }
      try {
        var kfRaw = JSON.parse(kpifail_getMasterDataLite(h, 2));
        if (!kfRaw.success || !kfRaw.records || !kfRaw.records.length) return;
        var kfToday = kfRaw.records.filter(function(r) { return r.date === todayVN; });
        if (!kfToday.length) return;

        var fmReasons = {};
        kfToday.filter(function(r){ return r.category === 'FM' && r.reason; }).forEach(function(r) {
          fmReasons[r.reason] = (fmReasons[r.reason] || 0) + 1;
        });
        var sopTypes = {};
        kfToday.filter(function(r){ return r.category === 'SOP' && r.type; }).forEach(function(r) {
          sopTypes[r.type] = (sopTypes[r.type] || 0) + 1;
        });
        var lmRiders = {};
        kfToday.filter(function(r){ return r.category === 'LM' && r.raw && r.raw.riderId; }).forEach(function(r) {
          var rid = String(r.raw.riderId);
          lmRiders[rid] = (lmRiders[rid] || 0) + 1;
        });

        var toSortedArr = function(map, keyName) {
          return Object.keys(map).map(function(k) {
            var o = {}; o[keyName] = k; o.soLuong = map[k]; return o;
          }).sort(function(a,b){ return b.soLuong - a.soLuong; }).slice(0, 5);
        };
        var fmArr   = toSortedArr(fmReasons, 'lyDo');
        var sopArr  = toSortedArr(sopTypes,  'loai');
        var lmArr   = toSortedArr(lmRiders,  'riderId');
        if (fmArr.length || sopArr.length || lmArr.length) {
          result[h].kpiFailChiTietHomNay = {
            fmLateLyDoChinh: fmArr,
            sopLoaiChinh: sopArr,
            lmLateTheoRider: lmArr,
            ghi_chu: 'Breakdown lấy từ đúng dữ liệu KPI Fail của HÔM NAY (' + todayVN + ') — dùng để trả lời "vì sao" (nguyên nhân) và "rider nào" (LM Late), KHÔNG PHẢI ước tính.'
          };
        }
      } catch(eh) { _LOG.d('[AlertExtra] kpiFailChiTiet hub=' + h + ' error: ' + eh.message); }
    });
  } catch(e) { _LOG.d('[AlertExtra] kpiFailChiTiet error: ' + e.message); }

  // ── 3. GHI CHÚ ĐÃ XÁC NHẬN — đóng vòng lặp phản hồi ──
  // Trước đây logAIFeedback() chỉ GHI, không có gì ĐỌC lại — phản bác của sếp
  // rơi vào quên lãng, lần sau AI mắc lại y hệt lỗi cũ. Nay: admin vào sheet
  // AI_Feedback_Log, đổi cột "Trạng thái" của dòng đúng thành "đã xác nhận"
  // (thủ công, có chủ đích — tránh tự động tin mọi phản bác kể cả phản bác sai).
  // Các dòng đã xác nhận sẽ được đọc lại và đưa vào context mỗi lần phân tích,
  // để AI không lặp lại đúng lỗi đã được xác nhận là sai trước đó.
  try {
    if (!ssMaster) ssMaster = _DS.ss(MASTER_DB_ID);
    var fbSheet = ssMaster.getSheetByName('AI_Feedback_Log');
    if (fbSheet && fbSheet.getLastRow() > 1) {
      var fbValues = fbSheet.getRange(2, 1, fbSheet.getLastRow()-1, 6).getValues();
      var confirmedByHub = {};
      fbValues.forEach(function(row) {
        var status = String(row[5]||'').trim().toLowerCase();
        if (status !== 'đã xác nhận' && status !== 'da xac nhan') return; // chỉ lấy dòng đã được admin duyệt
        var hubScope = String(row[2]||'').trim();
        hubs.forEach(function(h) {
          // hubScope có thể là 1 hub hoặc danh sách nhiều hub cách nhau dấu phẩy (multi-hub AOM/SUP)
          if (hubScope.indexOf(h) < 0 && _normStationKey_(hubScope).indexOf(_normStationKey_(h)) < 0) return;
          if (!confirmedByHub[h]) confirmedByHub[h] = [];
          if (confirmedByHub[h].length < 5) { // giới hạn 5 ghi chú/hub, tránh phình context
            confirmedByHub[h].push(String(row[4]||'').trim()); // cột "Phản hồi của user"
          }
        });
      });
      hubs.forEach(function(h) {
        if (confirmedByHub[h] && confirmedByHub[h].length) {
          result[h].ghiChuDaXacNhan = confirmedByHub[h];
        }
      });
    }
  } catch(e) { _LOG.d('[AlertExtra] confirmed corrections error: ' + e.message); }

  // ── 4. FC LM NGÀY MAI + RIDER NGÀY MAI — nền tảng kế hoạch D+1 ──
  // FC LM (Last Mile forecast) ngày mai là số đơn dự kiến sẽ đến trạm D+1,
  // kết hợp với rider plan ngày mai → quản lý biết năng lực có đủ xử lý không,
  // có cần điều phối tăng ca / gọi thêm người không. Trước đây bị bỏ qua hoàn toàn.
  try {
    var tomorrowDate  = new Date(Date.now() + 86400000);
    var tomorrowVN    = Utilities.formatDate(tomorrowDate, 'GMT+7', 'yyyy-MM-dd');
    var tomorrowMonth = tomorrowVN.slice(0, 7);           // yyyy-MM
    var tomorrowYear  = Number(tomorrowVN.slice(0, 4));
    var tomorrowMon   = Number(tomorrowVN.slice(5, 7));
    var tomorrowDayIdx = Number(tomorrowVN.slice(8, 10)) - 1; // 0-based

    // FC LM: đọc từ sheet "FC (auto)" trong RP_SOURCE_ID
    var srcSSfc = _DS.ss(RP_SOURCE_ID);
    var fcMapTmr = _rp_buildFCMap(srcSSfc, tomorrowYear, tomorrowMon);

    // Rider plan ngày mai: đọc từ Rider_Plan_Driver trong ADMIN_DB_ID
    var riderTmrMap = {}; // { hubNorm: { tongSo, diLam, off } }
    var ssAdminTmr = _DS.ss(ADMIN_DB_ID);
    var rpdSheetTmr = ssAdminTmr.getSheetByName('Rider_Plan_Driver');
    if (rpdSheetTmr && rpdSheetTmr.getLastRow() > 1 && tomorrowDayIdx >= 0) {
      var rpdValsTmr = rpdSheetTmr.getRange(2, 1, rpdSheetTmr.getLastRow()-1, 3).getValues();
      rpdValsTmr.forEach(function(row) {
        var rowMonth = _rp_monthCellToStr(row[0]);
        if (rowMonth !== tomorrowMonth) return;
        var stNorm = _normStationKey_(String(row[1]||'').trim());
        if (!hubsNormSet[stNorm]) return;
        try {
          var parsed = JSON.parse(row[2] || '{}');
          var arr = Array.isArray(parsed) ? parsed : (parsed.drivers || []);
          var total = arr.length;
          var offTmr = arr.filter(function(d) {
            return Number((d.attendance || [])[tomorrowDayIdx]) === 1;
          }).length;
          riderTmrMap[stNorm] = { tongSo: total, diLam: total - offTmr, off: offTmr };
        } catch(pe) {}
      });
    }

    hubs.forEach(function(h) {
      var hn   = _normStationKey_(h);
      var fcKey = h + '|' + tomorrowVN;
      var fc   = fcMapTmr[fcKey] || { lm: 0, fm: 0 };
      var rdr  = riderTmrMap[hn] || null;
      if (fc.lm > 0 || fc.fm > 0 || rdr) {
        result[h].d1Plan = {
          ngay: tomorrowVN,
          fc_lm: fc.lm,       // đơn LM dự kiến ngày mai
          fc_fm: fc.fm,       // đơn FM dự kiến ngày mai
          fc_total: fc.lm + fc.fm,
          rider_ngay_mai: rdr || null,
          // fc_per_rider: để AI tự tính — tránh chia 0 nếu rdr null
          ghi_chu: 'fc_lm là số đơn Last Mile dự kiến đến trạm ngày D+1 (nguồn FC auto). Dùng để đánh giá tồn hôm nay có kịp xử lý không, và năng lực rider ngày mai có đủ không.'
        };
      }
    });
  } catch(e) { _LOG.d('[AlertExtra] d1Plan error: ' + e.message); }

  try { CacheService.getScriptCache().put(_ck, JSON.stringify(result), 180); } catch(ce) { /* cache write lỗi — bỏ qua, vẫn trả kết quả đã tính */ }

  if (_skipDriverZoneDetail) {
    result._ghiChuBoQuaChiTietDriver = 'Phạm vi có ' + hubs.length + ' hub — bỏ qua driver/zone hotspot + KPI Fail chi tiết cấp hub để tránh vượt giới hạn ký tự gửi AI; baseline/riderPlan/d1Plan vẫn đầy đủ cho mọi hub.';
  } else if (_skippedByTimeBudget.length) {
    // [FIX MỚI] Hết ngân sách thời gian giữa chừng (hệ thống đang tải chậm) — khác với
    // trường hợp trên (chủ động bỏ qua vì QUÁ NHIỀU hub), đây là bỏ qua BỊ ĐỘNG để kịp
    // trả lời trong 28s. baseline/riderPlan/d1Plan của các hub này vẫn còn nguyên (được
    // tính ở bước khác, không nằm trong 2 vòng lặp bị cắt) — chỉ thiếu phần driver/zone
    // hotspot + KPI Fail chi tiết cho riêng các hub bị cắt.
    var _skipNames = _skippedByTimeBudget.length <= 10
      ? _skippedByTimeBudget.join(', ')
      : _skippedByTimeBudget.slice(0, 10).join(', ') + ' và ' + (_skippedByTimeBudget.length - 10) + ' hub khác';
    result._ghiChuBoQuaChiTietDriver = 'Hệ thống đang tải chậm hơn bình thường — đã bỏ qua driver/zone hotspot + KPI Fail chi tiết cho: ' + _skipNames + ' (để kịp trả lời trong thời gian cho phép). Backlog/aging/lost/baseline/riderPlan của các hub này vẫn đầy đủ, không bị ảnh hưởng — PHẢI nói rõ với sếp là thiếu đúng phần chi tiết driver/zone này, không suy diễn thêm.';
  }
  return { data: result, thoiGianHienTai: thoiGianHienTai };
}

/**
 * getAlertExtraContext(hubsJson)
 * ------------------------------------------------------------------
 * [GIỮ NGUYÊN API CŨ] — nay chỉ là wrapper gọi _gatherAlertExtra_() rồi
 * JSON.stringify lại, để bất kỳ chỗ nào khác còn gọi hàm này trực tiếp
 * (qua google.script.run) vẫn chạy đúng như trước, không phải sửa gì thêm.
 * Đường MỚI cho Alert Drawer là alert_getFullAnalysis() bên dưới — gộp
 * bước này với bước gọi AI thành 1 round-trip duy nhất.
 *
 * Input: hubsJson = JSON string mảng tên trạm cần lấy.
 * Trả về: { success, data: { [hub]: { baseline, riderPlan, todaySynced, d1Plan, ghiChuDaXacNhan } }, thoiGianHienTai }
 */
function getAlertExtraContext(hubsJson) {
  try {
    var hubs = JSON.parse(hubsJson || '[]');
    if (!Array.isArray(hubs) || !hubs.length) return JSON.stringify({ success: false, data: {} });
    var gathered = _gatherAlertExtra_(hubs);
    return JSON.stringify({ success: true, data: gathered.data, thoiGianHienTai: gathered.thoiGianHienTai });
  } catch(e) {
    return JSON.stringify({ success: false, data: {}, error: e.message });
  }
}

/**
 * alert_getFullAnalysis(payload)
 * ------------------------------------------------------------------
 * [MỚI] Gộp 2 round-trip tuần tự cũ (getAlertExtraContext → ana_askMascotAssistant,
 * tổng cộng có lúc tới ~35s và có thể âm thầm rớt mất baseline/d1Plan nếu bước 1
 * timeout 10s phía client) thành ĐÚNG 1 lần gọi server. Backend tự lấy dữ liệu bổ
 * sung (_gatherAlertExtra_, có cache 180s) rồi merge vào ctx trước khi gọi AI, nên
 * client chỉ cần chờ 1 request duy nhất — vừa nhanh hơn, vừa không còn tình trạng
 * thiếu forecast ngày mai / số liệu onhold hôm nay do timeout ở bước trung gian.
 *
 * payload = { ctxJson: string (JSON của ctx do _buildAlertContext tạo ở client),
 *             question: string, skipCache: boolean }
 * return: { success, text, fromCache?, extra: {[hub]:{...}}, thoiGianHienTai }
 *   (giữ đúng shape trả về của ana_askMascotAssistant, cộng thêm 'extra' +
 *   'thoiGianHienTai' để client merge vào ctx dùng cho các lượt hỏi tiếp theo
 *   trong thread mà không phải gọi lại _gatherAlertExtra_).
 */
function alert_getFullAnalysis(payload) {
  try {
    if (!payload || !payload.ctxJson) return { success: false, text: 'Thiếu context.' };
    var ctx = JSON.parse(payload.ctxJson);
    var allHubEntries = Array.isArray(ctx.hubs) ? ctx.hubs : [];
    var hubs = allHubEntries.map(function(h){ return h.hub; });

    // [MỚI 06/07] SUP/AOM quản nhiều trạm (có thể tới ~50) — trước đây _gatherAlertExtra_
    // luôn đọc THẬT Station_Daily/Rider_Plan_Driver/AI_Feedback_Log/FC cho TỪNG hub trong
    // toàn bộ phạm vi, kể cả hub đang hoàn toàn bình thường theo số liệu thô đã có sẵn
    // trong ctx.hubs (lostToday/backlog/aging_phan_bo/fmsQua3Ca — client tính xong, KHÔNG
    // cần đọc thêm gì để biết hub đó "sạch"). Với nhiều hub, phần lớn thời gian + quota
    // Sheets API bị tốn vào việc lấy baseline/kế hoạch D+1 CHI TIẾT cho những hub mà kết
    // quả cuối cùng cũng chẳng có gì đáng nói.
    // KHÔNG lọc khỏi ctx.hubs (AI vẫn thấy đủ số liệu thô của MỌI hub — giữ đúng triết lý
    // "không để code tự kết luận trước" đã ghi ở _buildAlertContext), CHỈ lọc bớt hub nào
    // được đưa vào bước ENRICH (baseline/riderPlan/d1Plan/driverHotspot/kpiFailChiTiet) —
    // dùng lại NGUYÊN VẸN _mascotSeverityScore_ (đã có sẵn, dùng để ưu tiên giữ hub khi
    // cắt context) làm tiêu chí "có dấu hiệu bất thường hay không", để 2 nơi (lọc enrich ở
    // đây và chip tổng quan tốt/xấu ở client) LUÔN khớp nhau, không lệch tiêu chí.
    // Ngưỡng 8 hub: dưới mức đó gather đủ vẫn rẻ, không cần lọc.
    var hubsForEnrich = hubs;
    var skippedEnrichHubs = [];
    if (allHubEntries.length > 8) {
      var enrichList = [];
      allHubEntries.forEach(function(h) {
        if (_mascotSeverityScore_(h) > 0) enrichList.push(h.hub);
        else skippedEnrichHubs.push(h.hub);
      });
      hubsForEnrich = enrichList; // có thể rỗng nếu cả phạm vi đang ổn — không sao, không có gì cần enrich thật
    }

    var gathered = _gatherAlertExtra_(hubsForEnrich);
    // [FIX] Đọc Alert_Aggregate 1 LẦN cho TOÀN BỘ hub trong phạm vi, TRƯỚC vòng lặp —
    // xem lý do đầy đủ ở comment của _alertGetLastResolvedSnapshotsBulk_() bên dưới.
    // (Giữ nguyên TOÀN BỘ hub ở đây, không dùng hubsForEnrich — đây chỉ là 1 lần đọc bulk
    // rẻ, không phải vòng lặp per-hub như _gatherAlertExtra_, nên không cần lọc bớt.)
    var _resolvedMapBulk = _alertGetLastResolvedSnapshotsBulk_(hubs, 20);
    // [MỚI — theo yêu cầu trực tiếp "hub A tồn thì điều nhân sự từ hub B/C gần
    // đó được không"] Tập hợp tên hub NẰM TRONG PHẠM VI QUYỀN của user đang hỏi
    // (chính là các hub đã có trong ctx.hubs) — dùng để quyết định hub lân cận
    // nào được kèm SỐ LIỆU THẬT, hub nào chỉ được nêu TÊN + KHOẢNG CÁCH.
    // KHÔNG được lộ số liệu vận hành của hub NGOÀI quyền user, dù có gần về mặt
    // địa lý — đây là ranh giới phân quyền, không phải giới hạn kỹ thuật.
    var _hubsInScope = {};
    ctx.hubs.forEach(function(hh) { _hubsInScope[_orgNormHub_(hh.hub)] = true; });
    ctx.hubs.forEach(function(h) {
      var e = gathered.data[h.hub];
      if (!e) return;
      if (e.baseline)      h.baseline      = e.baseline;
      if (e.riderPlan)     h.riderPlan     = e.riderPlan;
      if (e.d1Plan)        h.d1Plan        = e.d1Plan;
      if (e.todaySynced)   h.todaySynced   = e.todaySynced;
      if (e.ghiChuDaXacNhan && e.ghiChuDaXacNhan.length) h.ghiChuDaXacNhan = e.ghiChuDaXacNhan;
      // [BỔ SUNG] Gộp nốt các field mới (driver/zone hotspot, nguyên nhân KPI Fail chi tiết)
      // — trước đây các field này được _gatherAlertExtra_ tính ra nhưng KHÔNG được merge
      // vào ctx.hubs nên AI không bao giờ thấy được, dù dữ liệu đã tính xong.
      if (e.driverHotspot && e.driverHotspot.length) h.driverHotspot = e.driverHotspot;
      if (e.zoneHotspot && e.zoneHotspot.length) {
        h.zoneHotspot = e.zoneHotspot;
        h.zoneHotspotGhiChu = e.zoneHotspotGhiChu;
      }
      if (e.kpiFailChiTietHomNay) h.kpiFailChiTietHomNay = e.kpiFailChiTietHomNay;

      // [MỚI] Trạm gần nhất về ĐỊA LÝ (bán kính 30km, tối đa 3 trạm) — tính SẴN
      // bằng code (Haversine), AI KHÔNG tự đoán khoảng cách từ toạ độ thô.
      try {
        var _nearby = _spxGetNearbyHubs_(h.hub, 30, 3);
        if (_nearby.length) {
          h.tram_gan_theo_dia_ly = _nearby.map(function (n) {
            var inScope = _hubsInScope[_orgNormHub_(n.ten)];
            return inScope
              ? { ten: n.ten, khoang_cach_km: n.km, co_du_lieu_van_hanh: true }
              : { ten: n.ten, khoang_cach_km: n.km, co_du_lieu_van_hanh: false,
                  ghi_chu: 'Ngoài phạm vi quyền của user đang hỏi — KHÔNG có số liệu vận hành, chỉ biết vị trí địa lý.' };
          });
          h.ghi_chu_tram_gan = 'Chỉ là khoảng cách địa lý (đường chim bay) — KHÔNG phải số nhân sự thực đang trực. ' +
            'Với trạm co_du_lieu_van_hanh=true, đối chiếu số liệu thật của trạm đó trong chính mảng hubs. ' +
            'Đề xuất điều động nhân sự PHẢI nêu rõ là GỢI Ý THAM KHẢO (không có dữ liệu ai đang rảnh thực tế lúc này), không khẳng định chắc chắn.';
        }
      } catch (eNear) { /* thiếu toạ độ hoặc lỗi đọc HubSOC infor -> bỏ qua, không chặn phần còn lại */ }

      // [BỔ SUNG] Mục VIII (Hiệu quả): đối chiếu số liệu lúc resolve gần nhất với số liệu
      // HIỆN TẠI đang có trong h (backlog/lostToday/avgAgingDays do client gửi lên qua
      // _buildAlertContext) — tính CHÊNH LỆCH thẳng bằng code (không để AI tự trừ, tránh
      // sai số học), chỉ gắn field khi có alert đã resolved kèm snapshot trong ~1 ca gần đây.
      try {
        var lastResolved = _resolvedMapBulk[_normStationKey_(h.hub)];
        if (lastResolved && lastResolved.snapshot) {
          var snap = lastResolved.snapshot;
          h.ketQuaXuLyTruoc = {
            vanDeDaXuLy: lastResolved.message,
            lucResolveLuc: lastResolved.resolvedAt,
            lucResolve: { backlog: snap.backlog, avgAgingDays: snap.avgAgingDays, kpiFailChuaGiaiTrinh: snap.kpiFailChuaGiaiTrinh },
            hienTai:    { backlog: h.backlog || 0, avgAgingDays: h.avgAgingDays || 0 },
            chenhLech: {
              backlog: (h.backlog || 0) - (snap.backlog || 0),
              avgAgingDays: Math.round(((h.avgAgingDays || 0) - (snap.avgAgingDays || 0)) * 10) / 10
            },
            ghi_chu: 'Số âm ở chenhLech nghĩa là ĐÃ GIẢM (cải thiện) so với lúc resolve; số dương nghĩa là TĂNG LẠI (xấu đi) sau khi đã xử lý.'
          };
        }
      } catch(eKq) { _LOG.d('[AlertFullAnalysis] ketQuaXuLyTruoc hub=' + h.hub + ' error: ' + eKq.message); }
    });
    ctx.thoi_gian_hien_tai = gathered.thoiGianHienTai;
    if (gathered.data._ghiChuBoQuaChiTietDriver) ctx.ghi_chu_bo_qua_chi_tiet_driver = gathered.data._ghiChuBoQuaChiTietDriver;
    // [MỚI 06/07] Minh bạch với AI (và qua đó là với sếp) về việc hub nào KHÔNG được lấy
    // thêm baseline/kế hoạch D+1 do đang sạch theo số liệu thô — để AI không im lặng bỏ
    // qua mà phải nói rõ "N trạm này số liệu thô đang bình thường, chưa lấy thêm chi tiết".
    if (skippedEnrichHubs.length) {
      var _skipTxt = skippedEnrichHubs.length <= 12
        ? skippedEnrichHubs.join(', ')
        : skippedEnrichHubs.slice(0, 12).join(', ') + ' và ' + (skippedEnrichHubs.length - 12) + ' trạm khác';
      ctx.ghi_chu_bo_qua_enrich = skippedEnrichHubs.length + ' trạm có số liệu thô đang bình thường ' +
        '(không lost/backlog/aging quá hạn/FMS quá ca) nên KHÔNG lấy thêm baseline/kế hoạch D+1 ' +
        'chi tiết để giảm tải đọc dữ liệu — vẫn có đủ số liệu thô của các trạm này ở trên, không phải ' +
        'bị bỏ sót: ' + _skipTxt;
    }

    var mscResult = ana_askMascotAssistant({
      // [SỬA] Truyền CẤP người dùng xuống, để AI viết đúng tầm người đọc
      // (Lead nhận chỉ đạo từng đơn; ROM nhận bức tranh vùng).
      viewLevel:    payload.viewLevel || '',
      question:     payload.question || 'Tình hình ca vận hành hiện tại thế nào? Đâu là điểm nóng cần xử lý ngay?',
      context:      ctx,
      skipCache:    !!payload.skipCache,
      // [SỬA — phát hiện khi nối luồng gõ tự do vào hàm này] TRƯỚC ĐÂY hardcode
      // true với lý do "bấm chuông là hành động 1 lần, đã chặn phía client" —
      // đúng cho luồng chuông, nhưng hàm này giờ CÒN được gọi từ Ô GÕ TỰ DO
      // (mascotAskAI), nơi debounce 5 giây tồn tại ĐÚNG để chặn double-click/
      // double-Enter — hardcode true ở đây sẽ ÂM THẦM TẮT MẤT bảo vệ đó cho ô
      // gõ. Nay để bên gọi tự quyết định qua payload.skipDebounce — luồng
      // chuông (dưới đây) vẫn truyền true như cũ, hành vi không đổi; ô gõ tự
      // do không truyền gì → mặc định false → giữ nguyên debounce như trước.
      skipDebounce: !!payload.skipDebounce
    });

    mscResult.extra = gathered.data;
    mscResult.thoiGianHienTai = gathered.thoiGianHienTai;
    return mscResult;
  } catch(e) {
    return { success: false, text: 'Lỗi hệ thống: ' + e.message };
  }
}

/**
 * alert_seedTest() — chạy 1 lần thủ công để test luồng alert_getForStation.
 * Tạo 3 alert mẫu (severity 3/2/1) cho trạm của user hiện tại.
 * Xoá bằng cách xoá dòng trong sheet Alert_Aggregate sau khi test xong.
 */
/**
 * logAIFeedback(payload)
 * ------------------------------------------------------------------
 * Ghi lại khi user phản bác 1 kết quả phân tích AI (bấm "Thấy sai?").
 * Mục đích: có dấu vết thật để sau này xem lại AI hay sai ở đâu, không
 * phải để AI "học" ngay lập tức (không có cơ chế fine-tune ở đây) —
 * chỉ là audit trail + cho phép AI tự điều chỉnh NGAY trong phiên hiện
 * tại khi được gọi lại kèm phản hồi (xem alert_loadSnapshot ở client).
 *
 * payload: { hub, originalText, feedbackNote, userEmail }
 */
function logAIFeedback(payload) {
  try {
    var ss = _DS.ss(MASTER_DB_ID);
    var sheet = ss.getSheetByName('AI_Feedback_Log');
    if (!sheet) {
      sheet = ss.insertSheet('AI_Feedback_Log');
      sheet.appendRow(['Timestamp', 'User', 'Hub/Scope', 'Nội dung AI (bị phản bác)', 'Phản hồi của user', 'Trạng thái']);
      sheet.setFrozenRows(1);
      sheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    }
    var now = Utilities.formatDate(new Date(), 'GMT+7', "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([
      now,
      payload.userEmail || Session.getActiveUser().getEmail(),
      payload.hub || '',
      (payload.originalText || '').replace(/<[^>]+>/g, '').substring(0, 500), // bỏ HTML tag, giới hạn độ dài
      (payload.feedbackNote || '').substring(0, 300),
      'chưa review'
    ]);
    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

function alert_seedTest() {
  var email  = Session.getActiveUser().getEmail();
  var srcSS  = _DS.ss(RP_SOURCE_ID);
  var sa     = _rp_lookupSA(email, srcSS);
  var station = (sa && sa.hubs && sa.hubs.length > 0) ? sa.hubs[0] : '45-DLK Krong Pak 02 Hub';
  _pushAlert_({ stationName: station, source: 'kpifail', severity: 3, entityRef: 'SPXVN_TEST001', message: '[TEST] KPI Fail chưa giải trình — quá 24h' });
  _pushAlert_({ stationName: station, source: 'fms',     severity: 2, entityRef: '',              message: '[TEST] FMS tồn đọng 8 đơn quá ca' });
  _pushAlert_({ stationName: station, source: 'aging',   severity: 1, entityRef: 'SPXVN_TEST002', message: '[TEST] Quá hạn đã ghi note xử lý' });
  return 'Đã seed 3 alert test cho trạm: ' + station;
}

/**
 * alert_resolve(stationName, entityRef, resolvedBy)
 * Đánh dấu alert đã xử lý (status: 'open' → 'resolved').
 *
 * [BỔ SUNG] Đóng vòng lặp mục VIII (Hiệu quả sau xử lý) — trước đây chỉ ghi
 * ai/lúc nào resolve, KHÔNG lưu số liệu tại thời điểm đó nên lần phân tích sau
 * không có gì để so sánh "có cải thiện không". Nay TỰ CHỤP snapshot backlog/
 * aging/KPI Fail/lost ngay tại thời điểm resolve (không cần frontend truyền
 * thêm gì — gọi lại đúng 2 hàm summary đã có sẵn) và lưu vào cột 11 (JSON).
 */
function alert_resolve(stationName, entityRef, resolvedBy) {
  try {
    // [SECURITY FIX 2026-08] 2 lỗi trong hàm này:
    // (1) Không kiểm tra quyền — ai cũng "resolve" được cảnh báo của bất kỳ trạm nào.
    // (2) Tin thẳng chuỗi resolvedBy do CLIENT gửi lên để ghi vào log audit — có thể
    //     giả mạo tên người xử lý. Nay bắt buộc kiểm tra quyền theo trạm, và LUÔN lấy
    //     danh tính thật từ Session.getActiveUser() thay vì tham số resolvedBy (tham
    //     số này vẫn được nhận cho tương thích ngược nhưng bị bỏ qua khi ghi log).
    var _access = getModuleAccess();
    if (_access.role === 'denied') return JSON.stringify({ success: false, error: 'Không có quyền truy cập.' });
    if (_access.role !== 'admin' && (_access.hubs || []).map(function(h){ return _normStationKey_(h); }).indexOf(_normStationKey_(stationName)) === -1) {
      return JSON.stringify({ success: false, error: 'Không có quyền xử lý cảnh báo của trạm này.' });
    }
    var _resolvedByReal = _access.email || Session.getActiveUser().getEmail() || 'unknown';

    var sheet   = _alertAggSheet_();
    var stKey   = _normStationKey_(stationName);
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;
    var data    = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var now     = Utilities.formatDate(new Date(), 'GMT+7', "yyyy-MM-dd'T'HH:mm:ss");

    // Chụp snapshot 1 LẦN cho trạm này (dùng chung cho mọi dòng khớp trong vòng lặp,
    // vì đều đang resolve cùng 1 thời điểm) — tránh gọi lặp lại 2 hàm summary nhiều lần.
    var snapshotJson = '';
    try {
      var agingSnap = JSON.parse(aging_getIndexSummary(stationName) || '{}');
      var kpiSnap   = JSON.parse(kpifail_getIndexSummary(stationName) || '{}');
      snapshotJson = JSON.stringify({
        luc: now,
        backlog:        agingSnap.overdueCount    || 0,
        lostChuaChot:   agingSnap.closedLostCount || 0,
        avgAgingDays:   agingSnap.avgAgingDays     || 0,
        kpiFailTong:    kpiSnap.totalFail          || 0,
        kpiFailChuaGiaiTrinh: kpiSnap.unresolvedCount || 0
      });
    } catch(es) { _LOG.d('[Alert] alert_resolve snapshot error: ' + es.message); }

    data.forEach(function(row, i) {
      if (_normStationKey_(row[2]) !== stKey) return;
      if (String(row[5]) !== String(entityRef)) return;
      if (row[7] === 'resolved') return;
      sheet.getRange(i + 2, 8, 1, 3).setValues([['resolved', now, _resolvedByReal]]);
      if (snapshotJson) sheet.getRange(i + 2, 11).setValue(snapshotJson);
    });

    // [2026-07] Đồng bộ Firestore alerts_active/{stKey} — gỡ alert vừa resolve
    // khỏi mảng đang mở để client real-time thấy ngay, không đợi vòng poll tới.
    _alertFsResolve_(stKey, entityRef);
  } catch(e) {
    _LOG.d('[Alert] alert_resolve error: ' + e.message);
  }
}

/**
 * _alertGetLastResolvedSnapshotsBulk_(stationNames, withinHours)
 * ------------------------------------------------------------------
 * [FIX] Đọc sheet Alert_Aggregate 1 LẦN DUY NHẤT cho TOÀN BỘ hub cần tra —
 * thay cho việc gọi _alertGetLastResolvedSnapshot_() RIÊNG cho từng hub trong
 * vòng lặp ctx.hubs.forEach (xem alert_getFullAnalysis). Với user 1 trạm thì
 * không khác biệt (vẫn 1 lần đọc), nhưng với SUP/AOM quản hàng chục trạm —
 * cách cũ đọc lại NGUYÊN VẸN sheet Alert_Aggregate (có thể hàng nghìn dòng)
 * lặp lại 20-90 lần liên tiếp (mỗi hub 1 lần gọi getRange().getValues() —
 * 1 lần gọi Sheets API thật, không phải đọc từ bộ nhớ) — tổng thời gian cộng
 * dồn có thể vượt quá timeout phía client (~25-35s, xem ghi chú alert_loadSnapshot
 * ở index_fixed.html), khiến CẢ YÊU CẦU bị huỷ và SUP/AOM không nhận được
 * phân tích nào, dù dữ liệu hoàn toàn có thật — đây chính là nguyên nhân
 * "SUP quản lý nhiều trạm không có dữ liệu phản hồi". Nay chỉ đọc 1 lần
 * O(số dòng sheet), không phụ thuộc số hub đang quản lý.
 * @return {object} map: stationKey (đã chuẩn hoá) → { message, resolvedAt, snapshot }
 */
function _alertGetLastResolvedSnapshotsBulk_(stationNames, withinHours) {
  var result = {};
  try {
    withinHours = withinHours || 20;
    var sheet   = _alertAggSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return result;
    var wantedSet = Object.create(null);
    (stationNames || []).forEach(function(s) { wantedSet[_normStationKey_(s)] = true; });
    var cutoff = new Date(Date.now() - withinHours * 3600 * 1000);
    var data = sheet.getRange(2, 1, lastRow - 1, 11).getValues(); // 1 LẦN cho toàn bộ hub
    var bestRaw = {}; // stationKey → { ..., _t }
    data.forEach(function(row) {
      var stKey = _normStationKey_(row[2]);
      if (!wantedSet[stKey]) return; // ngoài phạm vi đang hỏi — bỏ qua, không tốn thêm gì
      if (row[7] !== 'resolved') return;
      if (!row[10]) return; // không có snapshot (alert cũ trước khi có bổ sung này)
      var resolvedAt = new Date(row[8]);
      if (isNaN(resolvedAt) || resolvedAt < cutoff) return;
      var cur = bestRaw[stKey];
      if (!cur || resolvedAt > cur._t) {
        bestRaw[stKey] = { message: row[6] || '', resolvedAt: Utilities.formatDate(resolvedAt, 'GMT+7', 'HH:mm dd/MM'), snapshotRaw: row[10], _t: resolvedAt };
      }
    });
    Object.keys(bestRaw).forEach(function(k) {
      try {
        var snap = JSON.parse(bestRaw[k].snapshotRaw);
        result[k] = { message: bestRaw[k].message, resolvedAt: bestRaw[k].resolvedAt, snapshot: snap };
      } catch(pe) { /* snapshot hỏng — bỏ qua đúng hub đó, không ảnh hưởng hub khác */ }
    });
  } catch(e) {
    _LOG.d('[Alert] _alertGetLastResolvedSnapshotsBulk_ error: ' + e.message);
  }
  return result;
}

/**
 * _alertGetLastResolvedSnapshot_(stationName, withinHours)
 * ------------------------------------------------------------------
 * [GIỮ NGUYÊN — dùng cho nơi khác chỉ cần tra 1 hub đơn lẻ, không phải vòng lặp]
 * Đọc lại alert 'resolved' GẦN NHẤT của 1 trạm (trong withinHours giờ
 * gần đây, mặc định 20h ~ 1 ca) có kèm snapshot số liệu tại thời điểm resolve —
 * dùng để so sánh với số liệu HIỆN TẠI, trả lời mục VIII (Hiệu quả).
 * [LƯU Ý] Nếu cần tra NHIỀU hub cùng lúc (VD trong 1 forEach), dùng
 * _alertGetLastResolvedSnapshotsBulk_() ở trên thay vì gọi hàm này lặp lại
 * nhiều lần — mỗi lần gọi hàm này là 1 lượt đọc TOÀN BỘ sheet Alert_Aggregate.
 * @return {object|null} { message, resolvedAt, snapshot }
 */
function _alertGetLastResolvedSnapshot_(stationName, withinHours) {
  try {
    withinHours = withinHours || 20;
    var sheet   = _alertAggSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;
    var stKey   = _normStationKey_(stationName);
    var cutoff  = new Date(Date.now() - withinHours * 3600 * 1000);
    var data    = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
    var best = null;
    data.forEach(function(row) {
      if (_normStationKey_(row[2]) !== stKey) return;
      if (row[7] !== 'resolved') return;
      if (!row[10]) return; // không có snapshot (alert cũ trước khi có bổ sung này)
      var resolvedAt = new Date(row[8]);
      if (isNaN(resolvedAt) || resolvedAt < cutoff) return;
      if (!best || resolvedAt > best._t) {
        best = { message: row[6] || '', resolvedAt: Utilities.formatDate(resolvedAt, 'GMT+7', 'HH:mm dd/MM'), snapshotRaw: row[10], _t: resolvedAt };
      }
    });
    if (!best) return null;
    try { best.snapshot = JSON.parse(best.snapshotRaw); } catch(pe) { return null; }
    delete best.snapshotRaw; delete best._t;
    return best;
  } catch(e) {
    _LOG.d('[Alert] _alertGetLastResolvedSnapshot_ error: ' + e.message);
    return null;
  }
}


// ════════════════════════════════════════════════════════════════════════════

/**
 * checkAnalyticsPermission(email)
 * ------------------------------------------------------------
 * Trước đây đọc từ sheet "UserPermission" (MASTER_DB_ID) — một nguồn dữ liệu
 * thứ hai độc lập với SA/DS Nhân viên, dễ lệch khi một bên được cập nhật mà
 * bên kia không. Nay thống nhất về 1 nguồn duy nhất: sheet SA + DS Nhân viên
 * trong RP_SOURCE_ID (cùng nguồn mà getModuleAccess/loadAllData đang dùng).
 *
 * Kiểu trả về GIỮ NGUYÊN { allowed, stations } để không phải sửa bất kỳ
 * chỗ gọi nào trong toàn bộ backend.gs và Analytics_Block.html.
 *
 * [2026-06] Wrapper gọi lại _rp_lookupSA() thay vì tự đọc sheet riêng.
 */
function checkAnalyticsPermission(email) {
  try {
    var em = (email || '').toString().trim().toLowerCase();
    if (!em) return { allowed: false, stations: [] };

    // Admin: trả về TẤT CẢ hub thật từ sheet AOM SUP → picker hoạt động bình thường
    // (≥2 trạm → hiện picker chọn trạm, giống AOM nhiều trạm)
    var adminMapCAP = _admin_getAdminMap();
    if (adminMapCAP[em]) {
      var allHubs = _rp_getAllHubsFromSA();
      return { allowed: true, stations: allHubs, isAdmin: true };
    }

    // [SỬA LỖI THẬT — báo cáo: sau khi sửa phân quyền, user không tải được danh
    // sách trạm ("Chưa chọn Hub" / "Hub list not loaded yet")]
    // Lượt trước em chỉ chuyển getModuleAccess() sang nguồn tổ chức chính thức,
    // còn hàm này VẪN đọc nguồn cũ -> user đăng nhập được (cấp bậc đúng) nhưng
    // danh sách trạm rỗng vì tên họ không có trong nguồn cũ. Phải dùng CÙNG
    // nguồn ở mọi đường, nếu không sẽ luôn lệch như vậy.
    var sa = null;
    try {
      var _orgMapCAP = _spxBuildOrgAccessMap_();
      var _meCAP = (_orgMapCAP && _orgMapCAP.byEmail) ? _orgMapCAP.byEmail[em] : null;
      if (_meCAP && _meCAP.stations && _meCAP.stations.length) {
        sa = { role: (String(_meCAP.role || '').toUpperCase() === 'AOM') ? 'aom'
                   : (String(_meCAP.role || '').toUpperCase() === 'SUP') ? 'sup' : 'station',
               hubs: _meCAP.stations.slice(), title: _meCAP.position || null };
      }
    } catch (eOrgCAP) {}
    if (!sa) {
      var srcSS = _DS.ss(RP_SOURCE_ID);
      sa = _rp_lookupSA(em, srcSS);
    }

    // [MỚI — phân cấp ROM] Kiểm tra ROM TRƯỚC khi kết luận "không có quyền".
    // Lý do đặt ở đây: ROM không tồn tại trong sheet nguồn (sheet chỉ có cột
    // AOM_Email/Sup_Email), nên _rp_lookupSA() luôn trả rỗng cho ROM -> trước
    // đây ROM bị chặn hoàn toàn, dù giao diện có sẵn nút xem thử "L1-ROM".
    // Phạm vi ROM = hợp các trạm của mọi AOM mà ROM đó quản (suy ra động).
    var _romScope = _rom_getScope(em);
    if (_romScope.isRom && _romScope.stations.length) {
      return {
        allowed:  true,
        stations: _romScope.stations,
        isRom:    true,
        role:     'rom',
        aomEmails: _romScope.aomEmails
      };
    }

    if (!sa || !sa.hubs || sa.hubs.length === 0) {
      return { allowed: false, stations: [] };
    }
    return { allowed: true, stations: sa.hubs };
  } catch(err) {
    return { allowed: false, stations: [], error: err.message };
  }
}

/**
 * migrateYellowToSA()
 * ------------------------------------------------------------
 * Đọc tất cả dòng VÀNG trong UserPermission (trạm có trong UserPermission
 * nhưng THIẾU trong SA), thêm các dòng còn thiếu vào sheet SA.
 * KHÔNG xoá, KHÔNG ghi đè dòng đã có — chỉ APPEND dòng mới.
 *
 * Chạy thủ công 1 lần: Apps Script Editor → chọn hàm này → Run.
 * Sau khi chạy xong, chạy lại auditUserPermissionVsSA() để xác nhận
 * tất cả vàng đã chuyển xanh trước khi xoá UserPermission.
 */
function migrateYellowToSA() {
  // [SECURITY FIX 2026-08] Hàm ghi dòng mới vào sheet SA (nguồn phân quyền hub cho
  // toàn hệ thống) — trước đây không kiểm tra quyền, ai gọi cũng chèn được dòng
  // "MIGRATED" giả vào SA. Chỉ admin mới được chạy công cụ di trú 1 lần này.
  _requireAdmin_(2);
  var ss    = _DS.ss(MASTER_DB_ID);
  var upSheet = ss.getSheetByName('UserPermission') || ss.getSheets()[0];
  var upData  = upSheet.getDataRange().getValues();
  var srcSS   = _DS.ss(RP_SOURCE_ID);
  var saSheet = srcSS.getSheetByName('AOM SUP') || srcSS.getSheetByName('SA');
  if (!saSheet) { _LOG.d('Không tìm thấy sheet AOM SUP hoặc SA'); return; }

  // Gom hub hiện có trong SA theo email (AOM+SUP)
  var saData = saSheet.getDataRange().getValues();
  var saHubsByEmail = {};
  for (var r = 1; r < saData.length; r++) {
    var hub = String(saData[r][RP_SA_COL_HUB] || '').trim();
    if (!hub) continue;
    var ae = String(saData[r][RP_SA_COL_AOM_EMAIL] || '').toLowerCase().trim();
    var se = String(saData[r][RP_SA_COL_SUP_EMAIL] || '').toLowerCase().trim();
    [ae, se].forEach(function(em) {
      if (!em) return;
      if (!saHubsByEmail[em]) saHubsByEmail[em] = [];
      if (saHubsByEmail[em].indexOf(hub) < 0) saHubsByEmail[em].push(hub);
    });
  }

  // Tìm các dòng vàng (ô background vàng) trong UserPermission
  var rowColors = upSheet.getRange(2, 1, upData.length - 1, 1).getBackgrounds();
  var newRows = []; var migrated = 0;

  for (var i = 1; i < upData.length; i++) {
    var bg = rowColors[i - 1][0];
    if (bg !== '#ffeb9c' && bg !== '#FFEB9C') continue; // chỉ xử lý dòng vàng
    var em2 = (upData[i][0] || '').toString().trim().toLowerCase();
    var upStations = ((upData[i][1] || '').toString().trim())
      .split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    var saHubs = saHubsByEmail[em2] || [];
    var saHubsNorm = saHubs.map(function(s){ return _normStationKey_(s); });
    // Chỉ thêm các trạm có trong UserPermission nhưng CHƯA CÓ trong SA
    upStations.forEach(function(hub) {
      if (saHubsNorm.indexOf(_normStationKey_(hub)) < 0) {
        // Append dòng mới: tạm để trống các cột không biết, điền hub
        var row = new Array(Math.max(9, RP_SA_COL_HUB + 1)).fill('');
        row[RP_SA_COL_HUB] = hub;
        row[RP_SA_COL_AOM_EMAIL] = em2; // gán tạm vào AOM email, admin điều chỉnh sau
        row[0] = 'MIGRATED'; // đánh dấu để admin review
        newRows.push(row);
        migrated++;
      }
    });
  }

  if (newRows.length > 0) {
    saSheet.getRange(saSheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
      .setValues(newRows)
      .setBackground('#FFF2CC'); // tô vàng nhạt để admin dễ nhận ra dòng vừa migrate
  }

  var msg = 'Migrate xong: thêm ' + migrated + ' dòng vào SA (đánh dấu MIGRATED).\n' +
    'Anh kiểm tra lại các dòng vàng nhạt trong sheet SA (điều chỉnh AOM/SUP email nếu cần),\n' +
    'sau đó chạy lại auditUserPermissionVsSA() để xác nhận trước khi xoá UserPermission.';
  _LOG.d(msg);
  // Standalone script → getUi() luôn lỗi. Xem log qua Execution log.
  return msg;
}

/**
 * deleteUserPermissionSheet(confirmToken)
 * ------------------------------------------------------------
 * Bước CUỐI — chỉ chạy sau khi:
 *   1. migrateYellowToSA() đã chạy và admin đã xác nhận dòng SA đúng.
 *   2. 9 dòng đỏ đã được xử lý (thêm vào SA hoặc xác nhận đã nghỉ việc).
 *   3. auditUserPermissionVsSA() chạy lại và CHỈ còn màu xanh + cam.
 * Hàm này xoá sheet UserPermission và ghi log để có vết.
 *
 * [FIX] Không dùng SpreadsheetApp.getUi().alert() để hỏi Yes/No nữa — đây là
 * standalone script (mở sheet qua openById(MASTER_DB_ID), không bound vào 1
 * Sheet cố định) nên getUi() luôn ném lỗi "Cannot call SpreadsheetApp.getUi()
 * from this context", hàm sẽ dừng NGAY TRƯỚC khi chạm tới deleteSheet() —
 * tức là trước đây hàm này CHƯA BAO GIỜ xoá được gì nếu gọi theo cách thông
 * thường (luôn crash ở bước hỏi). Để vẫn giữ nguyên tinh thần "phải xác nhận
 * rõ ràng mới xoá" (không xoá nhầm), giờ thay bằng: bắt buộc truyền đúng
 * chuỗi xác nhận làm tham số. Chạy trong Apps Script Editor bằng cách gọi:
 *   deleteUserPermissionSheet('CONFIRM_DELETE_USERPERMISSION')
 * Gọi không có tham số hoặc sai chuỗi → KHÔNG xoá gì cả, chỉ log nhắc lại.
 */
function deleteUserPermissionSheet(confirmToken) {
  // [SECURITY FIX 2026-08] Trước đây HÀM NÀY CHỈ được bảo vệ bằng 1 chuỗi token in
  // sẵn trong chính code (và bị in lại ra ngay trong message cảnh báo khi gọi sai) —
  // không hề kiểm tra danh tính người gọi. Thêm kiểm tra admin cấp 1, giữ nguyên token
  // làm lớp bảo vệ thứ 2 (chống bấm nhầm/tự động hoá lỗi) chứ không phải lớp bảo vệ duy nhất.
  _requireAdmin_(1);
  var ss    = _DS.ss(MASTER_DB_ID);
  var sheet = ss.getSheetByName('UserPermission');
  if (!sheet) { _LOG.d('Sheet UserPermission không tìm thấy — đã xoá trước đó?'); return; }

  var REQUIRED_TOKEN = 'CONFIRM_DELETE_USERPERMISSION';
  if (confirmToken !== REQUIRED_TOKEN) {
    var warnMsg = '⚠️ CHƯA XOÁ — cần xác nhận rõ ràng trước khi xoá sheet UserPermission.\n' +
      'Đã chắc chắn:\n' +
      '✅ migrateYellowToSA() đã chạy xong\n' +
      '✅ 9 dòng đỏ đã được xử lý\n' +
      '✅ auditUserPermissionVsSA() chỉ còn xanh/cam\n\n' +
      'Nếu chắc chắn, chạy lại: deleteUserPermissionSheet(\'' + REQUIRED_TOKEN + '\')';
    _LOG.d(warnMsg);
    return warnMsg;
  }

  ss.deleteSheet(sheet);
  _LOG.d('[2026-06] Sheet UserPermission đã được xoá. Toàn bộ phân quyền nay đọc từ SA/DS Nhân viên (RP_SOURCE_ID).');
}



/**
 * 2. Hàm lưu trữ dữ liệu lũy tiến đa ngày tập trung theo Trạm của User (Bảo toàn vĩnh viễn "Hộp đen" đơn hàng)
 */
function saveStationData(stationName, mergedOrdersJson, inboundLock, clientEpoch) {
  // MU-PERM: Kiểm tra quyền người dùng + trạm trước khi ghi
  if (!stationName || !stationName.trim()) return { success: false, msg: 'Thiếu tên trạm.' };
  var _email = Session.getActiveUser().getEmail();
  var _perm  = checkAnalyticsPermission(_email);
  if (!_perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };
  var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
  if (!_hasSt) return { success: false, msg: 'Không có quyền ghi dữ liệu trạm: ' + stationName };

  // ANTI-DATA-RESURRECTION: chặn ghi nếu client đang cầm dữ liệu CŨ HƠN lần "Xóa dữ liệu"
  // gần nhất của trạm này (xem chi tiết ở _anaCheckClearEpochOrReject_). Kiểm tra NGAY ở
  // đây — trước khi acquire lock/đọc-merge sheet — để không tốn công merge rồi mới huỷ.
  var _epochReject = _anaCheckClearEpochOrReject_(stationName, clientEpoch);
  if (_epochReject) return _epochReject;

  // FIX RACE ĐA NGƯỜI DÙNG: trước đây dùng getUserLock() — chỉ chặn CÙNG 1 tài khoản
  // gọi đồng thời. Nếu User A và User B (2 account khác nhau, cùng được cấp quyền 1 trạm)
  // ghi gần như đồng thời, getUserLock() KHÔNG chặn được nhau: cả 2 cùng đọc _cloudSnap
  // (snapshot cũ), cùng merge, người ghi sau dùng clearContent()+setValues() đè lên toàn
  // bộ sheet — kể cả phần dữ liệu mới nhất người ghi trước vừa lưu xong (lost update).
  // FIX ĐA TRẠM: getScriptLock() trực tiếp là lock TOÀN CỤC của cả script → Trạm A ghi
  // sẽ chặn cả Trạm B (2 sheet hoàn toàn khác nhau) phải xếp hàng theo, gây nghẽn khi mở
  // rộng hàng trăm trạm. Đổi sang named-lock theo TÊN TRẠM (cùng pattern syncSmartData()):
  // vẫn xếp hàng tuần tự nếu 2 request CÙNG trạm (giữ nguyên tính đúng đắn chống lost
  // update ở trên), nhưng các trạm khác nhau chạy song song, không chặn nhau nữa.
  var _lockKey = 'ana_save_station_lock_' + _anaSafeStationKey(stationName);
  if (!_anaAcquireNamedLock(_lockKey, 45000)) {
    return { success: false, msg: 'Hệ thống đang bận ghi dữ liệu trạm ' + stationName + ', sếp vui lòng thử lại sau ít giây!' };
  }
  try {
  var _t0 = Date.now(); // [FIX 2026-08-13] đo thời gian xử lý THẬT của lượt lưu này — xem _spxFlagHotStationIfSlow_() ở finally bên dưới
  var ss = getStationSS(stationName);
  var safeSheetName = "Data_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
  var sheet = ss.getSheetByName(safeSheetName);
  // MU-02: Đọc snapshot hiện tại trên cloud trước khi ghi
  // Merge server-side: client gửi file mới nhất → server UNION với data hiện có
  // Nguyên tắc: đơn đã 'delivered' trên cloud không bị overwrite về trạng thái thấp hơn
  var _cloudSnap = {};
  if (sheet && sheet.getLastRow() > 1) {
    var _existingData = sheet.getRange(2, 7, sheet.getLastRow() - 1, 1).getValues();
    for (var _ei = 0; _ei < _existingData.length; _ei++) {
      try {
        var _eo = JSON.parse(_existingData[_ei][0] || 'null');
        if (_eo && _eo.orderId) _cloudSnap[_eo.orderId] = _eo;
      } catch(e) {}
    }
  }

  var _raw = JSON.parse(mergedOrdersJson || '[]');
  var parsedOrders = Array.isArray(_raw) ? _raw : (_raw.orders || []);
  // [FIX 2026-07-B] KHÔNG còn tin số "inboundLock" do client tự tính gửi lên nữa — tham
  // số này bị BỎ QUA (giữ lại trong chữ ký hàm chỉ để tương thích ngược client cũ chưa
  // cập nhật, không dùng để ghi). Số Inbound giờ CHỈ được tính lại ở server, dựa đúng
  // trên dữ liệu vừa merge/ghi lần này — xem _anaComputeAndLockInboundServer_() bên dưới.

  if (!parsedOrders || parsedOrders.length === 0) {
    return { success: true, count: 0, lockOnly: true, clearEpoch: _anaGetClearEpoch_(stationName) };
  }

  if (!sheet) {
    sheet = ss.insertSheet(safeSheetName);
    sheet.appendRow(["Order ID", "Status", "Driver ID", "Driver Name", "Current Station", "Last Update", "Full Data JSON"]);
    sheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#6366f1").setFontColor("#ffffff");
    if (sheet.getMaxColumns() > 7) {
      sheet.deleteColumns(8, sheet.getMaxColumns() - 7);
    }
  }

  // MU-02 [FIX 2026-07 — TỔNG QUÁT HÓA]: Bản cũ CHỈ bảo vệ status 'delivered' khỏi bị hạ
  // cấp — mọi trường hợp khác (driverId, zone, onholdReason, sortCode, attempts...) của 1
  // đơn vẫn bị client cũ hơn (máy chưa refresh, đang cầm data cũ) ĐÈ THẲNG lên data mới hơn
  // mà client khác vừa lưu trước đó, vì server không so sánh "ai mới hơn" ngoài case
  // delivered. Đây chính là rủi ro "dữ liệu cũ đè dữ liệu mới" còn sót lại đã nói ở trên.
  // Cách sửa: tổng quát hóa thành so sánh THỨ HẠNG TIẾN TRÌNH của status thay vì chỉ 1 case
  // duy nhất — CỐ Ý KHÔNG dùng timestamp client gửi lên để so sánh "ai mới hơn" (đồng hồ máy
  // client từng gây lệch ngày ở phần Inbound, không đáng tin cậy để làm trọng tài). Đơn đang
  // ở status cấp cao hơn trong vòng đời (onhold cao hơn delivering, delivered cao hơn onhold)
  // luôn được giữ NGUYÊN VẸN CẢ OBJECT — không chỉ mỗi field status — để không bị kéo lùi.
  var _ANA_STATUS_RANK_ = { '': 0, 'delivering': 1, 'onhold': 2, 'delivered': 3 };
  var _anaOrderStatusRank_ = function(s) {
    var k = String(s || '').toLowerCase();
    return _ANA_STATUS_RANK_.hasOwnProperty(k) ? _ANA_STATUS_RANK_[k] : 1; // status lạ → coi ngang 'delivering', an toàn hơn coi ngang 0
  };
  var _mergedMap = {};
  Object.keys(_cloudSnap).forEach(function(oid) { _mergedMap[oid] = _cloudSnap[oid]; });
  parsedOrders.forEach(function(o) {
    var _cl = _cloudSnap[o.orderId];
    if (_cl && _anaOrderStatusRank_(_cl.status) > _anaOrderStatusRank_(o.status)) {
      _mergedMap[o.orderId] = _cl; // Cloud đang tiến xa hơn trong vòng đời đơn → giữ nguyên, không cho client cũ hơn kéo lùi
    } else {
      _mergedMap[o.orderId] = o;
    }
  });
  var mergedOrders = Object.values(_mergedMap);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).clearContent();
  }

  var rowsToAppend = mergedOrders.map(function(o) {
    return [
      o.orderId,
      o.status,
      o.driverId,
      o.driverName,
      stationName,
      _anaVNNow(),
      JSON.stringify(o)
    ];
  });
  if (rowsToAppend.length > 0) {
    sheet.getRange(2, 1, rowsToAppend.length, 7).setValues(rowsToAppend);
  }

  // [FIX 2026-07-B] CHỐT SỔ INBOUND NGAY TẠI ĐÂY — đúng lúc dữ liệu chính vừa được lưu
  // thật (đầu ngày hoặc bất kỳ lần cập nhật nào), dùng CHÍNH mergedOrders vừa ghi. Đọc
  // kèm Sup_ hiện có (nếu có) để 2 nguồn luôn được xét cùng lúc, nhất quán cho mọi user.
  // [2026-07 COST FIX] Giữ lại kết quả để trả THẲNG về response — client trước đây phải
  // gọi thêm getStationData() (1 lượt đọc Firestore riêng, không cache được vì idDatesJson
  // có thể ~900KB) chỉ để lấy lại đúng state vừa tính xong ở đây. Bỏ round-trip thừa đó.
  var _freshInboundState = null;
  try {
    var _supForLock = [];
    var _safeSupName = "Sup_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var _supSheetForLock = ss.getSheetByName(_safeSupName);
    if (_supSheetForLock && _supSheetForLock.getLastRow() > 1) {
      var _supRaw = _supSheetForLock.getRange(2, 7, _supSheetForLock.getLastRow() - 1, 1).getValues();
      for (var _si = 0; _si < _supRaw.length; _si++) {
        try {
          var _so = JSON.parse(_supRaw[_si][0] || 'null');
          if (_so && _so.orderId) _supForLock.push(_so);
        } catch(eSupParse) {}
      }
    }
    _freshInboundState = _anaComputeAndLockInboundServer_(ss, stationName, mergedOrders, _supForLock);
  } catch (eLockCompute) {
    console.warn('[Inbound] Tính/chốt sổ Inbound lỗi trong saveStationData (bỏ qua, giữ sổ cũ): ' + eLockCompute.message);
  }

  // =========================================================================
  // CLEANUP SUP_: Xóa đơn khỏi Sup_ khi đơn đó trong Data_ đã có tài xế giao
  // Điều kiện xóa: orderId có trong Data_ VÀ driverId != "0" và != ""
  // Giữ lại: đơn trong Sup_ mà Data_ vẫn còn driverId = 0 (chưa gán tuyến)
  // =========================================================================
  try {
    var safeSupName = "Sup_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var supSheet = ss.getSheetByName(safeSupName);

    if (supSheet && supSheet.getLastRow() > 1) {
      var supLastRow = supSheet.getLastRow();
      var supValues = supSheet.getRange(2, 1, supLastRow - 1, 7).getValues();
      // Map orderId → driverId từ Data_ vừa lưu
      // Chỉ đánh dấu xóa khi driverId thực sự có giá trị (đã gán tài xế)
      var assignedMap = {};
      // MU-11: Dùng mergedOrders (đã merge với cloud) để tránh xóa Sup_ của user B
      // parsedOrders chỉ là file của user A, mergedOrders mới là toàn bộ data đúng
      mergedOrders.forEach(function(o) {
        if (!o.orderId) return;
        var did = String(o.driverId || '').trim();
        if (did && did !== '0') {
          assignedMap[o.orderId] = true;
        }
      });
      // Giữ lại đơn bổ sung chưa được gán tài xế
      var remaining = supValues.filter(function(row) {
        var id = String(row[0]).trim();
        if (!id || String(row[6]).trim() === '') return false;
        return !assignedMap[id]; // chỉ xóa khi đã có tài xế
      });
      supSheet.getRange(2, 1, supLastRow - 1, 7).clearContent();
      if (remaining.length > 0) {
        supSheet.getRange(2, 1, remaining.length, 7).setValues(remaining);
      }
    }
  } catch(supErr) {
    console.warn("Loi cleanup Sup_: " + supErr.message);
  }

  // [FIX 2026-07-21 PERF] Xoá cache bundle NGAY sau khi ghi thành công — đảm bảo
  // lần đọc kế tiếp (dù trong TTL 20s) luôn thấy đúng dữ liệu vừa lưu, không bao
  // giờ trả về số liệu cũ.
  _anaInvalidateBundleCache_(stationName);
  return { success: true, count: rowsToAppend.length, inboundLock: (_freshInboundState && _freshInboundState.inboundLock) || 0, inboundState: _freshInboundState, clearEpoch: _anaGetClearEpoch_(stationName), inboundSyncDegraded: !!(_freshInboundState && _freshInboundState.fsWriteOk === false) };
  } finally {
    _anaReleaseNamedLock(_lockKey);
    // [FIX 2026-08-13] KHÔNG chỉ cảnh báo suông — nếu lượt lưu này chậm bất thường
    // (dấu hiệu Data_/Sup_ đang phình to dần), ĐÁNH DẤU NGAY vào "danh sách nóng" để
    // job archive ưu tiên xử lý trạm này ở lượt chạy KẾ TIẾP, không phải đợi tới lượt
    // xoay vòng bình thường (có thể vài đêm sau mới tới, tuỳ vị trí trong danh sách
    // trạm). Xem _spxFlagHotStationIfSlow_() để biết ngưỡng + cách xử lý ưu tiên.
    // Best-effort tuyệt đối — không được phép làm hỏng kết quả trả về cho user dù cờ
    // này ghi lỗi.
    try { _spxFlagHotStationIfSlow_(stationName, Date.now() - _t0); } catch (eHot) {}
  }
}

/**
 * 3. Hàm XÓA BIỆT LẬP dữ liệu lưu trữ đa ngày của riêng trạm được chọn
 * Hàm xóa toàn bộ dữ liệu trạm và giải phóng chốt chặn Inbound hôm nay
 */
// =========================================================================
// [FIX 2026-08-13] ARCHIVE ĐƠN CŨ ĐÃ HOÀN TẤT — chống Data_/Sup_ phình vô hạn
// -------------------------------------------------------------------------
// VẤN ĐỀ: Data_<trạm>/Sup_<trạm> KHÔNG có bất kỳ cơ chế dọn nào — mọi đơn từng
// xử lý ở 1 trạm nằm lại VĨNH VIỄN. Đây là sheet bị đọc/ghi lại TOÀN BỘ (không
// phân trang) ở MỌI lần user tải trang/lưu dữ liệu của module BI — quan trọng
// và được dùng nhiều nhất hệ thống. 1 trạm sản lượng cao vận hành nhiều năm có
// thể tích luỹ hàng trăm nghìn tới hàng triệu dòng, chạm dần trần 10 triệu
// cell/file của Google Sheets, và làm MỌI thao tác của module BI chậm dần đều
// — khác các job nền (chạy 1 lần/ngày), đây ảnh hưởng trực tiếp trải nghiệm
// user hàng trăm/nghìn lần mỗi ngày.
//
// GIẢI PHÁP (thống nhất với đội vận hành): đơn ở trạng thái CUỐI (delivered)
// và không có cập nhật trong ≥30 ngày được coi là "đã xong, an toàn tách ra" —
// chuyển sang sheet riêng Data_Archive_<trạm>/Sup_Archive_<trạm> (cùng file,
// vẫn mở được khi cần tra cứu thủ công), không xoá vĩnh viễn. Đơn đang
// 'onhold'/'delivering' KHÔNG BAO GIỜ bị archive dù cũ tới đâu — đây là đơn
// còn cần AOM/SUP xử lý, tuyệt đối không được để "biến mất" khỏi tầm nhìn.
// Nhu cầu xem lại lịch sử/xu hướng đã có hệ thống Trend riêng đảm nhiệm (theo
// xác nhận của đội vận hành) nên module BI không cần đọc gộp cả Data_ +
// Data_Archive_ trong luồng chính — giữ luồng đọc/ghi chính ĐƠN GIẢN VÀ NHANH.
//
// AN TOÀN ĐA NGƯỜI DÙNG: dùng ĐÚNG namespace khoá 'ana_save_station_lock_' +
// trạm — GIỐNG HỆT saveStationData/clearStationData/saveSupplementData — để
// không bao giờ archive cùng lúc với 1 user đang lưu dữ liệu trạm đó (tránh
// đọc phải trạng thái nửa vời hoặc ghi đè lẫn nhau).
// =========================================================================
var DATA_ARCHIVE_RETENTION_DAYS = 30;
var DATA_ARCHIVE_COOLDOWN_MS    = 12 * 60 * 60 * 1000; // nghỉ 12 giờ sau mỗi vòng quét toàn bộ trạm
var DATA_ARCHIVE_LASTDONE_KEY   = 'data_archive_lastdone_v1';
var DATA_ARCHIVE_BATCH_SIZE     = 60;   // trần tối đa — chốt an toàn thật là TIME_BUDGET_MS bên dưới (đồng bộ pattern với trendNightlyPurge/stationStatus_crawlBatch)
var DATA_ARCHIVE_CURSOR_KEY     = 'ana_data_archive_cursor_v1';

/** Trả về hạng trạng thái — Y HỆT logic trong saveStationData() để nhất quán, không tự suy diễn quy tắc khác. */
function _anaOrderStatusRankShared_(s) {
  var RANK = { '': 0, 'delivering': 1, 'onhold': 2, 'delivered': 3 };
  var k = String(s || '').toLowerCase();
  return RANK.hasOwnProperty(k) ? RANK[k] : 1;
}

/**
 * Tách 1 sheet (Data_ hoặc Sup_, cùng layout 7 cột: orderId, status, driverId,
 * driverName, stationName, lastUpdate, jsonFull) thành phần "giữ lại" (còn sống
 * hoặc chưa đủ tuổi) và "archive" (delivered + ≥30 ngày không cập nhật). CHỈ
 * ghi lại sheet nếu THẬT SỰ có gì để archive — tránh tốn API call vô ích cho
 * đa số trạm không có gì cần dọn ở 1 lượt chạy.
 *
 * [AN TOÀN 2026-08-13] Trạm chạy lần ĐẦU TIÊN sau khi bật tính năng này có thể
 * đã tích luỹ backlog rất lớn (nhiều năm chưa từng dọn) — nếu archive HẾT trong
 * 1 lượt, tự bản thân thao tác đó (đọc + ghi hàng trăm nghìn dòng) có nguy cơ
 * vượt trần 6 phút/lần chạy CHO RIÊNG 1 TRẠM. Giới hạn tối đa
 * ARCHIVE_MAX_ROWS_PER_CALL dòng archive/lượt — nếu còn dư, để lại cho lượt kế
 * tiếp (mỗi lượt giảm dần backlog, tự bắt kịp sau vài lượt thay vì cố xong
 * ngay 1 lần và rủi ro Timed Out).
 */
var ARCHIVE_MAX_ROWS_PER_CALL = 20000;

function _anaArchiveSplitSheet_(ss, liveSheetName, archiveSheetName, nowMs) {
  var sheet = ss.getSheetByName(liveSheetName);
  if (!sheet || sheet.getLastRow() <= 1) return { archived: 0 };

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var cutoffMs = nowMs - DATA_ARCHIVE_RETENTION_DAYS * 86400000;

  var keepRows = [];
  var archiveRows = [];
  var _capHit = false;
  values.forEach(function(row) {
    var rank = _anaOrderStatusRankShared_(row[1]);
    var rawLU = row[5];
    var luDate = (rawLU instanceof Date) ? rawLU : new Date(rawLU);
    var isValidDate = !isNaN(luDate.getTime());
    // [AN TOÀN] Last Update rỗng/hỏng → KHÔNG suy đoán, giữ lại trong sheet sống
    // (thà tốn chỗ hơn archive nhầm 1 đơn không rõ tuổi thật).
    var isOldEnough = isValidDate && luDate.getTime() < cutoffMs;
    if (rank === 3 && isOldEnough && !_capHit) {
      if (archiveRows.length >= ARCHIVE_MAX_ROWS_PER_CALL) { _capHit = true; keepRows.push(row); return; }
      archiveRows.push(row);
    } else {
      keepRows.push(row);
    }
  });

  if (archiveRows.length === 0) return { archived: 0 }; // không có gì để dọn — không đụng gì tới sheet

  var archiveSheet = ss.getSheetByName(archiveSheetName);
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(archiveSheetName);
    archiveSheet.appendRow(['Order ID', 'Status', 'Driver ID', 'Driver Name', 'Station', 'Last Update', 'Full Data JSON']);
    archiveSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#64748b').setFontColor('#ffffff');
  }
  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, archiveRows.length, 7).setValues(archiveRows);

  // Ghi lại sheet sống: xoá hết rồi ghi lại đúng phần "giữ lại" — cùng cách
  // saveStationData() đang làm (clearContent rồi setValues), không phải cách mới.
  // [SỬA — phát hiện khi rà soát lỗ hổng BI] TRƯỚC: clearContent() TOÀN BỘ
  // sheet sống RỒI MỚI ghi lại keepRows. Nếu script bị ngắt giữa 2 bước đó
  // (hết quota 360 phút/ngày — rủi ro đã biết của hệ thống này; hoặc timeout,
  // hoặc lỗi API tạm thời), sheet sống bị XOÁ TRẮNG và keepRows KHÔNG BAO GIỜ
  // được ghi lại — mất vĩnh viễn toàn bộ đơn CHƯA đủ tuổi archive (không nằm
  // trong Archive, cũng không còn trong sheet sống — không còn ở đâu khôi phục).
  // NAY: đảo thứ tự — GHI keepRows TRƯỚC (đè đúng vị trí cũ), rồi mới dọn
  // phần DƯ phía dưới (đúng bằng số dòng vừa archive). Nếu bị ngắt giữa chừng:
  // tệ nhất còn sót vài dòng cũ (đã archive) phía dưới sheet sống — vô hại,
  // lượt archive kế tiếp tự dọn tiếp — KHÔNG BAO GIỜ trắng sheet.
  if (keepRows.length > 0) {
    sheet.getRange(2, 1, keepRows.length, 7).setValues(keepRows);
  }
  if (keepRows.length < lastRow - 1) {
    sheet.getRange(2 + keepRows.length, 1, (lastRow - 1) - keepRows.length, 7).clearContent();
  }
  return { archived: archiveRows.length };
}

/** Archive 1 trạm — PHẢI giữ đúng khoá chung với saveStationData để không bao giờ chạy song song với 1 lượt lưu thật của user. */
function _anaArchiveStationOrders_(stationName) {
  var _lockKey = 'ana_save_station_lock_' + _anaSafeStationKey(stationName);
  var gotLock = _anaAcquireNamedLock(_lockKey, 15000);
  if (!gotLock) return { archived: 0, lockBusy: true }; // trạm đang có user thao tác — bỏ qua, thử lại lượt archive sau
  try {
    var ss = getStationSS(stationName);
    var nowMs = Date.now();
    var dRes = _anaArchiveSplitSheet_(ss, "Data_" + stationName.replace(/[^a-zA-Z0-9]/g, "_"), "Data_Archive_" + stationName.replace(/[^a-zA-Z0-9]/g, "_"), nowMs);
    var sRes = _anaArchiveSplitSheet_(ss, "Sup_" + stationName.replace(/[^a-zA-Z0-9]/g, "_"), "Sup_Archive_" + stationName.replace(/[^a-zA-Z0-9]/g, "_"), nowMs);
    return { archived: (dRes.archived || 0) + (sRes.archived || 0) };
  } catch (e) {
    return { archived: 0, error: e.message };
  } finally {
    _anaReleaseNamedLock(_lockKey);
  }
}

/**
 * Job nền — chạy trigger định kỳ (khung giờ vắng, giống trendNightlyPurgeRunner).
 * Chia lô theo trạm + tự dừng sớm theo thời gian (KHÔNG NGHIỆP VỤ QUAN TRỌNG tới
 * mức phải xong ngay — trễ 1 lượt chỉ khiến vài trạm lớn chưa được dọn, không có
 * hại gì), và tự nhường quota runtime/ngày cho traffic user thật.
 */
function ana_archiveOldOrdersRunner() {
  _requireAdminIfInteractive_(2);   // [SỬA] job nền không có người đăng nhập
  if (_spxShouldSkipForBudget_()) { _LOG.d('[Archive Đơn Cũ] Bỏ qua — ngân sách runtime hôm nay đã cao.'); return; }

  var gotLock = _anaAcquireNamedLock('ana_archive_batch_lock_v1', 5000);
  if (!gotLock) return; // lượt trước còn đang chạy

  var _t0 = Date.now();
  var TIME_BUDGET_MS = 4 * 60 * 1000;
  try {
    var totalArchived = 0;

    // [FIX 2026-08-13] ƯU TIÊN xử lý "danh sách nóng" TRƯỚC vòng xoay bình thường —
    // đây là phần XỬ LÝ thật (không chỉ cảnh báo) cho các trạm saveStationData() vừa
    // tự phát hiện chậm bất thường (>= 8s/lượt). CHẠY ĐƯỢC NGOÀI khung giờ vắng vì
    // đây là phản ứng khẩn cấp cho vấn đề đang ảnh hưởng user THẬT ngay lúc này —
    // đợi tới đêm mới xử lý là quá trễ, đúng như nhận xét "cảnh báo mà không xử lý
    // kịp thì đã là nghẽn". Vẫn dùng ĐÚNG khoá 'ana_save_station_lock_' của
    // saveStationData() nên không bao giờ tranh chấp với user đang thao tác thật.
    var priorityStations = _spxGetPriorityStations_();
    priorityStations.forEach(function(stationName) {
      if (Date.now() - _t0 > TIME_BUDGET_MS) return; // hết ngân sách thời gian lượt này — phần còn lại vẫn nằm trong danh sách nóng, xử lý tiếp lượt sau
      var res = _anaArchiveStationOrders_(stationName);
      if (res && !res.lockBusy) {
        // Xử lý xong (dù archived>0 hay =0 — nếu =0 nghĩa là không có gì đủ tuổi để
        // dọn, có thể trạm chậm vì lý do khác không phải backlog cũ) → gỡ khỏi danh
        // sách nóng, không lặp lại vô ích lượt sau.
        totalArchived += (res.archived || 0);
        _spxClearHotStation_(stationName);
        _LOG.d('[Archive Đơn Cũ] (ƯU TIÊN) Trạm "' + stationName + '" — archive ' + (res.archived || 0) + ' dòng.');
      }
      // res.lockBusy === true: trạm đang có user thao tác thật — KHÔNG gỡ khỏi danh
      // sách nóng, thử lại đúng trạm này ở lượt archive kế tiếp.
    });

    // Vòng xoay bình thường (toàn bộ trạm, theo cursor) — CHỈ chạy trong khung giờ
    // vắng như thiết kế gốc, và chỉ dùng phần ngân sách thời gian còn lại sau khi đã
    // ưu tiên xong danh sách nóng ở trên.
    if (_spxIsPrewarmQuietHours_() && (Date.now() - _t0) < TIME_BUDGET_MS) {
      var ssMaster = _DS.ss(MASTER_DB_ID);
      // [CHUYỂN DỊCH DẦN Station_Map — KHÔNG xoá dòng nào] TRƯỚC ĐÂY đọc thẳng
      // cột B: với 402 dòng định dạng CŨ (cột B = 'MASTER'), danh sách nhận về
      // ~95% là mục 'MASTER' trùng lặp -> job xoay vòng vô ích, lãng phí
      // ~46 phút/ngày. Không sai dữ liệu, chỉ tốn giờ chạy.
      // Nay dùng hàm dùng chung: tự hiểu CẢ 2 định dạng, đã khử trùng lặp và
      // loại mục không phải trạm. Dùng lại cache của _ssMapRead_ nên không tốn
      // thêm lượt đọc sheet nào.
      var stations = (typeof spx_getAllStationNames === 'function') ? spx_getAllStationNames() : [];
      if (stations.length) {
        var props = PropertiesService.getScriptProperties();
        var cursor = Number(props.getProperty(DATA_ARCHIVE_CURSOR_KEY)) || 0;
        if (cursor >= stations.length) cursor = 0;
        // [TỐI ƯU — đo thật: hàm này tăng 83%, lên ~53.6 phút/ngày] Cùng vấn đề
        // đã sửa cho stationStatus_crawlBatch: quét xong 1 vòng toàn bộ trạm là
        // lượt sau quét LẠI TỪ ĐẦU ngay. Đơn đủ tuổi để dọn KHÔNG phát sinh nhanh
        // như vậy — quét lại liên tục chỉ tốn thời gian mà archive được 0 dòng.
        // Nay nghỉ DATA_ARCHIVE_COOLDOWN_MS sau mỗi vòng hoàn tất. Danh sách
        // "trạm nóng" (ưu tiên, phản ứng khẩn cấp) KHÔNG bị ảnh hưởng — nó chạy
        // ở nhánh riêng phía trên, ngoài vòng xoay này.
        if (cursor === 0) {
          var _archDone = Number(props.getProperty(DATA_ARCHIVE_LASTDONE_KEY)) || 0;
          if (_archDone && (Date.now() - _archDone) < DATA_ARCHIVE_COOLDOWN_MS) {
            _LOG.d('[Archive Đơn Cũ] Vừa xong 1 vòng — nghỉ tới khi đủ thời gian chờ.');
            return;
          }
        }
        var batch = stations.slice(cursor, cursor + DATA_ARCHIVE_BATCH_SIZE);

        var processedCount = 0;
        for (var i = 0; i < batch.length; i++) {
          if (Date.now() - _t0 > TIME_BUDGET_MS) break;
          processedCount++;
          var res2 = _anaArchiveStationOrders_(batch[i]);
          if (res2 && res2.archived) totalArchived += res2.archived;
        }

        var nextCursor = cursor + processedCount;
        if (nextCursor >= stations.length) {
          nextCursor = 0;
          props.setProperty(DATA_ARCHIVE_LASTDONE_KEY, String(Date.now()));
        }
        props.setProperty(DATA_ARCHIVE_CURSOR_KEY, String(nextCursor));
        _LOG.d('[Archive Đơn Cũ] Vòng xoay: đã quét ' + processedCount + '/' + batch.length + ' trạm (cursor ' + cursor + ' → ' + nextCursor + '/' + stations.length + ').');
      }
    }

    _LOG.d('[Archive Đơn Cũ] Tổng archive lượt này: ' + totalArchived + ' dòng (' + priorityStations.length + ' trạm ưu tiên + vòng xoay thường).');
  } finally {
    _anaReleaseNamedLock('ana_archive_batch_lock_v1');
    _spxTrackExecMinutes_((Date.now() - _t0) / 60000);
  }
}

/** Cài trigger cho ana_archiveOldOrdersRunner — chạy tay 1 lần trong Apps Script Editor để bật. */
function ana_setupArchiveOldOrdersTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 30-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher30Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher30Min() thay thế.
  _requireAdmin_(1);
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'ana_archiveOldOrdersRunner') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ana_archiveOldOrdersRunner').timeBased().everyMinutes(30).create();
  return 'Đã cài trigger ana_archiveOldOrdersRunner (mỗi 30 phút). Vòng xoay toàn bộ trạm chỉ thực chạy ' +
    'trong khung giờ vắng 23h-5h (tối đa ' + DATA_ARCHIVE_BATCH_SIZE + ' trạm/lượt); riêng "danh sách nóng" ' +
    '(trạm saveStationData() vừa phát hiện chậm bất thường) được ưu tiên xử lý NGAY ở mỗi lượt 30 phút, ' +
    'kể cả ngoài khung giờ vắng — phản hồi trong tối đa ~30 phút kể từ lúc phát hiện chậm.';
}

function clearStationData(stationName) {
  // MU-PERM: Kiểm tra quyền người dùng + trạm trước khi xóa
  if (!stationName || !stationName.trim()) return { success: false, msg: 'Thiếu tên trạm.' };
  var _email = Session.getActiveUser().getEmail();
  var _perm  = checkAnalyticsPermission(_email);
  if (!_perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };
  var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
  if (!_hasSt) return { success: false, msg: 'Không có quyền xóa dữ liệu trạm: ' + stationName };

  // FIX RACE ĐA NGƯỜI DÙNG: getUserLock() chỉ chặn cùng 1 tài khoản — nếu User A đang
  // saveStationData() và User B bấm "Xóa dữ liệu" CÙNG trạm gần như đồng thời, 2 lock
  // riêng của 2 account không chặn nhau → có thể xóa giữa lúc đang ghi, hoặc ghi đè lên
  // ngay sau khi vừa xóa.
  // FIX ĐA TRẠM: dùng CÙNG named-lock key với saveStationData() ('ana_save_station_lock_'
  // + tên trạm) thay cho getScriptLock() toàn cục — vẫn đảm bảo "xóa" và "ghi" CÙNG 1 trạm
  // luôn tuần tự (giữ đúng mục tiêu ban đầu), nhưng không còn chặn các trạm khác đang ghi/xóa
  // song song, tránh nghẽn khi hệ thống mở rộng hàng trăm trạm.
  var _lockKey = 'ana_save_station_lock_' + _anaSafeStationKey(stationName);
  if (!_anaAcquireNamedLock(_lockKey, 45000)) {
    return { success: false, msg: 'Hệ thống đang bận ghi/xóa dữ liệu trạm ' + stationName + ', sếp vui lòng thử lại sau ít giây!' };
  }
  try {
    var ss = getStationSS(stationName);
    // 1. Xóa dữ liệu bảng chính (Data_Trạm)
    var safeName = "Data_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var sheet = ss.getSheetByName(safeName);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).clearContent();
    }

    // 2. Xóa dữ liệu bảng bổ sung (Sup_Trạm)
    var supName = "Sup_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var supSheet = ss.getSheetByName(supName);
    if (supSheet && supSheet.getLastRow() > 1) {
      var supCols = supSheet.getLastColumn() || 7;
      supSheet.getRange(2, 1, supSheet.getLastRow() - 1, supCols).clearContent();
    }

    // [FIX] KHÔNG đụng tới Firestore inbound_live / Sheet Inbound_Lock ở đây nữa.
    // idDatesJson/seenIdsJson/allIdsJson là SỔ LŨY KẾ TOÀN THỜI GIAN dùng để đối
    // chiếu Tồn/Tồn Mới qua các ngày — "Xóa dữ liệu trạm" chỉ có nghĩa là xóa
    // SỐ LIỆU HÔM NAY (Data_Trạm/Sup_Trạm ở trên + cache local phía client), không
    // phải xóa sạch lịch sử đối chiếu nhiều ngày của trạm. Bản thân inboundLock
    // (Inbound hôm nay) đã TỰ ĐỘNG tính lại mỗi lần đọc bằng cách đếm ID có
    // date === hôm nay trong idDatesJson (_anaParseInboundLiveDoc_) — không cần
    // và không được xóa/ghi đè thủ công ở đây, nếu không sẽ mất luôn sổ đối chiếu
    // Tồn của những ngày trước.

    // ANTI-DATA-RESURRECTION: "bump" clear epoch của trạm NGAY SAU KHI xóa sheet thành
    // công. Từ giờ, mọi saveStationData()/saveSupplementData() gửi lên với epoch CŨ hơn
    // mốc này (tức là từ tab/thiết bị chưa hay biết vừa có 1 lần xóa) sẽ bị server từ
    // chối — chặn đứng việc dữ liệu ngày cũ len lỏi trở lại qua tab khác chưa F5.
    var _newEpoch = _anaBumpClearEpoch_(stationName);
    _anaInvalidateBundleCache_(stationName); // [FIX 2026-07-21 PERF]

    return { success: true, msg: "Đã xóa dữ liệu trạm: " + stationName, clearEpoch: _newEpoch };
  } catch (err) {
    return { success: false, msg: err.message };
  } finally {
    _anaReleaseNamedLock(_lockKey);
  }
}

/**
 * 4. Hàm tải dữ liệu "Hộp đen" lịch sử từ Sheet lên giao diện đồ thị khi vào ca
 */
// ═══════════════════════════════════════════════════════════════════════
// [FIX 2026-07-21 PERF] getStationDataBundle() — GỘP getStationData() +
// getSupplementData() thành 1 lệnh gọi server DUY NHẤT cho luồng tải trạm
// chính (loadStationDatabaseFromSheet ở client). Trước đây mỗi lần mở/chuyển
// trạm, client bắn 2 lệnh google.script.run RIÊNG BIỆT — mỗi lệnh tự kiểm
// tra quyền + mở spreadsheet trạm RIÊNG, tốn gấp đôi round-trip HTTP (mỗi
// round-trip Apps Script có overhead cố định, ngoài phần đọc sheet) và gấp
// đôi lần gọi getStationSS(). Hàm này giữ NGUYÊN logic đọc dữ liệu của cả
// 2 hàm gốc (không đổi hành vi/định dạng orders trả về), chỉ khác là dùng
// CHUNG 1 lần kiểm tra quyền + 1 lần mở spreadsheet cho cả Data_ và Sup_.
// getStationData()/getSupplementData() GIỮ NGUYÊN không đổi — vẫn được các
// luồng khác (refresh sau khi lưu, retry loop...) dùng độc lập như cũ.
// ═══════════════════════════════════════════════════════════════════════
// [FIX 2026-07-21 PERF] Cache ngắn hạn (20s) cho TOÀN BỘ bundle 1 trạm — dùng
// CacheMgr.getChunked/setChunked (đã sẵn có, chịu được payload lớn bằng cách
// cắt nhiều entry) để việc bấm qua-lại vài trạm quen thuộc trong vài chục giây
// KHÔNG cần đọc lại Sheet mỗi lần. AN TOÀN VỀ SỐ LIỆU: TTL rất ngắn (20s) VÀ
// mọi hàm ghi (saveStationData/saveSupplementData/clearStationData/
// saveInboundLockToCloud) đều INVALIDATE cache này NGAY LẬP TỨC sau khi ghi
// thành công (xem _anaInvalidateBundleCache_ bên dưới, gọi ở cuối mỗi hàm ghi)
// — nên trong 100% trường hợp, dữ liệu đọc ra hoặc là "cache còn mới do chưa
// ai ghi gì", hoặc bị xoá cache ngay khi có ghi mới → không có kịch bản nào
// trả về số liệu cũ/sai cho user.
function _anaBundleCacheKey_(stationName) {
  return _anaSafeStationKey(stationName);
}
var _ANA_BUNDLE_CACHE_TTL_ = 20; // giây — ngắn có chủ đích, xem giải thích ở comment trên
function _anaInvalidateBundleCache_(stationName) {
  try { CacheMgr.invalidateChunked('ANALYTICS', 'bundle_' + _anaBundleCacheKey_(stationName)); } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════════════
// [FIX 2026-07-21 UX] getStationsDataStatusBatch() — cho danh sách chọn trạm
// biết CHÍNH XÁC trạm nào đã có dữ liệu ca hôm nay / trạm nào chưa, thay vì
// chỉ đoán qua lịch sử duyệt cục bộ (session) như bản trước. Chỉ kiểm tra
// getLastRow() của sheet Data_<trạm> (metadata, KHÔNG đọc nội dung ô nào) —
// rẻ hơn nhiều so với đọc toàn bộ dữ liệu. Nhờ getStationSS() dùng chung
// cache mở-spreadsheet-trong-1-lượt-thực-thi (_DS.ss), các trạm nằm CHUNG 1
// file shard chỉ tốn đúng 1 lần openById(), không phải mở lại cho từng trạm.
// Cache toàn bộ map kết quả theo user, TTL 60s — picker mở lại nhiều lần
// trong 1 phút không phải quét lại. Chỉ áp dụng cho ĐÚNG danh sách trạm user
// đó quản lý (không phải toàn bộ hệ thống) — với tài khoản thường (AOM/SUP)
// đây là vài chục trạm, rất nhẹ; với admin (toàn bộ ~391 hub), có TTL cache
// dài hơn (180s) để giảm tần suất quét full hệ thống.
// [FIX 2026-07-29] KIẾN TRÚC LẠI — chuẩn bị cho việc tăng số trạm lên 1000+.
// TRƯỚC ĐÂY: hàm này MỞ RIÊNG 1 file Google Sheet cho MỖI trạm user có quyền
// (kiến trúc shard 1-file/trạm, xem StationConfig.gs) rồi đọc 2 sheet mỗi file.
// SpreadsheetApp.openById() có độ trễ mạng thật (~0.3-2s/lần) và Apps Script
// KHÔNG có API mở nhiều file song song — nên với AOM/SUP quản nhiều chục/trăm
// trạm, hàm chạy TUẦN TỰ qua từng file → thời gian tỉ lệ THUẬN với số trạm họ
// quản (log Executions: max 383.7s = hơn 6 phút). Tăng số trạm hệ thống lên sẽ
// làm con số này tệ hơn theo đúng tỉ lệ, không phải sự cố ngẫu nhiên.
//
// SỬA: tách việc "mở file kiểm tra từng trạm" ra một CRAWLER NỀN
// (stationStatus_crawlBatch, xem bên dưới) — chạy mỗi 5 phút, mỗi lượt chỉ xử
// lý 1 LÔ nhỏ (không mở hết cùng lúc), quay vòng dần qua toàn bộ danh sách
// trạm, ghi kết quả vào 1 cache TỔNG HỢP DÙNG CHUNG. Hàm này giờ CHỈ đọc lại
// cache tổng đó rồi lọc theo quyền của user — không mở file nào cả, tốc độ
// O(1) bất kể user quản 1 trạm hay 500 trạm.
// Đánh đổi: trạm nào crawler CHƯA kịp quét tới (sau khi deploy lần đầu, hoặc
// vừa thêm trạm mới) sẽ trả về pending:true tạm thời, tự cập nhật trong tối đa
// 1 vòng crawl đầy đủ (xem STATION_STATUS_BATCH_SIZE để tính thời gian 1 vòng).
function getStationsDataStatusBatch(email) {
  try {
    var em = (email || '').toString().trim().toLowerCase();
    if (!em) return { success: false, msg: 'Thiếu email.' };
    var _perm = checkAnalyticsPermission(em);
    if (!_perm.allowed || !_perm.stations || !_perm.stations.length) {
      return { success: true, status: {} };
    }

    var allStatus = CacheMgr.getChunked('ANALYTICS', STATION_STATUS_ALL_CACHE_KEY) || {};
    var statusMap = {};
    _perm.stations.forEach(function(stationName) {
      statusMap[stationName] = allStatus[stationName] || { hasData: false, isToday: false, pending: true };
    });
    return { success: true, status: statusMap };
  } catch(err) {
    return { success: false, msg: err.message, status: {} };
  }
}

// ── Crawler nền cho getStationsDataStatusBatch ──────────────────────────────
var STATION_STATUS_ALL_CACHE_KEY = 'station_status_all_v1';
var STATION_STATUS_CURSOR_KEY    = 'station_status_cursor_v1'; // PropertiesService
var STATION_STATUS_COOLDOWN_MS   = 60 * 60 * 1000; // nghỉ 1 giờ sau mỗi vòng quét đủ 1.000 trạm
var STATION_STATUS_LASTDONE_KEY  = 'station_status_lastdone_v1';
var STATION_STATUS_BATCH_SIZE    = 150; // [SCALE FIX 2026-08] tăng từ 50 → 150 để chuẩn bị quy mô ~1.000 trạm — chỉ là TRẦN TỐI ĐA, chốt an toàn thật nằm ở TIME_BUDGET_MS trong stationStatus_crawlBatch()
// Với 300 trạm: 1 vòng đầy đủ ≈ 300/50 × 5 phút = 30 phút. Với 1000 trạm: ≈
// 100 phút/vòng — vẫn chấp nhận được vì đây là dữ liệu "còn dữ liệu hôm nay
// không", không cần tức thời tuyệt đối, và cache TTL cũ (60-180s) trước đây
// cũng đã ngầm chấp nhận độ trễ vài phút.

function stationStatus_crawlBatch() {
  // [SECURITY FIX 2026-08] Trước đây không kiểm tra quyền — gọi trực tiếp bất cứ
  // lúc nào cũng chạy được, bỏ qua điều kiện "chỉ chạy ngoài khung giờ vắng" mà
  // trigger tôn trọng. Chỉ admin (hoặc trigger 30 phút/lần chạy dưới danh nghĩa
  // admin đã cài) mới được gọi.
  _requireAdminIfInteractive_(2);   // [SỬA] job nền không có người đăng nhập
  if (_spxIsPrewarmQuietHours_()) { _LOG.d('[Station Status Crawl] Bỏ qua — khung giờ vắng user (23h-5h).'); return; }
  var gotLock = _anaAcquireNamedLock('station_status_crawl_lock_v1', 5000);
  if (!gotLock) { _LOG.d('[Station Status Crawl] Bỏ qua — lượt trước còn đang chạy.'); return; }
  try {
    var map = _ssMapRead_(); // { nameLower: {name, ssId, row} } — đã có cache riêng 6 phút
    var allNames = Object.keys(map).map(function(k) { return map[k].name; }).filter(Boolean);
    if (!allNames.length) return;

    var props = PropertiesService.getScriptProperties();
    var cursor = Number(props.getProperty(STATION_STATUS_CURSOR_KEY)) || 0;
    if (cursor >= allNames.length) cursor = 0;

    // [TỐI ƯU — đo thật: hàm này tốn ~79.9 phút/ngày, hạng 2 toàn hệ thống]
    // TRƯỚC ĐÂY quét xong hết danh sách trạm là cursor quay về 0 và lượt kế
    // tiếp (30 phút sau) quét LẠI TỪ ĐẦU ngay — tức chạy liên tục 24/7. Trạng
    // thái trạm KHÔNG đổi nhanh đến mức đó: quét lại toàn bộ mỗi ~1 giờ là
    // thừa. Nay sau khi hoàn tất 1 vòng thì NGHỈ đúng STATION_STATUS_COOLDOWN_MS
    // trước khi bắt đầu vòng mới. Dữ liệu vẫn được làm mới đều đặn (mỗi vòng
    // ~1 giờ + nghỉ 1 giờ = tối đa 2 giờ tuổi), đổi lại tiết kiệm gần một nửa
    // thời gian chạy. Vòng đang DỞ thì không bị ảnh hưởng — chỉ nghỉ khi đã xong.
    if (cursor === 0) {
      var _lastDone = Number(props.getProperty(STATION_STATUS_LASTDONE_KEY)) || 0;
      if (_lastDone && (Date.now() - _lastDone) < STATION_STATUS_COOLDOWN_MS) {
        try { Logger.log('stationStatus_crawlBatch — vừa quét xong 1 vòng, nghỉ tới khi đủ thời gian chờ.'); } catch (e) {}
        return;
      }
    }

    var batch = allNames.slice(cursor, cursor + STATION_STATUS_BATCH_SIZE);

    var todayKey = _anaTodayKey();
    var results = {};
    // [SCALE FIX 2026-08] Đổi forEach() → for-loop có chốt thời gian, cùng lý do và
    // cùng cơ chế đã áp cho trendNightlyPurge() (xem chú thích chi tiết ở đó): với N
    // trạm lớn (vd 1.000), 1 lô có thể vượt trần 6 phút/lần chạy nếu mở file chậm bất
    // thường — dừng sớm và chỉ nhích cursor đúng số trạm đã DUYỆT QUA, không bỏ sót.
    var _t0 = Date.now();
    // [FIX — đo thật: max 585.6s, vượt xa 240s (4 phút) ngân sách cũ] Kiểm tra
    // ngân sách chỉ diễn ra GIỮA CÁC TRẠM — không ngắt được SpreadsheetApp.openById()
    // đang treo giữa chừng (Apps Script không hỗ trợ timeout tuỳ chỉnh cho lệnh mở
    // file). Nếu 1 trạm cụ thể có file lớn/lỗi/chậm bất thường, thời gian mở file
    // đó cộng thêm TOÀN BỘ vào tổng, vượt xa ngân sách lý thuyết. Giảm ngân sách
    // xuống 3 phút để chừa thêm biên độ an toàn cho trường hợp 1 trạm cuối treo lâu.
    var TIME_BUDGET_MS = 3 * 60 * 1000; // 3 phút — hạ từ 4 phút, chừa biên độ an toàn
    var processedCount = 0;
    for (var _si = 0; _si < batch.length; _si++) {
      if (Date.now() - _t0 > TIME_BUDGET_MS) {
        _LOG.d('[Station Status Crawl] Dừng sớm do gần hết thời gian — đã quét ' + processedCount + '/' + batch.length + ' trạm trong lô.');
        break;
      }
      processedCount++;
      var stationName = batch[_si];
      // [MỚI] Ghi log TÊN TRẠM trước khi mở file — nếu hàm bị treo/timeout đúng
      // lúc xử lý 1 trạm cụ thể, dòng log này vẫn được ghi ra trước khi treo, giúp
      // tra Log Executions biết CHÍNH XÁC trạm nào gây chậm ở lần sau, không phải đoán.
      _LOG.d('[Station Status Crawl] Đang mở file trạm: ' + stationName);
      try {
        var entry = map[stationName.toLowerCase()];
        if (!entry || !entry.ssId) { results[stationName] = { hasData: false, isToday: false }; continue; }
        var ss = SpreadsheetApp.openById(entry.ssId);
        var safeSheetName = "Data_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
        var sheet = ss.getSheetByName(safeSheetName);
        var _hasData = !!(sheet && sheet.getLastRow() > 1);
        var _lastDate = '';
        try {
          var _ibSheet = ss.getSheetByName('Inbound_Lock');
          if (_ibSheet) {
            var _rowIdx = _anaFindInboundRow(_ibSheet, _anaSafeStationKey(stationName));
            if (_rowIdx > 0) _lastDate = String(_ibSheet.getRange(_rowIdx, 3).getValue() || '');
          }
        } catch (eIb) {}
        results[stationName] = { hasData: _hasData, isToday: (_lastDate.indexOf(todayKey) === 0) };
      } catch (eStation) {
        results[stationName] = { hasData: false, isToday: false, error: true };
      }
    }
    // [SCALE FIX 2026-08] nextCursor tính theo processedCount (số trạm đã DUYỆT QUA
    // thật sự trong lô này), KHÔNG dùng batch.length — nếu dừng sớm giữa lô, lượt
    // sau tiếp tục đúng từ trạm còn dang dở.
    var nextCursor = cursor + processedCount;
    if (nextCursor >= allNames.length) {
      nextCursor = 0; // hết danh sách → quay lại đầu
      props.setProperty(STATION_STATUS_LASTDONE_KEY, String(Date.now())); // mốc để tính thời gian nghỉ
    }

    // Merge vào cache TỔNG (đọc bản cũ, cập nhật đúng phần lô này, ghi lại) —
    // các trạm ngoài lô này giữ nguyên kết quả lần crawl trước, không bị xoá.
    var allStatus = CacheMgr.getChunked('ANALYTICS', STATION_STATUS_ALL_CACHE_KEY) || {};
    Object.keys(results).forEach(function(k) { allStatus[k] = results[k]; });
    // TTL 21600s (6 tiếng, trần tối đa của CacheService) — vì crawler tự làm
    // mới liên tục mỗi 5 phút, TTL ở đây chỉ để tự dọn nếu lỡ crawler bị tắt
    // hẳn (không dùng TTL ngắn để "ép tươi" vì dữ liệu này không cần tức thời).
    CacheMgr.setChunked('ANALYTICS', STATION_STATUS_ALL_CACHE_KEY, allStatus, 21600);

    props.setProperty(STATION_STATUS_CURSOR_KEY, String(nextCursor));
    _LOG.d('[Station Status Crawl] Đã quét ' + processedCount + '/' + batch.length + ' trạm trong lô (tổng ' + allNames.length + ' trạm, cursor ' + cursor + ' → ' + nextCursor + ').');
  } catch (e) {
    _LOG.d('[Station Status Crawl] ERROR: ' + e.message);
  } finally {
    _anaReleaseNamedLock('station_status_crawl_lock_v1');
  }
}

function setupStationStatusCrawlTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 30-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher30Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher30Min() thay thế.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'stationStatus_crawlBatch') ScriptApp.deleteTrigger(t);
  });
  // [FIX 2026-07-31] Đổi 5 phút -> 30 phút — trigger được cắt mạnh nhất trong đợt
  // cân bằng lại quota 360 phút/ngày, vì dữ liệu này ít nhạy cảm thời gian nhất
  // (chỉ để biết "trạm có dữ liệu hôm nay chưa", không cần tức thời — cache đọc
  // đã có TTL 6 tiếng làm nền từ trước).
  // [SCALE FIX 2026-08] STATION_STATUS_BATCH_SIZE tăng 50→150 để chuẩn bị quy mô
  // ~1.000 trạm: 1 vòng quét đầy đủ ở 300 trạm hiện tại còn ~1 tiếng (300÷150×30
  // phút), ở 1.000 trạm ~3.3 tiếng (1000÷150×30 phút, làm tròn lên ~4 tiếng do
  // chốt TIME_BUDGET_MS có thể giảm số trạm thực xử lý/lượt) — chấp nhận được cho
  // loại dữ liệu không cần tức thời này. Nếu N trạm tăng xa hơn nữa, chỉ cần tăng
  // số này hoặc rút ngắn interval trigger, không cần đổi logic.
  ScriptApp.newTrigger('stationStatus_crawlBatch').timeBased().everyMinutes(30).create();
  _LOG.d('✅ Trigger stationStatus_crawlBatch đã được tạo — chạy mỗi 30 phút.');
  return 'Đã tạo trigger stationStatus_crawlBatch (mỗi 30 phút, mỗi lượt quét ' + STATION_STATUS_BATCH_SIZE + ' trạm).';
}

/**
 * ana_getStationDataStamp(stationName)
 * [MỚI — sửa lỗi "2 user cùng trạm thấy số liệu khác nhau"]
 * Trả về DẤU THỜI ĐIỂM cập nhật gần nhất của dữ liệu trạm, để client biết có
 * ai vừa upload file mới hay không.
 *
 * VÌ SAO CẦN: module BI nạp dữ liệu 1 lần rồi giữ trong bộ nhớ trình duyệt,
 * KHÔNG có cơ chế tự làm mới nào (đã rà: 0 setInterval, và dấu thời gian
 * '_anaCloudTs_' vốn chỉ được GHI mà không nơi nào đọc lại). Hệ quả: user A mở
 * lúc 8h, user B cùng trạm upload lúc 9h -> màn hình A giữ số CŨ vô thời hạn,
 * không cảnh báo gì. Đúng hiện tượng đã báo cáo.
 *
 * CỰC NHẸ — CHỦ Ý: chỉ đọc metadata (getLastRow + 1 ô), KHÔNG đọc nội dung
 * bảng. Client gọi định kỳ 90 giây nên phải rẻ; nếu đọc cả bảng thì với 300+
 * trạm sẽ tự tạo ra vấn đề hiệu năng mới.
 */
function ana_getStationDataStamp(stationName) {
  try {
    _requireApproved_();
    var name = String(stationName || '').trim();
    if (!name) return JSON.stringify({ success: false });

    // Cache rất ngắn (10 giây): nhiều người cùng trạm sẽ hỏi gần như đồng thời,
    // không cần mở sheet lại cho từng người.
    var ck = 'ana_stamp_' + _anaSafeStationKey(name);
    var cache = CacheService.getScriptCache();
    var hit = cache.get(ck);
    if (hit) return hit;

    var ss = getStationSS(name);
    var sheetName = 'Data_' + _anaSafeStationKey(name);
    var sheet = ss.getSheetByName(sheetName);
    var stamp = '', rows = 0;
    if (sheet) {
      rows = Math.max(0, sheet.getLastRow() - 1);
      // Ô A1 giữ thời điểm lưu gần nhất (do saveStationData ghi) — nếu không
      // có thì dùng số dòng làm dấu thay thế, vẫn phát hiện được thay đổi.
      try {
        var a1 = sheet.getRange(1, 1).getDisplayValue();
        if (a1) stamp = String(a1);
      } catch (eA1) {}
    }
    var out = JSON.stringify({ success: true, stamp: stamp, rows: rows });
    try { cache.put(ck, out, 10); } catch (eC) {}
    return out;
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * ana_clearStationData(stationName)
 * [SỬA LỖI THẬT — báo cáo: "xoá dữ liệu BI liệu đã xoá hết chưa?"]
 * Chức năng xoá cũ CHỈ xoá bản trên máy người dùng (IndexedDB) và dọn giao diện.
 * Bản trên MÁY CHỦ (sheet Data_<trạm> và Sup_<trạm> trong file dữ liệu của trạm)
 * vẫn còn nguyên -> mở lại trang là dữ liệu cũ tải về, người dùng tưởng đã xoá.
 * Nguy hiểm nhất khi xoá vì số liệu SAI: số sai vẫn quay lại và bị dùng để ra quyết định.
 * Hàm này xoá đúng phần dữ liệu đơn hàng của trạm trên máy chủ.
 * KHÔNG đụng tới: lịch sử Trend, điểm giao đã lưu cho Vùng giao hàng, và số đã đồng
 * bộ sang Rider Plan — đó là dữ liệu của tính năng khác, xoá kèm sẽ mất ngoài ý muốn.
 */
function ana_clearStationData(stationName) {
  try {
    stationName = String(stationName || '').trim();
    if (!stationName) return JSON.stringify({ success: false, msg: 'Thiếu tên trạm.' });

    // Quyền: chỉ xoá được trạm nằm trong phạm vi của chính người dùng.
    var email = '';
    try { email = Session.getActiveUser().getEmail(); } catch (e) {}
    var perm = checkAnalyticsPermission(email);
    if (!perm || !perm.allowed) return JSON.stringify({ success: false, msg: 'Không có quyền.' });
    var ok = (perm.stations || []).some(function (s) {
      return String(s).trim().toLowerCase() === stationName.toLowerCase();
    });
    if (!ok) return JSON.stringify({ success: false, msg: 'Trạm ngoài phạm vi quản lý của bạn.' });

    var ss = getStationSS(stationName);
    var safe = stationName.replace(/[^a-zA-Z0-9]/g, '_');
    var daXoa = [], soDong = 0;
    ['Data_' + safe, 'Sup_' + safe].forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh) return;
      var rows = Math.max(0, sh.getLastRow() - 1);
      // Giữ lại dòng tiêu đề, xoá toàn bộ dữ liệu bên dưới.
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      daXoa.push(name);
      soDong += rows;
    });
    // Xoá mốc chốt Inbound CỦA RIÊNG TRẠM NÀY. Nếu để lại, số inbound đã chốt của
    // dữ liệu cũ sẽ hiện lại và mâu thuẫn với dữ liệu mới upload.
    // Dùng đúng 2 hàm sẵn có (_anaInboundSheet / _anaFindInboundRow) để chỉ đụng
    // ĐÚNG 1 DÒNG của trạm — sheet 'Inbound_Lock' dùng chung cho mọi trạm.
    try {
      var lockSheet = _anaInboundSheet(ss);
      var lockRow = lockSheet ? _anaFindInboundRow(lockSheet, _anaSafeStationKey(stationName)) : null;
      if (lockRow) {
        lockSheet.getRange(lockRow, 2, 1, lockSheet.getLastColumn() - 1).clearContent();
        daXoa.push('Inbound_Lock (dòng của trạm)');
      }
    } catch (eL) {}

    return JSON.stringify({ success: true, daXoa: daXoa, soDongDaXoa: soDong });
  } catch (e) {
    return JSON.stringify({ success: false, msg: e.message });
  }
}

function getStationDataBundle(stationName) {
  try {
    // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"]
    if (!stationName || !stationName.trim()) {
      return { orders: [], inboundLock: 0, inboundState: null, supplementOrders: [] };
    }
    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm.allowed) {
      return { orders: [], inboundLock: 0, inboundState: null, supplementOrders: [], permError: 'Không có quyền truy cập Analytics.' };
    }
    var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
    if (!_hasSt) {
      return { orders: [], inboundLock: 0, inboundState: null, supplementOrders: [], permError: 'Không có quyền đọc dữ liệu trạm: ' + stationName };
    }

    // ── Thử đọc cache trước — cache HIT thì trả ngay, khỏi đụng tới Sheet ──
    var _cacheKey = 'bundle_' + _anaBundleCacheKey_(stationName);
    var _cachedBundle = CacheMgr.getChunked('ANALYTICS', _cacheKey);
    if (_cachedBundle !== null) return _cachedBundle;

    var ss = getStationSS(stationName);

    // ── Phần Data_ (đơn chính) — logic giống hệt getStationData() ──
    var safeSheetName = "Data_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var sheet = ss.getSheetByName(safeSheetName);
    var orders = [];
    if (sheet && sheet.getLastRow() > 1) {
      var data = sheet.getRange(2, 7, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < data.length; i++) {
        var cellValue = data[i][0];
        if (cellValue && cellValue.toString().trim() !== "") {
          try {
            var parsed = JSON.parse(cellValue.toString().trim());
            if (parsed) orders.push(parsed);
          } catch(e) {
            console.log("Dong loi JSON tai hang " + (i + 2) + ": " + e.message);
          }
        }
      }
    }

    // ── Phần Sup_ (đơn bổ sung) — logic giống hệt getSupplementData() ──
    var safeSupName = "Sup_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var supSheet = ss.getSheetByName(safeSupName);
    var supplementOrders = [];
    if (supSheet && supSheet.getLastRow() > 1) {
      var supData = supSheet.getRange(2, 7, supSheet.getLastRow() - 1, 1).getValues();
      for (var j = 0; j < supData.length; j++) {
        var supCell = supData[j][0];
        if (supCell && supCell.toString().trim() !== "") {
          try {
            var supParsed = JSON.parse(supCell.toString().trim());
            if (supParsed) supplementOrders.push(supParsed);
          } catch(e) {
            console.log("Dong loi JSON bo sung tai hang " + (j + 2) + ": " + e.message);
          }
        }
      }
    }

    // ── Inbound state — đọc 1 lần duy nhất, dùng chung cho cả bundle ──
    var inboundState = _anaReadInboundState(ss, stationName);

    var _bundleResult = {
      ts:               inboundState.ts || null,
      orders:           orders,
      inboundLock:      inboundState.inboundLock || 0,
      inboundState:      inboundState,
      clearEpoch:       _anaGetClearEpoch_(stationName),
      supplementOrders: supplementOrders
    };
    // Ghi cache 20s — setChunked tự "best-effort" (không throw nếu quá lớn/lỗi),
    // nên KHÔNG ảnh hưởng gì tới việc trả kết quả đúng ngay lần đọc này.
    try { CacheMgr.setChunked('ANALYTICS', _cacheKey, _bundleResult, _ANA_BUNDLE_CACHE_TTL_); } catch(e) {}
    return _bundleResult;
  } catch(err) {
    console.error("Loi tong ham getStationDataBundle: ", err.message);
    return { orders: [], inboundLock: 0, inboundState: null, supplementOrders: [] };
  }
}

function getStationData(stationName) {
  try {
    // MU-PERM: Kiểm tra quyền người dùng + trạm
    if (!stationName || !stationName.trim()) return { orders: [], inboundLock: 0, inboundState: null };
    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm.allowed) return { orders: [], inboundLock: 0, inboundState: null, permError: 'Không có quyền truy cập Analytics.' };
    var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
    if (!_hasSt) return { orders: [], inboundLock: 0, inboundState: null, permError: 'Không có quyền đọc dữ liệu trạm: ' + stationName };

    // [FIX 2026-07-21 PERF] Dùng CHUNG cache bundle của getStationDataBundle() nếu đang
    // còn hiệu lực (20s) — CHỈ ĐỌC, không ghi vào cache này từ đây (quyền ghi/invalidate
    // vẫn thuộc riêng getStationDataBundle() + 4 hàm ghi, xem _anaInvalidateBundleCache_).
    // Giữ nguyên format trả về y hệt bản gốc (KHÔNG có field supplementOrders) để không
    // ảnh hưởng bất kỳ nơi gọi hàm này. Cache MISS → rơi xuống đúng logic gốc bên dưới,
    // hành vi giống 100% như trước khi có patch này.
    try {
      var _cachedBundle0 = CacheMgr.getChunked('ANALYTICS', 'bundle_' + _anaBundleCacheKey_(stationName));
      if (_cachedBundle0 !== null) {
        return {
          ts:          _cachedBundle0.ts || null,
          orders:      _cachedBundle0.orders || [],
          inboundLock: _cachedBundle0.inboundLock || 0,
          inboundState: _cachedBundle0.inboundState || null,
          clearEpoch:  _cachedBundle0.clearEpoch
        };
      }
    } catch(eCacheRead0) { /* lỗi đọc cache — bỏ qua, rơi xuống đọc Sheet như bình thường */ }

    var ss = getStationSS(stationName);
    var safeSheetName = "Data_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var sheet = ss.getSheetByName(safeSheetName);

    // Đọc inboundState 1 lần duy nhất sau khi parse orders xong (tránh double API call)
    if (!sheet) {
      var inboundState = _anaReadInboundState(ss, stationName);
      return { ts: inboundState.ts || null, orders: [], inboundLock: inboundState.inboundLock || 0, inboundState: inboundState, clearEpoch: _anaGetClearEpoch_(stationName) };
    }
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      var inboundState = _anaReadInboundState(ss, stationName);
      return { ts: inboundState.ts || null, orders: [], inboundLock: inboundState.inboundLock || 0, inboundState: inboundState, clearEpoch: _anaGetClearEpoch_(stationName) };
    }

    var data = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
    var orders = [];
    for (var i = 0; i < data.length; i++) {
      var cellValue = data[i][0];
      if (cellValue && cellValue.toString().trim() !== "") {
        try {
          var parsed = JSON.parse(cellValue.toString().trim());
          if (parsed) orders.push(parsed);
        } catch(e) {
          console.log("Dong loi JSON tai hang " + (i + 2) + ": " + e.message);
        }
      }
    }

    var inboundState = _anaReadInboundState(ss, stationName);
    return { ts: inboundState.ts || null, orders: orders, inboundLock: inboundState.inboundLock || 0, inboundState: inboundState, clearEpoch: _anaGetClearEpoch_(stationName) };
  } catch(err) {
    console.error("Loi tong ham getStationData: ", err.message);
    return { orders: [], inboundLock: 0, inboundState: null };
  }
}

/**
 * LƯU DATA BỔ SUNG LÊN SUP_ (Chỉ lưu đơn thỏa điều kiện truyền từ Frontend)
 * Giúp biến đếm của mọi User luôn luôn đồng bộ và chính xác.
 */
function saveSupplementData(stationName, supplementJson, clientEpoch) {
  // MU-PERM: Kiểm tra quyền người dùng + trạm
  if (!stationName || !stationName.trim()) return { success: false, msg: 'Thiếu tên trạm.' };
  var _email = Session.getActiveUser().getEmail();
  var _perm  = checkAnalyticsPermission(_email);
  if (!_perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };
  var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
  if (!_hasSt) return { success: false, msg: 'Không có quyền ghi bổ sung trạm: ' + stationName };

  // ANTI-DATA-RESURRECTION: cùng cơ chế guard với saveStationData() — xem
  // _anaCheckClearEpochOrReject_. Sup_ cũng bị "MERGE LŨY TIẾN" ở client nên cần chặn
  // giống hệt, nếu không đơn bổ sung cũ vẫn có thể len lỏi trở lại qua đường Sup_.
  var _epochReject2 = _anaCheckClearEpochOrReject_(stationName, clientEpoch);
  if (_epochReject2) return _epochReject2;

  // FIX RACE ĐA NGƯỜI DÙNG: getUserLock() chỉ chặn cùng 1 tài khoản — 2 user khác nhau
  // cùng quyền 1 trạm ghi Sup_ gần như đồng thời sẽ không bị chặn lẫn nhau, trong khi hàm
  // này đọc-toàn-sheet rồi clearContent()+setValues() lại → người ghi sau đè mất danh sách
  // bổ sung người ghi trước vừa lưu.
  // FIX ĐA TRẠM: dùng CÙNG named-lock key với saveStationData()/clearStationData() — vì
  // saveStationData() cũng dọn dẹp Sup_ (mục "CLEANUP SUP_") của CÙNG trạm, nên cả 3 hàm
  // vẫn cần xếp hàng tuần tự với nhau cho 1 trạm (giữ đúng mục tiêu chống lost update của
  // getScriptLock() cũ) — nhưng không còn chặn các trạm khác ghi/xóa song song.
  var _lockKey = 'ana_save_station_lock_' + _anaSafeStationKey(stationName);
  if (!_anaAcquireNamedLock(_lockKey, 45000)) {
    return { success: false, msg: 'Hệ thống đang bận ghi dữ liệu trạm ' + stationName + ', sếp vui lòng thử lại sau ít giây!' };
  }
  try {
    var ss = getStationSS(stationName);
    var safeSheetName = "Sup_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var sheet = ss.getSheetByName(safeSheetName);
    // Nếu chưa có sheet Sup_ thì tạo mới kèm Header chuẩn 7 cột
    if (!sheet) {
      sheet = ss.insertSheet(safeSheetName);
      sheet.getRange(1, 1, 1, 7).setValues([["Order ID", "Status", "Driver ID", "Driver Name", "Station", "Last Update", "Full Data JSON"]]);
      sheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#f59e0b").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
      if (sheet.getMaxColumns() > 7) {
        sheet.deleteColumns(8, sheet.getMaxColumns() - 7);
      }
    }

    var parsedOrders = JSON.parse(supplementJson || '[]');

    // ĐỌC SNAPSHOT SUP_ HIỆN CÓ TRÊN CLOUD TRƯỚC KHI GHI — cùng nguyên tắc UNION-MERGE
    // đã áp dụng ở saveStationData() (xem comment MU-02 ở đó). TRƯỚC ĐÂY hàm này
    // clearContent() rồi ghi thẳng đúng những gì client gửi lên — nếu User A vừa lưu
    // Sup_ xong, rồi User B (máy đang cầm danh sách Sup_ CŨ HƠN — ví dụ do luồng auto-
    // retry _anaPushPrimaryToCloudWithRetry_ tự gửi kèm DS.supplement.orders hiện có)
    // lưu tiếp ngay sau đó, dữ liệu bổ sung của A bị B XÓA SẠCH dù A ghi trước B — lock
    // chỉ đảm bảo 2 lệnh không đè giờ ghi lên nhau, không đảm bảo nội dung không mất.
    var _cloudSupSnap = {};
    if (sheet && sheet.getLastRow() > 1) {
      var _existingSupData = sheet.getRange(2, 7, sheet.getLastRow() - 1, 1).getValues();
      for (var _si2 = 0; _si2 < _existingSupData.length; _si2++) {
        try {
          var _eso = JSON.parse(_existingSupData[_si2][0] || 'null');
          if (_eso && _eso.orderId) _cloudSupSnap[_eso.orderId] = _eso;
        } catch(eSupSnapParse) {}
      }
    }

    // RULE CHỮA LỖI BIẾN ĐẾM VỀ 0: mảng rỗng KHÔNG còn được coi là "user chủ động xóa
    // hết" — việc xóa thật sự (Xóa dữ liệu) đã có clearStationData() đảm nhiệm riêng
    // (xóa cả Data_ lẫn Sup_ + bump clearEpoch). Ở đây, payload rỗng chỉ có nghĩa là
    // "client này không có gì mới để thêm/sửa" → GIỮ NGUYÊN Sup_ hiện có trên Cloud,
    // không xóa — tránh đúng tình huống máy B gửi list rỗng/cũ đè mất Sup_ của máy A.
    if (!parsedOrders || parsedOrders.length === 0) {
      return { success: true, count: Object.keys(_cloudSupSnap).length, cleared: false, clearEpoch: _anaGetClearEpoch_(stationName) };
    }

    // UNION theo orderId: giữ lại mọi đơn Cloud đang có, chỉ ghi đè/thêm đúng những
    // đơn client vừa gửi — không còn cảnh 1 client "biết ít hơn" xóa mất phần Cloud
    // đã có mà máy đó chưa kịp thấy.
    var _mergedSupMap = {};
    Object.keys(_cloudSupSnap).forEach(function(oid) { _mergedSupMap[oid] = _cloudSupSnap[oid]; });
    parsedOrders.forEach(function(o) { if (o && o.orderId) _mergedSupMap[o.orderId] = o; });
    var mergedSupOrders = Object.values(_mergedSupMap);

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).clearContent();
    }

    var now = _anaVNNow();
    var rowsToAppend = mergedSupOrders.map(function(o) {
      return [
        o.orderId,
        o.status,
        o.driverId || '',
        o.driverName || '',
        stationName,
        now,
        JSON.stringify(o) // Cột 7: Phục vụ load full data JSON về client đối soát
      ];
    });

    if (rowsToAppend.length > 0) {
      sheet.getRange(2, 1, rowsToAppend.length, 7).setValues(rowsToAppend);
    }

    // [FIX 2026-07-B] CHỐT SỔ INBOUND NGAY TẠI ĐÂY — dữ liệu bổ sung vừa được lưu thật.
    // Đọc kèm Data_ hiện có (primary) để dedupe đúng (đơn đã có ở primary thì không tính
    // lại ở supplement), cùng logic/thứ tự với saveStationData().
    // [2026-07 COST FIX] Trả thẳng state về response — bỏ round-trip getStationData() thừa
    // phía client (xem giải thích đầy đủ ở saveStationData()).
    var _freshInboundState2 = null;
    try {
      var _priForLock = [];
      var _safeDataName = "Data_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
      var _dataSheetForLock = ss.getSheetByName(_safeDataName);
      if (_dataSheetForLock && _dataSheetForLock.getLastRow() > 1) {
        var _priRaw = _dataSheetForLock.getRange(2, 7, _dataSheetForLock.getLastRow() - 1, 1).getValues();
        for (var _pi = 0; _pi < _priRaw.length; _pi++) {
          try {
            var _po = JSON.parse(_priRaw[_pi][0] || 'null');
            if (_po && _po.orderId) _priForLock.push(_po);
          } catch(ePriParse) {}
        }
      }
      // [FIX] Dùng mergedSupOrders (đã UNION với Cloud) thay vì parsedOrders (chỉ riêng
      // phần client vừa gửi) — tính Inbound phải dựa trên TOÀN BỘ Sup_ thật sự đang có
      // trên Cloud sau khi ghi, không phải chỉ phần 1 client vừa biết.
      _freshInboundState2 = _anaComputeAndLockInboundServer_(ss, stationName, _priForLock, mergedSupOrders);
    } catch (eLockCompute2) {
      console.warn('[Inbound] Tính/chốt sổ Inbound lỗi trong saveSupplementData (bỏ qua, giữ sổ cũ): ' + eLockCompute2.message);
    }

    _anaInvalidateBundleCache_(stationName); // [FIX 2026-07-21 PERF]
    return { success: true, count: rowsToAppend.length, inboundLock: (_freshInboundState2 && _freshInboundState2.inboundLock) || 0, inboundState: _freshInboundState2, clearEpoch: _anaGetClearEpoch_(stationName), inboundSyncDegraded: !!(_freshInboundState2 && _freshInboundState2.fsWriteOk === false) };
  } catch(err) {
    return { success: false, msg: err.message };
  } finally {
    _anaReleaseNamedLock(_lockKey);
  }
}

/**
 * 6. Tải data bổ sung của trạm về client (Chuẩn cấu trúc 7 cột giống getStationData)
 * Đảm bảo Trình duyệt B kéo về đúng mảng Object để đối soát, biến đếm sáng đèn chuẩn xác
 */
function getSupplementData(stationName) {
  try {
    // MU-PERM: Kiểm tra quyền người dùng + trạm
    if (!stationName || !stationName.trim()) return '[]';
    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm.allowed) return '[]';
    var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
    if (!_hasSt) return '[]';

    // [FIX 2026-07-21 PERF] Cùng lý do như getStationData() ở trên — dùng chung cache
    // bundle CHỈ ĐỌC, giữ nguyên format trả về (JSON string) y hệt bản gốc.
    try {
      var _cachedBundle1 = CacheMgr.getChunked('ANALYTICS', 'bundle_' + _anaBundleCacheKey_(stationName));
      if (_cachedBundle1 !== null) {
        return JSON.stringify(_cachedBundle1.supplementOrders || []);
      }
    } catch(eCacheRead1) { /* lỗi đọc cache — bỏ qua, rơi xuống đọc Sheet như bình thường */ }

    var ss = getStationSS(stationName);
    var safeSheetName = "Sup_" + stationName.replace(/[^a-zA-Z0-9]/g, "_");
    var sheet = ss.getSheetByName(safeSheetName);
    
    if (!sheet) return "[]";
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return "[]";
    
    // Bốc dữ liệu 7 cột chuẩn xác từ cột G (Cột số 7)
    var data = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
    var orders = [];
    
    for (var i = 0; i < data.length; i++) {
      var cellValue = data[i][0];
      if (cellValue && cellValue.toString().trim() !== "") {
        try { 
          var cleanStr = cellValue.toString().trim();
          var parsed = JSON.parse(cleanStr);
          if (parsed) orders.push(parsed); 
        } catch(e) {
          console.log("Dòng lỗi JSON bổ sung tại hàng " + (i + 2) + ": " + e.message);
        }
      }
    }
    return JSON.stringify(orders);
  } catch(err) {
    return "[]";
  }
}

function getInboundLock(stationName) {
  try {
    if (!stationName || !stationName.trim()) return '0';
    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm.allowed) return '0';
    var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
    if (!_hasSt) return '0';
    var ss = getStationSS(stationName);
    return String(_anaReadInboundState(ss, stationName).inboundLock || 0);
  } catch(err) {
    return '0';
  }
}

/**
 * Hàm ghi nhận số chốt chặn Inbound chuẩn từ máy gốc lên hệ thống trung tâm đám mây
 * Giúp mọi User, thiết bị khác truy cập vào trạm đều đọc chung 1 con số duy nhất
 */
function saveInboundLockToCloud(stationName, inboundValue) {
  if (!stationName || !stationName.trim()) return { success: false, msg: "Khong co ten tram" };
  // FIX BẢO MẬT ĐA TRẠM: hàm này trước đây KHÔNG kiểm tra quyền — bất kỳ user đã đăng
  // nhập (kể cả không có quyền Analytics, hoặc có quyền trạm khác) đều có thể gọi và ghi
  // đè inbound lock của BẤT KỲ trạm nào. Thêm cùng kiểm tra quyền như mọi hàm save/get khác.
  var _email = Session.getActiveUser().getEmail();
  var _perm  = checkAnalyticsPermission(_email);
  if (!_perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };
  var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
  if (!_hasSt) return { success: false, msg: 'Không có quyền ghi inbound lock trạm: ' + stationName };

  // FIX RACE ĐA NGƯỜI DÙNG: getUserLock() chỉ chặn cùng 1 tài khoản — 2 user khác nhau
  // cùng quyền 1 trạm ghi inbound lock gần như đồng thời sẽ không bị chặn lẫn nhau.
  // _anaSaveInboundState() đã tự UNION allIds để tránh mất ID, nhưng vẫn cần lock chung
  // để tránh đọc-ghi xen kẽ làm method tìm/xóa dòng trùng lệch nhau.
  // [FIX 2026-07] LOCK KEY LỆCH — trước đây dùng lockKey RIÊNG 'ana_inbound_lock_' trong
  // khi saveStationData() (cũng ghi CÙNG state qua _anaSaveInboundState() ở nhánh
  // "if (inboundLock)") lại dùng lockKey KHÁC 'ana_save_station_lock_'. Hai lock khác
  // nhau KHÔNG chặn nhau → saveStationData() và saveInboundLockToCloud() của CÙNG 1 trạm
  // có thể chạy song song, cùng đọc-cùng-ghi Firestore inbound_live/Sheet Inbound_Lock →
  // lost update (đây là gốc rễ "số liệu cập nhật sai khi đa trạm đa người dùng save/load").
  // Đổi về DÙNG CHUNG lockKey 'ana_save_station_lock_' với saveStationData()/
  // clearStationData()/saveSupplementData() — mọi thao tác đụng vào state của 1 trạm giờ
  // xếp hàng tuần tự với nhau; các trạm khác nhau vẫn chạy song song bình thường.
  var _lockKey = 'ana_save_station_lock_' + _anaSafeStationKey(stationName);
  if (!_anaAcquireNamedLock(_lockKey, 45000)) {
    return { success: false, msg: 'Hệ thống đang bận ghi inbound lock trạm ' + stationName + ', sếp vui lòng thử lại sau ít giây!' };
  }
  try {
    var ss = getStationSS(stationName);
    var state = (typeof inboundValue === 'string') ? JSON.parse(inboundValue) : inboundValue;
    if (typeof state === 'number') state = { inboundLock: state };
    var saved = _anaSaveInboundState(ss, stationName, state || {});
    _anaInvalidateBundleCache_(stationName); // [FIX 2026-07-21 PERF]
    return { success: true, state: saved, msg: "Da khoa so " + saved.inboundLock + " tren Google Sheet tram " + stationName };
  } catch(err) {
    return { success: false, msg: err.message };
  } finally {
    _anaReleaseNamedLock(_lockKey);
  }
}

// ============================================================
// [2026-07] TỒN / TỒN MỚI + ĐƠN VÔ CHỦ — ĐỒNG BỘ ĐA NGƯỜI DÙNG
// ============================================================
// Trước đây "Tồn/Tồn Mới" (và snapshot đơn vô chủ) CHỈ tính client-side, đồng
// bộ đa-tab CÙNG 1 người dùng qua BroadcastChannel (NT-06 trong Analytics_Block
// — xem comment gốc ở đó). Nhược điểm: 2 user khác nhau (khác máy/khác trình
// duyệt) cùng xem 1 trạm vẫn thấy số lệch nhau tới khi tự tải lại.
//
// GIẢI PHÁP: tận dụng ĐÚNG document inbound_live đã có sẵn (mỗi trạm 1 doc,
// dùng cho Inbound Lock) — ghi thêm vài field nhỏ bằng _fsPatchInboundLiveOps_
// (updateMask), KHÔNG đụng idDatesJson/seenIdsJson (field lớn, tới ~900KB).
// Không tạo collection mới, không cần schema mới, rủi ro thấp nhất.
//
// So sánh "mới hơn" dùng dataTs = giờ NẠP DỮ LIỆU phía client (Date.parse
// DS.primary.uploadTime) — CÙNG bản chất với NT-06, KHÔNG dùng giờ ghi lên
// server, để giữ đúng nguyên tắc "dữ liệu của ai mới hơn thắng", không phải
// "ai ghi lên sau thắng".
// ============================================================

/**
 * ana_pushTonState(stationName, payloadJson)
 * payload: { tonMoiIds:[], tonTongIds:[], dataTs:Number, date:"yyyy-MM-dd",
 *            orphan:{ total, urgent, codOrders, codValue } }
 * Fire-and-forget từ client (không chặn UI) — lỗi ở đây KHÔNG được làm hỏng
 * số Tồn hiển thị cục bộ của người gọi, nên luôn trả object thay vì throw.
 */
function ana_pushTonState(stationName, payloadJson) {
  try {
    if (!stationName || !stationName.trim()) return { success: false, msg: 'Khong co ten tram' };
    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };
    var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
    if (!_hasSt) return { success: false, msg: 'Không có quyền ghi dữ liệu Tồn trạm: ' + stationName };

    var p = (typeof payloadJson === 'string') ? JSON.parse(payloadJson) : (payloadJson || {});
    var stationKey = _anaSafeStationKey(stationName);
    var todayKey   = _anaTodayKey();
    var now = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ss'+07:00'");

    var tonMoiIds  = Array.isArray(p.tonMoiIds)  ? p.tonMoiIds  : [];
    var tonTongIds = Array.isArray(p.tonTongIds) ? p.tonTongIds : [];
    var dataTs     = parseInt(p.dataTs || 0, 10) || 0;
    var orphan     = (p.orphan && typeof p.orphan === 'object') ? p.orphan : {};

    // Trần dè dặt hơn nhiều so với 900.000 của idDates — đây chỉ là field PHỤ,
    // không cần giữ lịch sử, chỉ cần đủ cho hiển thị "danh sách đơn" nhanh.
    var TON_MAX_LEN = 400000;
    var tonTongJson = JSON.stringify(tonTongIds);
    if (tonTongJson.length > TON_MAX_LEN) {
      tonTongIds  = tonTongIds.slice(0, Math.max(0, Math.floor(tonTongIds.length * TON_MAX_LEN / tonTongJson.length)));
      tonTongJson = JSON.stringify(tonTongIds);
    }
    var tonMoiJson = JSON.stringify(tonMoiIds);
    if (tonMoiJson.length > TON_MAX_LEN) {
      tonMoiIds  = tonMoiIds.slice(0, Math.max(0, Math.floor(tonMoiIds.length * TON_MAX_LEN / tonMoiJson.length)));
      tonMoiJson = JSON.stringify(tonMoiIds);
    }

    _fsPatchInboundLiveOps_(stationKey, {
      tonDate:         todayKey,
      tonDataTs:       dataTs,
      tonMoiCount:     tonMoiIds.length,
      tonTongCount:    tonTongIds.length,
      tonMoiIdsJson:   tonMoiJson,
      tonTongIdsJson:  tonTongJson,
      orphanTotal:     parseInt(orphan.total     || 0, 10) || 0,
      orphanUrgent:    parseInt(orphan.urgent    || 0, 10) || 0,
      orphanCodOrders: parseInt(orphan.codOrders || 0, 10) || 0,
      orphanCodValue:  parseInt(orphan.codValue  || 0, 10) || 0,
      tonUpdatedAt:    now,
      tonUpdatedBy:    _email
    });
    return { success: true };
  } catch (e) {
    console.warn('[Ton] ana_pushTonState lỗi (bỏ qua, không chặn client): ' + e.message);
    return { success: false, msg: e.message };
  }
}

/**
 * ana_getTonState(stationName)
 * Đọc lại Tồn/Tồn Mới + đơn vô chủ của trạm từ inbound_live — client dùng để
 * so sánh dataTs với dữ liệu cục bộ, ưu tiên bên nào MỚI HƠN (cùng cơ chế
 * override đã có sẵn cho BroadcastChannel, chỉ khác nguồn là server).
 * Trả has:false nếu chưa có dữ liệu Tồn nào của HÔM NAY cho trạm này.
 */
function ana_getTonState(stationName) {
  try {
    if (!stationName || !stationName.trim()) return { success: false };
    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm.allowed) return { success: false };
    var _hasSt = _perm.stations.some(function(s){ return s.trim().toLowerCase() === stationName.trim().toLowerCase(); });
    if (!_hasSt) return { success: false };

    var stationKey = _anaSafeStationKey(stationName);
    var todayKey   = _anaTodayKey();
    // [2026-07 COST FIX-2] TTL 75s → 170s, khớp nhịp poll fallback mới (150s —
    // xem window._tonPollServer trong Analytics_Block.html). Đọc qua cache dùng
    // chung thay vì Firestore trực tiếp mỗi lần; nhiều SUP/AOM cùng xem 1 trạm
    // vẫn CHUNG 1 lần đọc Firestore trong cùng cửa sổ TTL thay vì mỗi tab đọc
    // riêng. Xem chi tiết comment tại _fsGetInboundLiveCached_ trong
    // Firestore_bridge.gs.
    var live = _fsGetInboundLiveCached_(stationKey, 170);
    if (!live || String(live.tonDate || '') !== todayKey) {
      return { success: true, has: false };
    }
    var tonMoiIds = [], tonTongIds = [];
    try { tonMoiIds  = JSON.parse(live.tonMoiIdsJson  || '[]'); } catch (e1) {}
    try { tonTongIds = JSON.parse(live.tonTongIdsJson || '[]'); } catch (e2) {}
    if (!Array.isArray(tonMoiIds))  tonMoiIds  = [];
    if (!Array.isArray(tonTongIds)) tonTongIds = [];

    return {
      success: true, has: true,
      station: stationKey, date: todayKey,
      dataTs: parseInt(live.tonDataTs || 0, 10) || 0,
      tonMoiIds: tonMoiIds, tonTongIds: tonTongIds,
      orphan: {
        total:     parseInt(live.orphanTotal     || 0, 10) || 0,
        urgent:    parseInt(live.orphanUrgent    || 0, 10) || 0,
        codOrders: parseInt(live.orphanCodOrders || 0, 10) || 0,
        codValue:  parseInt(live.orphanCodValue  || 0, 10) || 0
      },
      updatedAt: live.tonUpdatedAt || null,
      updatedBy: live.tonUpdatedBy || ''
    };
  } catch (e) {
    console.warn('[Ton] ana_getTonState lỗi: ' + e.message);
    return { success: false, msg: e.message };
  }
}

/**
 * [2026-07] getFirebaseAuthToken(stationName)
 * Entrypoint client gọi để lấy custom token đăng nhập Firebase Auth (SDK phía
 * trình duyệt), THAY THẾ dần window._tonPollServer (poll 25s qua GAS) bằng
 * onSnapshot lắng nghe trực tiếp document inbound_live/{stationKey} — mục
 * đích loại bỏ phần đọc lặp lại khỏi quota UrlFetchApp của GAS (xem chi tiết
 * thiết kế + mẫu Security Rules trong comment đầu khối "FIREBASE AUTH CUSTOM
 * TOKEN" của Firestore_bridge.gs).
 *
 * Kiểm tra quyền y hệt các hàm Analytics khác (checkAnalyticsPermission) TRƯỚC
 * khi mint token — token chỉ cấp cho user có quyền đọc Analytics, và document
 * permissions/{uid} luôn được ghi lại đúng danh sách trạm hiện tại của user đó
 * ngay trong lần gọi này, để Security Rules phía Firestore xác thực đúng theo
 * quyền tại thời điểm mint (không dùng danh sách quyền cũ/cache).
 *
 * Trả về cả FIRESTORE_PROJECT_ID để client khởi tạo Firebase SDK mà không cần
 * hardcode projectId riêng trong HTML (tránh lệch giữa 2 nơi cấu hình).
 */
function getFirebaseAuthToken(stationName) {
  try {
    // ═══════════════════════════════════════════════════════════════════
    // [2026-07 — AN TOÀN QUY MÔ] 2 lớp chặn SỚM, chạy TRƯỚC mọi thao tác
    // Firestore (kể cả _fsSyncPermissionDoc_ ghi permissions) — mục đích: nếu
    // có bug tương lai gây gọi lặp (giống bug write-storm đã vá ở NT-09), 2 lớp
    // này chặn đứng TẠI NGUỒN, không để lan ra Firestore, dù ở quy mô bao nhiêu
    // trạm. Client (NT-08/NT-09) đã có sẵn cơ chế fallback an toàn khi hàm này
    // trả về success:false — tự động rơi về poll cũ, KHÔNG có đường nào khiến
    // Tồn/chuông cảnh báo ngừng cập nhật hẳn.
    // ═══════════════════════════════════════════════════════════════════

    // (a) KILL SWITCH — đặt Script Property FIRESTORE_REALTIME_KILL_SWITCH = '1'
    // để tắt NGAY toàn bộ realtime listener trên MỌI trạm/mọi user, hiệu lực
    // tức thì (không cần deploy lại). Dùng khi cần dừng khẩn cấp lúc theo dõi
    // billing thấy bất thường.
    if (PropertiesService.getScriptProperties().getProperty('FIRESTORE_REALTIME_KILL_SWITCH') === '1') {
      return { success: false, msg: 'Realtime tạm khoá (kill switch).' };
    }

    // (b) RATE LIMIT toàn hệ thống — đếm số lần mint token trong cửa sổ 60s
    // bằng CacheService (dùng CHUNG cho mọi user, không phải per-user), vượt
    // ngưỡng thì từ chối cho tới cửa sổ kế tiếp. Đây là chốt chặn KHÔNG PHỤ
    // THUỘC số trạm — dù 391 hay 6.000 trạm, tốc độ ghi permissions/mint token
    // tối đa vẫn bị ép về đúng 1 con số cố định. Đếm có thể lệch nhẹ do
    // CacheService không atomic 100% ở tần suất rất cao — chấp nhận được vì
    // đây là van an toàn mềm (soft limit), không phải giới hạn bảo mật cứng.
    var RATE_LIMIT_PER_MIN = 300; // ~5 mint/giây trung bình — dư sức cho vận hành bình thường, đủ thấp để chặn storm
    var cache = CacheService.getScriptCache();
    var bucketKey = 'fs_mint_rl_' + Math.floor(Date.now() / 60000);
    var curCount = parseInt(cache.get(bucketKey) || '0', 10) || 0;
    if (curCount >= RATE_LIMIT_PER_MIN) {
      console.warn('[FirebaseAuth] Vượt rate limit mint token (' + RATE_LIMIT_PER_MIN + '/phút) — từ chối tạm, client tự rơi về poll cũ.');
      return { success: false, msg: 'Hệ thống đang bận, thử lại sau.', throttled: true };
    }
    try { cache.put(bucketKey, String(curCount + 1), 70); } catch (eRlPut) { /* lỗi cache — bỏ qua, không chặn request */ }

    var email = Session.getActiveUser().getEmail();
    var perm  = checkAnalyticsPermission(email);
    if (!perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };
    if (stationName && stationName.trim()) {
      var hasSt = perm.stations.some(function(s) {
        return s.trim().toLowerCase() === stationName.trim().toLowerCase();
      });
      if (!hasSt) return { success: false, msg: 'Không có quyền đọc dữ liệu trạm: ' + stationName };
    }

    var uid = _fsAuthUidFromEmail_(email);
    var stationKeys = (perm.stations || []).map(function(s) { return _normStationKey_(s); });
    _fsSyncPermissionDoc_(uid, stationKeys);
    var token = _fsMintFirebaseAuthToken_(uid);

    // Trả kèm stationKey đã chuẩn hoá bởi SERVER — client dùng thẳng chuỗi này
    // làm docId khi subscribe Firestore, TUYỆT ĐỐI không tự tính lại ở JS phía
    // trình duyệt (tránh lặp lại đúng lớp bug diacritics đã từng vá ở
    // _anaSafeStationKey/_normStationKey_ trước đây — 2 nơi tính ra 2 kết quả
    // khác nhau sẽ khiến listener subscribe nhầm document, âm thầm không lỗi).
    var apiKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_WEB_API_KEY') || '';
    // [MỚI — "FCM foreground"] VAPID key là KHOÁ CÔNG KHAI (public key) dùng để
    // đăng ký nhận push — an toàn khi trả về client, không phải bí mật như
    // FIRESTORE_SERVICE_ACCOUNT_JSON. Lấy 1 lần trong Firebase Console >
    // Project Settings > Cloud Messaging > Web configuration > Generate key pair.
    var vapidKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_VAPID_KEY') || '';

    return {
      success: true,
      token: token,
      uid: uid,
      projectId: _fsProjectId_(),
      apiKey: apiKey,
      vapidKey: vapidKey,
      stationKey: stationName ? _normStationKey_(stationName) : '',
      expiresInSec: 3600
    };
  } catch (e) {
    console.warn('[FirebaseAuth] getFirebaseAuthToken lỗi: ' + e.message);
    return { success: false, msg: e.message };
  }
}


// ==========================================
// CẤU HÌNH CHUNG — insea.io SuperAgent
// ==========================================
var INSEA_API_URL = 'https://ai.insea.io/api/superagents/22541/run';

/**
 * Lấy token từ PropertiesService — không hardcode trong source.
 * Cách lưu 1 lần: mở Apps Script → Project Settings → Script Properties
 * → thêm key "INSEA_TOKEN" với value là token của bạn.
 * Fallback về giá trị cũ nếu chưa cấu hình (tránh crash ngay lập tức).
 */
function _getInseaToken() {
  try {
    var t = PropertiesService.getScriptProperties().getProperty('INSEA_TOKEN');
    if (t && t.trim()) return t.trim();
  } catch(e) {}
  // Fallback — nên xóa sau khi đã lưu vào Script Properties
  return 'vETwaMev7tNNhukmbsTUia0Ogx0yIjuL';
}

/**
 * _getInseaTokens_()
 * [MỚI — theo yêu cầu trực tiếp "add thêm 2,3 key, hết hạn mức tự chuyển
 * sang key khác"] Trả về DANH SÁCH token theo thứ tự ưu tiên (key chính
 * trước, dự phòng sau) — _callInsea() bên dưới tự thử lần lượt khi gặp HTTP
 * 429 (hết hạn mức) ở key đang dùng.
 *
 * CÁCH THÊM KEY DỰ PHÒNG (không cần deploy lại code):
 *   Apps Script Editor → biểu tượng bánh răng "Project Settings" (góc trái)
 *   → mục "Script Properties" → "Add script property" → thêm lần lượt:
 *     INSEA_TOKEN    = <key chính, đã có sẵn>
 *     INSEA_TOKEN_2  = <key dự phòng thứ 2>
 *     INSEA_TOKEN_3  = <key dự phòng thứ 3>
 *   Đánh số PHẢI LIÊN TỤC (2, 3, 4...) — hàm dừng dò ở số đầu tiên bị bỏ
 *   trống. Không cần có đủ INSEA_TOKEN_2/3 — bỏ trống thì hệ thống tự chỉ
 *   dùng 1 key như trước, không bắt buộc.
 */
function _getInseaTokens_() {
  var props = PropertiesService.getScriptProperties();
  var list = [];
  var first = (props.getProperty('INSEA_TOKEN') || '').trim();
  // Fallback token cũ hard-code trong source — GIỮ để không crash nếu Script
  // Properties chưa cấu hình key chính. LƯU Ý RIÊNG: token lộ thẳng trong mã
  // nguồn là rủi ro bảo mật thật (ai đọc được file .gs này cũng dùng được) —
  // nên xoá dòng fallback này khỏi source sau khi đã lưu INSEA_TOKEN vào
  // Script Properties. Không tự xoá ở đây vì ngoài phạm vi việc đang làm.
  list.push(first || 'vETwaMev7tNNhukmbsTUia0Ogx0yIjuL');
  for (var i = 2; i <= 10; i++) { // trần 10 key — dư sức dùng, tránh dò vô hạn nếu cấu hình sai
    var k = (props.getProperty('INSEA_TOKEN_' + i) || '').trim();
    if (!k) break; // dừng ở số đầu tiên bị bỏ trống — đánh số phải liên tục
    list.push(k);
  }
  return list;
}
// [MỚI] Nhớ lại (5 phút) key vừa gọi THÀNH CÔNG gần nhất — để lần gọi SAU bắt
// đầu ngay từ key đó, khỏi dội request thất bại vào (các) key trước đó đã
// biết là hết hạn mức trong lúc chúng chưa được nạp lại quota.
var INSEA_KEY_CACHE_KEY = 'insea_active_key_idx';
var INSEA_KEY_CACHE_TTL = 300;

/**
 * HELPER CHUNG — gọi insea.io SuperAgent và trả về text
 *
 * @param {string} promptText   — nội dung prompt
 * @param {object} [opts]       — tuỳ chọn mở rộng
 *   opts.cacheKey  {string}  — nếu truyền vào, kết quả được cache bằng CacheService
 *   opts.cacheTTL  {number}  — TTL cache tính bằng giây (mặc định 300 = 5 phút)
 * @returns {{ success: boolean, text: string, fromCache?: boolean, isQuota?: boolean }}
 *
 * TIẾT KIỆM TOKEN:
 *   ① Chỉ gọi API khi user bấm nút (Frontend không gọi auto)
 *   ② Cache kết quả theo cacheKey — cùng data không gọi lại trong TTL
 *   ③ Prompt ngắn gọn — chỉ số liệu thô, không mô tả dài
 */
/**
 * [FIX] Phát hiện SuperAgent (insea.io) trả về câu CHÀO MỞ ĐẦU mặc định thay vì
 * xử lý thật nội dung/số liệu đã gửi lên — xảy ra khi mỗi request bị server coi
 * là 1 phiên hội thoại HOÀN TOÀN MỚI (do _callInsea không gửi conversation_id/
 * session_id). Nhận diện qua các cụm đặc trưng của câu chào mặc định, không phải
 * nội dung phân tích thật (phân tích thật luôn có số liệu cụ thể, không có các
 * cụm mời chào chung chung này).
 */
function _isInseaCannedGreeting(text) {
  if (!text) return false;
  var t = text.toString();
  var markers = ['sẵn sàng trực ca', 'dán ngữ cảnh hoặc bảng tính', 'mascot ai đã sẵn sàng'];
  var tLower = t.toLowerCase();
  return markers.some(function(m) { return tLower.indexOf(m) !== -1; });
}

/**
 * BỘ ĐẾM HẠN MỨC AI — [MỚI, theo yêu cầu: "phải có số rõ ràng cụ thể"]
 * Trước đây hệ thống CÓ phát hiện hết hạn mức (mã 429, tự chuyển khoá dự phòng)
 * nhưng KHÔNG đếm và không hiển thị ở đâu — không ai biết đã dùng bao nhiêu, còn
 * bao nhiêu, hay AI có đang phản hồi không.
 * Đếm theo NGÀY (giờ VN), lưu trong Script Properties (bền qua các lượt chạy).
 */
var SPX_AI_STATS_KEY = 'spx_ai_stats_v1';
function _spxAiStatsToday_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
}
function _spxAiCount_(loai, extra) {
  try {
    var props = PropertiesService.getScriptProperties();
    var all = JSON.parse(props.getProperty(SPX_AI_STATS_KEY) || '{}');
    var day = _spxAiStatsToday_();
    var s = all[day] || { goi: 0, thanhCong: 0, tuCache: 0, hetHanMuc: 0, loiKhac: 0, lanHetHanMucCuoi: '', khoaDangDung: 0 };
    if (loai && s.hasOwnProperty(loai)) s[loai]++;
    if (loai === 'hetHanMuc') s.lanHetHanMucCuoi = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'HH:mm:ss');
    if (extra && typeof extra.khoa === 'number') s.khoaDangDung = extra.khoa + 1;
    all[day] = s;
    // Giữ 14 ngày gần nhất cho gọn
    var days = Object.keys(all).sort();
    while (days.length > 14) { delete all[days.shift()]; }
    props.setProperty(SPX_AI_STATS_KEY, JSON.stringify(all));
  } catch (e) {}
}

/**
 * spx_getAiQuotaStats() — số liệu cho panel "HẠN MỨC AI" ở trang Quản trị.
 */
// ════════════════════════════════════════════════════════════════════════
// [MỚI] GÓP Ý / BÁO LỖI TỪ NGƯỜI DÙNG — kèm ảnh chụp màn hình (tuỳ chọn)
// Theo yêu cầu: "cần có feedback từ user gửi về admin, có thể đính kèm hình ảnh".
// Lưu vào sheet 'User_Feedback' trong Admin DB; ảnh lưu Drive cùng thư mục file
// chủ, chỉ giữ ĐƯỜNG DẪN trong sheet (ô Sheets không chứa nổi ảnh).
// Kèm sẵn BỐI CẢNH kỹ thuật (module đang mở, trạm, cấp bậc, trình duyệt) để admin
// không phải hỏi lại — phần lớn báo lỗi thiếu chính là mấy thông tin này.
// ════════════════════════════════════════════════════════════════════════
var FEEDBACK_SHEET = 'User_Feedback';
var FEEDBACK_MAX_IMAGE_MB = 5;

function spx_submitFeedback(payloadJson) {
  try {
    var p = (typeof payloadJson === 'string') ? JSON.parse(payloadJson) : (payloadJson || {});
    var noiDung = String(p.noiDung || '').trim();
    if (!noiDung) return JSON.stringify({ success: false, msg: 'Chưa nhập nội dung góp ý.' });
    if (noiDung.length > 3000) noiDung = noiDung.slice(0, 3000);

    var access = {};
    try { access = getModuleAccess() || {}; } catch (eA) {}
    var email = access.email || '';
    try { if (!email) email = Session.getActiveUser().getEmail(); } catch (eE) {}

    // Ảnh: nhận base64 từ trình duyệt, lưu thành file Drive, sheet chỉ giữ đường dẫn.
    var anhUrl = '';
    if (p.anhBase64) {
      try {
        var mime = String(p.anhMime || 'image/png');
        if (mime.indexOf('image/') !== 0) throw new Error('Chỉ nhận tệp ảnh.');
        var bytes = Utilities.base64Decode(p.anhBase64);
        if (bytes.length > FEEDBACK_MAX_IMAGE_MB * 1024 * 1024) {
          throw new Error('Ảnh vượt quá ' + FEEDBACK_MAX_IMAGE_MB + 'MB.');
        }
        var ten = 'feedback_' + Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyyMMdd_HHmmss') +
                  '_' + String(email).split('@')[0] + '.' + (mime.split('/')[1] || 'png');
        var blob = Utilities.newBlob(bytes, mime, ten);
        var folder = null;
        try {
          var parents = DriveApp.getFileById(ADMIN_DB_ID).getParents();
          if (parents.hasNext()) folder = parents.next();
        } catch (eF) {}
        var file = folder ? folder.createFile(blob) : DriveApp.createFile(blob);
        anhUrl = file.getUrl();
      } catch (eImg) {
        // Ảnh lỗi KHÔNG được làm mất góp ý — vẫn lưu phần chữ, ghi rõ lý do.
        anhUrl = '(không lưu được ảnh: ' + eImg.message + ')';
      }
    }

    var ss = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName(FEEDBACK_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(FEEDBACK_SHEET);
      sheet.appendRow(['Thời gian', 'Email', 'Cấp bậc', 'Trạm', 'Loại', 'Nội dung', 'Ảnh', 'Module', 'Bối cảnh', 'Trạng thái', 'Ghi chú xử lý']);
      sheet.setFrozenRows(1);
    }
    var lv = { levelLabel: '' };
    try { lv = _spx_mapRoleToLevel_(access); } catch (eL) {}
    sheet.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss'),
      email,
      lv.levelLabel || access.role || '',
      (access.hubs && access.hubs.length === 1) ? access.hubs[0] : ((access.hubs && access.hubs.length) ? access.hubs.length + ' trạm' : ''),
      String(p.loai || 'Góp ý'),
      noiDung,
      anhUrl,
      String(p.module || ''),
      String(p.boiCanh || '').slice(0, 500),
      'Mới',
      ''
    ]);
    return JSON.stringify({ success: true, coAnh: !!anhUrl });
  } catch (e) {
    return JSON.stringify({ success: false, msg: e.message });
  }
}

/** spx_getFeedbackList() — danh sách góp ý cho trang Quản trị (mới nhất trước). */
function spx_getFeedbackList() {
  try {
    _requireAdmin_(2);
    var sheet = _DS.ss(ADMIN_DB_ID).getSheetByName(FEEDBACK_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ success: true, items: [], tong: 0 });
    var v = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
    var items = [];
    for (var i = v.length - 1; i >= 0 && items.length < 100; i--) {
      items.push({
        dong: i + 2, thoiGian: String(v[i][0]), email: String(v[i][1]), cap: String(v[i][2]),
        tram: String(v[i][3]), loai: String(v[i][4]), noiDung: String(v[i][5]),
        anh: String(v[i][6]), module: String(v[i][7]), trangThai: String(v[i][9] || 'Mới')
      });
    }
    var chuaXuLy = 0;
    for (var k = 0; k < v.length; k++) { if (String(v[k][9] || 'Mới') === 'Mới') chuaXuLy++; }
    return JSON.stringify({ success: true, items: items, tong: v.length, chuaXuLy: chuaXuLy });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

/** spx_setFeedbackStatus(dong, trangThai) — đánh dấu đã xử lý. */
function spx_setFeedbackStatus(dong, trangThai) {
  try {
    _requireAdmin_(2);
    var sheet = _DS.ss(ADMIN_DB_ID).getSheetByName(FEEDBACK_SHEET);
    if (!sheet) return JSON.stringify({ success: false, error: 'Chưa có dữ liệu góp ý.' });
    dong = Number(dong);
    if (!(dong >= 2 && dong <= sheet.getLastRow())) return JSON.stringify({ success: false, error: 'Dòng không hợp lệ.' });
    sheet.getRange(dong, 10).setValue(String(trangThai || 'Đã xử lý'));
    return JSON.stringify({ success: true });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

function spx_getAiQuotaStats() {
  try {
    _requireAdmin_(2);
    var all = JSON.parse(PropertiesService.getScriptProperties().getProperty(SPX_AI_STATS_KEY) || '{}');
    var day = _spxAiStatsToday_();
    var s = all[day] || { goi: 0, thanhCong: 0, tuCache: 0, hetHanMuc: 0, loiKhac: 0, lanHetHanMucCuoi: '', khoaDangDung: 0 };
    var soKhoa = 0;
    try { soKhoa = _getInseaTokens_().length; } catch (e) {}
    return JSON.stringify({
      success: true, ngay: day, soKhoaCauHinh: soKhoa, homNay: s,
      lichSu: Object.keys(all).sort().reverse().slice(0, 7).map(function (k) {
        return { ngay: k, goi: all[k].goi || 0, hetHanMuc: all[k].hetHanMuc || 0 };
      })
    });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

function _callInsea(promptText, opts) {
  opts = opts || {};
  var cacheKey = opts.cacheKey || null;
  var cacheTTL = opts.cacheTTL || 300; // 5 phút mặc định
  var _isRetry = !!opts._isRetry;
  // [MỚI] Chỉ số key insea đang thử trong danh sách _getInseaTokens_() — 0 =
  // key chính. Đệ quy sang key kế tiếp khi gặp 429 (xem bên dưới). Dùng
  // typeof thay vì `opts._keyIndex || 0` vì 0 là giá trị hợp lệ (key #1) —
  // `|| 0` sẽ không phân biệt được "chưa truyền" với "truyền đúng key #1".
  var keyIndex = (typeof opts._keyIndex === 'number') ? opts._keyIndex : 0;

  // ① Thử đọc cache trước — không tốn 1 token nào
  if (cacheKey) {
    try {
      var cached = CacheService.getScriptCache().get('insea_' + cacheKey);
      if (cached) { _spxAiCount_('tuCache'); return { success: true, text: _spxAiCleanSafe_(cached), fromCache: true }; }
    } catch(ce) { /* cache miss → tiếp tục gọi API */ }
  }

  var tokens = _getInseaTokens_();
  // [MỚI] Lượt gọi ĐẦU TIÊN (không phải đệ quy chuyển key/retry) — bắt đầu từ
  // key được nhớ là "đang hoạt động tốt" thay vì luôn bắt đầu từ key #1,
  // tránh dội request thất bại vào đúng key vừa hết hạn mức liên tục.
  if (typeof opts._keyIndex !== 'number') {
    try {
      var cachedIdx = CacheService.getScriptCache().get(INSEA_KEY_CACHE_KEY);
      if (cachedIdx != null) keyIndex = Math.min(parseInt(cachedIdx, 10) || 0, tokens.length - 1);
    } catch (eIdx) {}
  }
  var activeToken = tokens[keyIndex] || tokens[0];

  var options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + activeToken },
    "payload": JSON.stringify({ "query": promptText }),
    "muteHttpExceptions": true,
    "deadline": 55 // [FIX TIMEOUT] GAS default 20s → kill trước khi insea trả về; max = 55s
  };

  try {
    _spxAiCount_('goi', { khoa: keyIndex });
    var response = UrlFetchApp.fetch(INSEA_API_URL, options);
    var httpCode = response.getResponseCode();
    var rawText  = response.getContentText();

    if (httpCode === 429) {
      // [MỚI — theo yêu cầu trực tiếp "add thêm 2,3 key, hết hạn mức tự
      // chuyển qua key khác"] Còn key dự phòng chưa thử trong danh sách ->
      // tự động thử NGAY, hoàn toàn trong suốt với mọi nơi gọi _callInsea()
      // (mascot, tra cứu xã/phường...) — không nơi nào cần biết có bao nhiêu
      // key hay đang dùng key nào.
      if (keyIndex + 1 < tokens.length) {
        try { _LOG.d('[Insea] Key #' + (keyIndex + 1) + ' hết hạn mức (429) — tự chuyển sang key #' + (keyIndex + 2) + '.'); } catch (eLog) {}
        return _callInsea(promptText, { cacheKey: cacheKey, cacheTTL: cacheTTL, _isRetry: _isRetry, _keyIndex: keyIndex + 1 });
      }
      // Hết sạch key dự phòng — giữ nguyên hành vi cũ (báo quota cho frontend,
      // frontend tự khoá nút 10 phút).
      _spxAiCount_('hetHanMuc');
      return { success: false, isQuota: true, text: 'QUOTA_EXCEEDED', retryAfter: 600 };
    }
    if (httpCode < 200 || httpCode >= 300) {
      // [UX FIX — theo yêu cầu trực tiếp "thông báo cho user không được dùng
      // ngôn ngữ kỹ thuật"] Trước đây trả thẳng "HTTP 500: <rawText>" ra tới
      // tận khung chat mascot — user (Hub/SUP/AOM, không phải dev) thấy mã
      // lỗi HTTP và JSON thô, không hiểu được. Ghi chi tiết kỹ thuật vào log
      // để debug (không mất thông tin), còn field "text" (thứ DUY NHẤT hiển
      // thị lên UI) đổi thành câu tiếng Việt thân thiện.
      try { _LOG.d('[Insea] Lỗi HTTP ' + httpCode + ': ' + rawText.substring(0, 300)); } catch (eLog2) {}
      return { success: false, text: 'Dịch vụ AI đang gặp sự cố, vui lòng thử lại sau ít phút.' };
    }

    // [MỚI] Gọi thành công với key này -> nhớ lại 5 phút để lần gọi SAU bắt
    // đầu ngay từ đây, khỏi dội lại (các) key trước đó đã biết hết hạn mức
    // trong lúc chúng chưa được nạp lại quota.
    try { CacheService.getScriptCache().put(INSEA_KEY_CACHE_KEY, String(keyIndex), INSEA_KEY_CACHE_TTL); } catch (ePut) {}

    // Parse response — insea trả về { data: { outputs: { answer: "..." } } }
    try {
      var json = JSON.parse(rawText);
      var text = '';
      if (json.data && json.data.outputs && json.data.outputs.answer) {
        text = json.data.outputs.answer;
      }
      if (!text && json.data) {
        var d = json.data;
        text = (d.outputs && (d.outputs.answer || d.outputs.text))
               || d.output || d.answer || d.text || d.message || '';
      }
      // [UX FIX — cùng lý do ở trên] "Raw: <json thô>" đổi thành câu tiếng
      // Việt thân thiện — chi tiết kỹ thuật vẫn ghi log để debug.
      if (!text) {
        try { _LOG.d('[Insea] AI phản hồi trống. Raw: ' + rawText.substring(0, 300)); } catch (eLog3) {}
        return { success: false, text: 'AI chưa phân tích được câu hỏi này, vui lòng thử hỏi lại theo cách khác.' };
      }

      text = text.toString().trim();

      // [FIX] SuperAgent trả về câu chào mặc định (coi request này là phiên mới,
      // bỏ qua toàn bộ prompt/số liệu đã gửi) — KHÔNG được hiển thị nội dung này
      // cho sếp như thể là 1 phân tích thật. Log lại đầy đủ để debug, thử gọi lại
      // 1 lần (đôi khi do lỗi tạm thời phía SuperAgent); nếu vẫn dính thì trả về
      // lỗi rõ ràng để frontend hiện fallback thay vì hiện nhầm câu chào.
      if (_isInseaCannedGreeting(text)) {
        try {
          _LOG.d('[InseaCannedGreeting] Phát hiện SuperAgent trả câu chào mặc định thay vì phân tích thật.'
            + ' isRetry=' + _isRetry
            + ' | Prompt (800 ký tự đầu): ' + promptText.substring(0, 800)
            + ' | Raw response: ' + rawText.substring(0, 1000));
        } catch(le) {}

        if (!_isRetry) {
          return _callInsea(promptText, { cacheKey: cacheKey, cacheTTL: cacheTTL, _isRetry: true, _keyIndex: keyIndex });
        }
        // [DEBUG] Nhét luôn nội dung text thật + độ dài prompt vào message lỗi trả về
        // frontend — để thấy ngay trên UI (banner "Chi tiết:") thay vì phải mò vào
        // Execution log của Apps Script mới xem được SuperAgent thực sự nói gì.
        return {
          success: false,
          isCannedGreeting: true,
          text: 'AI (insea.io) trả lời không đúng ngữ cảnh (đã thử lại 1 lần vẫn dính) — ' +
                'độ dài prompt gửi đi: ' + promptText.length + ' ký tự. ' +
                'Nội dung SuperAgent trả về: "' + text.substring(0, 400) + '"'
        };
      }

      // ② Lưu cache nếu có cacheKey
      if (cacheKey) {
        try {
          var toStore = text.length > 90000 ? text.substring(0, 90000) : text;
          CacheService.getScriptCache().put('insea_' + cacheKey, toStore, cacheTTL);
        } catch(ce) { /* lỗi cache write — bỏ qua */ }
      }

      return { success: true, text: _spxAiCleanSafe_(text) };

    } catch(pe) {
      if (rawText && rawText.length > 5) return { success: true, text: _spxAiCleanSafe_(rawText.trim()) };
      return { success: false, text: 'Lỗi parse response: ' + pe.message };
    }

  } catch(e) {
    return { success: false, text: 'Lỗi đường truyền: ' + e.message };
  }
}

/**
 * 1. HÀM CHẠY KIỂM TRA (TEST)
 * Hãy chọn hàm này và bấm "Run" để kiểm tra kết nối insea.io
 */
function test_gemini_() {
  var result = _callInsea('Chào! Hãy xác nhận kết nối bằng 1 câu ngắn tiếng Việt.');
  if (result.success) {
    _LOG.d('👉 AI PHẢN HỒI THÀNH CÔNG: ' + result.text);
  } else {
    _LOG.d('❌ Lỗi: ' + result.text);
  }
}

/**
 * 2. HÀM PHÂN TÍCH VẬN HÀNH BƯU CỤC THỰC TẾ
 * Giữ nguyên tên hàm ana_askGeminiAI(data) để Frontend gọi bình thường không bị crash.
 */
/**
 * _spxAiRoleProfile_(level)
 * [MỚI — theo yêu cầu trực tiếp: "người quản lý 1 trạm khác người quản lý 1
 * miền, không thể làm như nhau được"]
 *
 * TRƯỚC ĐÂY mọi lời nhắc gửi AI đều GẮN CỨNG vai người nhận là "Hub Team Lead"
 * (hoặc "Hub Team Lead / Supervisor"). Hệ quả: ROM quản cả miền vẫn nhận lời
 * khuyên viết cho người trực ca tại 1 bưu cục — kiểu "điều phối tài xế trong
 * ca", trong khi ROM cần so sánh giữa các AOM và nhìn xu hướng vùng.
 * Cấp AOM/ROM trước đây KHÔNG hề được nhắc tới trong bất kỳ lời nhắc nào.
 *
 * Hàm này trả về "hồ sơ vai" để chèn vào đầu mọi lời nhắc AI, gồm:
 *   role   — AI đang nói chuyện với ai
 *   scope  — người đó quản phạm vi nào
 *   focus  — thứ họ CẦN nghe (khác nhau hoàn toàn giữa các cấp)
 *   avoid  — thứ KHÔNG nên khuyên (việc của cấp dưới, họ không trực tiếp làm)
 */
function _spxAiRoleProfile_(level) {
  var lv = String(level || '').toLowerCase().trim();
  var P = {
    staff: {
      role:  'Nhân viên vận hành tại 1 bưu cục',
      scope: 'đúng 1 trạm, và chỉ phần việc được giao trong ca',
      focus: 'việc cần làm NGAY trong ca: đơn nào xử lý trước, gọi khách nào, giao lại đơn nào. Nói cụ thể tới từng mã đơn / từng tài xế.',
      avoid: 'đừng bàn chiến lược, ngân sách, hay so sánh giữa các trạm — ngoài tầm quyết định của họ.'
    },
    lead: {
      role:  'Hub Team Lead — người trực tiếp điều hành 1 bưu cục',
      scope: 'đúng 1 trạm',
      focus: 'điều phối trong ca: phân bổ tài xế, xử lý đơn tồn/quá hạn, đơn nguy cơ thất lạc, chốt số cuối ca. Nêu rõ tài xế nào, khu vực nào, bao nhiêu đơn.',
      avoid: 'đừng so sánh với trạm khác (họ không có dữ liệu đó) và đừng bàn việc thuộc cấp vùng.'
    },
    sup: {
      role:  'Supervisor — quản nhiều Hub trong 1 cụm',
      scope: 'một nhóm trạm (thường 5-15 trạm)',
      focus: 'SO SÁNH GIỮA CÁC TRẠM mình quản: trạm nào đang tụt, trạm nào cần chi viện người/xe, vấn đề nào lặp lại ở nhiều trạm. Ưu tiên theo mức độ nghiêm trọng.',
      avoid: 'đừng sa vào chỉ đạo từng đơn lẻ — đó là việc của Team Lead; hãy nói ở mức trạm.'
    },
    aom: {
      role:  'Area Operations Manager — quản nhiều Supervisor trong 1 khu vực',
      scope: 'một khu vực gồm nhiều cụm trạm',
      focus: 'XU HƯỚNG KHU VỰC và phân bổ nguồn lực giữa các SUP: cụm nào đang xấu đi, nguyên nhân hệ thống (thiếu người? tuyến xa? hạ tầng?), nên điều nguồn lực từ đâu sang đâu.',
      avoid: 'đừng liệt kê từng đơn hay từng tài xế — hãy nói ở mức cụm/SUP và nêu vấn đề CÓ TÍNH LẶP LẠI.'
    },
    rom: {
      role:  'Regional Operations Manager — quản toàn vùng',
      scope: 'toàn vùng, nhiều khu vực (AOM)',
      focus: 'BỨC TRANH VÙNG: so sánh giữa các AOM, chỉ số nào lệch chuẩn toàn vùng, vấn đề mang tính hệ thống cần can thiệp từ cấp vùng, rủi ro cần báo lên.',
      avoid: 'tuyệt đối không đi vào chi tiết từng đơn/tài xế/trạm lẻ — chỉ nêu tên trạm khi đó là điểm nóng bất thường cần chú ý.'
    },
    admin: {
      role:  'Quản trị hệ thống — xem được toàn bộ dữ liệu',
      scope: 'toàn hệ thống',
      focus: 'bức tranh tổng thể và các bất thường nổi bật ở mọi cấp.',
      avoid: 'không cần giới hạn phạm vi, nhưng vẫn nên nêu điểm quan trọng trước.'
    }
  };
  return P[lv] || P.lead;   // không rõ cấp -> mặc định Lead (hành vi cũ, an toàn)
}

/**
 * _spxAiRoleHeader_(level, stationOrScopeText)
 * Trả về đoạn văn mở đầu lời nhắc, đã gắn đúng vai + phạm vi + trọng tâm.
 */
function _spxAiRoleHeader_(level, scopeText) {
  var p = _spxAiRoleProfile_(level);
  return [
    'Bạn là Phó Ban Vận Hành cao cấp của SPX Express.',
    'NGƯỜI ĐỌC báo cáo này là: ' + p.role + '.',
    'Phạm vi quản lý của họ: ' + p.scope + (scopeText ? ' (' + scopeText + ')' : '') + '.',
    'TRỌNG TÂM cần phân tích: ' + p.focus,
    'LƯU Ý: ' + p.avoid,
    'Hãy viết đúng tầm quyết định của người đọc — không khuyên việc họ không có quyền làm.'
  ].join('\n');
}

function ana_askGeminiAI(data) {
  try {
    if (!data) return { success: false, text: "Chưa có dữ liệu vận hành từ hệ thống!" };

    // ── Chế độ phân tích tài xế riêng lẻ ──
    if (data.mode === 'driver') {
      return ana_askGeminiAI_driver(data);
    }
    // ── Chế độ phân tích đơn vô chủ ──
    if (data.mode === 'orphan') {
      return ana_askGeminiAI_orphan(data);
    }

    var stationName    = data.stationName    || "Bưu cục SPX Express";
    var inbound        = data.inbound        || data.total || 0;
    var total          = data.total          || 0;
    var delivered      = data.delivered      || 0;
    var delivering     = data.delivering     || 0;
    var onhold         = data.onhold         || 0;
    var activeDrivers  = data.activeDrivers  || 1;
    var avgOrders      = data.avgOrders      || 0;
    var topHoldReason  = data.topHoldReason  || "Không rõ lý do";
    var topHoldCount   = data.topHoldCount   || 0;
    var stagingHours   = data.stagingHours   || 0;
    var reattempts     = data.reattempts     || 0;
    var highValue      = data.highValueCount || 0;
    var damaged        = data.damagedCount   || 0;
    var driverSummary  = data.driverSummary  || "";
    var zoneSummary    = data.zoneSummary    || "";
    var holdSummary    = data.holdSummary    || "";
    var holdOrderDetails = data.holdOrderDetails || "";

    var successRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
    var onholdRate  = total > 0 ? Math.round((onhold  / total) * 100) : 0;

    // ── Cache key: trạm + DSR + tổng đơn + onhold — cache 5 phút ──
    var _ckStation = 'st_' + (stationName||'').replace(/\s/g,'_') + '_' + total + '_' + delivered + '_' + onhold + '_' + activeDrivers;
    try {
      var _cached = CacheService.getScriptCache().get(_ckStation);
      if (_cached) return { success: true, text: _cached, fromCache: true };
    } catch(ce) {}

    var prompt = [
      // [SỬA] Vai người đọc nay THEO CẤP THẬT, không còn gắn cứng "Hub Team Lead".
      _spxAiRoleHeader_(data && data.viewLevel, station ? ("trạm " + station) : ""),
      "Hãy phân tích chi tiết dữ liệu ca trực dưới đây của trạm **" + stationName + "** và đưa ra chỉ đạo cụ thể, có số liệu, tên tài xế/tuyến thực tế — TUYỆT ĐỐI không nói chung chung.",
      "",
      "═══════════════════════════════════",
      "📊 SỐ LIỆU TỔNG QUAN CA TRỰC — TRẠM: " + stationName,
      "═══════════════════════════════════",
      "• Inbound nhập kho hôm nay: " + inbound + " đơn (tổng đơn trong kho: " + total + ")",
      "• Đã giao thành công: " + delivered + " đơn → Tỷ lệ DSR: **" + successRate + "%**" + (successRate < 80 ? " ⚠️ DƯỚI CHUẨN" : successRate < 95 ? " ⚡ CẦN CẢI THIỆN" : " ✅ TỐT"),
      "• Đang giao trên tuyến: " + delivering + " đơn",
      "• Tồn đọng OnHold tại kho: " + onhold + " đơn (" + onholdRate + "% tổng đơn)",
      "• Rider hoạt động: " + activeDrivers + " người (TB: " + avgOrders + " đơn/người)",
      "• Thời gian staging TB: " + stagingHours + " giờ" + (stagingHours > 4 ? " ⚠️ Chậm" : " ✅"),
      "• Lý do Hold nhiều nhất: [" + topHoldReason + "] với " + topHoldCount + " đơn",
    ];

    if (reattempts > 0) prompt.push("• Đơn giao lại ≥2 lần: " + reattempts + " đơn");
    if (highValue > 0)  prompt.push("• Hàng giá trị cao (COD ≥ 1tr): " + highValue + " đơn — ⚠️ Cần giám sát");
    if (damaged > 0)    prompt.push("• Hàng hư hỏng/móp méo: " + damaged + " đơn");

    if (driverSummary) {
      prompt.push("");
      prompt.push("═══════════════════════════════════");
      prompt.push("🏍️ HIỆU SUẤT TỪNG RIDER (MÃ - TÊN: Tổng/Giao/Tỉ lệ/Hold)");
      prompt.push("═══════════════════════════════════");
      prompt.push(driverSummary);
    }

    if (zoneSummary) {
      prompt.push("");
      prompt.push("═══════════════════════════════════");
      prompt.push("🗺️ DIỄN BIẾN THEO TUYẾN/ZONE");
      prompt.push("═══════════════════════════════════");
      prompt.push(zoneSummary);
    }

    if (holdSummary) {
      prompt.push("");
      prompt.push("═══════════════════════════════════");
      prompt.push("📦 THỐNG KÊ LÝ DO ONHOLD");
      prompt.push("═══════════════════════════════════");
      prompt.push(holdSummary);
    }

    if (holdOrderDetails) {
      prompt.push("");
      prompt.push("📋 Danh sách mã đơn OnHold theo nhóm lý do (mẫu đại diện):");
      prompt.push(holdOrderDetails);
    }

    prompt.push("");
    prompt.push("═══════════════════════════════════");
    prompt.push("📋 YÊU CẦU ĐẦU RA — ĐỊNH DẠNG MARKDOWN");
    prompt.push("═══════════════════════════════════");
    prompt.push("Trình bày báo cáo gồm 3 phần rõ ràng, dùng heading Markdown (###), gạch đầu dòng (-), bôi đậm (**) các con số và từ khóa quan trọng:");
    prompt.push("");
    prompt.push("### 🛑 1. ĐIỂM ĐEN VẬN HÀNH");
    prompt.push("Chỉ đích danh: mã/tên Rider nào đang kéo DSR xuống, tuyến nào bị ùn tắc, lý do hold nào nguy hiểm nhất. Dùng số liệu thực tế từ dữ liệu trên.");
    prompt.push("");
    prompt.push("### ⚡ 2. PHƯƠNG ÁN ĐIỀU PHỐI NÓNG");
    prompt.push("Hành động cụ thể, có số: cắt bao nhiêu đơn từ Rider/tuyến nào → sang Rider/tuyến nào? Xử lý nhóm hold nào trước? Ưu tiên ra sao? Ai làm gì ngay bây giờ?");
    prompt.push("");
    prompt.push("### 📈 3. DỰ BÁO TIẾN ĐỘ CLEAR KHO");
    prompt.push("Với tốc độ hiện tại, ca này có khả năng clear Inbound không? Cảnh báo nguy cơ trễ SLA nếu có. Đề xuất chỉ tiêu cuối ca cụ thể.");
    prompt.push("");
    prompt.push("⚠️ NGUYÊN TẮC: Ngôn ngữ quyết liệt thực tế của ngành logistics. Không nói \"có thể\", \"nên xem xét\" — phải nói \"Ngay lập tức...\", \"Cắt X đơn từ...\", \"Rider [tên] cần...\". Nếu thiếu mã tài xế cụ thể, dùng tên từ dữ liệu driverSummary.");

    var _result = _callInsea(prompt.join("\n"));
    if (_result.success && _result.text) {
      try { CacheService.getScriptCache().put(_ckStation, _result.text, 300); } catch(ce) {}
    }
    return _result;
  } catch(e) {
    return { success: false, text: e.message };
  }
}

/**
 * Phân tích chuyên sâu từng tài xế — được gọi từ ana_askGeminiAI khi mode='driver'
 */
function ana_askGeminiAI_driver(data) {
  var name        = data.driverName  || 'Tài xế';
  var id          = data.driverId    || 'N/A';
  var station     = data.stationName || '';
  var total       = data.total       || 0;
  var delivered   = data.delivered   || 0;
  var delivering  = data.delivering  || 0;
  var onhold      = data.onhold      || 0;
  var hoan        = data.hoan        || 0;
  var rate        = data.successRate || (total > 0 ? Math.round(delivered/total*100) : 0);
  var reattempts  = data.reattempts  || 0;
  var cod         = data.cod         || 0;
  var codDel      = data.codDelivered|| 0;
  var holdSummary = data.holdSummary || '';
  var holdSamples = data.holdSamples || '';
  var stDSR       = data.stationDSR  || 0;
  var stTotal     = data.stationTotal|| 0;
  var topZone     = data.topZone     || '';

  var rateFlag = rate < 70 ? '🔴 NGUY HIỂM' : rate < 85 ? '🟡 CẦN CẢI THIỆN' : rate < 95 ? '🟢 KHÁ' : '✅ XUẤT SẮC';
  var vsStation = rate > stDSR ? ('(+' + (rate-stDSR) + '% so TB trạm)') : ('(-' + (stDSR-rate) + '% so TB trạm)');

  // ── Cache key: theo driver + số liệu hiện tại — cache 5 phút ──
  var _ckDriver = 'drv_' + (id||name||'').replace(/\s/g,'_') + '_' + total + '_' + delivered + '_' + onhold;
  try {
    var _cached = CacheService.getScriptCache().get(_ckDriver);
    if (_cached) return { success: true, text: _cached, fromCache: true };
  } catch(ce) {}

  var prompt = [
    'Bạn là Quản lý Vận hành SPX Express. Phân tích hiệu suất tài xế dưới đây và đưa ra chỉ đạo CỤ THỂ có số liệu thực tế.',
    '',
    '══════════════════════════════',
    '🏍️ HỒ SƠ TÀI XẾ: [' + id + '] ' + name + ' — Trạm ' + station,
    '══════════════════════════════',
    '• Tổng đơn phụ trách : ' + total,
    '• Đã giao thành công : ' + delivered + ' → DSR: ' + rate + '% ' + rateFlag + ' ' + vsStation,
    '• Đang giao trên đường: ' + delivering,
    '• OnHold tại kho      : ' + onhold,
    '• Đã hoàn trả         : ' + hoan,
    '• Giao lại ≥2 lần     : ' + reattempts + (reattempts > 3 ? ' ⚠️' : ''),
    '• COD thu được        : ' + Math.round(codDel/1000) + 'k / ' + Math.round(cod/1000) + 'k đ',
  ];
  if (topZone)     prompt.push('• Khu vực chính       : ' + topZone);
  if (holdSummary) prompt.push('• Lý do Hold          : ' + holdSummary);
  if (holdSamples) prompt.push('• Mã đơn Hold mẫu    : ' + holdSamples);
  prompt.push('• DSR trung bình trạm : ' + stDSR + '% (tổng ' + stTotal + ' đơn)');

  prompt = prompt.concat([
    '',
    '══════════════════════════════',
    '📋 YÊU CẦU — ĐỊNH DẠNG MARKDOWN',
    '══════════════════════════════',
    'Trình bày 3 phần rõ ràng:',
    '',
    '### 🔍 1. ĐÁNH GIÁ HIỆU SUẤT',
    'Nhận xét thẳng: tài xế này đang ở mức nào? Điểm mạnh, điểm yếu cụ thể dựa trên số liệu.',
    '',
    '### ⚡ 2. NGUYÊN NHÂN & HÀNH ĐỘNG NGAY',
    'Lý do hold nhiều nhất là gì? Tài xế cần làm gì ngay bây giờ để tăng DSR? Quản lý cần can thiệp gì?',
    '',
    '### 🎯 3. CHỈ TIÊU VÀ CAM KẾT',
    'Đặt mục tiêu cụ thể cho phần còn lại của ca. Nếu DSR < 80%, đề xuất hành động kỷ luật/hỗ trợ.',
    '',
    '⚠️ Ngôn ngữ quyết liệt logistics, có tên tài xế, có con số. Không nói chung chung.'
  ]);

  var _resultDrv = _callInsea(prompt.join("\n"));
  if (_resultDrv.success && _resultDrv.text) {
    try { CacheService.getScriptCache().put(_ckDriver, _resultDrv.text, 300); } catch(ce) {}
  }
  return _resultDrv;
}


/**
 * Phân tích nhóm đơn vô chủ — gọi khi mode='orphan'
 */
function ana_askGeminiAI_orphan(data) {
  var station    = data.stationName  || '';
  var total      = data.orphanTotal  || 0;
  var urgent     = data.urgentCount  || 0;
  var holding    = data.holdCount    || 0;
  var codOrders  = data.codOrders    || 0;
  var totalCod   = data.totalCod     || 0;
  var urgSamples = data.urgentSamples|| '';
  var holdSamples= data.holdSamples  || '';
  var stDSR      = data.stationDSR   || 0;
  var stTotal    = data.stationTotal || 0;

  // ── Cache key: trạm + số đơn vô chủ + urgent — cache 5 phút ──
  var _ckOrphan = 'orp_' + (station||'').replace(/\s/g,'_') + '_' + total + '_' + urgent + '_' + codOrders;
  try {
    var _cached = CacheService.getScriptCache().get(_ckOrphan);
    if (_cached) return { success: true, text: _cached, fromCache: true };
  } catch(ce) {}

  var prompt = [
    'Bạn là Quản lý Vận hành SPX Express. Có ' + total + ' ĐƠN VÔ CHỦ tại trạm ' + station + ' — đơn không xác định được tài xế phụ trách.',
    '',
    '══════════════════════════════',
    '📦 THỐNG KÊ ĐƠN VÔ CHỦ',
    '══════════════════════════════',
    '• Tổng đơn vô chủ    : ' + total + ' / ' + stTotal + ' đơn toàn trạm (' + Math.round(total/stTotal*100) + '%)',
    '• 🔴 Đang giao (nguy hiểm): ' + urgent + ' đơn — không biết tài xế nào đang cầm',
    '• 🟡 Đang hold        : ' + holding + ' đơn',
    '• Đơn COD vô chủ     : ' + codOrders + ' đơn — tổng ' + Math.round(totalCod/1000) + 'k đ tiền mặt không rõ ai giữ',
    '• DSR toàn trạm      : ' + stDSR + '%',
  ];

  if (urgSamples)  prompt.push('• Mã đơn đang giao    : ' + urgSamples);
  if (holdSamples) prompt.push('• Mã đơn đang hold    : ' + holdSamples);

  prompt = prompt.concat([
    '',
    '══════════════════════════════',
    '📋 YÊU CẦU — ĐỊNH DẠNG MARKDOWN',
    '══════════════════════════════',
    '',
    '### 🔴 1. ĐÁNH GIÁ RỦI RO NGAY',
    'Đơn đang giao mà không rõ tài xế — rủi ro mất hàng, mất COD là bao nhiêu? Mức độ nghiêm trọng?',
    '',
    '### ⚡ 2. HÀNH ĐỘNG KHẨN CẤP (làm ngay trong 15 phút)',
    'Từng bước cụ thể để xác định và gán tài xế cho các đơn đang giao. Ai gọi ai, tra cứu ở đâu?',
    '',
    '### 🛡️ 3. PHÒNG NGỪA TÁI PHÁT',
    'Tại sao đơn bị vô chủ? Quy trình nào cần siết? Ai chịu trách nhiệm kiểm soát?',
    '',
    '⚠️ Ngôn ngữ quyết liệt, có số liệu thực tế. Ưu tiên đơn COD và đơn đang giao trước.'
  ]);

  var _resultOrp = _callInsea(prompt.join("\n"));
  if (_resultOrp.success && _resultOrp.text) {
    try { CacheService.getScriptCache().put(_ckOrphan, _resultOrp.text, 300); } catch(ce) {}
  }
  return _resultOrp;
}

/**
 * 4. TRỢ LÝ HỎI-ĐÁP MASCOT (tab "Hỏi") — phân tích đa chiều câu hỏi tự do
 * Được Frontend gọi khi câu hỏi không khớp các pattern tra cứu nhanh có sẵn,
 * hoặc khi câu hỏi mang tính phân tích/đề xuất (vì sao, nên làm gì, dự báo, rủi ro...).
 * payload = { question: string, context: object }  — context là snapshot dữ liệu hiện tại do Frontend tổng hợp.
 */
// [FIX INSEA RESET] promptText.length = 21,691 ký tự (1 hub) đã đủ để insea reset session.
// Sau compact instructions (8,575) + header (479): budget context = 14,000 - 9,054 = 4,946.
// Đặt 5,800 vì margin 6,837 so với ngưỡng reset thực tế → an toàn cho cả multi-hub 15 trạm.
var MASCOT_CTX_MAX_LEN = 5800;

/**
 * _mascotSeverityScore_(hub)
 * ------------------------------------------------------------------
 * Điểm mức độ nghiêm trọng của 1 hub — dùng để QUYẾT ĐỊNH HUB NÀO ĐƯỢC GIỮ
 * LẠI trước khi bị cắt do context quá dài, KHÔNG dùng để kết luận vận hành
 * (đó là việc của AI). Hub điểm càng cao càng cần giữ lại trong context.
 */
function _mascotSeverityScore_(h) {
  var ab = (h && h.aging_phan_bo) || {};
  return (h.backlog || 0)
       + (ab.khan_cap_tren_5_ngay || 0) * 3
       + (ab.canh_bao_3_den_5_ngay || 0)
       + (h.lostToday || 0) * 2
       + (h.fmsQua3Ca || 0)
       // [MỚI — theo cùng đợt bổ sung Pick/Vi phạm/Rescue vào context AI] Nếu
       // không tính vào điểm nặng, hub có nhiều vi phạm/đơn cứu cứu đỏ nhưng
       // aging/FMS bình thường sẽ bị RỚT ĐẦU TIÊN khi phải cắt bớt context —
       // đúng lúc AI cần thấy nhất thì lại mất.
       + (h.viphamTotal || 0)
       + (h.rescueDo || 0) * 2;
}

/**
 * _shrinkContextForPrompt_(context, maxLen)
 * ------------------------------------------------------------------
 * [FIX 06/07 — thay cho contextJson.substring(0, maxLen) cũ]
 * Cắt cứng theo KÝ TỰ có 3 vấn đề đã xác nhận thật (xem review ngày 06/07):
 *   (1) Cắt ngay giữa chuỗi JSON tại vị trí ngẫu nhiên — JSON bị đứt gãy.
 *   (2) MỌI hub nằm sau điểm cắt trong mảng 'hubs' biến mất khỏi những gì AI
 *       thấy, không có cảnh báo nào, không log lại hub nào bị rớt.
 *   (3) User quản lý nhiều trạm (AOM/SUP) dính lỗi này nhiều hơn hẳn user 1
 *       trạm: mỗi hub sau khi merge baseline/riderPlan/d1Plan/driverHotspot/...
 *       (alert_getFullAnalysis) nặng ~1.1-1.2K ký tự — chỉ ~10 hub đã chạm
 *       ngưỡng 14.000, THẤP HƠN NHIỀU so với ngưỡng cảnh báo cũ ở phía trên
 *       (_skipDriverZoneDetail ở 25 hub, ghi_chu_rut_gon ở 60 hub) — nghĩa là
 *       những ngưỡng đó chưa kịp bật thì dữ liệu đã âm thầm bị cắt rồi.
 *
 * Cách sửa — 3 bước, ưu tiên GIỮ LẠI dữ liệu quan trọng nhất thay vì cắt bừa:
 *   Bước 1: nếu có mảng 'hubs' — bỏ dần hub có _mascotSeverityScore_ THẤP NHẤT
 *           trước (hub đang yên ổn), giữ hub đang có vấn đề nặng cho AI thấy.
 *   Bước 2: nếu vẫn dư (context không có 'hubs', hoặc dư do các mảng phụ khác
 *           như driverHotspot/zoneHotspot/sla_top/theo_tram/theo_sup/...) —
 *           rút mỗi mảng phụ đó về tối đa 2 phần tử đầu.
 *   Bước 3: an toàn cuối cùng (gần như không bao giờ phải chạm tới với luồng
 *           cảnh báo thực tế) — cắt cứng ký tự như cũ.
 * Ở CẢ 3 bước, nếu có bớt/cắt gì, luôn gắn 1 ghi chú hệ thống liệt kê rõ đã bớt
 * gì để AI PHẢI nói thẳng cho sếp biết phần nào chưa được xem xét, thay vì im
 * lặng bỏ sót khiến sếp tưởng nhầm là "ổn" ở những hub đó.
 */
function _shrinkContextForPrompt_(context, maxLen) {
  var SAFETY_MARGIN = 500; // chừa chỗ cho ghi chú hệ thống gắn thêm ở cuối
  var budget = Math.max(1000, maxLen - SAFETY_MARGIN);

  // Làm việc trên bản sao — context gốc còn được nơi gọi dùng để build cache key.
  var work;
  try { work = JSON.parse(JSON.stringify(context)); } catch(e) { work = context; }

  function fits() { try { return JSON.stringify(work).length <= budget; } catch(e) { return false; } }

  // ── Bước 1: bớt hub nhẹ nhất trước ──
  var droppedHubs = [];
  while (!fits() && Array.isArray(work.hubs) && work.hubs.length > 1) {
    var minIdx = 0;
    for (var j = 1; j < work.hubs.length; j++) {
      if (_mascotSeverityScore_(work.hubs[j]) < _mascotSeverityScore_(work.hubs[minIdx])) minIdx = j;
    }
    droppedHubs.push(work.hubs[minIdx].hub || ('hub#' + minIdx));
    work.hubs.splice(minIdx, 1);
  }

  // ── Bước 2: rút gọn các mảng phụ khác nếu vẫn còn dư ──
  var arrFieldsToShrink = ['driverHotspot','zoneHotspot','sla_top','theo_tram','theo_sup','don_lau_nhat','onhold_ly_do_breakdown'];
  var shrunkFields = [];
  function shrinkArraysDeep(obj) {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(function(k) {
      var v = obj[k];
      if (Array.isArray(v)) {
        if (arrFieldsToShrink.indexOf(k) >= 0 && v.length > 2) {
          if (shrunkFields.indexOf(k) < 0) shrunkFields.push(k);
          obj[k] = v.slice(0, 2);
        } else {
          v.forEach(shrinkArraysDeep);
        }
      } else if (v && typeof v === 'object') {
        shrinkArraysDeep(v);
      }
    });
  }
  if (!fits()) shrinkArraysDeep(work);

  // ── Bước 3: an toàn cuối cùng — cắt cứng ký tự (hiếm khi phải chạm tới) ──
  var hardTruncated = false;
  var resultJson;
  try { resultJson = JSON.stringify(work); } catch(e) { resultJson = JSON.stringify(context).substring(0, budget); }
  if (resultJson.length > budget) {
    hardTruncated = true;
    resultJson = resultJson.substring(0, budget);
  }

  if (droppedHubs.length || shrunkFields.length || hardTruncated) {
    var hubNoteText = droppedHubs.length <= 10
      ? droppedHubs.join(', ')
      : droppedHubs.slice(0, 10).join(', ') + ' và ' + (droppedHubs.length - 10) + ' hub khác';
    var note = {};
    if (droppedHubs.length) note.hub_bi_bo_qua_do_qua_tai = hubNoteText + ' — đã lược bỏ khỏi phân tích lần này do context vượt giới hạn ký tự gửi AI (ưu tiên giữ lại hub đang nặng hơn). PHẢI nói rõ cho sếp biết các hub này CHƯA được xem xét trong lượt phân tích này, không mặc nhiên coi là ổn.';
    if (shrunkFields.length) note.du_lieu_phu_da_rut_gon = shrunkFields.join(', ') + ' — chỉ giữ 2 mục đầu do giới hạn dung lượng, không phải toàn bộ.';
    if (hardTruncated) note.canh_bao_cat_cung = 'Dữ liệu vẫn còn quá lớn sau khi đã lược bớt, phần cuối đã bị cắt trực tiếp — có thể không còn nguyên vẹn, PHẢI cảnh báo rõ là dữ liệu phần này không đầy đủ, không suy diễn thêm.';
    resultJson += ' \n\n[GHI CHÚ HỆ THỐNG — KHÔNG PHẢI SỐ LIỆU VẬN HÀNH, chỉ để AI biết giới hạn dữ liệu]: ' + JSON.stringify(note);
  }

  return resultJson;
}

/**
 * _spxAiCleanOutput_(text)
 * [MỚI — báo cáo: "AI phân tích hiển thị toàn từ ngữ kỹ thuật"]
 * Lớp lọc CUỐI trước khi trả về giao diện. Chỉ dựa vào hướng dẫn cho AI là không
 * đủ — mô hình vẫn có lúc in ra quá trình suy luận và tên trường dữ liệu.
 *   (1) Cắt bỏ mọi thứ TRƯỚC dòng mở đầu bắt buộc (🔴 ĐIỂM NÓNG NHẤT). Giao diện
 *       tách mục bằng regex neo đầu chuỗi (^🔴) — có chữ phía trước là hỏng toàn bộ
 *       việc tách mục, mất cả danh sách việc tick được.
 *   (2) Đổi các cụm kỹ thuật lọt ra thành lời vận hành.
 *   (3) Bỏ những dòng còn lại mang hình dạng nhật ký kỹ thuật (nhiều tên_biến kèm '=').
 * Không đụng tới nội dung hợp lệ: nếu không tìm thấy dòng 🔴 thì GIỮ NGUYÊN text
 * (tránh cắt nhầm câu trả lời dạng hội thoại/follow-up vốn không có dòng này).
 */
var SPX_AI_TERM_MAP = [
  [/\[\s*Cần sync data\s*\]/gi, 'chưa có dữ liệu'],
  [/\bnguon_du_lieu_da_mo_trong_phien\b/gi, 'các module đã mở trong ca'],
  [/\briderplan_chua_nhap\b/gi, 'số trạm chưa nhập Rider Plan'],
  [/\bvipham_chua_co_ticket\b/gi, 'vi phạm chưa gắn ticket'],
  [/\bkpiFailChiTietHomNay\b/gi, 'chi tiết KPI Fail hôm nay'],
  [/\bdriverHotspot\b/gi, 'tài xế nổi cộm'],
  [/\bzoneHotspot\b/gi, 'khu vực nổi cộm'],
  [/\bketQuaXuLyTruoc\b/gi, 'kết quả xử lý lần trước'],
  [/\bxu_huong_30p\b/gi, 'xu hướng 30 phút'],
  [/\blich_su_hoi_trong_ca\b/gi, 'các câu đã hỏi trong ca'],
  [/\btong_hop_toan_pham_vi\b/gi, 'số tổng toàn phạm vi'],
  [/\bpct_ca_da_troi_qua\b/gi, 'tiến độ ca'],
  [/\bky_vong_giao_pct\b/gi, 'tỉ lệ giao kỳ vọng'],
  [/\bthoi_gian_hien_tai\b/gi, 'thời gian hiện tại'],
  [/\bbi_module_hien_tai\b/gi, 'dữ liệu BI đang mở'],
  [/\bavgAgingDays\b/gi, 'số ngày tồn trung bình'],
  [/\bbaseline\b/gi, 'mức nền']
];
// [MỚI] Bọc an toàn: đặt bộ lọc tại MỘT điểm duy nhất (_callInsea) cho mọi đường
// gọi AI. Nếu bộ lọc lỗi thì trả về nguyên văn — không bao giờ làm mất câu trả lời.
function _spxAiCleanSafe_(text) {
  try { return _spxAiCleanOutput_(text); } catch (e) { return text; }
}

function _spxAiCleanOutput_(text) {
  var s = String(text == null ? '' : text);
  if (!s) return s;

  // (1) Cắt phần suy luận đứng trước dòng mở đầu bắt buộc.
  var m = s.match(/🔴\s*<b>\s*ĐIỂM NÓNG NHẤT/i);
  if (m && m.index > 0) s = s.slice(m.index);

  // (2) Đổi cụm kỹ thuật sang lời vận hành.
  SPX_AI_TERM_MAP.forEach(function (pair) { s = s.replace(pair[0], pair[1]); });

  // (3) Bỏ dòng còn sót mang hình dạng nhật ký kỹ thuật: có >=2 cụm tên_biến/tênBiến
  //     đi kèm dấu '=' hoặc true/false. Chỉ xét dòng KHÔNG mở đầu bằng emoji mục.
  var parts = s.split(/<br\s*\/?>/i);
  var kept = parts.filter(function (line) {
    var plain = line.replace(/<[^>]+>/g, ' ').trim();
    if (!plain) return true;
    if (/^[🔴🔍🎯🌟📈🔮✅📌🟢⚠️📋☐]/.test(plain)) return true;   // dòng mục hợp lệ
    var techTokens = (plain.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z]*\b/g) || []).length;
    var hasEq = /=\s*(?:\d|true|false|null)/i.test(plain) || /\b(true|false)\b/.test(plain);
    return !(techTokens >= 2 && hasEq);
  });
  s = kept.join('<br>');
  return s.replace(/^(?:\s|<br\s*\/?>)+/i, '');
}

function ana_askMascotAssistant(payload) {
  try {
    var question = ((payload && payload.question) || '').toString().trim();
    if (!question) return { success: false, text: 'Câu hỏi trống.' };

    var context = (payload && payload.context) || {};
    var contextJson = JSON.stringify(context);
    if (contextJson.length > MASCOT_CTX_MAX_LEN) contextJson = _shrinkContextForPrompt_(context, MASCOT_CTX_MAX_LEN);

    // ── Debounce 5 giây per-user: tránh gửi liên tục khi đang gõ trong ô mascot ──
    // [FIX] CHỈ áp dụng cho luồng gõ tự do (ô "Hỏi & phân tích"). Luồng chuông cảnh
    // báo (alert_getFullAnalysis) và trả lời follow-up trong thread cảnh báo là hành
    // động BẤM 1 LẦN, đã có cờ chặn phía client (_alertLoading) rồi — dùng CHUNG debounce
    // này với ô gõ khiến 2 lần bấm chuông gần nhau (hoặc đóng/mở lại drawer) bị nuốt mất
    // kết quả, phía client treo mãi ở "AI đang phân tích..." không có gì xảy ra tiếp,
    // sếp phải bấm lại nhiều lần mới có lúc lọt qua được cửa sổ 5s. Nay cho phép các
    // luồng chuông truyền skipDebounce=true để bỏ qua khoá này.
    var _skipDebounce = !!(payload && payload.skipDebounce);
    if (!_skipDebounce) {
      var _debKey = 'msc_debounce_' + Session.getActiveUser().getEmail().replace(/[^a-z0-9]/gi,'_');
      try {
        var _debHit = CacheService.getUserCache().get(_debKey);
        if (_debHit) return { success: false, text: '_DEBOUNCE_' };
        CacheService.getUserCache().put(_debKey, '1', 5); // lock 5 giây
      } catch(de) {}
    }

    // ── Cache key: câu hỏi + focus + 50 ký tự đầu context (tránh lặp câu hỏi trong ca) ──
    // [FIX] skipCache=true dùng cho các lượt follow-up trong thread (phản bác/hỏi thêm):
    // đây là hội thoại theo mạch, mỗi câu cần AI xử lý thật, TUYỆT ĐỐI không được lấy
    // từ cache — trước đây do "question" gửi lên luôn là 1 câu cố định (bug ở frontend,
    // đã fix), cache key bị trùng với lần hỏi đầu tiên nên trả nhầm nội dung cũ.
    var _skipCache = !!(payload && payload.skipCache);
    var focusHint = context && context.focus ? context.focus : '';
    var _ckMascot = 'msc_' + focusHint + '_' + question.toLowerCase().replace(/\s+/g,'_').substring(0, 60)
                  + '_' + contextJson.substring(0, 50).replace(/\s/g,'');
    // [MỚI — theo yêu cầu trực tiếp: "user load liên tục tốn usage AI phân
    // tích lại liên tục thì không đúng, phần câu hỏi tự do thì không định
    // lượng được, nhưng cái NÀY thì đo đếm được"] TTL cache TRƯỚC ĐÂY cố định
    // 180s cho CẢ 3 luồng (Tổng quan tự động, chuông, câu hỏi tự do) — không
    // phân biệt. Luồng Tổng quan tự động gọi ĐÚNG 1 CÂU HỎI CỐ ĐỊNH mỗi khi
    // trang tải/reload — hoàn toàn ĐỊNH LƯỢNG ĐƯỢC (không như câu hỏi tự do,
    // nội dung ngẫu nhiên theo ý user, không kiểm soát được tần suất). Nay cho
    // phép bên gọi TỰ CHỌN thời gian cache riêng qua payload.cacheTtlSec — nếu
    // không truyền, GIỮ NGUYÊN 180s như cũ (không đổi hành vi câu hỏi tự do/
    // chuông cảnh báo). Trần 600s (10 phút) để không cache quá lâu tới mức lệch
    // hẳn so với số liệu thật (các thẻ số liệu vẫn làm mới độc lập, không phụ
    // thuộc cache này — chỉ phần TƯỜNG THUẬT của AI bị trễ theo, không phải số).
    var _cacheTtlSec = Math.max(30, Math.min(600, parseInt(payload && payload.cacheTtlSec, 10) || 180));
    if (!_skipCache) {
      try {
        var _cached = CacheService.getScriptCache().get(_ckMascot);
        if (_cached) return { success: true, text: _cached, fromCache: true };
      } catch(ce) {}
    }

    var focusMap = {
      'sup':            'Câu hỏi về tình hình của một SUP cụ thể.',
      'hub':            'Câu hỏi về tình hình của một Hub/Trạm cụ thể.',
      'aom':            'Câu hỏi về AOM.',
      'aom_tong_hop':   'Câu hỏi tổng hợp theo AOM.',
      'aging':          'Câu hỏi về đơn quá hạn / aging backlog.',
      'lost':           'Câu hỏi về đơn Lost Today.',
      'fms':            'Câu hỏi về tồn đọng FMS.',
      'top_hub':        'Câu hỏi xếp hạng hub nặng nhất.',
      'so_sanh_hub':    'Câu hỏi so sánh giữa các hub.',
      'tong_the':       'Câu hỏi cần nhận định / ưu tiên toàn diện.',
      'phan_tich_tu_do':'Câu hỏi phân tích tự do.'
    };
    var focusLine = focusHint && focusMap[focusHint]
      ? 'Phạm vi câu hỏi: ' + focusMap[focusHint]
      : '';

    // ── Output template theo intent ──
    var outputTemplates = {
      'sup': [
        "📊 <b>Tổng quan:</b> [tổng đơn QH / Lost — tỉ lệ so với toàn hệ thống là bao nhiêu %]<br>",
        "🔍 <b>Nhận định:</b> [SUP này đang ở mức nào — nhẹ / trung bình / nặng — vì sao]<br>",
        "📍 <b>Điểm nóng:</b> [hub nào đang gánh nhiều nhất, đơn aging lâu nhất bao nhiêu ngày]<br>",
        "✅ <b>Đề xuất:</b> [1–2 hành động cụ thể SUP hoặc sếp cần làm ngay]"
      ].join(""),
      'hub': [
        "📊 <b>Số liệu:</b> [QH / Lost / Chốt — so với hôm qua hoặc trung bình nếu có]<br>",
        "🔍 <b>Nhận định:</b> [hub đang ở mức nào, nguyên nhân có thể là gì dựa trên dữ liệu]<br>",
        "⚠️ <b>Rủi ro:</b> [đơn lâu nhất bao nhiêu ngày, nguy cơ vi phạm SLA không]<br>",
        "✅ <b>Đề xuất:</b> [hành động cụ thể cho hub này]"
      ].join(""),
      'aging': [
        "🔴 <b>Tình trạng aging:</b> [tổng đơn QH, tập trung ở hub / SUP nào nhiều nhất]<br>",
        "⏱️ <b>Đơn nguy hiểm nhất:</b> [đơn lâu nhất, aging bao nhiêu ngày, thuộc hub / SUP nào]<br>",
        "🔍 <b>Phân tích:</b> [pattern nào đang thấy — 1 hub chiếm bao nhiêu %, phân bố đều hay tập trung]<br>",
        "✅ <b>Ưu tiên xử lý:</b> [thứ tự hub / SUP cần xử lý trước, lý do]"
      ].join(""),
      'tong_the': [
        "BẮT BUỘC trả lời ĐỦ 8 mục theo đúng thứ tự La Mã dưới đây — mỗi mục tối đa 1–3 dòng, đi thẳng vào số liệu, KHÔNG lan man, KHÔNG lặp lại số liệu đã nêu ở mục khác. Đây là khung chuẩn để sếp đọc 1 lần là nắm hết ca, dù đang xem 1 trạm hay cả cụm nhiều trạm (SUP/AOM).<br>",
        "QUY TẮC PHẠM VI (đọc field 'scope' trong data trước khi viết):<br>",
        "• scope = 'hub' (1 trạm): mọi mục chỉ nói về ĐÚNG trạm đang xem — không suy diễn/gộp sang trạm khác.<br>",
        "• scope = 'multi_hub' (SUP/AOM/tài khoản nhiều trạm): mục I và Dự báo được phép nêu số TỔNG toàn cụm ('tong_hop_toan_pham_vi'); từ mục II trở đi CHỈ nêu đích danh (các) hub/driver/ward lệch hẳn so với phần còn lại — CẤM liệt kê dàn trải hết toàn bộ hub, chỉ chọn đúng (các) điểm nóng thật sự.<br>",
        "• Nếu 1 mục không có đủ dữ liệu để trả lời (kể cả với 1 trạm hay nhiều trạm): ghi đúng '[Chưa đủ dữ liệu]' tại mục đó, KHÔNG bịa số hay bỏ trống mục.<br><br>",
        "I. <b>Hiện trạng:</b> [vận hành hôm nay đang ở mức nào — bình thường/căng/khẩn cấp; KPI hiện tại (QH/Lost/backlog/FMS) so với baseline hoặc trung bình mọi ngày; có gì khác thường so với bình thường không]<br>",
        "II. <b>Vấn đề:</b> [KHÔNG lặp lại nguyên văn dòng '🔴 ĐIỂM NÓNG NHẤT' đã nêu ở đầu — chỉ bổ sung phần dòng đó CHƯA nói: mức độ nghiêm trọng (nhẹ/trung bình/nặng) và phạm vi ảnh hưởng (bao nhiêu đơn/bao nhiêu hub) tính bằng con số]<br>",
        "III. <b>Đối tượng:</b> [hub nào / driver nào / ward nào / SOP nào đang gây ra vấn đề ở mục II — nêu tên/mã thật lấy từ context (driverHotspot, zoneHotspot, kpiFailChiTietHomNay...) nếu có, KHÔNG nói chung chung 'một số hub/tài xế'. LƯU Ý: hệ thống hiện CHƯA lưu dữ liệu cấp 'tuyến' hay 'khách hàng cụ thể' — nếu câu hỏi/mục này cần tới thì ghi đúng 1 câu ngắn 'Chưa có dữ liệu cấp tuyến/khách hàng, chỉ có dữ liệu cấp hub-driver-khu vực', KHÔNG suy diễn hay gọi tên khách hàng/tuyến không có thật]<br>",
        "IV. <b>Nguyên nhân:</b> [chọn ĐÚNG loại dựa trên dữ liệu — thiếu nguồn lực (riderPlan) / con người (driverHotspot) / quy trình (sopLoaiChinh) / hệ thống / khách hàng (onhold_ly_do_breakdown) / yếu tố bên ngoài; không đoán khi thiếu căn cứ, ghi '[Chưa đủ dữ liệu xác định nguyên nhân]' nếu vậy]<br>",
        "V. <b>Xu hướng:</b> [đang tốt lên hay xấu đi, tăng hay giảm — dùng xu_huong_30p/baseline.xuHuongLienTiep nếu có; nêu rõ đây là sự cố nhất thời (mới lệch 1 ngày) hay đang lặp lại nhiều ngày liên tiếp]<br>",
        "VI. <b>Dự báo:</b> [1 câu NGẮN NHẤT có thể — chiều hướng chung nếu giữ nguyên tốc độ hiện tại (tốt lên/xấu đi/giữ nguyên). KHÔNG nêu chi tiết con số tồn đọng hay phương án xử lý ở đây — phần đó BẮT BUỘC để dành riêng cho 2 dòng 🎯/⚠️ ở cuối cùng theo rule ㉕, tránh nói 2 lần cùng 1 nội dung]<br>",
        "VII. <b>Hành động:</b> [từng việc 1 dòng bắt đầu bằng ☐ theo đúng rule ㉙ — ai làm (SUP/hub/rider nào cụ thể), việc gì, ưu tiên việc nào trước, cần điều phối thêm nguồn lực gì. Nếu hub đang nặng có field 'tram_gan_theo_dia_ly': có thể gợi ý điều động hỗ trợ từ (các) trạm gần đó co_du_lieu_van_hanh=true — LUÔN nêu rõ đây là GỢI Ý THAM KHẢO theo khoảng cách địa lý, KHÔNG khẳng định chắc chắn vì không có dữ liệu ai đang rảnh thực tế lúc này]<br>",
        "VIII. <b>Hiệu quả:</b> [CHỈ khi có field 'ketQuaXuLyTruoc' ở hub liên quan — dùng đúng 'chenhLech' đã tính sẵn để nói rõ cải thiện hay xấu đi so với lần xử lý gần nhất, mốc giờ đã resolve, còn cần hành động tiếp không; nếu KHÔNG có field này, ghi đúng 'Chưa có mốc xử lý trước để đối chiếu' — KHÔNG bịa ra kết quả]<br>",
        "GIỚI HẠN TỔNG: Toàn bộ 8 mục (I→VIII, chưa tính dòng mở đầu và 2 dòng kết) KHÔNG được vượt quá 16 dòng <br> cộng lại — nếu 1 mục thực sự không có gì đáng nói (VD tình hình ổn, không có nguyên nhân đặc biệt), viết ĐÚNG 1 dòng ngắn xác nhận việc đó rồi qua mục kế tiếp, không cố kéo dài cho đủ 3 dòng.<br>",
        "QUAN TRỌNG: Giữ đúng khung 8 mục này mỗi lần, nhưng nội dung từng mục phải phản ánh đúng data hôm nay — không rơi vào cùng 1 câu chữ mỗi lần chỉ đổi số."
      ].join(""),
      'so_sanh_hub': [
        "📊 <b>So sánh:</b> [bảng nhanh: Hub A — QH/Lost vs Hub B — QH/Lost]<br>",
        "🔍 <b>Hub nặng hơn:</b> [Hub nào đang tệ hơn, chênh lệch bao nhiêu, tỉ lệ %]<br>",
        "✅ <b>Đề xuất:</b> [nên tập trung nguồn lực vào hub nào trước, vì sao]"
      ].join(""),
      'top_hub': [
        "🔥 <b>Xếp hạng hub nặng nhất:</b><br>[liệt kê từng hub: tên — QH — Lost — nhận xét ngắn]<br>",
        "🔍 <b>Nhận định chung:</b> [top 1-2 chiếm bao nhiêu % tổng hệ thống, có bất thường không]<br>",
        "✅ <b>Ưu tiên:</b> [hub nào xử lý trước, vì sao]"
      ].join(""),
      'lost': [
        "📊 <b>Lost hôm nay:</b> [tổng, tập trung ở đâu nhiều nhất]<br>",
        "🔍 <b>Nhận định:</b> [mức độ so với bình thường, hub / SUP nào đang có vấn đề]<br>",
        "✅ <b>Hành động:</b> [cần làm gì ngay để giảm lost]"
      ].join(""),
      'default': [
        "📊 <b>Số liệu chính:</b> [trả lời trực tiếp câu hỏi với con số cụ thể]<br>",
        "🔍 <b>Nhận định:</b> [ý nghĩa của số liệu đó — tốt / xấu / bình thường, vì sao]<br>",
        "✅ <b>Đề xuất:</b> [1–2 hành động cụ thể sếp nên làm dựa trên dữ liệu này]"
      ].join("")
    };

    var template = outputTemplates[focusHint] || outputTemplates['default'];

    // [FIX] Cắt prompt gửi đi — trước đây LUÔN gửi đủ 22 quy tắc dù phần lớn chỉ áp
    // dụng cho tình huống đặc biệt (follow-up trong thread, có dữ liệu BI, có d1Plan...).
    // Với lượt bấm chuông đầu tiên (không phải follow-up, chưa mở BI, chưa có d1Plan) —
    // trường hợp PHỔ BIẾN NHẤT — các quy tắc đó chiếm ~4.500 ký tự dư thừa, đẩy tổng
    // prompt lên tới ~14.500 ký tự và khiến insea.io SuperAgent trả về câu chào mặc định
    // thay vì phân tích thật (nghi ngờ vượt ngưỡng xử lý input). Nay chỉ gửi quy tắc nào
    // THỰC SỰ liên quan tới field đang có trong context — khi có follow-up/BI/d1Plan thật,
    // quy tắc tương ứng vẫn được gửi đầy đủ như cũ, không mất tính năng gì.
    var _hasFollowUp   = !!context.tin_nhan_moi_nhat_cua_sep;
    var _hasGhiChu     = Array.isArray(context.hubs) && context.hubs.some(function(h){ return h && h.ghiChuDaXacNhan && h.ghiChuDaXacNhan.length; });
    var _hasBiModule   = !!context.bi_module_hien_tai;
    var _hasD1Plan     = Array.isArray(context.hubs) && context.hubs.some(function(h){ return h && h.d1Plan; });
    var _hasXuHuong30p = !!context.xu_huong_30p;
    var _hasLichSuCa   = !!context.lich_su_hoi_trong_ca;
    var _hasRiderPlan  = Array.isArray(context.hubs) && context.hubs.some(function(h){ return h && h.riderPlan; });
    // [BỔ SUNG] Cờ cho các field mới: driver/zone hotspot, nguyên nhân KPI Fail chi tiết,
    // xu hướng liên tiếp, và kết quả xử lý của lần cảnh báo trước (đóng vòng lặp Hiệu quả).
    var _hasDriverHotspot = Array.isArray(context.hubs) && context.hubs.some(function(h){ return h && h.driverHotspot && h.driverHotspot.length; });
    var _hasZoneHotspot   = Array.isArray(context.hubs) && context.hubs.some(function(h){ return h && h.zoneHotspot && h.zoneHotspot.length; });
    var _hasKpiFailChiTiet= Array.isArray(context.hubs) && context.hubs.some(function(h){ return h && h.kpiFailChiTietHomNay; });
    var _hasXuHuongLienTiep = Array.isArray(context.hubs) && context.hubs.some(function(h){ return h && h.baseline && h.baseline.xuHuongLienTiep; });
    var _hasKetQuaXuLyTruoc = Array.isArray(context.hubs) && context.hubs.some(function(h){ return h && h.ketQuaXuLyTruoc; });

    var quyTac = [
      "① Mọi nhận định PHẢI có số liệu dẫn chứng cụ thể (VD: 'hub X chiếm 34% tổng QH').",
      "② Đề xuất phải là hành động làm được ngay trong ca — không phải lý thuyết.",
      "③ Thiếu data cho 1 phần: ghi '[Cần sync data]' tại phần đó. QUAN TRỌNG: 'nguon_du_lieu_da_mo_trong_phien' cho biết Pick/Vi phạm/Rescue/Rider Plan module đã được user MỞ trong phiên này hay chưa (true/false) — nếu false, pickTotal/viphamTotal/rescueChuaXuLy/rescueDo/rider_plan_ke_hoach = 0 KHÔNG có nghĩa 'sạch', mà là 'chưa có dữ liệu để kiểm tra' — PHẢI nói rõ điều này, KHÔNG được kết luận 'không có vấn đề' từ số 0 đó.",
      "④ Định dạng: CHỈ dùng <b>...</b> và <br>. TUYỆT ĐỐI KHÔNG dùng Markdown (**, ##, gạch đầu dòng -, số thứ tự '1. 2.'). Tiêu đề mục: '(emoji) <b>Tên mục:</b>' — emoji ngay trước <b>, không chèn số/dấu chấm xen giữa. Liệt kê nhiều ý: xuống dòng bằng <br>, không dùng '-'.",
      "⑤ Xưng 'em', gọi 'sếp'. Tone: chuyên nghiệp, gần gũi.",
      // [SỬA — báo cáo: AI in cả quá trình suy luận và tên trường kỹ thuật ra màn hình]
      // Ví dụ thực tế đã xảy ra: "1. LIỆT KÊ DỮ LIỆU THẬT: scope = hub... pick=false,
      // riderplan_chua_nhap = 1... 5. CHỐT HÀNH ĐỘNG" nằm TRƯỚC dòng mở đầu bắt buộc
      // -> giao diện tách mục bằng regex ^🔴 nên KHÔNG khớp -> đổ nguyên khối ra màn hình
      // và mất luôn danh sách việc tick được. Hai quy tắc dưới chặn từ gốc.
      "㉚ CHỈ xuất đúng các mục trong khuôn mẫu. TUYỆT ĐỐI KHÔNG in quá trình suy luận,\nkhông liệt kê dữ liệu đầu vào, không mục tự kiểm tra/đối chiếu/chốt hành động, không\nđánh số bước. Dòng ĐẦU TIÊN của câu trả lời phải là dòng 🔴 — không có bất kỳ chữ nào trước nó.",
      "㉛ NGÔN NGỮ VẬN HÀNH, không phải ngôn ngữ kỹ thuật. CẤM viết tên trường dữ liệu,\ntên biến, dấu '=', true/false, JSON, hay cụm như '[Cần sync data]', 'context', 'field'.\nThiếu dữ liệu thì viết bằng lời: 'chưa có dữ liệu Pick trong ca này'. Gọi nhóm theo\nnghĩa vận hành ('nhóm tồn trên 5 ngày'), không gọi 'Nhóm A/B/C' trống nghĩa.",
      "⑥ Emoji: chỉ ở đầu mỗi mục như template, không thêm tùy tiện.",
      "⑧ 'tong_hop_toan_pham_vi' nếu có: là số TỔNG để phân tích, không phải kết luận — tự đánh giá kết hợp breakdown từng hub.",
      "⑩ CẤM: 'cần theo dõi thêm', 'chú ý sát sao', 'xử lý sớm', 'kiểm tra lại'. Thay bằng: làm gì + với ai (tên cụ thể) + deadline (giờ/ca). Phần 'Việc cần làm ngay' phải là thao tác nghiệp vụ thật, không chỉ 'vào module X xem'.",
      "⑳ Phân nhóm onhold/aging theo khẩn cấp: Nhóm A (làm ngay): reject+unavailable ≥2 lần + aging >5 ngày. Nhóm B (trong ca): reschedule hôm nay + re-attempt lần 2. Nhóm C (theo dõi): reschedule ngày mai + onhold lần 1. Nêu con số và hành động rõ từng nhóm.",
      "㉒ Đối chiếu kết luận khẩn cấp với 'thoi_gian_hien_tai' (gioHienTai, khungCa). Cùng 1 con số có thể bình thường đầu ca nhưng báo động cuối ca. Nếu 'todaySynced' cách 'luuLucNao' >2 tiếng so gioHienTai: nêu rõ số liệu có thể cũ.",
      "㉓ Đặt nhận xét trong ngữ cảnh tiến độ ca: nếu có 'pct_ca_da_troi_qua' và 'ky_vong_giao_pct' — không so rate với target cuối ngày khi ca còn dài. Dùng 'tien_do_so_ky_vong' làm câu mở đầu. <40% ca: ưu tiên 'cần làm gì'. >75% ca hoặc phut_toi_deadline_sla <90: mọi tồn đọng nghiêm trọng hơn — nêu rõ 'còn X phút'.",
      "㉔ Follow-up: đọc 'loai_phan_hoi' — (A) phan_bac: thừa nhận nếu đúng/giải thích nếu còn đúng, không lặp cũ. (B) them_thong_tin: tích hợp info mới. (C) hoi_giai_thich: đào sâu đúng điểm đó. (D) hoi_gia_dinh: tính kịch bản cụ thể. (E) hoi_them: trả lời khía cạnh mới.",
      "㉕ KẾT THÚC bắt buộc 2 dòng (emoji 🎯 ⚠️ là mốc tách hiển thị — thiếu = hiển thị sai):<br>🎯 <b>Nếu xử lý đúng:</b> [SỰ KIỆN/con số sẽ xảy ra tới mốc giờ cụ thể — CẤM nhận xét 'tốt/ổn']<br>⚠️ <b>Nếu không xử lý kịp:</b> (a) số đơn tồn dồn cụ thể + (b) ai xử lý ca sau, thứ tự ưu tiên. Tình huống nhẹ: 'rủi ro thấp, không cần leo thang'.",
      "㉖ Câu hỏi ngoài lề vận hành: trả lời ngắn thân thiện, đùa nhẹ 1 câu, sau đó kéo về 1 gợi ý cụ thể từ số thật đang có. Không áp rule ⑮, không nhét số liệu vào phần trả lời ngoài lề."
    ];

    // Conditional rules — chỉ push khi field tương ứng tồn tại trong context
    if (_hasXuHuong30p) quyTac.push("⑦ 'xu_huong_30p' có mặt: bắt buộc đề cập xu hướng tăng/giảm so với 30p trước khi nhận xét số liệu tổng hợp.");
    if (_hasLichSuCa)   quyTac.push("⑨ 'lich_su_hoi_trong_ca' có nội dung: dùng để biết sếp đang theo dõi vấn đề gì, không lặp lại điều đã giải thích.");
    if (_hasGhiChu)     quyTac.push("⑫ Hub có 'ghiChuDaXacNhan': đặt trong 📋 <b>Ghi chú đã xác nhận:</b>, đánh dấu đã xử lý hay chưa, liên kết với diễn biến mới nếu có.");

    // [SỬA — theo phản hồi trực tiếp] ⑭ (câu hỏi giả định "nếu...thì...") trước
    // đây CHỈ áp dụng khi là follow-up trong luồng hội thoại — câu hỏi ĐẦU TIÊN
    // của phiên nếu là dạng giả định thì KHÔNG có hướng dẫn này, AI phải tự
    // xoay sở không có khung ước tính rõ ràng. Đưa ra NGOÀI khối follow-up,
    // áp dụng cho MỌI câu hỏi — không phụ thuộc có phải follow-up hay không.
    quyTac.push("⑭ Câu hỏi giả định (\"nếu...thì...\"): ước tính sơ bộ theo công thức đơn giản từ số thật (backlog/tốc độ xử lý/rider hiện tại), nêu rõ đây là ước tính định hướng, không cam kết chính xác.");

    if (_hasFollowUp) {
      quyTac.push("⑩b Sếp gửi follow-up: phân loại đúng rồi mới xử lý — phan_bac→⑪; hoi_nguon→⑬; gia_dinh→⑭; ngoai_pham_vi→⑮. Không mặc định coi mọi tin nhắn là phản bác.");
      quyTac.push("⑪ Phản bác: (a) CÓ dẫn chứng số/hub/mã đơn → thừa nhận/điều chỉnh nếu đúng, hoặc đối chiếu số liệu nếu sai. (b) KHÔNG dẫn chứng → hỏi lại 1 câu cụ thể để làm rõ, không tự đổi ý khi không có căn cứ.");
      quyTac.push("⑬ Hỏi nguồn gốc số liệu: chỉ rõ field/nguồn thật trong context đã dùng. Không biết → nói thẳng 'số liệu tổng hợp từ dữ liệu vận hành, không có nguồn chi tiết hơn'.");
      quyTac.push("⑮ Ngoài phạm vi data: kiểm tra 'bi_module_hien_tai' trước — nếu khớp trạm đang hỏi thì dùng. Chỉ khi không có mới nói thẳng thiếu data, gợi ý module phù hợp.");
      quyTac.push("⑯ 'lich_su_hoi_dap_trong_thread' có mặt: đọc để hiểu mạch hội thoại, không giải thích lại điều đã trả lời ở lượt trước.");
    }

    if (!_hasFollowUp) {
      quyTac.push("㉘ MỞ ĐẦU bắt buộc ĐÚNG 1 dòng (frontend tách hiển thị — SAI định dạng = hiển thị sai):\n🔴 <b>ĐIỂM NÓNG NHẤT:</b> [1 câu ≤25 từ — con số nguy hiểm nhất + hậu quả nếu bỏ qua. Chỉ 1 vấn đề. Nếu ổn: 'Không có điểm nóng đáng lo — ca đang ổn định']");
      quyTac.push("㉙ Mục ✅ Hành động: mỗi việc trên 1 dòng riêng, bắt đầu '☐ '. Format: '☐ [Ai] → [làm gì cụ thể] — trước [giờ/mốc]'. Không dùng '-' hay số thứ tự.");
    }var prompt = [
      // [SỬA] Trước đây chỉ nhắc Lead/SUP — bỏ sót hoàn toàn AOM/ROM.
      _spxAiRoleHeader_(payload && payload.viewLevel, ""),
      "Đây là trợ lý vận hành nội bộ, phân tích dữ liệu ca trực theo thời gian thực.",
      "",
      "VAI TRÒ: Chuyên gia vận hành logistics — không phải chatbot thông thường. Mọi câu trả lời phải dựa 100% trên số liệu thực tế được cung cấp, có nhận định rõ ràng và hành động cụ thể.",
      "",
      focusLine,
      "Câu hỏi: \"" + question + "\"",
      "",
      "Dữ liệu thực tế (đã lọc theo phạm vi câu hỏi):",
      contextJson,
      "",
      "CÁCH TRẢ LỜI (điền số liệu thật, KHÔNG được để chung chung — với các mục có khuôn cố định thì theo đúng khuôn, với mục ghi rõ 'tự quyết định' thì được tự do cấu trúc câu trả lời miễn đảm bảo có dẫn chứng số liệu):",
      template,
      "",
      "QUY TẮC CỨNG:"
    ].concat(quyTac).join("\n");

    var _resultMsc = _callInsea(prompt);
    // Đầu ra đã được lọc tập trung trong _callInsea() — không lọc lại ở đây.
    if (!_skipCache && _resultMsc.success && _resultMsc.text) {
      try { CacheService.getScriptCache().put(_ckMascot, _resultMsc.text, _cacheTtlSec); } catch(ce) {}
    }
    return _resultMsc;

  } catch(e) {
    return { success: false, text: 'Lỗi hệ thống: ' + e.message };
  }
}

// [ĐÃ XOÁ — MODULE AI MỞ RỘNG (ai_analyzeOnhold/ai_analyzeAging/ai_analyzeRiderPlan)]
// Cả 3 hàm phân tích AI kiểu cũ này đã bị THAY THẾ HOÀN TOÀN bởi
// ana_askMascotAssistant()/alert_getFullAnalysis() — kiến trúc mới hơn, dùng
// chung 1 pipeline cho Tổng quan + (trước đây) chuông cảnh báo. Xác nhận qua
// grep toàn bộ dự án: không còn nơi nào gọi 3 tên hàm cũ này nữa, cũng không
// trùng tên với bất kỳ Trigger thật nào đang cài đặt.


/**
 * ============================================================
 * MODULE TREND — BACKEND GAS
 * Lưu / đọc lịch sử vận hành trạm + tài xế theo ngày
 *
 * Kiến trúc:
 *   - Cùng MASTER_DB_ID với hệ thống hiện tại
 *   - 2 sheet tab mới: Station_Daily, Driver_Daily
 *   - Tự tạo sheet nếu chưa có (tương tự pattern saveStationData)
 *   - LockService chống race condition đa user / đa trạm
 *   - Kiểm tra quyền qua checkAnalyticsPermission trước mọi thao tác ghi
 *   - Time-based trigger tự động chốt 22h30 mỗi ngày
 * ============================================================
 */

// ── HELPERS ─────────────────────────────────────────────────

/** Sheet Station_Daily — tự tạo nếu chưa có */
function _trendStationSheet(ss) {
  var HEADERS = [
    'date', 'station', 'total', 'delivered', 'rate',
    'delivering', 'onhold', 'hoan', 'reattempts',
    'cod_total', 'cod_delivered', 'driver_count',
    'inbound', 'outbound', 'pickup_total', 'pickup_done', 'pickup_rate',
    'saved_by', 'saved_at'
  ];
  var sheet = ss.getSheetByName('Station_Daily');
  if (!sheet) {
    sheet = ss.insertSheet('Station_Daily');
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 160);
    if (sheet.getMaxColumns() > HEADERS.length) {
      sheet.deleteColumns(HEADERS.length + 1, sheet.getMaxColumns() - HEADERS.length);
    }
    return sheet;
  }
  // MIGRATE: sheet cũ có thể thiếu 5 cột inbound/outbound/pickup_* (tạo trước khi feature pickup ra đời)
  // Header cũ: ...driver_count, saved_by, saved_at (14 cột)
  // Header mới: ...driver_count, inbound, outbound, pickup_total, pickup_done, pickup_rate, saved_by, saved_at (19 cột)
  // FIX: đọc header theo NỘI DUNG (không phụ thuộc lastCol < HEADERS.length, xem giải thích
  // chi tiết ở _trendDriverSheet) + phân biệt 2 trường hợp để không bao giờ insertColumnsBefore
  // lên 1 sheet đã có data thật nằm sau "saved_by" cũ (tránh làm lệch data đang đúng).
  var maxColsS  = sheet.getMaxColumns();
  var lastCol   = sheet.getLastColumn();
  var readColsS = Math.max(1, Math.min(Math.max(lastCol, HEADERS.length), maxColsS));
  var curHeaders = sheet.getRange(1, 1, 1, readColsS).getValues()[0];
  var hasNewCols  = curHeaders.indexOf('inbound') >= 0;
  if (!hasNewCols) {
    var savedByIdx0 = curHeaders.indexOf('saved_by'); // 0-based, -1 nếu không có
    var savedByCol1 = savedByIdx0 >= 0 ? (savedByIdx0 + 1) : 0; // 1-based

    if (savedByCol1 > 0 && lastCol > savedByCol1) {
      // TRƯỜNG HỢP A: đã có data thật vượt qua "saved_by" cũ → chỉ đổi tên 7 header
      // (inbound..pickup_rate, saved_by, saved_at), KHÔNG insertColumnsBefore.
      sheet.getRange(1, savedByCol1, 1, 7)
        .setValues([['inbound','outbound','pickup_total','pickup_done','pickup_rate','saved_by','saved_at']])
        .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    } else {
      // TRƯỜNG HỢP B: layout cũ thật, chưa có dòng nào chứa inbound/pickup → an toàn để chèn cột.
      var lastRow = sheet.getLastRow();
      var insertBeforeCol = savedByCol1 > 0 ? savedByCol1 : 13;
      sheet.insertColumnsBefore(insertBeforeCol, 5);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
        .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
      if (lastRow > 1) {
        var fillRange = sheet.getRange(2, insertBeforeCol, lastRow - 1, 5);
        var zeros = [];
        for (var i = 0; i < lastRow - 1; i++) zeros.push([0,0,0,0,0]);
        fillRange.setValues(zeros);
      }
    }
  }
  return sheet;
}

/** Sheet Driver_Daily — tự tạo nếu chưa có */
function _trendDriverSheet(ss) {
  var HEADERS = [
    'date', 'station', 'driver_id', 'driver_name',
    'total', 'delivered', 'rate', 'delivering',
    'onhold', 'hoan', 'reattempts', 'cod', 'cod_delivered',
    'top_zone', 'pickup_assigned', 'pickup_done', 'pickup_rate',
    'saved_at'
  ];
  var sheet = ss.getSheetByName('Driver_Daily');
  if (!sheet) {
    sheet = ss.insertSheet('Driver_Daily');
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(4, 180);
    if (sheet.getMaxColumns() > HEADERS.length) {
      sheet.deleteColumns(HEADERS.length + 1, sheet.getMaxColumns() - HEADERS.length);
    }
    return sheet;
  }
  // MIGRATE: sheet cũ có thể thiếu 3 cột pickup_assigned/pickup_done/pickup_rate
  // Header cũ: ...top_zone, saved_at (15 cột)
  // Header mới: ...top_zone, pickup_assigned, pickup_done, pickup_rate, saved_at (18 cột)
  // FIX: KHÔNG dựa vào lastCol < HEADERS.length để quyết định có migrate hay không.
  // Lý do: nếu sheet đã có sẵn cột rác/format thừa ở phía sau (lastCol >= 18) nhưng
  // header thực tế vẫn là layout cũ, điều kiện cũ sẽ bỏ qua migrate hoàn toàn → header
  // bị sai vị trí (vd "saved_at" nằm ở cột mà code đang ghi pickup_assigned vào, 2 cột
  // kế tiếp không có tên) dù DATA vẫn được ghi đúng theo index code (tự đọc/tự ghi khớp
  // nhau) — chỉ phần HIỂN THỊ header bị lệch, dễ gây hiểu nhầm khi xem trực tiếp Sheet.
  // → Luôn đọc header hiện có theo NỘI DUNG (bất kể lastCol) rồi mới quyết định.
  var maxColsD   = sheet.getMaxColumns();
  var lastColD   = sheet.getLastColumn();
  var readColsD  = Math.max(1, Math.min(Math.max(lastColD, HEADERS.length), maxColsD));
  var curHeaders = sheet.getRange(1, 1, 1, readColsD).getValues()[0];
  var hasNewCols = curHeaders.indexOf('pickup_assigned') >= 0;
  if (!hasNewCols) {
    var savedAtIdx0 = curHeaders.indexOf('saved_at'); // 0-based, -1 nếu không có
    var savedAtCol1 = savedAtIdx0 >= 0 ? (savedAtIdx0 + 1) : 0; // 1-based

    if (savedAtCol1 > 0 && lastColD > savedAtCol1) {
      // TRƯỜNG HỢP A: sheet đã có DATA THỰC vượt qua cột "saved_at" cũ (code ghi-đọc
      // theo index cố định đã từng chạy ở đây, ví dụ cột O,P,Q trong ảnh chụp thực tế).
      // → CHỈ đổi lại TÊN 4 cột header cho khớp với dữ liệu đang nằm sẵn, TUYỆT ĐỐI
      //   không insertColumnsBefore — insert sẽ đẩy lệch toàn bộ data đã ghi đúng vị trí,
      //   biến lỗi "header sai tên" thành lỗi "data thật sự lệch cột" (nặng hơn nhiều).
      sheet.getRange(1, savedAtCol1, 1, 4)
        .setValues([['pickup_assigned', 'pickup_done', 'pickup_rate', 'saved_at']])
        .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
    } else {
      // TRƯỜNG HỢP B: sheet đúng nghĩa layout cũ, CHƯA từng có dòng nào chứa pickup
      // (không có data thừa sau "saved_at") → an toàn để chèn 3 cột mới như cũ.
      var lastRow = sheet.getLastRow();
      var insertBeforeCol = savedAtCol1 > 0 ? savedAtCol1 : 15;
      sheet.insertColumnsBefore(insertBeforeCol, 3);
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
        .setFontWeight('bold').setBackground('#1e3a5f').setFontColor('#ffffff');
      if (lastRow > 1) {
        var fillRange = sheet.getRange(2, insertBeforeCol, lastRow - 1, 3);
        var zeros = [];
        for (var i = 0; i < lastRow - 1; i++) zeros.push([0,0,0]);
        fillRange.setValues(zeros);
      }
    }
  }
  return sheet;
}

/** Ngày hôm nay theo giờ VN — nhất quán với phần còn lại của backend */
function _trendTodayKey() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
}

/** Timestamp đầy đủ giờ VN */
function _trendNowVN() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ss'+07:00'");
}

/** 'yyyy-MM-dd' → ngày trước đó 1 ngày, cùng định dạng. Dùng để tính cận trên
 *  khi query Firestore phần dữ liệu đã bị purge khỏi Sheet (xem getTrendStation). */
function _trendPrevDay_(dateStr) {
  var d = new Date(dateStr + 'T00:00:00+07:00');
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
}

/**
 * Kiểm tra xem ngày + trạm đã có snapshot chưa
 * Trả về số thứ tự hàng nếu đã tồn tại, 0 nếu chưa
 */
function _trendFindStationRow(sheet, dateKey, stationName) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var stNorm = stationName.trim().toLowerCase();
  for (var i = 0; i < values.length; i++) {
    var rawDate = values[i][0];
    var rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
      : String(rawDate || '').slice(0, 10);
    var rowStation = String(values[i][1] || '').trim().toLowerCase();
    if (rowDate === dateKey && rowStation === stNorm) {
      return i + 2;
    }
  }
  return 0;
}

/**
 * Xóa tất cả dòng Driver_Daily của (dateKey, stationName) rồi ghi lại batch.
 * Tối ưu: đọc 2 cột đầu để locate, đọc full cols chỉ những hàng cần giữ lại.
 * → O(3) API calls thay vì O(N) deleteRow — tránh timeout lock với dataset lớn.
 */
function _trendDeleteDriverRows(sheet, dateKey, stationName) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var totalCols = 18; // Driver_Daily có 18 cột (date → saved_at)
  var stNorm = stationName.trim().toLowerCase();

  // Bước 1: chỉ đọc 2 cột để xác định các hàng cần giữ/bỏ — nhanh hơn đọc 18 cột
  var keyCols = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var keepIdxs = []; // 0-based index trong keyCols
  for (var i = 0; i < keyCols.length; i++) {
    var rawDate = keyCols[i][0];
    var rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
      : String(rawDate || '').slice(0, 10);
    var rowStation = String(keyCols[i][1] || '').trim().toLowerCase();
    if (!(rowDate === dateKey && rowStation === stNorm)) {
      keepIdxs.push(i);
    }
  }

  // Không có hàng nào cần xóa
  if (keepIdxs.length === keyCols.length) return;

  // Bước 2: đọc full 18 cột của các hàng cần giữ (tránh đọc cả sheet)
  var allValues = sheet.getRange(2, 1, lastRow - 1, totalCols).getValues();
  var keep = keepIdxs.map(function(idx) { return allValues[idx]; });

  // Bước 3: xóa toàn vùng data rồi ghi lại batch — 2 API calls
  sheet.getRange(2, 1, lastRow - 1, totalCols).clearContent();
  if (keep.length > 0) {
    sheet.getRange(2, 1, keep.length, totalCols).setValues(keep);
  }
}

/**
 * FIX HÀNG LẤY: đọc lại pickup_assigned/pickup_done/pickup_rate hiện có trong Driver_Daily
 * cho (dateKey, stationName), trả về map driverId -> {assigned, picked, rate}.
 * Dùng để MERGE khi phiên save hiện tại không có dữ liệu pickup mới (hasPickupData=false),
 * tránh việc _trendDeleteDriverRows + ghi lại xóa mất số liệu pickup đã có từ trước
 * (vd người A upload file pickup lúc 10h, người B refresh đơn hàng lúc 14h ở phiên/tab
 * khác không có pickup trong bộ nhớ → nếu không merge sẽ ghi đè 0 đè lên số đã đúng).
 * Phải gọi hàm này TRƯỚC khi xóa dòng cũ.
 */
function _trendGetOldDriverPickupMap(sheet, dateKey, stationName) {
  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return map;
  var stNorm = stationName.trim().toLowerCase();
  var totalCols = 18; // date..saved_at
  var values = sheet.getRange(2, 1, lastRow - 1, totalCols).getValues();
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rawDate = row[0];
    var rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
      : String(rawDate || '').slice(0, 10);
    var rowStation = String(row[1] || '').trim().toLowerCase();
    if (rowDate !== dateKey || rowStation !== stNorm) continue;
    var driverId = String(row[2] || '').trim();
    if (!driverId) continue;
    map[driverId] = {
      name:     row[3]  || '',
      assigned: row[14] || 0,
      picked:   row[15] || 0,
      rate:     row[16] || 0
    };
  }
  return map;
}

/**
 * _trendPurgeSheet(ss, sheetName, totalCols, archiveFn)
 * Xóa các hàng cũ hơn 62 ngày của 1 sheet trong 1 spreadsheet cụ thể.
 *
 * archiveFn (tuỳ chọn): function(expiredRows) — gọi TRƯỚC khi xoá, dùng để
 * archive các row sắp mất vào Firestore (xem _fsArchiveStationRows_ /
 * _fsArchiveDriverRows_ trong Firestore_Bridge.gs). Nếu archiveFn throw lỗi
 * (vd mất mạng, Firestore quota), HUỶ purge lần này — giữ nguyên data trong
 * Sheet, thử lại ở lần chạy trigger kế tiếp — KHÔNG BAO GIỜ xoá khi chưa
 * chắc đã lưu được bản sao.
 */
function _trendPurgeSheet(ss, sheetName, totalCols, archiveFn) {
  var cutoffStr = _spxVnDateStr_(-62); // [SỬA] 62 ngày trước theo GIỜ VIỆT NAM

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return 0;

  var lastRow = sheet.getLastRow();
  var allValues = sheet.getRange(2, 1, lastRow - 1, totalCols).getValues();

  var keep = [];
  var expired = [];
  allValues.forEach(function(row) {
    var rawDate = row[0];
    var rowDate = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
      : String(rawDate || '').slice(0, 10);
    if (rowDate >= cutoffStr) keep.push(row); else expired.push(row); // giữ lại nếu còn trong 62 ngày
  });

  if (expired.length === 0) return 0; // không có gì cần xóa

  if (archiveFn) {
    try {
      archiveFn(expired);
    } catch (eArchive) {
      _LOG.d('[TREND PURGE] Archive Firestore lỗi, HUỶ purge ' + sheetName +
        ' lần này (giữ nguyên Sheet, thử lại đêm sau): ' + eArchive.message);
      return 0;
    }
  }

  sheet.getRange(2, 1, lastRow - 1, totalCols).clearContent();
  if (keep.length > 0) {
    sheet.getRange(2, 1, keep.length, totalCols).setValues(keep);
  }
  return expired.length;
}

/**
 * _trendPurgeOldRows(ssMaster, ssDriver)
 * Station_Daily luôn ở MASTER (ssMaster).
 * Driver_Daily nằm theo trạm (ssDriver) — có thể trùng ssMaster (trạm ở MASTER)
 * hoặc khác (trạm ở DB2/DB3).
 */
function _trendPurgeOldRows(ssMaster, ssDriver) {
  _trendPurgeSheet(ssMaster, 'Station_Daily', 19);
  _trendPurgeSheet(ssDriver || ssMaster, 'Driver_Daily', 18);
}

// ── HÀM CHÍNH: CHỐT NGÀY ────────────────────────────────────

/**
 * saveSnapshot(stationName, summaryJson, driverStatsJson, forceOverwrite)
 *
 * Gọi từ Frontend Analytics Block khi:
 *   - Quản lý bấm nút "Chốt ngày"
 *
 * summaryJson:     JSON.stringify(ANA.summary)
 * driverStatsJson: JSON.stringify(ANA.driverStats)
 * forceOverwrite:  true = ghi đè nếu đã có, false = bỏ qua nếu đã có
 *
 * Đa trạm / đa người dùng:
 *   - getUserLock: mỗi Google account có lock riêng → 2 user khác nhau chạy song song
 *   - Mỗi trạm là 1 row độc lập trong Station_Daily → không ảnh hưởng nhau
 *   - Driver_Daily: clearContent + setValues batch theo (date, station) → atomic per station
 */
function saveSnapshot(stationName, summaryJson, driverStatsJson, forceOverwrite, extraJson) {
  // Kiểm tra quyền: user phải có quyền trên trạm này
  var email = Session.getActiveUser().getEmail();
  var perm  = checkAnalyticsPermission(email);
  if (!perm.allowed) {
    return { success: false, msg: 'Không có quyền truy cập Analytics.' };
  }
  var stationNorm = (stationName || '').trim();
  // Kiểm tra user có quyền với trạm cụ thể này không
  var hasStationPerm = perm.stations.some(function(s) {
    return s.trim().toLowerCase() === stationNorm.toLowerCase();
  });
  if (!hasStationPerm) {
    return { success: false, msg: 'Bạn không có quyền chốt ngày cho trạm: ' + stationNorm };
  }

  // FIX RACE ĐA TRẠM: trước đây dùng getUserLock() — chỉ chặn CÙNG 1 tài khoản gọi
  // đồng thời, nên user trạm DLK1 và user trạm DLK2 chạy HOÀN TOÀN SONG SONG.
  // Vấn đề: _trendDeleteDriverRows() và _trendPurgeOldRows() đọc-toàn-sheet rồi
  // clearContent()+setValues() lại — DỊCH CHUYỂN vị trí dòng của MỌI trạm khác đang
  // dùng chung Station_Daily/Driver_Daily. Nếu 2 trạm khác nhau save gần nhau, 1 trạm
  // có thể đang giữ "existRow" (số dòng đọc trước đó) đã bị lệch do trạm kia vừa xóa/dồn
  // dòng → ghi đè nhầm vào dòng của trạm khác. Cần 1 khoá TOÀN CỤC (mọi tài khoản, mọi
  // trạm) để đảm bảo không có 2 lệnh save nào chồng lấp thời gian thực thi — vẫn đúng
  // như phân tích gốc, KHÔNG đổi mức độ an toàn này.
  // [FIX 2026-07-16] TRƯỚC ĐÂY dùng thẳng LockService.getScriptLock().waitLock(45000) —
  // GIỮ đúng tài nguyên LockService toàn cục trong SUỐT thời gian saveSnapshot() chạy
  // (có thể vài chục giây). Mọi hàm KHÁC cũng cần mượn ĐÚNG LockService.getScriptLock()
  // này trong khoảnh khắc rất ngắn (≤2s/lượt thử) để kiểm tra atomic — kể cả các hàm
  // duyệt quyền đăng nhập (spx_setAccessLoginStatus...) chỉ cần waitLock(10000) ngắn.
  // Hệ quả thực tế: saveSnapshot() của 1 trạm giữ khoá toàn cục hàng chục giây → MỌI
  // thao tác khác (Inbound của trạm khác, duyệt quyền đăng nhập...) bị kẹt hàng loạt
  // lượt thử-chiếm-khoá, timeout ÂM THẦM (không phải lỗi JS nên không hiện gì ở Console)
  // → phải bấm lại nhiều lần mới đúng lúc khoá rảnh.
  // SỬA: đổi sang _anaAcquireNamedLock()/_anaReleaseNamedLock() (PropertiesService) với 1
  // key TOÀN CỤC dùng chung ('ana_trend_global_lock') — vẫn xếp hàng tuần tự y hệt cũ
  // (không đổi tính đúng đắn chống lệch dòng Trend), nhưng không còn chiếm giữ tài nguyên
  // LockService.getScriptLock() thật trong thời gian dài, nhường lại cho các thao tác
  // khác chỉ cần mượn nó trong tích tắc.
  var _snapLockKey = 'ana_trend_global_lock';
  if (!_anaAcquireNamedLock(_snapLockKey, 45000)) {
    return { success: false, msg: 'Hệ thống đang xử lý lượt lưu khác, vui lòng thử lại sau vài giây.' };
  }

  try {
    var ss       = _DS.ss(MASTER_DB_ID);   // Station_Daily, Trigger_Log
    var ssDriver = getStationSS(stationNorm);                // Driver_Daily theo trạm
    var dateKey  = _trendTodayKey();
    var nowVN    = _trendNowVN();

    var summary     = JSON.parse(summaryJson     || '{}');
    var driverStats = JSON.parse(driverStatsJson || '[]');
    var extra = {};
    try { extra = JSON.parse(extraJson || '{}'); } catch(e) {}
    var inbound     = extra.inbound     || 0;
    var outbound    = extra.outbound    || 0;
    var pickupTotal = extra.pickupTotal || 0;
    var pickupDone  = extra.pickupDone  || 0;
    var pickupRate  = extra.pickupRate  || 0;
    var dataDate    = String(extra.dataDate || '').slice(0, 10);
    if (!dataDate || dataDate !== dateKey) {
      return {
        success: false,
        msg: 'Dữ liệu trend không đúng ngày hiện tại: ' + (dataDate || 'trống') + ' != ' + dateKey
      };
    }
    // FIX HÀNG LẤY: cờ rõ ràng từ frontend cho biết PHIÊN NÀY có thực sự nạp file
    // "Performance Report" (hàng lấy) hay không. Trước đây pickupTotal/pickupDone
    // tự suy ra 0 khi window.DS.pickup trống (vd phiên/khác tab/khác người chưa upload
    // file pickup lần nào) — và vì saveSnapshot luôn GHI ĐÈ TOÀN BỘ dòng, số liệu pickup
    // đã lưu đúng trước đó (do 1 người khác upload lúc trước) bị XÓA SẠCH về 0 ngay khi
    // có người refresh lại file đơn hàng chính (việc này xảy ra nhiều lần/ngày).
    // → Khi hasPickupData=false, KHÔNG dùng pickupTotal/pickupDone/pickupRate=0 ở trên,
    //   mà giữ lại giá trị đã lưu trước đó (đọc lại từ Sheet) — xem bên dưới.
    var hasPickupData = !!extra.hasPickupData;
    var pickupDrMap = {};
    (extra.pickupDrivers || []).forEach(function(p) {
      if (p.driverId) pickupDrMap[String(p.driverId)] = p;
    });

    // ── STATION_DAILY ──────────────────────────────────────
    var stSheet = _trendStationSheet(ss);
    var existRow = _trendFindStationRow(stSheet, dateKey, stationNorm);

    if (existRow && !forceOverwrite) {
      return {
        success: false,
        alreadyExists: true,
        msg: 'Đã có snapshot ngày ' + dateKey + ' cho trạm ' + stationNorm + '. Chọn "Ghi đè" để cập nhật.'
      };
    }

    // FIX HÀNG LẤY (Station_Daily): phiên này không có dữ liệu pickup → giữ nguyên
    // pickup_total/pickup_done/pickup_rate đã lưu trước đó (nếu có), không ghi đè bằng 0.
    if (!hasPickupData && existRow) {
      try {
        var oldStPickup = stSheet.getRange(existRow, 15, 1, 3).getValues()[0];
        pickupTotal = oldStPickup[0] || 0;
        pickupDone  = oldStPickup[1] || 0;
        pickupRate  = oldStPickup[2] || 0;
      } catch (eOldPk) { /* giữ 0 nếu đọc lỗi (sheet quá cũ/lệch cột) */ }
    }

    var stRow = [
      dateKey,
      stationNorm,
      summary.total        || 0,
      summary.delivered    || 0,
      summary.successRate  || (summary.total > 0 ? Math.round((summary.delivered / summary.total) * 100) : 0),
      summary.delivering   || 0,
      summary.onhold       || 0,
      // hoan: tổng từ driverStats vì summary không có field này
      driverStats.reduce(function(s, d) { return s + (d.hoan || 0); }, 0),
      summary.reattempts   || 0,
      summary.codTotal     || 0,
      summary.codDelivered || 0,
      driverStats.length,
      inbound, outbound, pickupTotal, pickupDone, pickupRate,
      email,
      nowVN
    ];

    if (existRow) {
      // Ghi đè dòng cũ
      stSheet.getRange(existRow, 1, 1, stRow.length).setValues([stRow]);
    } else {
      stSheet.appendRow(stRow);
    }

    // ── DRIVER_DAILY ───────────────────────────────────────
    var drSheet = _trendDriverSheet(ssDriver);
    // FIX HÀNG LẤY: đọc lại số pickup theo tài xế đã lưu trước đó (nếu có) TRƯỚC KHI xóa,
    // để dùng làm fallback khi phiên save hiện tại không mang dữ liệu pickup mới.
    var oldDriverPickupMap = hasPickupData ? {} : _trendGetOldDriverPickupMap(drSheet, dateKey, stationNorm);
    // Xóa dữ liệu tài xế cũ của ngày + trạm này trước khi ghi mới
    _trendDeleteDriverRows(drSheet, dateKey, stationNorm);

    {
      var drRows = driverStats.map(function(d) {
        var drId  = String(d.id || '');
        var pkNew = pickupDrMap[drId];
        var pkOld = oldDriverPickupMap[drId];
        // Có dữ liệu pickup mới trong phiên này → dùng số mới (kể cả khi tài xế đó = 0,
        // vì đây là số liệu thật của report mới). Không có pickup mới phiên này →
        // giữ lại số đã lưu trước đó cho đúng tài xế này (nếu có), tránh ghi đè về 0.
        var pkAssigned = hasPickupData ? (pkNew ? (pkNew.assigned || 0) : 0) : (pkOld ? (pkOld.assigned || 0) : 0);
        var pkPicked   = hasPickupData ? (pkNew ? (pkNew.picked   || 0) : 0) : (pkOld ? (pkOld.picked   || 0) : 0);
        var pkRate     = hasPickupData ? (pkNew ? (pkNew.rate     || 0) : 0) : (pkOld ? (pkOld.rate     || 0) : 0);
        return [
          dateKey,
          stationNorm,
          d.id          || '',
          d.name        || '',
          d.total       || 0,
          d.delivered   || 0,
          d.successRate || 0,
          d.delivering  || 0,
          d.onhold      || 0,
          d.hoan        || 0,
          d.reattempts  || 0,
          d.cod         || 0,
          d.codDelivered|| 0,
          d.topZone     || '',
          pkAssigned,
          pkPicked,
          pkRate,
          nowVN
        ];
      });

      // FIX TÀI XẾ CHUYÊN LẤY: driverStats (Deli) chỉ chứa tài xế CÓ đơn giao trong ngày.
      // Tài xế chuyên lấy (chỉ lấy hàng, không có đơn giao) không nằm trong driverStats,
      // nên nếu chỉ ghi theo driverStats.map() ở trên, dòng pickup của họ sẽ bị
      // _trendDeleteDriverRows() xóa và KHÔNG được ghi lại — mất số liệu mỗi khi Deli save.
      // → Bổ sung thêm 1 dòng riêng (phần Deli = 0) cho mỗi driverId có dữ liệu pickup
      // (mới hoặc cũ) nhưng không có mặt trong driverStats.
      var deliIds = {};
      driverStats.forEach(function(d) { deliIds[String(d.id || '')] = true; });
      var pickupOnlySource = hasPickupData ? pickupDrMap : oldDriverPickupMap;
      Object.keys(pickupOnlySource).forEach(function(drId) {
        if (deliIds[drId]) return; // đã có trong driverStats, không trùng lặp
        var pk = pickupOnlySource[drId];
        var pkAssigned = pk ? (pk.assigned || 0) : 0;
        var pkPicked   = pk ? (pk.picked   || 0) : 0;
        var pkRate     = pk ? (pk.rate     || 0) : 0;
        var pkName     = pk ? (pk.driverName || pk.name || '') : '';
        if (!pkAssigned && !pkPicked) return; // không có gì để ghi
        drRows.push([
          dateKey, stationNorm, drId, pkName,
          0, 0, 0, 0, 0, 0, 0, 0, 0, '', // phần Deli = 0
          pkAssigned, pkPicked, pkRate,
          nowVN
        ]);
      });

      if (drRows.length > 0) {
        drSheet.getRange(
          drSheet.getLastRow() + 1, 1,
          drRows.length, drRows[0].length
        ).setValues(drRows);
      }
    }

    // Ghi log mỗi lần save (thay thế trigger log)
    _trendWriteLog(ss, dateKey, nowVN,
      forceOverwrite ? 'auto_upload' : 'manual',
      existRow ? 0 : 1, 0, '');

    // FIX RACE ĐA TRẠM: đã BỎ purge inline khỏi đây (trước đây gọi mỗi lần save,
    // tức nhiều lần/ngày/trạm — dù bọc try/catch riêng, nó vẫn là 1 thao tác đọc-toàn-
    // sheet + clearContent() + setValues() làm dịch chuyển dòng của MỌI trạm khác).
    // Giờ chỉ chạy 1 lần/ngày vào giờ vắng qua trendNightlyPurgeRunner() (xem cuối file),
    // và cũng dùng getScriptLock() như saveSnapshot()/savePickupOnly() nên không thể
    // chồng lấp với bất kỳ lệnh save nào. Xem hướng dẫn cài trigger ở setupTrendNightlyPurgeTrigger().

    return {
      success:     true,
      date:        dateKey,
      station:     stationNorm,
      driverCount: driverStats.length,
      overwritten: !!existRow,
      msg: (existRow ? 'Đã cập nhật' : 'Đã chốt') + ' snapshot ' + dateKey + ' — ' + stationNorm
           + ' (' + driverStats.length + ' tài xế)'
    };

  } catch(e) {
    return { success: false, msg: 'Lỗi server: ' + e.message };
  } finally {
    _anaReleaseNamedLock(_snapLockKey);
  }
}

// ── LƯU RIÊNG HÀNG LẤY (PICKUP) — ĐỘC LẬP VỚI DELI ─────────────
/**
 * savePickupOnly(stationName, dateKey, pickupTotal, pickupDone, pickupRate, pickupDriversJson)
 *
 * VẤN ĐỀ CŨ: pickup chỉ được gửi qua saveSnapshot() (chung đường với Deli), và saveSnapshot
 * chỉ được gọi tự động khi Deli upload/đã có ANA.driverStats trong RAM của đúng tab đó.
 * Nếu người dùng upload file "Hàng Lấy" trong 1 phiên/tab CHƯA có dữ liệu Deli (vd vừa mở
 * trang, upload pickup làm việc đầu tiên, hoặc Deli & pickup do 2 người khác nhau làm) →
 * ana_trendAutoSave() return ngay ở guard "!ANA.driverStats.length" → pickup không bao giờ
 * được ghi xuống Sheet, dù vẫn hiển thị/dùng được trong tab đó (báo cáo cuối ngày).
 *
 * FIX: hàm này ghi TRỰC TIẾP 3 cột pickup_total/pickup_done/pickup_rate (Station_Daily) và
 * pickup_assigned/pickup_done/pickup_rate theo từng tài xế (Driver_Daily), KHÔNG cần
 * ANA.driverStats/ANA.summary — gọi ngay khi parse xong file pickup, bất kể Deli đã có
 * dữ liệu trong ngày hay chưa:
 *   - Deli đã lưu trước (có dòng) → chỉ UPDATE 3 cột pickup trên dòng đã có, không đụng Deli.
 *   - Deli CHƯA lưu (pickup tới trước) → TẠO dòng mới (phần Deli = 0, phần pickup = số thật).
 *     Khi Deli lưu sau đó, cơ chế "hasPickupData" trong saveSnapshot() đã có từ trước sẽ tự
 *     đọc lại đúng số pickup này (đọc TRƯỚC khi ghi đè dòng) nên không bị mất.
 */
function savePickupOnly(stationName, dateKey, pickupTotal, pickupDone, pickupRate, pickupDriversJson) {
  var email = Session.getActiveUser().getEmail();
  var perm  = checkAnalyticsPermission(email);
  if (!perm.allowed) {
    return { success: false, msg: 'Không có quyền truy cập Analytics.' };
  }
  var stationNorm = (stationName || '').trim();
  var hasStationPerm = perm.stations.some(function(s) {
    return s.trim().toLowerCase() === stationNorm.toLowerCase();
  });
  if (!hasStationPerm) {
    return { success: false, msg: 'Bạn không có quyền lưu hàng lấy cho trạm: ' + stationNorm };
  }

  // FIX RACE ĐA TRẠM: dùng cùng lock toàn cục với saveSnapshot() —
  // để pickup của trạm A và deli của trạm B (hoặc pickup của trạm B) không thể chạy
  // chồng giờ và lệch dòng nhau (xem giải thích chi tiết ở saveSnapshot()).
  // [FIX 2026-07-16] Cùng nguyên nhân/cùng cách sửa như saveSnapshot(): trước đây giữ
  // thẳng LockService.getScriptLock() trong suốt thời gian chạy, chiếm mất tài nguyên mà
  // các thao tác NGẮN khác (kể cả duyệt quyền đăng nhập spx_setAccessLoginStatus...) cần
  // mượn trong tích tắc → làm nghẽn/timeout âm thầm những thao tác không liên quan.
  // Đổi sang cùng khoá toàn cục 'ana_trend_global_lock' qua _anaAcquireNamedLock — vẫn
  // xếp hàng tuần tự với saveSnapshot() y hệt trước (chung 1 key), không đổi mức an toàn.
  var _pickupLockKey = 'ana_trend_global_lock';
  if (!_anaAcquireNamedLock(_pickupLockKey, 45000)) {
    return { success: false, msg: 'Hệ thống đang xử lý lượt lưu khác, vui lòng thử lại sau vài giây.' };
  }

  try {
    var ss       = _DS.ss(MASTER_DB_ID); // Station_Daily
    var ssDriver = getStationSS(stationNorm);              // Driver_Daily theo trạm
    var nowVN    = _trendNowVN();
    var dkey     = String(dateKey || '').slice(0, 10);
    if (!dkey) return { success: false, msg: 'Thiếu ngày (dateKey) khi lưu hàng lấy.' };

    var pkDrivers = [];
    try { pkDrivers = JSON.parse(pickupDriversJson || '[]'); } catch(eJ) {}

    var pTotal = Number(pickupTotal) || 0;
    var pDone  = Number(pickupDone)  || 0;
    var pRate  = Number(pickupRate)  || 0;

    // ── STATION_DAILY ──────────────────────────────────────
    var stSheet  = _trendStationSheet(ss);
    var existRow = _trendFindStationRow(stSheet, dkey, stationNorm);
    if (existRow) {
      // Deli đã lưu trước → chỉ ghi đè 3 cột pickup (O,P,Q), giữ nguyên toàn bộ phần Deli.
      stSheet.getRange(existRow, 15, 1, 3).setValues([[pTotal, pDone, pRate]]);
    } else {
      // Chưa có dòng nào hôm nay cho trạm này (pickup tới trước Deli) → tạo dòng mới.
      var stRow = [
        dkey, stationNorm,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // total,delivered,rate,delivering,onhold,hoan,reattempts,cod_total,cod_delivered,driver_count
        0, 0,                          // inbound, outbound
        pTotal, pDone, pRate,
        email, nowVN
      ];
      stSheet.appendRow(stRow);
    }

    // ── DRIVER_DAILY ───────────────────────────────────────
    var drSheet = _trendDriverSheet(ssDriver);
    var lastRowD = drSheet.getLastRow();
    var existingDriverRows = {}; // driverId(string) -> rowIndex (1-based)
    if (lastRowD > 1) {
      var allValsD = drSheet.getRange(2, 1, lastRowD - 1, 18).getValues();
      var stNormD = stationNorm.trim().toLowerCase();
      for (var i = 0; i < allValsD.length; i++) {
        var r = allValsD[i];
        var rDate = r[0] instanceof Date
          ? Utilities.formatDate(r[0], 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
          : String(r[0] || '').slice(0, 10);
        var rStation = String(r[1] || '').trim().toLowerCase();
        if (rDate === dkey && rStation === stNormD) {
          var drvId = String(r[2] || '').trim();
          if (drvId) existingDriverRows[drvId] = i + 2; // +2: bù header + 0-index
        }
      }
    }

    var newDriverRows = [];
    pkDrivers.forEach(function(p) {
      var drId = String(p.driverId || '').trim();
      if (!drId) return; // bỏ qua tài xế không xác định được ID từ file pickup
      var assigned = Number(p.assigned) || 0;
      var picked   = Number(p.picked)   || 0;
      var rate     = Number(p.rate)     || 0;
      if (existingDriverRows[drId]) {
        // Đã có dòng Driver_Daily hôm nay (Deli lưu trước) → chỉ update 3 cột pickup.
        drSheet.getRange(existingDriverRows[drId], 15, 1, 3).setValues([[assigned, picked, rate]]);
      } else {
        // Chưa có dòng cho tài xế này hôm nay → tạo dòng tạm (phần Deli = 0).
        // Nếu Deli lưu sau đó, _trendGetOldDriverPickupMap() sẽ đọc lại đúng số pickup
        // này (theo driverId) trước khi _trendDeleteDriverRows() xóa dòng tạm này đi.
        newDriverRows.push([
          dkey, stationNorm, drId, p.driverName || '',
          0, 0, 0, 0, 0, 0, 0, 0, 0,  // total,delivered,rate,delivering,onhold,hoan,reattempts,cod,cod_delivered
          '',                          // top_zone
          assigned, picked, rate,
          nowVN
        ]);
      }
    });
    if (newDriverRows.length) {
      drSheet.getRange(
        drSheet.getLastRow() + 1, 1,
        newDriverRows.length, newDriverRows[0].length
      ).setValues(newDriverRows);
    }

    _trendWriteLog(ss, dkey, nowVN, 'pickup_only', existRow ? 0 : 1, 0, '');

    return {
      success: true,
      date: dkey,
      station: stationNorm,
      msg: 'Đã lưu hàng lấy ' + dkey + ' — ' + stationNorm + ' (' + pkDrivers.length + ' tài xế)'
    };

  } catch(e) {
    return { success: false, msg: 'Lỗi server: ' + e.message };
  } finally {
    _anaReleaseNamedLock(_pickupLockKey);
  }
}

// ── PURGE DỮ LIỆU CŨ (62 NGÀY) — CHẠY 1 LẦN/NGÀY, KHÔNG CHẠY THEO MỖI LẦN SAVE ──
/**
 * FIX RACE ĐA TRẠM (phần 2): trước đây _trendPurgeOldRows() được gọi ngay trong
 * saveSnapshot() — nghĩa là chạy NHIỀU LẦN/NGÀY/TRẠM. Đây là 1 thao tác đọc-toàn-sheet
 * + clearContent() + setValues() lại, làm DỊCH CHUYỂN vị trí dòng của MỌI trạm khác
 * đang dùng chung Station_Daily (MASTER) / Driver_Daily (theo shard). Nếu nó chạy đúng
 * lúc 1 trạm khác đang giữ "existRow" đọc trước đó để chuẩn bị ghi → ghi nhầm vào dòng
 * của trạm khác sau khi dòng đã bị dồn lại.
 *
 * Giờ tách hẳn ra: chỉ chạy 1 LẦN/NGÀY vào giờ vắng (mặc định 2h sáng) qua time-based
 * trigger, và dùng CHUNG getScriptLock() với saveSnapshot()/savePickupOnly() — nên dù
 * có ai save trễ/sớm bất thường trùng giờ, purge vẫn phải đợi xếp hàng, không bao giờ
 * chạy chồng với 1 lệnh save đang đọc-ghi theo row index.
 *
 * CÀI ĐẶT (chạy 1 lần duy nhất, thủ công trong Apps Script Editor):
 *   1) Mở function trendNightlyPurgeRunner() bên dưới, SỬA lại đúng cách lấy danh sách
 *      tên trạm (mặc định đang đọc cột A của sheet "Station_Map" trong MASTER_DB,
 *      từ dòng 2 — đổi lại nếu tên trạm của bạn nằm ở cột khác).
 *   2) Chạy hàm setupTrendNightlyPurgeTrigger() MỘT LẦN (chọn nó trong dropdown "Select
 *      function" rồi bấm Run) để tạo trigger time-based 2h sáng hằng ngày.
 *   3) Kiểm tra lại trong Triggers (icon đồng hồ bên trái) thấy đúng 1 trigger
 *      "trendNightlyPurgeRunner" — nếu thấy 2+ (do chạy setup nhiều lần), hàm setup đã
 *      tự xóa trigger cũ trước khi tạo mới nên không lo bị trùng.
 */
function trendNightlyPurge(stationList, purgeStationDaily) {
  // [SECURITY FIX 2026-08] Hàm XOÁ VĨNH VIỄN dữ liệu lịch sử Station_Daily/Driver_Daily
  // (sau khi archive Firestore best-effort) — trước đây không kiểm tra quyền, gọi trực
  // tiếp bất cứ lúc nào (không chỉ trong khung giờ vắng) cũng purge được ngay. Chỉ admin
  // (hoặc trigger tự động chạy dưới danh nghĩa tài khoản admin đã cài trigger) mới được
  // gọi. KHÔNG ảnh hưởng trendNightlyPurgeRunner() vì trigger time-driven chạy dưới danh
  // nghĩa tài khoản đã cài đặt trigger (phải là admin mới cài được trigger).
  _requireAdminIfInteractive_(2);   // [SỬA] được job nền trendNightlyPurgeRunner gọi — không có người đăng nhập
  // [FIX 2026-08-02] Cùng lớp lỗi đã gặp và vá ở getStationsDataStatusBatch:
  // trước đây hàm này (qua trendNightlyPurgeRunner) purge TẤT CẢ trạm trong 1
  // lượt duy nhất — mỗi trạm phải MỞ RIÊNG 1 file Sheet + gọi Firestore archive
  // qua mạng (archiveFn) — với 300+ trạm, tổng thời gian vượt hẳn trần 30 phút,
  // khớp đúng log Executions ghi nhận Timed Out 100% các lần chạy. Nghĩa là
  // Driver_Daily CHƯA TỪNG được purge thành công, phình dần vô thời hạn. Giờ
  // hàm này chỉ nhận 1 LÔ trạm (xem trendNightlyPurgeRunner) — purgeStationDaily
  // chỉ true ở lô ĐẦU TIÊN của mỗi vòng, tránh purge lặp lại Station_Daily
  // (không sharded theo trạm, không cần purge nhiều lần/đêm) mỗi lô nhỏ.
  var _purgeLockKey = 'ana_trend_global_lock';
  if (!_anaAcquireNamedLock(_purgeLockKey, 60000)) {
    // [SCALE FIX 2026-08] processedCount: 0 — CHƯA xử lý trạm nào (lock bận), Runner
    // phải giữ nguyên cursor và thử lại đúng lô này ở lượt sau, không được nhảy qua.
    return { success: false, processedCount: 0, msg: 'Không lấy được lock (có lệnh save khác đang chạy quá lâu), thử lại sau.' };
  }

  try {
    var ssMaster = _DS.ss(MASTER_DB_ID);
    // ARCHIVE FIRESTORE: _fsArchiveStationRows_ (Firestore_Bridge.gs) ghi các row sắp bị
    // xoá vào fireboard_daily/{stationKey_date} TRƯỚC khi purge. Nếu chưa setup Firestore
    // (thiếu Script Properties), _fsArchiveStationRows_/_fsGetAccessToken_ sẽ throw →
    // _trendPurgeSheet bắt lỗi, HUỶ purge lần này thay vì xoá mất data — an toàn, không
    // cần bật cờ gì thêm để tạm tắt archive, chỉ cần chưa setup Firestore là purge tự
    // đứng yên (Sheet sẽ phình dần cho tới khi setup xong, không mất dữ liệu).
    var removedStation = purgeStationDaily
      ? _trendPurgeSheet(ssMaster, 'Station_Daily', 19, _fsArchiveStationRows_)
      : 0;

    var seenIds = {};
    var removedDriverTotal = 0;
    var shardCount = 0;
    // [SCALE FIX 2026-08] Trước đây forEach() xử lý HẾT nguyên lô bất kể tốn bao lâu
    // — an toàn khi lô nhỏ (300 trạm ÷ 30/lô), nhưng khi N trạm tăng (vd 1.000) và
    // batch size được tăng theo tỉ lệ, 1 lô lớn hơn có nguy cơ vượt trần 6 phút/lần
    // chạy của Apps Script và bị cắt ngang GIỮA CHỪNG — trong khi
    // trendNightlyPurgeRunner() lại tính nextCursor theo ĐỘ DÀI LÔ ĐÃ CẮT SẴN (xem
    // hàm đó), nên nếu không có chốt này, các trạm chưa kịp xử lý sẽ bị cursor nhảy
    // qua luôn, coi như đã purge xong — ÂM THẦM BỎ SÓT, rất khó phát hiện vì không
    // báo lỗi gì. Nay dừng sớm nếu gần chạm trần thời gian, trả về processedCount
    // để Runner biết CHÍNH XÁC đã xử lý bao nhiêu trạm mà tính lại nextCursor đúng
    // (xem trendNightlyPurgeRunner) — cơ chế này tự thích ứng với N trạm bất kỳ,
    // không cần đoán trước 1 con số batch size "đủ an toàn" mỗi khi N thay đổi.
    var _t0 = Date.now();
    var TIME_BUDGET_MS = 4 * 60 * 1000; // 4 phút — chừa biên độ an toàn dưới trần 6 phút
    var list = stationList || [];
    var processedCount = 0;
    for (var _si = 0; _si < list.length; _si++) {
      if (Date.now() - _t0 > TIME_BUDGET_MS) {
        _LOG.d('[trendNightlyPurge] Dừng sớm do gần hết thời gian — đã xử lý ' + processedCount + '/' + list.length + ' trạm trong lô, phần còn lại để lượt sau.');
        break;
      }
      var station = String(list[_si] || '').trim();
      processedCount++; // tính cả trạm rỗng/lỗi vào "đã xử lý" — Runner cần biết đã DUYỆT QUA vị trí này trong danh sách, không phải "purge thành công"
      if (!station) continue;
      try {
        var ssDriver = getStationSS(station);
        var id = ssDriver.getId();
        if (seenIds[id]) continue; // nhiều trạm có thể chung 1 file shard — chỉ purge 1 lần/file
        seenIds[id] = true;
        shardCount++;
        removedDriverTotal += _trendPurgeSheet(ssDriver, 'Driver_Daily', 18, _fsArchiveDriverRows_);
      } catch (eStation) {
        // Bỏ qua trạm bị lỗi (vd tên không khớp Station_Map), không chặn các trạm còn lại
      }
    }

    return {
      success: true,
      processedCount: processedCount, // [SCALE FIX 2026-08] Runner dùng số này để tính nextCursor, KHÔNG dùng độ dài lô đã cắt sẵn
      msg: 'Đã purge xong: Station_Daily bỏ ' + removedStation + ' dòng cũ; '
           + 'Driver_Daily bỏ ' + removedDriverTotal + ' dòng cũ trên ' + shardCount + ' shard/spreadsheet'
           + (processedCount < list.length ? ' (dừng sớm do hết giờ: ' + processedCount + '/' + list.length + ' trạm trong lô — phần còn lại tiếp tục ở lượt sau).' : '.')
    };
  } catch (e) {
    // [SCALE FIX 2026-08] processedCount: 0 — lỗi xảy ra trước/trong lúc xử lý,
    // không rõ đã xong bao nhiêu trạm; mặc định 0 để Runner KHÔNG nhảy cursor
    // (an toàn hơn: chấp nhận kiểm tra lại vài trạm đã purge xong — vô hại vì
    // _trendPurgeSheet không xoá gì thêm nếu không còn dòng cũ — còn hơn bỏ sót
    // trạm chưa kịp xử lý).
    return { success: false, processedCount: 0, msg: 'Lỗi purge: ' + e.message };
  } finally {
    _anaReleaseNamedLock(_purgeLockKey);
  }
}

// [FIX 2026-08-02] Đổi từ "1 lượt duy nhất lúc 2h sáng, purge TẤT CẢ trạm" (luôn
// Timed Out ở 300+ trạm, purge chưa từng thành công) sang crawler theo LÔ, chạy
// nhiều lượt nhỏ suốt khung giờ vắng — đúng pattern đã dùng cho
// stationStatus_crawlBatch. 30 trạm/lượt (nhỏ hơn stationStatus_crawlBatch vì có
// thêm archive Firestore qua mạng, tốn hơn) × ~12 lượt/đêm (23h-5h, mỗi 30 phút)
// = ~360 trạm/đêm — đủ phủ hết danh sách trạm hiện tại trong 1 đêm, còn dư biên
// độ khi tăng trưởng.
//
// [SCALE FIX 2026-08] Tăng lên 80 để chuẩn bị cho quy mô ~1.000 trạm (80×12 =
// 960 trạm/đêm, vẫn vừa 1 vòng/đêm thay vì phải mất ~3 đêm như trước khi tăng).
// Con số này giờ chỉ là TRẦN TỐI ĐA — chốt an toàn thật sự nằm ở TIME_BUDGET_MS
// trong trendNightlyPurge() (dừng sớm nếu gần hết 4 phút), nên không cần tính
// toán chính xác tuyệt đối; nếu 80 trạm/lô có ngày vẫn chạm trần thời gian (vd
// Firestore chậm bất thường), cơ chế processedCount ở dưới sẽ tự bù đúng phần
// còn thiếu ở lượt kế tiếp, không mất/sót trạm nào.
var TREND_PURGE_BATCH_SIZE = 80;
var TREND_PURGE_CURSOR_KEY = 'trend_purge_cursor_v1';

function trendNightlyPurgeRunner() {
  // [SECURITY FIX 2026-08] Đã chặn phần thật sự phá huỷ dữ liệu ở trendNightlyPurge()
  // (yêu cầu admin) — thêm chặn ở đây nữa cho gọn: nếu ai gọi thẳng runner này ngoài
  // khung giờ vắng thì đã tự return sớm, nhưng trong khung giờ vắng vẫn nên chặn để
  // tránh việc đọc Station_Map/tính batch không cần thiết từ người không có quyền.
  _requireAdmin_(2);
  if (!_spxIsPrewarmQuietHours_()) return; // CHỈ chạy trong khung giờ vắng (23h-5h)
  var gotLock = _anaAcquireNamedLock('trend_purge_batch_lock_v1', 5000);
  if (!gotLock) return; // lượt trước còn đang chạy — bỏ qua, thử lại lượt sau

  var ss = _DS.ss(MASTER_DB_ID);
  try {
    // [CHUYỂN DỊCH DẦN Station_Map] Xem ghi chú đầy đủ ở ana_archiveOldOrdersRunner.
    var stations = (typeof spx_getAllStationNames === 'function') ? spx_getAllStationNames() : [];
    if (!stations.length) return;

    var props = PropertiesService.getScriptProperties();
    var cursor = Number(props.getProperty(TREND_PURGE_CURSOR_KEY)) || 0;
    if (cursor >= stations.length) cursor = 0;

    var isFirstBatchOfCycle = (cursor === 0); // chỉ purge Station_Daily (không sharded) ở lô đầu mỗi vòng
    var batch = stations.slice(cursor, cursor + TREND_PURGE_BATCH_SIZE);

    var res = trendNightlyPurge(batch, isFirstBatchOfCycle);

    // [SCALE FIX 2026-08] Tính nextCursor theo SỐ TRẠM THỰC SỰ ĐÃ DUYỆT QUA
    // (res.processedCount, do trendNightlyPurge trả về) — KHÔNG dùng độ dài lô đã
    // cắt sẵn (batch.length) như trước. Nếu hàm dừng sớm giữa lô vì gần hết giờ,
    // processedCount < batch.length, và cursor chỉ nhích đúng phần đã xong — lượt
    // sau tiếp tục đúng từ trạm còn dang dở, không bỏ sót trạm nào bất kể N lớn
    // tới đâu.
    var actuallyProcessed = (res && typeof res.processedCount === 'number') ? res.processedCount : batch.length;
    var nextCursor = cursor + actuallyProcessed;
    if (nextCursor >= stations.length) nextCursor = 0; // hết danh sách → quay lại đầu
    props.setProperty(TREND_PURGE_CURSOR_KEY, String(nextCursor));

    // Ghi lại kết quả vào Trigger_Log để dễ kiểm tra trigger có chạy đúng không
    try {
      var progressNote = ' [lô ' + cursor + '-' + nextCursor + '/' + stations.length + ']';
      _trendWriteLog(ss, _trendTodayKey(), _trendNowVN(), 'nightly_purge_batch',
        res.success ? 1 : 0, 0, (res.success ? (res.msg || '') : res.msg) + progressNote);
    } catch (eLog) {}
    return res;
  } finally {
    _anaReleaseNamedLock('trend_purge_batch_lock_v1');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// [MỚI — theo yêu cầu trực tiếp "thêm Driver Zone vào module BI", trích từ
// tài liệu bàn giao phiên chat khác + backend_patched.gs, đã rà bảo mật +
// phụ thuộc trước khi ghép] Toàn bộ khối dưới đây GIỮ NGUYÊN logic gốc đã
// review (kiểm tra quyền theo trạm, khoá đặt tên, throttle, xử lý theo lô
// tránh timeout 300+ trạm — đúng chuẩn đã dùng cho trendNightlyPurgeRunner
// ngay phía trên). LƯU Ý QUAN TRỌNG khi nối phía frontend: các hàm này trả
// về OBJECT THÔ (không JSON.stringify) — khác quy ước JSON.stringify đã
// dùng cho các hàm tự viết trong phiên hôm nay — Apps Script tự serialize
// đúng cho google.script.run, phía client KHÔNG được JSON.parse() thêm 1
// lớp nữa cho các hàm dgh_*/hub_* này.
// ═══════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// MODULE: DRIVER GEO HISTORY — lưu tọa độ đơn ĐÃ GIAO THÀNH CÔNG theo (ngày,
// trạm, tài xế) để build "Driver Zone" (đường biên vùng giao hàng suy ra từ
// lịch sử) ở frontend. KHÔNG lưu vị trí GPS liên tục của tài xế — chỉ lưu
// điểm đến của từng đơn, giống hệt nguồn dữ liệu map hiện có (Latitude/
// Longitude từ CSV), chỉ khác là được TÍCH LŨY qua nhiều ngày thay vì bị xóa
// mỗi lần "Cuối ngày" như Data_<trạm>.
//
// [THIẾT KẾ CHO QUY MÔ 300+ TRẠM / NHIỀU USER — 3 quyết định quan trọng]
//
// 1) Sheet nằm TRONG SPREADSHEET RIÊNG CỦA TỪNG TRẠM (getStationSS(stationName),
//    giống Driver_Daily) — KHÔNG dùng chung MASTER_DB_ID như Trend/Station_Daily.
//    Lý do: nếu gộp chung 1 spreadsheet, dữ liệu của 300+ trạm cộng dồn vào
//    cùng 1 file rất dễ chạm trần 10 triệu ô của Google Sheets, và 1 spreadsheet
//    quá lớn làm chậm MỌI thao tác đọc/ghi của MỌI trạm khác dùng chung file đó
//    (kể cả Trend/Station_Daily không liên quan gì tới Zone). Tách riêng theo
//    trạm giới hạn rủi ro/tải trong phạm vi 1 trạm.
//
// 2) dgh_archivePoints() ĐƯỢC GỌI TỪ ana_trendAutoSave() — tức là chạy MỖI LẦN
//    upload CSV (nhiều lần/ngày/trạm), KHÔNG CHỈ lúc "Cuối ngày". Nếu ghi thẳng
//    vào Sheet mỗi lần gọi, với 300+ trạm active cùng lúc, tổng số lệnh ghi
//    Sheets API/phút sẽ rất lớn. Nên hàm này CHỦ ĐỘNG TỰ THROTTLE — chỉ thực sự
//    đọc/ghi Sheet nếu đã đủ DGH_MIN_INTERVAL_MS kể từ lần ghi thành công gần
//    nhất CỦA CHÍNH TRẠM ĐÓ (theo dõi qua CacheService, rẻ và tự hết hạn — không
//    dùng PropertiesService cho việc này vì có trần dung lượng/script và không
//    cần bền qua nhiều ngày). Các lượt gọi bị throttle trả về ngay lập tức
//    (success:true, skipped:true) — gần như miễn phí, không mở Sheet, không
//    giữ lock — nên gọi thường xuyên từ client vẫn an toàn.
//
// 3) Xóa dòng cũ trước khi ghi lại KHÔNG dùng deleteRow() lặp từng dòng (mỗi
//    lần gọi = 1 request API riêng, cực chậm khi 1 trạm có hàng trăm/nghìn đơn
//    giao 1 ngày) — dùng đúng pattern batch-rewrite đã có sẵn trong codebase
//    (_trendDeleteDriverRows): đọc 2 cột để xác định dòng giữ/bỏ, đọc full dữ
//    liệu CHỈ của các dòng giữ, rồi clearContent()+setValues() 1 lần — tổng
//    cộng ~4 lệnh Sheets API bất kể sheet có bao nhiêu dòng, thay vì hàng trăm.
// ══════════════════════════════════════════════════════════════════════════
var DGH_RETENTION_MONTHS  = 2;               // [SỬA — theo quyết định: hạ từ 4 tháng xuống ~30 ngày] Dữ liệu lưu theo SHEET THÁNG nên phải giữ 2 tháng mới đủ 30 ngày: đầu tháng (VD ngày 2/10) thì 30 ngày gần nhất vẫn nằm phần lớn ở sheet tháng 9. Giữ 1 tháng sẽ mất dữ liệu ngay đầu mỗi tháng. LƯU Ý: đây là mốc riêng của Driver Zone — KHÔNG liên quan tới Trend (Trend giữ nguyên 62 ngày, cơ chế khác, xem trendNightlyPurge).
var DGH_MIN_INTERVAL_MS   = 15 * 60 * 1000;  // throttle: tối đa 1 lần ghi thật sự / 15 phút / trạm (autosave gọi nhiều hơn thì bị skip)
// [SỬA — theo phản hồi: "5.481 điểm nhưng mỗi tài xế chỉ tối đa 400"] Trước đây cắt CỨNG 400 điểm/tài xế:
// mọi tài xế đều chạm trần nên người giao 2.000 đơn và người giao 400 đơn có TRỌNG SỐ NGANG NHAU -> lệch
// việc chọn chủ vùng, tỷ lệ trộn tài xế và phân xử phần chồng lấn. Nay giới hạn theo TỔNG và chia theo
// TỈ LỆ số đơn thật (mọi tài xế dùng CÙNG 1 tỉ lệ lấy mẫu) nên giữ nguyên tương quan giữa các tài xế.
// [SỬA — nâng trần lấy mẫu] Trước là 12.000, đo lúc đó client xử lý ~6s. Từ khi
// front-end chuyển phần tính toán nặng sang Web Worker (không còn chặn giao
// diện), nâng lên được mà không lo "đơ" trang — đã đo tới 18.000 điểm vẫn
// hoàn tất trong khoảng 10s trên luồng chính (Worker còn nhanh hơn vì không bị
// cạnh tranh CPU với phần vẽ giao diện). Mẫu nhiều hơn giúp diện tích/mật độ
// từng vùng chính xác hơn, nhất là vùng ít đơn (dễ bị lệch nhiều khi mẫu nhỏ).
// LƯU Ý: đây là ước lượng dựa trên đo thử ở môi trường phát triển, KHÔNG PHẢI
// số đo trên dữ liệu thật của trạm — nếu sau khi đổi thấy chậm hẳn trên trạm
// đông đơn nhất, hạ về lại 12.000 hoặc thấp hơn.
var DGH_MAX_POINTS_TOTAL      = 18000;  // tổng điểm tối đa trả về mỗi lần gọi
var DGH_MIN_POINTS_PER_DRIVER = 40;     // tài xế ít đơn vẫn giữ tối thiểu ngần này (hoặc toàn bộ nếu có ít hơn)
var DGH_MAX_POINTS_PER_DRIVER = 400;    // [KHÔNG CÒN DÙNG — giữ lại để tránh lỗi nếu nơi khác còn tham chiếu]
// [SỬA — theo đúng cảnh báo trong tài liệu bàn giao Driver Zone mục IV.3: bản
// gốc CHƯA lưu wardName, cần bổ sung khi tích hợp] Thêm cột 'wardName' (cột 9).
// wardName là ranh giới hành chính THẬT có sẵn trong dữ liệu (cột "Ward Name"
// của file CSV) — BẮT BUỘC cho bước tính zone về sau (mỗi vùng giao hàng phải
// nằm gọn trong đúng 1 xã/phường, không được tính vượt qua). Nếu không lưu từ
// bây giờ, toàn bộ lịch sử tích luỹ được sẽ thiếu Ward và không dùng được.
// An toàn với sheet ĐÃ CÓ dữ liệu cũ (8 cột): các hàm đọc/ghi đều dùng
// DGH_HEADERS.length nên tự khớp số cột mới; dòng cũ đọc lên sẽ thiếu phần tử
// cuối (undefined) — nơi dùng phải tự chấp nhận wardName rỗng cho dữ liệu cũ.
var DGH_HEADERS = ['date', 'station', 'driverId', 'driverName', 'orderId', 'lat', 'lng', 'zoneId', 'wardName'];

function _dgh_monthKey_(dateKey) {
  return (dateKey || '').replace(/-/g, '').slice(0, 6); // 'yyyy-MM-dd' -> 'yyyyMM'
}

function _dgh_sheetNameForMonth_(monthKey) {
  return 'Driver_Geo_' + monthKey;
}

/** Mở spreadsheet RIÊNG của trạm (không phải MASTER_DB_ID) — xem giải thích (1) ở trên. */
function _dgh_getSheet_(stationName, monthKey) {
  var ss = getStationSS(stationName);
  var name = _dgh_sheetNameForMonth_(monthKey);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, DGH_HEADERS.length).setValues([DGH_HEADERS])
      .setFontWeight('bold').setBackground('#374151').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Xóa các dòng cũ cùng ngày trước khi ghi lại (idempotent — auto-save gọi
 * archive nhiều lần/ngày, mỗi lần ghi đè bằng data mới nhất, không cộng dồn
 * trùng lặp). Dùng pattern batch-rewrite giống _trendDeleteDriverRows() —
 * KHÔNG deleteRow() từng dòng — xem giải thích (3) ở trên.
 * Trả về dữ liệu KEEP để hàm gọi tận dụng luôn (đỡ đọc lại sheet lần nữa).
 */
function _dgh_rewriteDay_(sheet, dateKey, newRows) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    if (newRows.length) sheet.getRange(2, 1, newRows.length, DGH_HEADERS.length).setValues(newRows);
    return;
  }
  // Bước 1: chỉ đọc cột date (cột 1) — rẻ hơn đọc toàn bộ để xác định dòng giữ/bỏ
  var dateCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var keepIdxs = [];
  for (var i = 0; i < dateCol.length; i++) {
    if ((dateCol[i][0] + '') !== dateKey) keepIdxs.push(i);
  }
  if (keepIdxs.length === dateCol.length && !newRows.length) return; // không có gì đổi

  // Bước 2: đọc full dữ liệu CHỈ của các dòng giữ (không phải cả sheet)
  var allValues = keepIdxs.length ? sheet.getRange(2, 1, lastRow - 1, DGH_HEADERS.length).getValues() : [];
  var keep = keepIdxs.map(function(idx) { return allValues[idx]; });
  var finalRows = keep.concat(newRows);

  // Bước 3: xóa vùng data + ghi lại 1 lần — tổng ~3-4 API call bất kể kích thước sheet
  sheet.getRange(2, 1, lastRow - 1, DGH_HEADERS.length).clearContent();
  if (finalRows.length) sheet.getRange(2, 1, finalRows.length, DGH_HEADERS.length).setValues(finalRows);
}

/**
 * Ghi các điểm giao hàng THÀNH CÔNG (status Delivered, có lat/lng hợp lệ) của
 * 1 trạm trong 1 ngày. Gọi từ client mỗi lần ana_trendAutoSave() chạy (tức
 * mỗi lần upload CSV) — hàm TỰ THROTTLE (xem giải thích (2) ở trên), nên gọi
 * dồn dập vẫn an toàn, phần lớn lượt gọi sẽ chỉ là no-op rẻ tiền.
 *
 * pointsJson: JSON string [{driverId, driverName, orderId, lat, lng, zoneId}, ...]
 * dateKey: 'yyyy-MM-dd' — PHẢI khớp ngày dữ liệu hiện tại (giống check dataDate
 * trong saveSnapshot), để tránh ghi nhầm ngày khi client bị lệch giờ/cache cũ.
 */
function dgh_archivePoints(stationName, dateKey, pointsJson) {
  var email = Session.getActiveUser().getEmail();
  var perm  = checkAnalyticsPermission(email);
  if (!perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };

  var stationNorm = (stationName || '').trim();
  var hasStationPerm = perm.stations.some(function(s) {
    return s.trim().toLowerCase() === stationNorm.toLowerCase();
  });
  if (!hasStationPerm) return { success: false, msg: 'Bạn không có quyền lưu dữ liệu cho trạm: ' + stationNorm };

  var tz = SPX_TZ;
  var todayKey = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  // [SỬA LỖI THẬT — cùng đợt tách luồng lưu điểm giao]
  // TRƯỚC ĐÂY bắt buộc dateKey PHẢI BẰNG hôm nay, nếu lệch thì từ chối thẳng.
  // Sai thực tế: người dùng thường upload file của NGÀY HÔM TRƯỚC (sáng hôm
  // sau mới xuất được báo cáo của ngày cũ) -> mọi lượt lưu đều bị chặn, đây là
  // 1 trong các nguyên nhân khiến Driver Zone không có điểm nào suốt nhiều ngày.
  // NAY: chấp nhận dữ liệu trong vòng 30 ngày gần nhất (đúng bằng thời gian
  // lưu trữ đã chốt cho Driver Zone — quá mốc đó thì dù ghi vào cũng bị dọn).
  // Vẫn CHẶN ngày tương lai để tránh dữ liệu rác do sai đồng hồ máy người dùng.
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return { success: false, msg: 'Ngày dữ liệu không hợp lệ: ' + (dateKey || 'trống') };
  }
  var _dDiff = (new Date(todayKey + 'T00:00:00Z').getTime()
              - new Date(dateKey + 'T00:00:00Z').getTime()) / 86400000;
  if (_dDiff < 0) {
    return { success: false, msg: 'Ngày dữ liệu ở tương lai: ' + dateKey + ' > ' + todayKey };
  }
  if (_dDiff > 30) {
    return { success: false, msg: 'Dữ liệu quá cũ (' + dateKey + ', cách ' + Math.round(_dDiff) + ' ngày) — ngoài phạm vi lưu trữ 30 ngày.' };
  }

  // THROTTLE: kiểm tra cache TRƯỚC KHI làm bất cứ việc gì tốn kém (parse JSON,
  // mở Sheet...) — phần lớn lượt gọi (autosave dồn dập) sẽ dừng ngay ở đây,
  // chỉ tốn 1 lệnh CacheService.get() rẻ tiền.
  var cache = CacheService.getScriptCache();
  // [SỬA — cùng đợt] Khoá throttle theo CẢ TRẠM VÀ NGÀY. Trước đây chỉ theo
  // trạm: upload file ngày 15 xong, upload tiếp ngày 16 trong vòng 15 phút sẽ
  // bị chặn nhầm — dù đó là dữ liệu của ngày KHÁC, hoàn toàn nên được lưu.
  var throttleKey = 'dgh_last_write_' + stationNorm + '_' + dateKey;
  if (cache.get(throttleKey)) {
    return { success: true, skipped: true, msg: 'Đã ghi gần đây (throttle ' + (DGH_MIN_INTERVAL_MS/60000) + ' phút/trạm) — bỏ qua lượt này.' };
  }

  var points;
  try { points = JSON.parse(pointsJson || '[]'); } catch (e) { return { success: false, msg: 'JSON điểm không hợp lệ.' }; }
  points = points.filter(function(p) {
    return p && p.driverId && Number(p.lat) && Number(p.lng) &&
           Math.abs(Number(p.lat)) > 0.01 && Math.abs(Number(p.lng)) > 0.01;
  });
  if (!points.length) return { success: true, count: 0, msg: 'Không có điểm hợp lệ để lưu.' };

  var lockKey = 'dgh_archive_lock_' + stationNorm;
  if (!_anaAcquireNamedLock(lockKey, 20000)) {
    return { success: false, msg: 'Hệ thống đang ghi Driver Geo cho trạm này, thử lại sau vài giây.' };
  }
  try {
    // Set throttle NGAY sau khi qua được lock (trước khi ghi xong) — nếu ghi lỡ lỗi
    // giữa chừng, ta vẫn chấp nhận chờ hết throttle window thay vì retry dồn dập.
    cache.put(throttleKey, String(Date.now()), Math.round(DGH_MIN_INTERVAL_MS / 1000));

    var monthKey = _dgh_monthKey_(dateKey);
    var sheet = _dgh_getSheet_(stationNorm, monthKey);
    var newRows = points.map(function(p) {
      return [dateKey, stationNorm, String(p.driverId), String(p.driverName || ''),
              String(p.orderId || ''), Number(p.lat), Number(p.lng), String(p.zoneId || ''),
              // [SỬA — cùng đợt thêm cột wardName, xem ghi chú ở DGH_HEADERS]
              String(p.wardName || '')];
    });
    _dgh_rewriteDay_(sheet, dateKey, newRows);
    return { success: true, count: newRows.length };
  } catch (e) {
    return { success: false, msg: e.message };
  } finally {
    _anaReleaseNamedLock(lockKey);
  }
}

/**
 * Đọc điểm giao hàng lịch sử của 1 trạm trong `daysBack` ngày gần nhất (kể cả
 * hôm nay) — dùng ở frontend để build Driver Zone (hull). LUÔN mở spreadsheet
 * riêng của trạm đó (1 station/lượt gọi) — không bao giờ loop qua nhiều trạm
 * trong 1 lần thực thi (xem dgh_purgeOldMonthsRunner bên dưới về lý do).
 *
 * driverIdsJson: optional JSON array of driverId — rỗng/omit = tất cả tài xế
 * (nên truyền cụ thể khi chỉ xem/so sánh vài tài xế, để giảm dữ liệu đọc+trả về).
 */
function dgh_getPoints(stationName, daysBack, driverIdsJson) {
  var email = Session.getActiveUser().getEmail();
  var perm  = checkAnalyticsPermission(email);
  if (!perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };

  var stationNorm = (stationName || '').trim();
  var hasStationPerm = perm.stations.some(function(s) {
    return s.trim().toLowerCase() === stationNorm.toLowerCase();
  });
  if (!hasStationPerm) return { success: false, msg: 'Bạn không có quyền xem dữ liệu trạm: ' + stationNorm };

  var driverFilter = null;
  try {
    var arr = JSON.parse(driverIdsJson || '[]');
    if (arr && arr.length) {
      driverFilter = {};
      arr.forEach(function(id) { driverFilter[String(id)] = true; });
    }
  } catch (e) {}

  var nBack = Math.max(1, Math.min(180, Number(daysBack) || 30)); // chặn trần 180 ngày/lượt gọi tránh đọc quá nặng
  var tz = SPX_TZ;
  var today = new Date();
  var minDate = Utilities.formatDate(new Date(today.getTime() - nBack * 86400000), tz, 'yyyy-MM-dd');

  // [MỚI — đo hiệu năng] Chưa có số liệu thật về thời gian đọc sheet, nên
  // trước khi cân nhắc thêm CacheService (rủi ro dữ liệu cũ nếu sai TTL/khoá),
  // ghi lại thời gian thật vào Log — xem tại Apps Script > Executions.
  var _t0 = Date.now();
  var months = {};
  for (var d = 0; d <= nBack; d++) {
    var dt = new Date(today.getTime() - d * 86400000);
    months[_dgh_monthKey_(Utilities.formatDate(dt, tz, 'yyyy-MM-dd'))] = true;
  }

  var byDriver = {}; // gom theo driver để downsample TRƯỚC khi trả JSON (giảm payload)
  var ss = getStationSS(stationNorm);
  var _tSS = Date.now();
  var _rowsRead = 0, _sheetsRead = 0;
  Object.keys(months).forEach(function(monthKey) {
    var sheet = ss.getSheetByName(_dgh_sheetNameForMonth_(monthKey));
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var data = sheet.getRange(2, 1, lastRow - 1, DGH_HEADERS.length).getValues();
    _sheetsRead++; _rowsRead += data.length;
    data.forEach(function(r) {
      var rDate = (r[0] + '');
      if (rDate < minDate) return; // r[1] luôn == stationNorm vì đã mở đúng spreadsheet của trạm này
      var driverId = r[2] + '';
      if (driverFilter && !driverFilter[driverId]) return;
      if (!byDriver[driverId]) byDriver[driverId] = [];
      // [SỬA — cùng đợt thêm cột wardName, xem ghi chú ở DGH_HEADERS] Trả thêm
      // wardName ra client để bước tính zone dùng làm ranh giới cứng. Dữ liệu
      // CŨ (lưu trước khi có cột này) sẽ cho undefined → ép về chuỗi rỗng, nơi
      // dùng tự xử lý trường hợp thiếu Ward.
      byDriver[driverId].push({ date: rDate, driverId: driverId, driverName: r[3], orderId: r[4], lat: r[5], lng: r[6], zoneId: r[7], wardName: r[8] || '' });
    });
  });

  var _tRead = Date.now();
  // Downsample: >DGH_MAX_POINTS_PER_DRIVER điểm không giúp hull chính xác hơn đáng
  // kể, nhưng làm payload JSON + tính hull ở client nặng hơn — nhất là khi nhiều
  // user cùng mở Zone 1 lúc. Lấy mẫu đều (evenly-spaced) để không thiên lệch theo
  // ngày gần/xa.
  // [SỬA] Lấy mẫu THEO TỈ LỆ: nếu tổng số điểm vượt DGH_MAX_POINTS_TOTAL thì mọi tài xế cùng bị lấy mẫu
  // với 1 tỉ lệ = TRẦN / TỔNG (lấy đều theo thứ tự lưu -> không thiên lệch ngày gần/xa). Tài xế ít đơn
  // được giữ tối thiểu DGH_MIN_POINTS_PER_DRIVER điểm để không bị mất vùng.
  var totalRaw = 0;
  Object.keys(byDriver).forEach(function(did) { totalRaw += byDriver[did].length; });
  var ratio = totalRaw > DGH_MAX_POINTS_TOTAL ? (DGH_MAX_POINTS_TOTAL / totalRaw) : 1;
  var out = [];
  Object.keys(byDriver).forEach(function(did) {
    var pts = byDriver[did];
    var quota = pts.length;
    if (ratio < 1) {
      quota = Math.max(Math.round(pts.length * ratio), Math.min(pts.length, DGH_MIN_POINTS_PER_DRIVER));
    }
    if (quota >= pts.length) {
      for (var i = 0; i < pts.length; i++) out.push(pts[i]);
      return;
    }
    var step = pts.length / quota;
    for (var k = 0; k < quota; k++) out.push(pts[Math.floor(k * step)]);
  });

  // [SỬA — theo yêu cầu trực tiếp "tích hợp vào spxGetDispatcherTimingReport
  // thay vì phải coi Executions log"] Trước đây chỉ Logger.log rời rạc, mỗi lần
  // xem phải mở Executions rồi bấm từng lượt. Nay ghi qua ĐÚNG cơ chế đo lường
  // đã có sẵn cho các dispatcher job nền (_spxTrackFnTiming_ + ScriptProperties,
  // xem spxGetDispatcherTimingReport() ở trên) — số liệu của dgh_getPoints sẽ
  // TỰ ĐỘNG hiện chung trong đúng 1 báo cáo đó (đếm lần gọi, TB/min/max/tổng),
  // tích luỹ bền qua nhiều lần gọi thật, không mất khi hàm chạy xong. Tôn trọng
  // cờ SPX_DISPATCH_TIMING_ENABLED — tắt cờ đó thì dừng ghi luôn, đỡ tốn I/O khi
  // đã đo đủ.
  var _elapsedS = (Date.now() - _t0) / 1000;
  if (typeof SPX_DISPATCH_TIMING_ENABLED !== 'undefined' && SPX_DISPATCH_TIMING_ENABLED) {
    try { _spxTrackFnTiming_('dgh_getPoints', _elapsedS, false); } catch (eTiming) {}
  }
  // Vẫn giữ thêm 1 dòng Logger.log CHI TIẾT (bao nhiêu sheet/dòng, tách rõ thời
  // gian đọc vs downsample) — báo cáo tổng hợp không có mức chi tiết này, chỉ
  // xem được khi cần đào sâu 1 lượt cụ thể qua Executions.
  Logger.log('[dgh_getPoints] trạm=%s ngày=%s: mở SS %sms, đọc %s sheet/%s dòng trong %sms, downsample %sms, tổng %sms (raw=%s -> trả %s)',
    stationNorm, nBack, (_tSS - _t0), _sheetsRead, _rowsRead, (_tRead - _tSS),
    (Date.now() - _tRead), (Date.now() - _t0), totalRaw, out.length);
  // totalRaw/sampled trả kèm để client biết đây là MẪU và hiển thị đúng (không nhầm với tổng đơn thật)
  return { success: true, points: out, daysBack: nBack, totalRaw: totalRaw, sampled: out.length < totalRaw };
}

/**
 * Dọn các sheet Driver_Geo_YYYYMM quá cũ (> DGH_RETENTION_MONTHS tháng) —
 * CHỈ 1 LÔ trạm nhỏ mỗi lần chạy, giống HỆT trendNightlyPurgeRunner (đọc
 * Station_Map, cursor lưu trong PropertiesService, chỉ chạy giờ vắng 23h-5h).
 *
 * BẮT BUỘC theo lô: mỗi trạm = 1 lượt mở spreadsheet riêng (getStationSS),
 * với 300+ trạm nếu loop hết trong 1 lần thực thi sẽ Timed Out y hệt bug đã
 * từng gặp với Driver_Daily (xem comment ở trendNightlyPurge/trendNightlyPurgeRunner
 * phía trên) — nên KHÔNG được viết thành 1 vòng for duyệt hết toàn bộ trạm.
 */
var DGH_PURGE_BATCH_SIZE = 30;
var DGH_PURGE_CURSOR_KEY = 'dgh_purge_cursor_v1';

function dgh_purgeOldMonthsBatch_(stationList) {
  var tz = SPX_TZ;
  var cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - DGH_RETENTION_MONTHS);
  var cutoffKey = Utilities.formatDate(cutoff, tz, 'yyyyMM');

  var deleted = [];
  stationList.forEach(function(stationName) {
    try {
      var ss = getStationSS(stationName);
      ss.getSheets().forEach(function(sheet) {
        var name = sheet.getName();
        if (name.indexOf('Driver_Geo_') === 0) {
          var monthKey = name.replace('Driver_Geo_', '');
          if (monthKey.length === 6 && monthKey < cutoffKey) {
            ss.deleteSheet(sheet);
            deleted.push(stationName + '/' + name);
          }
        }
      });
    } catch (e) { /* 1 trạm lỗi (VD spreadsheet bị xóa/mất quyền) không được chặn các trạm còn lại */ }
  });
  return { success: true, deleted: deleted };
}

/**
 * Trigger runner — gắn CHUNG lịch với trendNightlyPurgeRunner (mỗi 30 phút,
 * tự bỏ qua ngoài khung giờ vắng). Chạy 1 LẦN trong Apps Script Editor để cài:
 * setupDghPurgeTrigger().
 */
function dghPurgeOldMonthsRunner() {
  if (!_spxIsPrewarmQuietHours_()) return;
  var gotLock = _anaAcquireNamedLock('dgh_purge_batch_lock_v1', 5000);
  if (!gotLock) return;

  try {
    var ss = _DS.ss(MASTER_DB_ID);
    // [CHUYỂN DỊCH DẦN Station_Map] Xem ghi chú đầy đủ ở ana_archiveOldOrdersRunner.
    var stations = (typeof spx_getAllStationNames === 'function') ? spx_getAllStationNames() : [];
    if (!stations.length) return;

    var props = PropertiesService.getScriptProperties();
    var cursor = Number(props.getProperty(DGH_PURGE_CURSOR_KEY)) || 0;
    if (cursor >= stations.length) cursor = 0;

    var batch = stations.slice(cursor, cursor + DGH_PURGE_BATCH_SIZE);
    var nextCursor = cursor + batch.length;
    if (nextCursor >= stations.length) nextCursor = 0;
    props.setProperty(DGH_PURGE_CURSOR_KEY, String(nextCursor));

    dgh_purgeOldMonthsBatch_(batch);
  } finally {
    _anaReleaseNamedLock('dgh_purge_batch_lock_v1');
  }
}

/** Chạy 1 LẦN DUY NHẤT trong Apps Script Editor để tạo trigger purge theo lô cho Driver Geo History. */
function setupDghPurgeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dghPurgeOldMonthsRunner') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dghPurgeOldMonthsRunner')
    .timeBased()
    .everyMinutes(30)
    .create();
  return 'Đã tạo trigger dghPurgeOldMonthsRunner — chạy mỗi 30 phút, chỉ thực sự purge trong khung giờ vắng 23h-5h (mỗi lượt ' + DGH_PURGE_BATCH_SIZE + ' trạm).';
}

// ══════════════════════════════════════════════════════════════════════════
// MODULE: HUB LOCATION — tọa độ cố định của trạm (hub), dùng để tính khoảng
// cách từ zone/tài xế tới hub (Driver Zone) và có thể tái dùng cho các metric
// "distance to hub"/"Hub gần nhất" trong bảng đánh giá zone bất thường.
//
// Lưu ngay trong Station_Map (MASTER_DB_ID) — mở rộng thêm cột D (hub_lat),
// E (hub_lng). Dữ liệu cực nhỏ (1 dòng/trạm, ~300 dòng tổng) nên để chung
// MASTER_DB_ID an toàn, không giống rủi ro phình sheet như Driver_Geo (dữ
// liệu thô hàng trăm nghìn dòng) đã tách riêng theo trạm ở trên.
// ══════════════════════════════════════════════════════════════════════════
function _hub_ensureHeaders_(sheet) {
  var hdrD = String(sheet.getRange(1, 4).getValue() || '').trim();
  var hdrE = String(sheet.getRange(1, 5).getValue() || '').trim();
  if (!hdrD || !hdrE) {
    sheet.getRange(1, 4, 1, 2).setValues([['hub_lat', 'hub_lng']])
      .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
  }
}

/**
 * Ghi tọa độ cố định của 1 trạm. Gọi từ công cụ "Đặt vị trí Hub" ở frontend
 * (click trên bản đồ → xác nhận → lưu). Nếu trạm chưa có dòng trong
 * Station_Map (hiếm, vì getStationSS() thường đã tạo dòng từ trước) thì tự
 * thêm dòng mới.
 */
/**
 * dz_getHubCoordFromOrg(stationName)
 * [MỚI — theo góp ý trực tiếp: "chúng ta ĐÃ CÓ toạ độ trạm, sao lại bắt tự
 * định vị?"] Lấy toạ độ hub từ ĐÚNG danh mục hệ thống đã có sẵn (sheet
 * "Hub/SOC infor" — cùng nguồn đang dùng cho Tra cứu Hub và thời tiết tự
 * động), thay vì bắt người dùng bấm định vị GPS hay tự gõ tay.
 * Tái dùng nguyên _spxGetHubInfoMap_() + _spxParseCoord_() đã có — không đọc
 * thêm nguồn mới, không thêm chi phí đọc sheet riêng.
 * Trả OBJECT THÔ (khớp quy ước của nhóm hàm hub_ và dgh_ — client KHÔNG parse).
 */
function dz_getHubCoordFromOrg(stationName) {
  try {
    _requireApproved_();
    var name = String(stationName || '').trim();
    if (!name) return { success: false, msg: 'Thiếu tên trạm.' };
    // [ĐA TRẠM — siết quyền theo trạm, khớp đúng mức của hub_getLocation/
    // dgh_getPoints] Trước đây chỉ kiểm tra "đã được duyệt" chung chung, nghĩa
    // là bất kỳ nhân viên nào cũng tra được toạ độ + địa chỉ của MỌI trạm.
    // Tuy đây là dữ liệu danh mục nội bộ (không phải số liệu vận hành nhạy
    // cảm), vẫn nên giới hạn đúng phạm vi trạm được phân quyền cho nhất quán.
    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };
    var _hasPerm = (_perm.stations || []).some(function(s) {
      // Dùng ĐÚNG cách so khớp của hub_getLocation/dgh_getPoints (trim +
      // thường hoá) — không dùng _normStationKey_ để tránh 2 nơi cho ra kết
      // quả khác nhau với cùng 1 tên trạm (đúng lớp lỗi đã gặp trước đây).
      return String(s).trim().toLowerCase() === name.toLowerCase();
    });
    if (!_hasPerm) return { success: false, msg: 'Không có quyền với trạm này.' };
    var info = _spxGetHubInfoMap_().byHub[_orgNormHub_(name)];
    if (!info) {
      // Thử làm mới cache 1 lần rồi tra lại — cùng cơ chế tự phục hồi đã dùng
      // ở Tra cứu Hub (sheet nguồn có thể vừa được thêm/đổi tên trạm).
      info = _spxGetHubInfoMap_(true).byHub[_orgNormHub_(name)];
    }
    if (!info) return { success: false, msg: 'Không tìm thấy trạm trong danh mục Hub/SOC infor.' };
    var coord = _spxParseCoord_(info.coord);
    if (!coord) return { success: false, msg: 'Trạm có trong danh mục nhưng chưa có toạ độ.' };
    return {
      success: true,
      lat: coord.lat,
      // [SỬA LỖI THẬT — video báo "không lưu được toạ độ": ô Kinh độ trống]
      // _spxParseCoord_() trả về { lat, lon } — dùng tên "lon", KHÔNG phải
      // "lng". Trước đây viết coord.lng -> undefined -> ô Kinh độ rỗng ->
      // không lưu được. Các hàm hub_*/dgh_* lại dùng tên "lng", nên ở ĐÂY là
      // đúng chỗ phải quy đổi tên cho khớp, giữ nguyên cả 2 hàm gốc.
      lng: coord.lon,
      address: info.address || '',
      source: 'Hub/SOC infor'
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * dz_getNearbyHubCoords(stationName, maxKm)
 * [MỚI — Metric 6 "Hub gần nhất"] Trả về toạ độ các hub LÂN CẬN quanh trạm
 * đang xem, để client tự tính: với mỗi vùng giao hàng, hub gần điểm giữa vùng
 * đó nhất có phải chính trạm này không. Nếu KHÔNG — nghĩa là vùng đó thực chất
 * nằm gần trạm khác hơn, dấu hiệu chia vùng chưa hợp lý (đơn nên do trạm kia
 * giao sẽ tiết kiệm quãng đường hơn).
 *
 * Khác _spxGetNearbyHubs_() đã có: hàm đó chỉ trả tên + khoảng cách HUB-ĐẾN-HUB
 * (dùng cho mục đích khác), còn ở đây cần TOẠ ĐỘ để tính từ điểm giữa của từng
 * vùng — không tái dùng được, nhưng vẫn dùng chung nguồn dữ liệu
 * (_spxGetHubInfoMap_) nên không phát sinh chi phí đọc.
 *
 * KHÔNG lọc theo quyền từng trạm: đây chỉ là dữ kiện ĐỊA LÝ (tên + toạ độ hub),
 * không phải số liệu vận hành — cùng nguyên tắc đã áp dụng cho
 * _spxGetNearbyHubs_. Vẫn yêu cầu quyền với trạm ĐANG XEM.
 */
function dz_getNearbyHubCoords(stationName, maxKm) {
  try {
    _requireApproved_();
    var name = String(stationName || '').trim();
    if (!name) return { success: false, msg: 'Thiếu tên trạm.' };

    var _email = Session.getActiveUser().getEmail();
    var _perm  = checkAnalyticsPermission(_email);
    if (!_perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };
    var _hasPerm = (_perm.stations || []).some(function(s) {
      return String(s).trim().toLowerCase() === name.toLowerCase();
    });
    if (!_hasPerm) return { success: false, msg: 'Không có quyền với trạm này.' };

    var limitKm = Number(maxKm) > 0 ? Number(maxKm) : 60;
    var info = _spxGetHubInfoMap_().byHub || {};
    var meKey = _orgNormHub_(name);
    var me = info[meKey];
    var meCoord = me ? _spxParseCoord_(me.coord) : null;
    if (!meCoord) return { success: false, msg: 'Trạm hiện tại chưa có toạ độ trong danh mục.' };

    var hubs = [{ name: (me.name || name), lat: meCoord.lat, lng: meCoord.lon, isCurrent: true }];
    Object.keys(info).forEach(function(k){
      if (k === meKey) return;
      var c = _spxParseCoord_(info[k].coord);
      if (!c) return;
      var km = _spxHaversineKm_(meCoord.lat, meCoord.lon, c.lat, c.lon);
      if (km <= limitKm) {
        hubs.push({ name: info[k].name, lat: c.lat, lng: c.lon, isCurrent: false });
      }
    });
    return { success: true, hubs: hubs, currentName: (me.name || name) };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

function hub_setLocation(stationName, lat, lng) {
  var email = Session.getActiveUser().getEmail();
  var perm  = checkAnalyticsPermission(email);
  if (!perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };

  var stationNorm = (stationName || '').trim();
  var hasStationPerm = perm.stations.some(function(s) {
    return s.trim().toLowerCase() === stationNorm.toLowerCase();
  });
  if (!hasStationPerm) return { success: false, msg: 'Bạn không có quyền đặt vị trí Hub cho trạm: ' + stationNorm };

  var latN = Number(lat), lngN = Number(lng);
  if (!latN || !lngN || Math.abs(latN) > 90 || Math.abs(lngN) > 180) {
    return { success: false, msg: 'Tọa độ không hợp lệ.' };
  }

  var lockKey = 'hub_set_lock_' + stationNorm;
  if (!_anaAcquireNamedLock(lockKey, 15000)) {
    return { success: false, msg: 'Hệ thống đang bận, thử lại sau vài giây.' };
  }
  try {
    var ss = _DS.ss(MASTER_DB_ID);
    var sheet = ss.getSheetByName('Station_Map');
    if (!sheet) return { success: false, msg: 'Không tìm thấy sheet Station_Map.' };
    _hub_ensureHeaders_(sheet);

    var lastRow = sheet.getLastRow();
    var nameLower = stationNorm.toLowerCase();
    var written = false;
    if (lastRow > 1) {
      var vals = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0] || '').trim().toLowerCase() === nameLower) {
          sheet.getRange(i + 2, 4, 1, 2).setValues([[latN, lngN]]);
          written = true;
          break;
        }
      }
    }
    if (!written) {
      sheet.appendRow(['', stationNorm, '', latN, lngN]);
    }
    return { success: true, lat: latN, lng: lngN };
  } catch (e) {
    return { success: false, msg: e.message };
  } finally {
    _anaReleaseNamedLock(lockKey);
  }
}

/**
 * Đọc tọa độ cố định của 1 trạm — trả về null nếu trạm chưa từng được đặt vị trí.
 */
function hub_getLocation(stationName) {
  var email = Session.getActiveUser().getEmail();
  var perm  = checkAnalyticsPermission(email);
  if (!perm.allowed) return { success: false, msg: 'Không có quyền truy cập Analytics.' };

  var stationNorm = (stationName || '').trim();
  var hasStationPerm = perm.stations.some(function(s) {
    return s.trim().toLowerCase() === stationNorm.toLowerCase();
  });
  if (!hasStationPerm) return { success: false, msg: 'Bạn không có quyền xem trạm: ' + stationNorm };

  var ss = _DS.ss(MASTER_DB_ID);
  var sheet = ss.getSheetByName('Station_Map');
  if (!sheet || sheet.getLastRow() < 2) return { success: true, location: null };

  var nameLower = stationNorm.toLowerCase();
  var vals = sheet.getRange(2, 2, sheet.getLastRow() - 1, 4).getValues(); // B..E: name, ss_id, hub_lat, hub_lng
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim().toLowerCase() === nameLower) {
      var lat = Number(vals[i][2]), lng = Number(vals[i][3]);
      if (lat && lng) return { success: true, location: { lat: lat, lng: lng } };
      return { success: true, location: null };
    }
  }
  return { success: true, location: null };
}

/** Chạy 1 LẦN DUY NHẤT trong Apps Script Editor để tạo trigger purge theo lô. */
function setupTrendNightlyPurgeTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 30-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher30Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher30Min() thay thế.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'trendNightlyPurgeRunner') ScriptApp.deleteTrigger(t);
  });
  // [FIX 2026-08-02] Đổi "1 lần/ngày lúc 2h" -> "mỗi 30 phút, tự bỏ qua nếu
  // ngoài khung giờ vắng (xem _spxIsPrewarmQuietHours_ trong hàm)" — cho phép
  // purge theo lô nhỏ suốt 23h-5h thay vì 1 lượt khổng lồ luôn Timed Out.
  ScriptApp.newTrigger('trendNightlyPurgeRunner')
    .timeBased()
    .everyMinutes(30)
    .create();
  return 'Đã tạo trigger trendNightlyPurgeRunner — chạy mỗi 30 phút, chỉ thực sự purge trong khung giờ vắng 23h-5h (mỗi lượt ' + TREND_PURGE_BATCH_SIZE + ' trạm).';
}

// ── TRIGGER LOG TỰ ĐỘNG (CHO MỖI LẦN SAVE) ──────────────────────
// Không cần trigger riêng cho việc save — frontend tự gọi saveSnapshot()/savePickupOnly()
// ngay sau mỗi lần upload CSV. Log của từng lần save vẫn ghi qua _trendWriteLog() như cũ.
// (Trigger duy nhất cần cài đặt thủ công là trendNightlyPurgeRunner() ở trên, cho việc purge.)

// ── LOG SAVE ────────────────────────────────────────────────────
/**
 * Ghi 1 dòng vào Trigger_Log mỗi khi saveSnapshot() chạy.
 * type: 'auto_upload' (frontend tự save sau upload) | 'manual' (chốt tay)
 */
function _trendWriteLog(ss, dateKey, nowVN, triggerType, saved, skipped, errorMsg) {
  try {
    var HEADERS = ['date', 'triggered_at', 'type', 'stations_saved', 'stations_skipped', 'error'];
    var logSheet = ss.getSheetByName('Trigger_Log');
    if (!logSheet) {
      logSheet = ss.insertSheet('Trigger_Log');
      logSheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
        .setFontWeight('bold').setBackground('#374151').setFontColor('#ffffff');
      logSheet.setFrozenRows(1);
    }
    logSheet.appendRow([dateKey, nowVN, triggerType, saved, skipped, errorMsg || '']);
    // Giữ tối đa 90 dòng log
    var lastRow = logSheet.getLastRow();
    if (lastRow > 91) logSheet.deleteRow(2);
  } catch(e) { /* không để lỗi log chặn luồng chính */ }
}

/**
 * Đọc Trigger_Log — gọi từ frontend để xem lịch sử save
 */
function getTrendTriggerLog() {
  // [SECURITY FIX 2026-08] Trước đây không kiểm tra quyền — chặn tối thiểu "đã
  // duyệt" (không chặn admin-only vì nút "Log trigger" hiển thị cho mọi role xem
  // được tab Trend, không riêng admin).
  try { _requireApproved_(); } catch (eAuth) { return { success: false, error: eAuth.message }; }
  try {
    var ss    = _DS.ss(MASTER_DB_ID);
    var sheet = ss.getSheetByName('Trigger_Log');
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, logs: [] };
    var lastRow = sheet.getLastRow();
    // [FIX 2026-08-02] Chỉ đọc TỐI ĐA 1000 dòng gần nhất — trước đây đọc toàn bộ
    // sheet, và sheet này giờ ghi log NHIỀU LẦN HƠN trước (từ khi
    // stationStatus_crawlBatch/trendNightlyPurgeRunner đổi sang chạy theo lô
    // nhỏ nhiều lượt/đêm thay vì 1 lần/ngày) — sẽ phình nhanh hơn nếu không
    // giới hạn. Không ai cần xem quá 1000 dòng log gần nhất trong 1 lượt xem.
    var maxRows  = 1000;
    var numRows  = lastRow - 1;
    var startRow = numRows > maxRows ? (lastRow - maxRows + 1) : 2;
    var readRows = lastRow - startRow + 1;
    var values  = sheet.getRange(startRow, 1, readRows, 6).getValues();
    var logs = values.map(function(row) {
      return {
        date:        String(row[0] || '').slice(0, 10),
        triggeredAt: String(row[1] || ''),
        type:        String(row[2] || ''),
        saved:       row[3] || 0,
        skipped:     row[4] || 0,
        error:       String(row[5] || '')
      };
    }).reverse();
    return { success: true, logs: logs };
  } catch(e) {
    return { success: false, msg: e.message };
  }
}

// ── ĐỌC DỮ LIỆU TREND ───────────────────────────────────────

/**
 * getTrendStation(stationName, fromDate, toDate)
 * Trả về array các ngày trong khoảng thời gian cho 1 trạm
 *
 * fromDate, toDate: 'yyyy-MM-dd'
 * Dùng cho Tab Trend phần trạm
 */
function getTrendStation(stationName, fromDate, toDate) {
  try {
    var email = Session.getActiveUser().getEmail();
    var perm  = checkAnalyticsPermission(email);
    if (!perm.allowed) return { success: false, msg: 'Không có quyền.' };
    var hasAccess = perm.stations.some(function(s) {
      return s.trim().toLowerCase() === (stationName || '').trim().toLowerCase();
    });
    if (!hasAccess) return { success: false, msg: 'Không có quyền xem trạm: ' + stationName };

    var ss    = _DS.ss(MASTER_DB_ID);
    var sheet = ss.getSheetByName('Station_Daily');
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, data: [] };

    var lastRow = sheet.getLastRow();
    // [FIX 2026-08-02] Đọc qua cache dùng chung (60s TTL) thay vì tự
    // getRange().getValues() riêng cho MỖI lượt gọi — trước đây, mỗi user xem
    // trend của MỘT trạm bất kỳ đều tự quét lại TOÀN BỘ sheet Station_Daily
    // (mọi trạm, tới 62 ngày lưu trữ — quy mô tăng trực tiếp theo tổng số trạm
    // hệ thống, không phải theo trạm đang xem), dù nội dung đọc được là Y HỆT
    // NHAU cho bất kỳ ai xem bất kỳ trạm nào. Cùng lớp lỗi đã gặp và vá ở Tra
    // Cứu/RBAC — ở đây còn đáng chú ý hơn vì sheet này tăng trực tiếp theo số
    // trạm × số ngày lưu trữ, sẽ ngày càng chậm khi tiến gần 1000 trạm nếu
    // không có cache dùng chung.
    var values = CacheMgr.getChunked('ANALYTICS', 'station_daily_values_v1');
    if (!values) {
      values = sheet.getRange(2, 1, lastRow - 1, 17).getValues();
      try { CacheMgr.setChunked('ANALYTICS', 'station_daily_values_v1', values, 60); } catch (eCache) {}
    }

    var stNorm = (stationName || '').trim().toLowerCase();
    var data   = [];

    values.forEach(function(row) {
      var rawDate0 = row[0];
      var rowDate = rawDate0 instanceof Date
        ? Utilities.formatDate(rawDate0, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
        : String(rawDate0 || '').slice(0, 10);
      var rowStation = String(row[1] || '').trim().toLowerCase();
      if (rowStation !== stNorm) return;
      if (fromDate && rowDate < fromDate) return;
      if (toDate   && rowDate > toDate)   return;
      data.push({
        date:        rowDate,
        total:       row[2]  || 0,
        delivered:   row[3]  || 0,
        rate:        row[4]  || 0,
        delivering:  row[5]  || 0,
        onhold:      row[6]  || 0,
        hoan:        row[7]  || 0,
        reattempts:  row[8]  || 0,
        codTotal:    row[9]  || 0,
        codDelivered:row[10] || 0,
        driverCount: row[11] || 0,
        inbound:     row[12] || 0,
        outbound:    row[13] || 0,
        pickupTotal: row[14] || 0,
        pickupDone:  row[15] || 0,
        pickupRate:  row[16] || 0
      });
    });

    // Sắp theo ngày tăng dần
    data.sort(function(a, b) { return a.date < b.date ? -1 : 1; });

    // MERGE FIRESTORE: nếu fromDate yêu cầu sớm hơn ngày sớm nhất còn trong Sheet (phần
    // còn lại đã bị trendNightlyPurgeRunner archive-rồi-xoá sau 62 ngày), bổ sung phần
    // thiếu từ fireboard_daily. Lỗi Firestore (chưa setup, mất mạng...) chỉ log, KHÔNG
    // chặn kết quả Sheet đã có — vẫn trả về data như cũ nếu Firestore không khả dụng.
    var sheetMinDate = data.length ? data[0].date : null;
    if (fromDate && (!sheetMinDate || fromDate < sheetMinDate)) {
      try {
        var fsToDate = sheetMinDate ? _trendPrevDay_(sheetMinDate) : toDate;
        if (!(fsToDate < fromDate)) { // chỉ query nếu khoảng còn hợp lệ
          var stationKey = _normStationKey_(stationName);
          var fsRows = _fsQueryStationRange_(stationKey, fromDate, fsToDate);
          var fsData = fsRows.map(function(r) {
            return {
              date: r.date || '', total: r.total || 0, delivered: r.delivered || 0,
              rate: r.rate || 0, delivering: r.delivering || 0, onhold: r.onhold || 0,
              hoan: r.hoan || 0, reattempts: r.reattempts || 0, codTotal: r.cod_total || 0,
              codDelivered: r.cod_delivered || 0, driverCount: r.driver_count || 0,
              inbound: r.inbound || 0, outbound: r.outbound || 0,
              pickupTotal: r.pickup_total || 0, pickupDone: r.pickup_done || 0,
              pickupRate: r.pickup_rate || 0
            };
          });
          data = fsData.concat(data);
        }
      } catch (eFs) {
        _LOG.d('[TREND] getTrendStation: merge Firestore lỗi (bỏ qua, chỉ trả Sheet): ' + eFs.message);
      }
    }

    return { success: true, station: stationName, data: data };
  } catch(e) {
    return { success: false, msg: e.message };
  }
}

/**
 * getTrendDrivers(stationName, fromDate, toDate, driverIds)
 * Trả về lịch sử tài xế trong khoảng ngày
 *
 * driverIds: [] = tất cả tài xế của trạm
 *            ['TX001','TX002'] = chỉ những tài xế này
 *
 * Dùng cho Tab Trend phần tài xế (single + multi compare)
 */
function getTrendDrivers(stationName, fromDate, toDate, driverIdsJson) {
  try {
    var email = Session.getActiveUser().getEmail();
    var perm  = checkAnalyticsPermission(email);
    if (!perm.allowed) return { success: false, msg: 'Không có quyền.' };
    var hasAccess = perm.stations.some(function(s) {
      return s.trim().toLowerCase() === (stationName || '').trim().toLowerCase();
    });
    if (!hasAccess) return { success: false, msg: 'Không có quyền xem trạm: ' + stationName };

    var driverIds = [];
    try { driverIds = JSON.parse(driverIdsJson || '[]'); } catch(e) {}

    var ss    = getStationSS(stationName);
    var sheet = ss.getSheetByName('Driver_Daily');
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, data: {}, drivers: [] };

    var lastRow = sheet.getLastRow();
    var values  = sheet.getRange(2, 1, lastRow - 1, 17).getValues();

    var stNorm   = (stationName || '').trim().toLowerCase();
    var idFilter = driverIds.length > 0
      ? driverIds.reduce(function(m, id) { m[String(id).trim()] = true; return m; }, {})
      : null;

    // data[driverId][date] = { ...stats }
    var data     = {};
    var driverMeta = {};

    values.forEach(function(row) {
      var rawDate1 = row[0];
      var rowDate = rawDate1 instanceof Date
        ? Utilities.formatDate(rawDate1, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
        : String(rawDate1 || '').slice(0, 10);
      var rowStation = String(row[1] || '').trim().toLowerCase();
      var driverId   = String(row[2] || '').trim();
      if (rowStation !== stNorm) return;
      if (!driverId) return;
      if (fromDate && rowDate < fromDate) return;
      if (toDate   && rowDate > toDate)   return;
      if (idFilter && !idFilter[driverId]) return;

      if (!data[driverId]) {
        data[driverId] = {};
        driverMeta[driverId] = { id: driverId, name: String(row[3] || ''), _sumTotal: 0, _sumDelivered: 0 };
      }
      driverMeta[driverId]._sumTotal     += (Number(row[4]) || 0);
      driverMeta[driverId]._sumDelivered += (Number(row[5]) || 0);
      data[driverId][rowDate] = {
        date:        rowDate,
        total:       row[4]  || 0,
        delivered:   row[5]  || 0,
        rate:        row[6]  || 0,
        delivering:  row[7]  || 0,
        onhold:      row[8]  || 0,
        hoan:        row[9]  || 0,
        reattempts:  row[10] || 0,
        cod:         row[11] || 0,
        codDelivered:row[12] || 0,
        topZone:       String(row[13] || ''),
        pickupAssigned:row[14] || 0,
        pickupDone:    row[15] || 0,
        pickupRate:    row[16] || 0
      };
    });

    // MERGE FIRESTORE: cùng nguyên tắc như getTrendStation — nếu fromDate sớm hơn ngày
    // sớm nhất còn trong Driver_Daily (Sheet), bổ sung phần đã bị purge từ Firestore
    // (collectionGroup 'drivers' dưới fireboard_daily). Lỗi Firestore chỉ log, không
    // chặn kết quả Sheet.
    var sheetMinDateD = null;
    Object.keys(data).forEach(function(id) {
      Object.keys(data[id]).forEach(function(d) {
        if (!sheetMinDateD || d < sheetMinDateD) sheetMinDateD = d;
      });
    });
    if (fromDate && (!sheetMinDateD || fromDate < sheetMinDateD)) {
      try {
        var fsToDateD = sheetMinDateD ? _trendPrevDay_(sheetMinDateD) : toDate;
        if (!(fsToDateD < fromDate)) {
          var stationKeyD = _normStationKey_(stationName);
          var fsDriverRows = _fsQueryDriverRange_(stationKeyD, fromDate, fsToDateD);
          fsDriverRows.forEach(function(r) {
            var driverId = String(r.driver_id || '').trim();
            if (!driverId) return;
            if (idFilter && !idFilter[driverId]) return;
            if (!data[driverId]) {
              data[driverId] = {};
              driverMeta[driverId] = { id: driverId, name: r.driver_name || '', _sumTotal: 0, _sumDelivered: 0 };
            }
            driverMeta[driverId]._sumTotal     += (Number(r.total) || 0);
            driverMeta[driverId]._sumDelivered += (Number(r.delivered) || 0);
            data[driverId][r.date] = {
              date: r.date || '', total: r.total || 0, delivered: r.delivered || 0,
              rate: r.rate || 0, delivering: r.delivering || 0, onhold: r.onhold || 0,
              hoan: r.hoan || 0, reattempts: r.reattempts || 0, cod: r.cod || 0,
              codDelivered: r.cod_delivered || 0, topZone: r.top_zone || '',
              pickupAssigned: r.pickup_assigned || 0, pickupDone: r.pickup_done || 0,
              pickupRate: r.pickup_rate || 0
            };
          });
        }
      } catch (eFsD) {
        _LOG.d('[TREND] getTrendDrivers: merge Firestore lỗi (bỏ qua, chỉ trả Sheet): ' + eFsD.message);
      }
    }

    // Danh sách tài xế có dữ liệu — tính avgRate từ tổng đã accumulate
    var drivers = Object.values(driverMeta).map(function(d) {
      var avgRate = d._sumTotal > 0 ? Math.round(d._sumDelivered / d._sumTotal * 100) : 0;
      return { id: d.id, name: d.name, avgRate: avgRate };
    }).sort(function(a, b) {
      return a.name < b.name ? -1 : 1;
    });

    return { success: true, station: stationName, data: data, drivers: drivers };
  } catch(e) {
    return { success: false, msg: e.message };
  }
}

/**
 * getTrendDriverList(stationName)
 * Trả về danh sách tài xế đã từng xuất hiện trong Driver_Daily của trạm
 * Dùng để populate dropdown chọn tài xế trong Tab Trend
 */
function getTrendDriverList(stationName) {
  try {
    var email = Session.getActiveUser().getEmail();
    var perm  = checkAnalyticsPermission(email);
    if (!perm.allowed) return { success: false, msg: 'Không có quyền.' };
    // MU-PERM: Thêm station-level check (nhất quán với getTrendStation / getTrendDrivers)
    var hasAccess = perm.stations.some(function(s) {
      return s.trim().toLowerCase() === (stationName || '').trim().toLowerCase();
    });
    if (!hasAccess) return { success: false, msg: 'Không có quyền xem trạm: ' + stationName };

    var ss    = getStationSS(stationName);
    var sheet = ss.getSheetByName('Driver_Daily');
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, drivers: [] };

    var lastRow = sheet.getLastRow();
    var values  = sheet.getRange(2, 1, lastRow - 1, 4).getValues();

    var stNorm = (stationName || '').trim().toLowerCase();
    var seen   = {};

    values.forEach(function(row) {
      var rowStation = String(row[1] || '').trim().toLowerCase();
      var driverId   = String(row[2] || '').trim();
      var driverName = String(row[3] || '').trim();
      if (rowStation !== stNorm || !driverId || seen[driverId]) return;
      seen[driverId] = { id: driverId, name: driverName };
    });

    var drivers = Object.values(seen).sort(function(a, b) {
      return a.name < b.name ? -1 : 1;
    });

    return { success: true, station: stationName, drivers: drivers };
  } catch(e) {
    return { success: false, msg: e.message };
  }
}

/**
 * getTrendDateRange(stationName)
 * Trả về ngày sớm nhất và mới nhất có dữ liệu của trạm
 * Dùng để set giới hạn date picker trong Tab Trend
 */
function getTrendDateRange(stationName) {
  try {
    var email = Session.getActiveUser().getEmail();
    var perm  = checkAnalyticsPermission(email);
    if (!perm.allowed) return { success: false };
    // MU-PERM: Thêm station-level check
    var hasAccess = perm.stations.some(function(s) {
      return s.trim().toLowerCase() === (stationName || '').trim().toLowerCase();
    });
    if (!hasAccess) return { success: false, msg: 'Không có quyền xem trạm: ' + stationName };

    var ss    = _DS.ss(MASTER_DB_ID);
    var sheet = ss.getSheetByName('Station_Daily');
    if (!sheet || sheet.getLastRow() <= 1) {
      return { success: true, minDate: null, maxDate: null };
    }

    var lastRow = sheet.getLastRow();
    var values  = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var stNorm  = (stationName || '').trim().toLowerCase();
    var dates   = [];

    values.forEach(function(row) {
      if (String(row[1] || '').trim().toLowerCase() !== stNorm) return;
      var d = String(row[0] || '').slice(0, 10);
      if (d && d.match(/^\d{4}-\d{2}-\d{2}$/)) dates.push(d);
    });

    if (!dates.length) return { success: true, minDate: null, maxDate: null };

    dates.sort();
    return { success: true, minDate: dates[0], maxDate: dates[dates.length - 1] };
  } catch(e) {
    return { success: false, msg: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
