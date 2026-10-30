/**
 * ============================================================
 * ⚠️ [DEPRECATED 2026-08-02] FILE NÀY LÀ CODE CŨ, KHÔNG CÒN ĐƯỢC DÙNG ⚠️
 * ============================================================
 * Xác nhận bởi Xuân (2026-08-02): hệ thống thực tế đang chạy theo kiến trúc
 * ĐƠN GIẢN HƠN của StationConfig.gs — "1 spreadsheet MỚI HOÀN TOÀN cho MỖI
 * trạm" (không phải "gộp trạm vào 1 nhóm nhỏ DB dùng chung" như file này).
 *
 * BẰNG CHỨNG: toàn bộ phần còn lại của code (backend.gs, stationStatus_crawlBatch,
 * trendNightlyPurgeRunner...) đều gọi _ssMapRead_() (của StationConfig.gs) —
 * KHÔNG hàm nào trong codebase gọi _mdb_readStationMap() (của file này) ngoài
 * chính nó tự gọi. File này chưa từng được tích hợp vào phần còn lại của hệ thống.
 *
 * XUNG ĐỘT NGHIÊM TRỌNG ĐàPHÁT HIỆN: file này định nghĩa lại getStationSS(),
 * TRÙNG TÊN với bản THẬT trong StationConfig.gs — Apps Script không báo lỗi khi
 * trùng tên hàm giữa các file .gs, chỉ âm thầm dùng 1 trong 2 bản (thứ tự phụ
 * thuộc cách Apps Script nạp file, không đảm bảo chắc chắn bản nào thắng).
 * NGUY HIỂM HƠN: 2 file còn hiểu SAI KHÁC NHAU ý nghĩa các cột trong cùng 1
 * sheet "Station_Map" (file này: cột A=Station Name, B=DB Key, C=Spreadsheet ID
 * DÙNG CHUNG — StationConfig.gs: cột A=Station Key, B=Station Name, C=ss_id
 * RIÊNG của từng trạm) — nếu lỡ chạy nhầm hàm ghi trong file này
 * (_mdb_appendStationMap, mdb_migrateStation) sẽ GHI SAI LỆCH dữ liệu vào đúng
 * các cột mà StationConfig.gs đang tin tưởng đọc, làm trạm bị trỏ sai file.
 *
 * ĐÃ ĐỔI TÊN getStationSS() -> _DEPRECATED_MDB_getStationSS() (xem bên dưới)
 * để loại bỏ hẳn xung đột tên — file này giờ hoàn toàn "câm", không hàm nào
 * còn có thể vô tình ghi đè lên hệ thống thật đang chạy.
 *
 * Giữ lại file để tham khảo kiến trúc (ý tưởng chia DB khi >1 spreadsheet gần
 * đầy vẫn có giá trị tham khảo cho tương lai xa, khi StationConfig.gs's "1 file/
 * trạm" thật sự chạm trần số lượng file Drive cho phép) — không xoá hẳn.
 * ============================================================
 */
/**
 * ============================================================
 * MODULE: MULTI_DB_ROUTER
 * Mục đích: Khi số trạm tăng (tới ~300), 1 spreadsheet (MASTER_DB_ID)
 * không còn đủ chỗ (giới hạn ~200 sheet / spreadsheet và giới hạn cell).
 * Module này cho phép "chia" các sheet Data_<Station> / Sup_<Station>
 * sang các spreadsheet phụ (DB2, DB3, ...) mà KHÔNG đổi cấu trúc dữ liệu.
 *
 * Cơ chế:
 * - Có 1 sheet cấu hình "Station_Map" trong MASTER_DB_ID:
 *     cột A: Station Name
 *     cột B: DB Key  (MASTER / DB2 / DB3 ...)
 *     cột C: Spreadsheet ID (để trống nếu DB Key = MASTER)
 *     cột D: Ghi chú / thời gian gán
 * - getStationSS(stationName): tra Station_Map, nếu trạm đã có mapping
 *   thì mở đúng spreadsheet đó; nếu CHƯA có (trạm mới) thì:
 *     1) kiểm tra MASTER_DB còn "đủ chỗ" không (số sheet hiện tại < ngưỡng)
 *     2) nếu đủ -> gán trạm vào MASTER, ghi vào Station_Map
 *     3) nếu không đủ -> lần lượt kiểm tra DB2, DB3... theo MULTI_DB_LIST,
 *        chọn DB đầu tiên còn chỗ, ghi vào Station_Map
 * - Mọi hàm saveStationData/getStationData/saveSupplementData/...
 *   chỉ cần đổi `SpreadsheetApp.openById(MASTER_DB_ID)`
 *   thành `getStationSS(stationName)`.
 *
 * Cấu trúc Data_ / Sup_ giữ NGUYÊN như cũ -> không ảnh hưởng các chỉ số
 * đã tổng hợp ở sheet chính (mỗi trạm 1 hàng ở Station_Daily/Driver_Daily...).
 * ============================================================
 */

// ---- DANH SÁCH CÁC SPREADSHEET PHỤ (thêm dần khi cần mở rộng) ----
// key 'MASTER' luôn là MASTER_DB_ID (đã định nghĩa ở backend.gs)
var MULTI_DB_LIST = {
  'MASTER': MASTER_DB_ID,
  'DB2': '1F9t5L1HgjD2-2zZF-iM28wizJop6M0gurSi32gcn70k',
  'DB3': '1kuMK2Nau2IolqwN3Du6tRZabOE4QDqAiZx0dib5lins'
  // 'DB4': '....', // thêm khi cần
};

// Ngưỡng số sheet tối đa cho mỗi spreadsheet trước khi điều hướng
// sang spreadsheet kế tiếp. Mỗi trạm tạo 2 sheet (Data_ + Sup_),
// trừ ra một ít sheet hệ thống (Station_Map, Inbound_Lock, UserPermission,...)
// Google Sheets giới hạn kỹ thuật ~200 sheet/spreadsheet -> để ngưỡng an toàn 180.
//
// Lưu ý: từ bản cập nhật này, các sheet Data_/Sup_/Inbound_Lock/Station_Daily/
// Driver_Daily đều được TRIM về đúng số cột cần dùng (7-19 cột thay vì mặc định
// 26 cột) ngay khi tạo -> giảm ~70% ngân sách cell "rỗng" mỗi sheet.
var MULTI_DB_MAX_SHEETS = 180;

// Ngưỡng tổng số cell (grid size = maxRows*maxCols, tính theo giới hạn 10.000.000
// cell/spreadsheet của Google Sheets) trước khi điều hướng trạm mới sang DB kế tiếp.
// Đặt ở mức 60% (6.000.000) để còn margin cho NGÀY CAO ĐIỂM (lễ/Tết/big campaign)
// khi 1 trạm có thể tăng 2-4x số đơn/ngày (Data_ ~ đơn x 7 cột) so với ngày thường.
var MULTI_DB_MAX_CELLS = 6000000;

var STATION_MAP_SHEET_NAME = 'Station_Map';
var STATION_MAP_HEADERS = ['Station Name', 'DB Key', 'Spreadsheet ID', 'Note'];

/**
 * Tổng số cell (grid size) hiện tại của 1 spreadsheet — tính theo maxRows*maxCols
 * mỗi sheet, vì đây là chỉ số tính vào giới hạn 10.000.000 cell/spreadsheet
 * (khác với số cell ĐANG CÓ DỮ LIỆU).
 */
function _mdb_estimateCells(ssId) {
  var ss = SpreadsheetApp.openById(ssId);
  var sheets = ss.getSheets();
  var total = 0;
  for (var i = 0; i < sheets.length; i++) {
    total += sheets[i].getMaxRows() * sheets[i].getMaxColumns();
  }
  return total;
}

/**
 * Lấy (hoặc tạo) sheet Station_Map trong MASTER_DB.
 */
function _mdb_getStationMapSheet() {
  var ss = SpreadsheetApp.openById(MASTER_DB_ID);
  var sheet = ss.getSheetByName(STATION_MAP_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STATION_MAP_SHEET_NAME);
    sheet.getRange(1, 1, 1, STATION_MAP_HEADERS.length).setValues([STATION_MAP_HEADERS])
      .setFontWeight('bold').setBackground('#0f4c81').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    if (sheet.getMaxColumns() > STATION_MAP_HEADERS.length) {
      sheet.deleteColumns(STATION_MAP_HEADERS.length + 1, sheet.getMaxColumns() - STATION_MAP_HEADERS.length);
    }
  }
  return sheet;
}

/**
 * Đọc toàn bộ map Station Name (đã chuẩn hoá lowercase/trim) -> { dbKey, ssId }
 * Cache trong CacheService 5 phút để giảm số lần đọc Sheet (mỗi request gọi getStationSS).
 */
function _mdb_readStationMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('mdb_station_map');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  var sheet = _mdb_getStationMapSheet();
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < data.length; i++) {
      var name = String(data[i][0] || '').trim();
      if (!name) continue;
      var dbKey = String(data[i][1] || 'MASTER').trim() || 'MASTER';
      var ssId  = String(data[i][2] || '').trim();
      map[name.toLowerCase()] = { dbKey: dbKey, ssId: ssId, station: name };
    }
  }
  cache.put('mdb_station_map', JSON.stringify(map), 300); // 5 phút
  return map;
}

/**
 * Ghi 1 dòng mapping mới vào Station_Map + xoá cache để lần sau đọc lại đúng.
 */
function _mdb_appendStationMap(stationName, dbKey, ssId) {
  // [SECURITY FIX — rà soát bảo mật toàn diện] File này ĐÃ DEPRECATED (xem banner
  // đầu file) nhưng hàm này vẫn giữ NGUYÊN tên gốc, không đổi tên như getStationSS()
  // -> _DEPRECATED_MDB_getStationSS() — vẫn gọi thẳng được qua google.script.run mà
  // KHÔNG có kiểm tra quyền nào, có thể ghi SAI LỆCH dữ liệu Station_Map thật (2 file
  // hiểu khác nhau ý nghĩa các cột, xem banner). Khoá admin cấp 1 — không ai khác cần
  // gọi hàm này (đã ngừng dùng trong luồng thật).
  _requireAdmin_(1);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var sheet = _mdb_getStationMapSheet();
    // Kiểm tra lại 1 lần nữa (tránh race: 2 request cùng tạo trạm mới song song)
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0] || '').trim().toLowerCase() === stationName.trim().toLowerCase()) {
          // Đã có mapping (do request khác vừa tạo) -> không ghi trùng
          CacheService.getScriptCache().remove('mdb_station_map');
          return;
        }
      }
    }
    sheet.appendRow([
      stationName,
      dbKey,
      (dbKey === 'MASTER') ? '' : ssId,
      'Auto-assigned ' + _anaVNNow()
    ]);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
    CacheService.getScriptCache().remove('mdb_station_map');
  }
}

/**
 * Đếm số sheet hiện có trong 1 spreadsheet (theo ID).
 */
function _mdb_countSheets(ssId) {
  var ss = SpreadsheetApp.openById(ssId);
  return ss.getSheets().length;
}

/**
 * Chọn DB Key còn chỗ (theo thứ tự MASTER -> DB2 -> DB3 -> ...).
 * Điều kiện "còn chỗ": số sheet < MULTI_DB_MAX_SHEETS VÀ tổng cell (grid size)
 * < MULTI_DB_MAX_CELLS (margin cho ngày cao điểm: đơn/trạm x2-x4 ngày thường).
 * Trả về { dbKey, ssId }.
 */
function _mdb_pickAvailableDB() {
  var keys = Object.keys(MULTI_DB_LIST);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var ssId = MULTI_DB_LIST[key];
    try {
      var sheetCount = _mdb_countSheets(ssId);
      var cellCount  = _mdb_estimateCells(ssId);
      if (sheetCount < MULTI_DB_MAX_SHEETS && cellCount < MULTI_DB_MAX_CELLS) {
        return { dbKey: key, ssId: ssId };
      }
    } catch (e) {
      console.warn('Loi kiem tra dung luong cua ' + key + ': ' + e.message);
    }
  }
  // Nếu tất cả đều đầy -> fallback DB cuối cùng (sẽ tự báo lỗi khi insertSheet nếu quá giới hạn thật)
  var lastKey = keys[keys.length - 1];
  return { dbKey: lastKey, ssId: MULTI_DB_LIST[lastKey] };
}

/**
 * HÀM CHÍNH: Lấy Spreadsheet object chứa Data_<station> / Sup_<station>.
 * - Nếu trạm đã có trong Station_Map -> mở đúng spreadsheet đó.
 * - Nếu chưa có (trạm mới) -> tự chọn DB còn chỗ, ghi mapping, trả về spreadsheet đó.
 *
 * @param {string} stationName
 * @return {Spreadsheet}
 */
// [DEPRECATED 2026-08-02] Đổi tên từ getStationSS() -> loại bỏ xung đột tên với
// bản THẬT trong StationConfig.gs. KHÔNG dùng hàm này — xem banner đầu file.
function _DEPRECATED_MDB_getStationSS(stationName) {
  var key = String(stationName || '').trim().toLowerCase();
  if (!key) return SpreadsheetApp.openById(MASTER_DB_ID);

  var map = _mdb_readStationMap();
  var entry = map[key];

  if (entry) {
    var ssId = (entry.dbKey === 'MASTER' || !entry.ssId) ? MASTER_DB_ID : entry.ssId;
    return SpreadsheetApp.openById(ssId);
  }

  // Trạm mới: chọn DB còn chỗ và ghi mapping (có lock + check trùng bên trong)
  var picked = _mdb_pickAvailableDB();
  _mdb_appendStationMap(stationName, picked.dbKey, picked.ssId);

  // Đọc lại map SAU khi append (cache đã bị xoá trong _mdb_appendStationMap)
  // để lấy đúng mapping CHÍNH THỨC, đề phòng trường hợp 2 request cùng tạo
  // trạm mới song song và request này "thua" (không phải người ghi dòng map).
  var freshMap = _mdb_readStationMap();
  var freshEntry = freshMap[key];
  if (freshEntry) {
    var freshSsId = (freshEntry.dbKey === 'MASTER' || !freshEntry.ssId) ? MASTER_DB_ID : freshEntry.ssId;
    return SpreadsheetApp.openById(freshSsId);
  }
  // Fallback (lý thuyết không xảy ra): dùng lựa chọn ban đầu
  return SpreadsheetApp.openById(picked.ssId);
}

/**
 * Báo cáo chi tiết tình trạng các DB cho Admin.
 * Trả về:
 * {
 *   thresholds: { max: 180 },
 *   dbs: [
 *     { dbKey, ssId, sheetCount, stationCount, remaining, percent, warning, url }
 *   ],
 *   stations: [ { station, dbKey } ... ]  // danh sách trạm + DB tương ứng
 * }
 * warning = true nếu remaining <= 10 (gần đầy)
 */
function mdb_getAdminOverview() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] File này ĐÃ DEPRECATED (xem banner
  // đầu file) nhưng hàm này vẫn giữ NGUYÊN tên gốc, không đổi tên như getStationSS()
  // -> _DEPRECATED_MDB_getStationSS() — vẫn gọi thẳng được qua google.script.run mà
  // KHÔNG có kiểm tra quyền nào, có thể ghi SAI LỆCH dữ liệu Station_Map thật (2 file
  // hiểu khác nhau ý nghĩa các cột, xem banner). Khoá admin cấp 1 — không ai khác cần
  // gọi hàm này (đã ngừng dùng trong luồng thật).
  _requireAdmin_(1);
  var map = _mdb_readStationMap();

  var dbs = [];
  Object.keys(MULTI_DB_LIST).forEach(function (dbKey) {
    var ssId = MULTI_DB_LIST[dbKey];
    var sheetCount = 0, cellCount = 0, errMsg = null;
    try {
      sheetCount = _mdb_countSheets(ssId);
      cellCount  = _mdb_estimateCells(ssId);
    }
    catch (e) { errMsg = e.message; }

    var stationCount = 0;
    Object.keys(map).forEach(function (k) {
      if ((map[k].dbKey || 'MASTER') === dbKey) stationCount++;
    });

    var remaining = MULTI_DB_MAX_SHEETS - sheetCount;
    var cellRemaining = MULTI_DB_MAX_CELLS - cellCount;
    dbs.push({
      dbKey: dbKey,
      ssId: ssId,
      url: 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit',
      sheetCount: sheetCount,
      stationCount: stationCount,
      maxSheets: MULTI_DB_MAX_SHEETS,
      remaining: remaining,
      percent: Math.round((sheetCount / MULTI_DB_MAX_SHEETS) * 100),
      cellCount: cellCount,
      maxCells: MULTI_DB_MAX_CELLS,
      cellRemaining: cellRemaining,
      cellPercent: Math.round((cellCount / MULTI_DB_MAX_CELLS) * 100),
      warning: remaining <= 10 || cellRemaining <= 0,
      error: errMsg
    });
  });

  var stations = Object.keys(map).map(function (k) {
    return { station: map[k].station, dbKey: map[k].dbKey || 'MASTER' };
  }).sort(function (a, b) { return a.station.localeCompare(b.station); });

  return {
    thresholds: { maxSheets: MULTI_DB_MAX_SHEETS, maxCells: MULTI_DB_MAX_CELLS },
    dbs: dbs,
    stations: stations,
    totalStations: stations.length
  };
}

/**
 * Bản cũ (Logger only) — vẫn giữ để chạy nhanh trong Apps Script editor.
 */
function mdb_debugOverview() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] File này ĐÃ DEPRECATED (xem banner
  // đầu file) nhưng hàm này vẫn giữ NGUYÊN tên gốc, không đổi tên như getStationSS()
  // -> _DEPRECATED_MDB_getStationSS() — vẫn gọi thẳng được qua google.script.run mà
  // KHÔNG có kiểm tra quyền nào, có thể ghi SAI LỆCH dữ liệu Station_Map thật (2 file
  // hiểu khác nhau ý nghĩa các cột, xem banner). Khoá admin cấp 1 — không ai khác cần
  // gọi hàm này (đã ngừng dùng trong luồng thật).
  _requireAdmin_(1);
  var overview = mdb_getAdminOverview();
  Logger.log(JSON.stringify(overview, null, 2));
  return overview;
}

/**
 * Migrate thủ công: chuyển 1 trạm đang ở 1 DB sang DB khác (chạy 1 lần, cẩn thận).
 * Di chuyển ĐẦY ĐỦ:
 *   - Sheet Data_/Sup_ (copy nguyên sheet sang đích, xoá ở nguồn)
 *   - 1 dòng Inbound_Lock của trạm (Station Key) — tránh mất counter inbound hôm nay
 *   - Toàn bộ dòng Driver_Daily (62 ngày) của trạm — tránh mất lịch sử Trend tài xế
 * Station_Daily KHÔNG cần di chuyển vì luôn nằm cố định ở MASTER.
 * Cập nhật Station_Map sau khi xong.
 */
function mdb_migrateStation(stationName, targetDbKey) {
  // [SECURITY FIX — rà soát bảo mật toàn diện] File này ĐÃ DEPRECATED (xem banner
  // đầu file) nhưng hàm này vẫn giữ NGUYÊN tên gốc, không đổi tên như getStationSS()
  // -> _DEPRECATED_MDB_getStationSS() — vẫn gọi thẳng được qua google.script.run mà
  // KHÔNG có kiểm tra quyền nào, có thể ghi SAI LỆCH dữ liệu Station_Map thật (2 file
  // hiểu khác nhau ý nghĩa các cột, xem banner). Khoá admin cấp 1 — không ai khác cần
  // gọi hàm này (đã ngừng dùng trong luồng thật).
  _requireAdmin_(1);
  if (!MULTI_DB_LIST[targetDbKey]) throw new Error('DB Key không tồn tại: ' + targetDbKey);
  var safeData = 'Data_' + stationName.replace(/[^a-zA-Z0-9]/g, '_');
  var safeSup  = 'Sup_'  + stationName.replace(/[^a-zA-Z0-9]/g, '_');
  var safeKey  = stationName.trim().replace(/[^a-zA-Z0-9]/g, '_');
  var stNorm   = stationName.trim().toLowerCase();

  var srcSS = _DEPRECATED_MDB_getStationSS(stationName);
  var dstSS = SpreadsheetApp.openById(MULTI_DB_LIST[targetDbKey]);

  // 1) Data_ / Sup_ — copy nguyên sheet
  [safeData, safeSup].forEach(function (sheetName) {
    var srcSheet = srcSS.getSheetByName(sheetName);
    if (!srcSheet) return;
    if (dstSS.getSheetByName(sheetName)) {
      throw new Error('Sheet ' + sheetName + ' đã tồn tại ở DB đích, hãy xử lý thủ công.');
    }
    srcSheet.copyTo(dstSS).setName(sheetName);
    srcSS.deleteSheet(srcSheet);
  });

  // 2) Inbound_Lock — di chuyển đúng 1 dòng của trạm (theo Station Key)
  var srcInbound = srcSS.getSheetByName('Inbound_Lock');
  if (srcInbound && srcInbound.getLastRow() > 1) {
    var ibLastRow = srcInbound.getLastRow();
    var ibCols = srcInbound.getLastColumn();
    var ibValues = srcInbound.getRange(2, 1, ibLastRow - 1, ibCols).getValues();
    var keepIb = [];
    var moveIbRow = null;
    for (var ii = 0; ii < ibValues.length; ii++) {
      if (String(ibValues[ii][0] || '') === safeKey) {
        moveIbRow = ibValues[ii];
      } else {
        keepIb.push(ibValues[ii]);
      }
    }
    if (moveIbRow) {
      // Ghi sang đích (tạo sheet Inbound_Lock đích nếu chưa có — dùng hàm chung _anaInboundSheet)
      var dstInbound = _anaInboundSheet(dstSS);
      dstInbound.appendRow(moveIbRow);
      // Xoá khỏi nguồn: clear + rewrite các dòng còn lại
      srcInbound.getRange(2, 1, ibLastRow - 1, ibCols).clearContent();
      if (keepIb.length > 0) {
        srcInbound.getRange(2, 1, keepIb.length, ibCols).setValues(keepIb);
      }
    }
  }

  // 3) Driver_Daily — di chuyển toàn bộ dòng (mọi ngày trong 62-day window) của trạm
  var srcDriver = srcSS.getSheetByName('Driver_Daily');
  if (srcDriver && srcDriver.getLastRow() > 1) {
    var drLastRow = srcDriver.getLastRow();
    var drCols = srcDriver.getLastColumn();
    var drValues = srcDriver.getRange(2, 1, drLastRow - 1, drCols).getValues();
    var keepDr = [];
    var moveDr = [];
    for (var jj = 0; jj < drValues.length; jj++) {
      var rowStation = String(drValues[jj][1] || '').trim().toLowerCase();
      if (rowStation === stNorm) {
        moveDr.push(drValues[jj]);
      } else {
        keepDr.push(drValues[jj]);
      }
    }
    if (moveDr.length > 0) {
      var dstDriver = _trendDriverSheet(dstSS);
      dstDriver.getRange(dstDriver.getLastRow() + 1, 1, moveDr.length, drCols).setValues(moveDr);
      // Xoá khỏi nguồn
      srcDriver.getRange(2, 1, drLastRow - 1, drCols).clearContent();
      if (keepDr.length > 0) {
        srcDriver.getRange(2, 1, keepDr.length, drCols).setValues(keepDr);
      }
    }
  }

  // 4) Cập nhật Station_Map
  var sheet = _mdb_getStationMapSheet();
  var lastRow = sheet.getLastRow();
  var found = false;
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0] || '').trim().toLowerCase() === stationName.trim().toLowerCase()) {
        sheet.getRange(i + 2, 2, 1, 2).setValues([[targetDbKey, (targetDbKey === 'MASTER') ? '' : MULTI_DB_LIST[targetDbKey]]]);
        found = true;
        break;
      }
    }
  }
  if (!found) {
    sheet.appendRow([stationName, targetDbKey, (targetDbKey === 'MASTER') ? '' : MULTI_DB_LIST[targetDbKey], 'Manual migrate ' + _anaVNNow()]);
  }
  CacheService.getScriptCache().remove('mdb_station_map');
  return { success: true, msg: 'Đã chuyển trạm ' + stationName + ' sang ' + targetDbKey + ' (Data_/Sup_/Inbound_Lock/Driver_Daily)' };
}