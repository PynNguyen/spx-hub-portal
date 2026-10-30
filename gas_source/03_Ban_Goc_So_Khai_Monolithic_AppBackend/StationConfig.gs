/**
 * ============================================================
 * StationConfig.gs — SPX HUB
 *
 * getStationSS(stationName) — hoàn toàn tự động:
 *   1. Tra cache (6 phút) → nếu có ss_id thì mở ngay.
 *   2. Tra Station_Map cột C trong MASTER_DB_ID.
 *   3. Nếu chưa có ss_id → TỰ TẠO file Google Sheet mới,
 *      ghi ID vào Station_Map cột C, xóa cache, trả về SS.
 *
 * Không cần chạy bất kỳ hàm setup nào thủ công.
 * Thêm trạm mới → lần đầu gọi getStationSS() tự lo hết.
 *
 * CẤU TRÚC Station_Map (sheet trong MASTER_DB_ID):
 *   Cột A : Station Key  (đã có)
 *   Cột B : Station Name (đã có)
 *   Cột C : ss_id        ← tự điền khi tạo shard
 * ============================================================
 */

var _SS_MAP_CACHE_KEY = 'station_ss_map_v1';
var _SS_MAP_CACHE_TTL = 360; // giây

// ── ĐỌC MAP TỪ SHEET (có cache) ─────────────────────────────

function _ssMapRead_() {
  try {
    var hit = CacheService.getScriptCache().get(_SS_MAP_CACHE_KEY);
    if (hit) return JSON.parse(hit);
  } catch (e) {}

  var sheet = SpreadsheetApp.openById(MASTER_DB_ID).getSheetByName('Station_Map');
  var map = {};
  if (sheet && sheet.getLastRow() > 1) {
    // [CHUYỂN DỊCH DẦN — KHÔNG xoá dòng nào]
    // Bảng Station_Map hiện có 2 ĐỊNH DẠNG cùng tồn tại, do 2 đoạn code khác
    // nhau ghi vào qua các thời kỳ:
    //   Cũ  (Multi_DB_Router, đã ngừng dùng): A=tên trạm · B='MASTER' · C=ss_id
    //   Mới (_ssCreateShard_ ở dưới)        : A=khoá rút gọn · B=tên trạm · C=ss_id
    //
    // TRƯỚC ĐÂY chỉ đọc cột B làm tên -> với 402 dòng định dạng CŨ, tên luôn ra
    // 'MASTER', nên tất cả sập vào 1 khoá duy nhất. Hệ quả THẬT (đo từ log):
    // danh sách trạm mà hệ thống nhìn thấy gồm ~95% là mục 'MASTER' trùng lặp,
    // khiến 2 job chạy nền lãng phí ~46 phút/ngày (~17% ngân sách runtime).
    // KHÔNG sai dữ liệu (tìm sheet 'Data_MASTER' không có -> bỏ qua), chỉ tốn giờ.
    //
    // NAY đọc ĐƯỢC CẢ 2 ĐỊNH DẠNG, tự nhận diện: cột B là tên trạm thật thì
    // dùng cột B (định dạng mới), ngược lại dùng cột A (định dạng cũ).
    // => Không cần xoá dòng nào, không rủi ro mất đường dẫn tới file trạm;
    //    các trạm CHỈ có ở định dạng cũ nay cũng tra được (trước đây thì không).
    // Khi 1 trạm có ở CẢ HAI định dạng, ưu tiên dòng có ss_id thật; nếu cả hai
    // đều có thì dòng SAU (định dạng mới) thắng, vì đó là dòng đang được ghi.
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach(function(r) {
      var colA = String(r[0] || '').trim();
      var colB = String(r[1] || '').trim();
      var id   = String(r[2] || '').trim();

      // 'MASTER' ở cột B = dấu hiệu định dạng CŨ -> tên trạm nằm ở cột A.
      var isNewFormat = !!(colB && colB.toUpperCase() !== 'MASTER');
      var name = isNewFormat ? colB : colA;
      if (!name) return;
      // Bỏ qua các dòng không phải trạm thật (VD chính chữ 'MASTER', 'ALL',
      // 'test' — có thật trong bảng) để không đẩy rác vào danh sách quét.
      var up = name.toUpperCase();
      if (up === 'MASTER' || up === 'ALL' || up === 'TEST') return;

      var key = name.toLowerCase();
      var prev = map[key];

      // [QUAN TRỌNG — 1 TRẠM CÓ THỂ CÓ 2 DÒNG, TRỎ 2 FILE KHÁC NHAU]
      // Thực tế đã xác minh: trạm '45-DLK Krong Pak 02 Hub' có
      //   · dòng định dạng CŨ  -> file 'SPX Data - MASTER'  (TRỐNG, không dùng)
      //   · dòng định dạng MỚI -> file riêng của trạm       (CÓ dữ liệu thật)
      // Chọn sai file = đọc/ghi vào file trống = coi như mất hết dữ liệu trạm.
      //
      // QUY TẮC CHỌN, theo thứ tự ưu tiên (KHÔNG phụ thuộc thứ tự dòng trong
      // sheet — nếu dựa vào thứ tự thì chỉ cần ai đó sắp xếp lại bảng là hỏng):
      //   1. Dòng định dạng MỚI luôn thắng — đó là dòng _ssCreateShard_ đang
      //      ghi, và là file mà toàn bộ dữ liệu thật đang nằm.
      //   2. Cùng định dạng: dòng có ss_id thắng dòng không có.
      if (prev) {
        if (prev.isNew && !isNewFormat) return;          // đã có dòng mới -> giữ
        if (prev.isNew === isNewFormat && !id) return;   // cùng loại, mục mới thiếu id -> giữ
      }
      map[key] = { name: name, ssId: id, row: null, isNew: isNewFormat };
    });
  }

  try { CacheService.getScriptCache().put(_SS_MAP_CACHE_KEY, JSON.stringify(map), _SS_MAP_CACHE_TTL); } catch (e) {}
  return map;
}

function _ssMapInvalidate_() {
  try { CacheService.getScriptCache().remove(_SS_MAP_CACHE_KEY); } catch (e) {}
}

// ── TẠO SHARD MỚI (lazy, có lock per-station) ────────────────

function _ssCreateShard_(stationName) {
  // [SỬA KHẨN] Lớp chặn thứ 2: không bao giờ tạo file cho tên đặc biệt.
  var _csUp = String(stationName || '').trim().toUpperCase();
  if (!_csUp || _csUp === 'MASTER' || _csUp === 'ALL' || _csUp === 'TEST') {
    throw new Error('Từ chối tạo file cho tên không phải trạm: "' + stationName + '"');
  }
  // Named lock: chống 2 request cùng trạm mới gọi đồng thời → tạo 2 file
  var lockKey = 'shard_create_' + _normStationKey_(stationName);
  if (!_anaAcquireNamedLock(lockKey, 20000)) {
    // Timeout → trả về MASTER làm fallback tạm, không fail hard
    console.warn('[StationConfig] Timeout chờ lock tạo shard "' + stationName + '". Fallback MASTER.');
    return SpreadsheetApp.openById(MASTER_DB_ID);
  }

  try {
    // Double-check: có thể lock vừa giải phóng do người trước vừa tạo xong
    var map = _ssMapRead_();
    var entry = map[stationName.toLowerCase()];
    if (entry && entry.ssId) {
      try { return SpreadsheetApp.openById(entry.ssId); } catch (e) {}
    }

    // Tìm hàng trong Station_Map để ghi ss_id sau khi tạo
    var masterSS = SpreadsheetApp.openById(MASTER_DB_ID);
    var sheet    = masterSS.getSheetByName('Station_Map');

    // Đảm bảo header cột C tồn tại
    if (sheet) {
      var hdrC = String(sheet.getRange(1, 3).getValue() || '').trim();
      if (!hdrC) {
        sheet.getRange(1, 3).setValue('ss_id')
          .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
        sheet.setColumnWidth(3, 340);
      }
    }

    // Tạo file Google Sheet mới, đặt cùng thư mục với MASTER_DB_ID
    var fileName = 'SPX Data - ' + stationName;
    var newSS = SpreadsheetApp.create(fileName);
    var newId = newSS.getId();

    try {
      var masterFile = DriveApp.getFileById(MASTER_DB_ID);
      var parents    = masterFile.getParents();
      if (parents.hasNext()) {
        var folder   = parents.next();
        var newFile  = DriveApp.getFileById(newId);
        folder.addFile(newFile);
        DriveApp.getRootFolder().removeFile(newFile);
      }
    } catch (eDrive) {
      // Không di chuyển được thư mục thì thôi — file vẫn dùng được ở My Drive
      console.warn('[StationConfig] Không di chuyển file shard vào thư mục cha: ' + eDrive.message);
    }

    // Ghi ss_id vào Station_Map cột C
    var written = false;
    if (sheet && sheet.getLastRow() > 1) {
      var nameLower = stationName.toLowerCase();
      var vals = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < vals.length; i++) {
        if (String(vals[i][0] || '').trim().toLowerCase() === nameLower) {
          sheet.getRange(i + 2, 3).setValue(newId);
          written = true;
          break;
        }
      }
    }
    if (!written && sheet) {
      // Trạm chưa có dòng trong Station_Map → thêm dòng mới.
      var stKey = _normStationKey_(stationName);
      sheet.appendRow([stKey, stationName, newId]);
    }

    _ssMapInvalidate_(); // buộc đọc lại lần sau

    console.log('[StationConfig] Đã tạo shard mới: "' + stationName + '" → ' + newId + ' (' + fileName + ')');
    return newSS;

  } catch (e) {
    console.error('[StationConfig] Lỗi tạo shard cho "' + stationName + '": ' + e.message + '. Fallback MASTER.');
    return SpreadsheetApp.openById(MASTER_DB_ID);
  } finally {
    _anaReleaseNamedLock(lockKey);
  }
}

// ── HÀM CHÍNH ────────────────────────────────────────────────

/**
 * getStationSS(stationName)
 * Tra cache → Station_Map → tự tạo nếu chưa có.
 * Luôn trả về SpreadsheetApp hợp lệ, không bao giờ throw.
 */
function getStationSS(stationName) {
  var name = String(stationName || '').trim();
  if (!name) return SpreadsheetApp.openById(MASTER_DB_ID);
  // [SỬA KHẨN — nguyên nhân hàng loạt file "SPX Data - MASTER" ngày 21/9]
  // 'MASTER' / 'ALL' / 'TEST' là giá trị ĐẶC BIỆT, không phải tên trạm. Trước
  // đây chúng tình cờ khớp một khoá trong bảng tra nên vô hại. Khi _ssMapRead_
  // loại các dòng này ra (đúng ra phải loại), mỗi lần có nơi gọi
  // getStationSS('MASTER') lại rơi vào nhánh TẠO FILE MỚI 'SPX Data - MASTER'.
  // Nay trả thẳng về MASTER_DB, KHÔNG BAO GIỜ tạo file cho các tên này.
  var _nmUp = name.toUpperCase();
  if (_nmUp === 'MASTER' || _nmUp === 'ALL' || _nmUp === 'TEST') return SpreadsheetApp.openById(MASTER_DB_ID);

  var map   = _ssMapRead_();
  var entry = map[name.toLowerCase()];

  // [SỬA KHẨN — chặn job nền tự tạo hàng loạt file]
  // Sau khi _ssMapRead_ đọc được CẢ 2 định dạng Station_Map, các job nền duyệt
  // ~400 trạm thật thay vì chuỗi 'MASTER' vô nghĩa như trước. Trạm nào có ss_id
  // cũ không mở được (file mồ côi / đã xoá / không có quyền) sẽ rơi vào nhánh
  // TỰ TẠO FILE MỚI bên dưới — nhân lên hàng trăm trạm, mỗi lượt chạy nền.
  // Báo cáo thời gian ghi nhận 31/77 lượt lỗi ở đúng các job này.
  // Job nền (chạy qua _spxTimedCall_) KHÔNG BAO GIỜ được tạo file: không mở được
  // thì báo lỗi cho riêng trạm đó và bỏ qua. Người dùng thao tác trực tiếp vẫn
  // giữ hành vi cũ (tự tạo file riêng khi trạm dùng lần đầu).
  var _bgNoCreate = (typeof _SPX_BG_NO_SHARD_CREATE !== 'undefined' && _SPX_BG_NO_SHARD_CREATE === true);

  if (entry && entry.ssId) {
    try { return SpreadsheetApp.openById(entry.ssId); } catch (e) {
      if (_bgNoCreate) {
        throw new Error('[Job nền] Không mở được file của trạm "' + name + '" (' + e.message + ') — bỏ qua, không tự tạo file mới.');
      }
      console.warn('[StationConfig] ss_id "' + entry.ssId + '" không mở được (' + e.message +
        '). Thử tạo lại shard cho "' + name + '".');
      return _ssCreateShard_(name);
    }
  }

  if (_bgNoCreate) {
    throw new Error('[Job nền] Trạm "' + name + '" chưa có file riêng — bỏ qua, không tự tạo file mới.');
  }
  return _ssCreateShard_(name);
}

// ── TEST ─────────────────────────────────────────────────────

function testGetStationSS() {
  _ssMapInvalidate_();
  var map  = _ssMapRead_();
  var keys = Object.keys(map);
  var ok = 0, fail = 0, missing = 0;
  keys.forEach(function(k) {
    var entry = map[k];
    if (!entry.ssId) { missing++; Logger.log('⚠️ NO_ID | ' + entry.name); return; }
    try {
      var ss = SpreadsheetApp.openById(entry.ssId);
      Logger.log('✅ OK   | ' + entry.name + ' → ' + entry.ssId + ' (' + ss.getName() + ')');
      ok++;
    } catch (e) {
      Logger.log('❌ FAIL | ' + entry.name + ' → ' + entry.ssId + ' | ' + e.message);
      fail++;
    }
  });
  var msg = 'Kết quả: ' + ok + ' OK, ' + fail + ' FAIL, ' + missing + ' chưa có ss_id / ' + keys.length + ' trạm.';
  Logger.log(msg);
  return msg;
}
/**
 * spx_getAllStationNames()
 * [MỚI — chuyển dịch dần Station_Map, KHÔNG xoá dòng nào]
 * Trả về danh sách TÊN TRẠM THẬT, đã khử trùng lặp và loại các mục không phải
 * trạm ('MASTER', 'ALL', 'test'...).
 *
 * VÌ SAO CẦN: 3 job chạy nền (ana_archiveOldOrdersRunner, trendNightlyPurgeRunner,
 * dghPurgeOldMonthsRunner) đang TỰ đọc thẳng cột B của Station_Map. Với 402
 * dòng định dạng cũ, cột B luôn là 'MASTER' -> danh sách nhận về ~95% là mục
 * trùng lặp vô nghĩa, khiến các job xoay vòng lãng phí ~46 phút/ngày
 * (~17% ngân sách runtime), dù KHÔNG gây sai dữ liệu.
 *
 * Dùng chung _ssMapRead_() — nơi đã biết đọc cả 2 định dạng và có cache sẵn,
 * nên gọi hàm này gần như không tốn thêm gì.
 */
function spx_getAllStationNames() {
  try {
    var map = _ssMapRead_();
    var out = [];
    Object.keys(map).forEach(function (k) {
      var nm = map[k] && map[k].name ? String(map[k].name).trim() : '';
      if (nm) out.push(nm);
    });
    return out.sort();
  } catch (e) {
    return [];
  }
}

/**
 * spx_cleanupJunkMasterShards(dryRun)
 * [MỚI — dọn hàng loạt file rác "SPX Data - MASTER" sinh ra ngày 21/9]
 * CHẠY THỦ CÔNG trong Apps Script Editor.
 *
 * CÁC LỚP AN TOÀN — một file chỉ bị chuyển vào Thùng rác khi thoả TẤT CẢ:
 *   1. Tên CHÍNH XÁC là "SPX Data - MASTER", là Google Sheet, do chính mình sở hữu
 *   2. Tạo từ ngày 21/9/2026 trở đi (file cũ hơn giữ nguyên, kể cả khi cũng rỗng)
 *   3. KHÔNG được dòng nào trong Station_Map trỏ tới, và không phải MASTER_DB
 *   4. Mở ra thấy RỖNG THẬT: không trang tính nào có dữ liệu
 * Chuyển vào THÙNG RÁC (khôi phục được trong 30 ngày), KHÔNG xoá vĩnh viễn.
 *
 * CÁCH DÙNG:
 *   - Chạy spx_cleanupJunkMasterShards()        -> CHỈ ĐẾM, không xoá gì (mặc định)
 *   - Xem kết quả, thấy hợp lý thì chạy spx_cleanupJunkMasterShards_Run()
 *   - Mỗi lượt tối đa ~4 phút; còn file thì chạy lại tới khi báo 0.
 */
function spx_cleanupJunkMasterShards(dryRun) {
  if (dryRun === undefined) dryRun = true;
  _requireAdmin_(1);
  var t0 = Date.now(), BUDGET = 4 * 60 * 1000;
  var CUTOFF = new Date('2026-09-21T00:00:00+07:00');

  // Lớp 3: mọi ss_id đang được Station_Map tham chiếu -> tuyệt đối giữ lại
  var keep = {};
  keep[MASTER_DB_ID] = 1;
  try {
    var sm = SpreadsheetApp.openById(MASTER_DB_ID).getSheetByName('Station_Map');
    if (sm && sm.getLastRow() > 1) {
      sm.getRange(2, 3, sm.getLastRow() - 1, 1).getValues().forEach(function (r) {
        var id = String(r[0] || '').trim(); if (id) keep[id] = 1;
      });
    }
  } catch (e) {
    return 'DỪNG — không đọc được Station_Map để đối chiếu, không dám xoá gì: ' + e.message;
  }

  var me = Session.getEffectiveUser().getEmail();
  var it = DriveApp.searchFiles("title = 'SPX Data - MASTER' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  var stat = { seen: 0, tooOld: 0, referenced: 0, notMine: 0, notEmpty: 0, junk: 0, trashed: 0, errors: 0 };
  var sample = [];

  while (it.hasNext()) {
    if (Date.now() - t0 > BUDGET) { stat.stoppedEarly = true; break; }
    var f = it.next(); stat.seen++;
    try {
      if (f.getName() !== 'SPX Data - MASTER') continue;                         // lớp 1
      try { if (f.getOwner() && f.getOwner().getEmail() !== me) { stat.notMine++; continue; } } catch (eO) {}
      if (f.getDateCreated() < CUTOFF) { stat.tooOld++; continue; }             // lớp 2
      if (keep[f.getId()]) { stat.referenced++; continue; }                      // lớp 3
      var ss = SpreadsheetApp.openById(f.getId());                               // lớp 4
      var sheets = ss.getSheets();
      // Rỗng = MỌI trang đều không có dữ liệu (job nền có thể đã thêm trang trống
      // như Data_MASTER sau khi file được tạo). Chỉ cần 1 ô có dữ liệu là GIỮ LẠI.
      var _hasData = sheets.some(function (s) { return s.getLastRow() > 1 || s.getLastColumn() > 1; });
      if (_hasData || sheets.length > 10) { stat.notEmpty++; continue; }
      stat.junk++;
      if (sample.length < 5) sample.push(f.getId() + ' (tạo ' + f.getDateCreated() + ')');
      if (!dryRun) { f.setTrashed(true); stat.trashed++; }
    } catch (eF) { stat.errors++; }
  }

  var msg = (dryRun ? '[CHẠY THỬ — CHƯA XOÁ GÌ] ' : '[ĐÃ CHUYỂN VÀO THÙNG RÁC] ') +
    'Đã xét ' + stat.seen + ' file | RÁC (rỗng, tạo từ 21/9, không ai dùng): ' + stat.junk +
    (dryRun ? '' : ' | đã chuyển thùng rác: ' + stat.trashed) +
    ' | Giữ lại — cũ hơn 21/9: ' + stat.tooOld + ', đang được Station_Map dùng: ' + stat.referenced +
    ', có dữ liệu: ' + stat.notEmpty + ', không phải của mình: ' + stat.notMine +
    ' | Lỗi: ' + stat.errors +
    (stat.stoppedEarly ? ' | HẾT GIỜ — còn file, hãy chạy lại.' : ' | Đã xét hết.');
  Logger.log(msg);
  if (sample.length) Logger.log('Ví dụ file rác: ' + sample.join(' ; '));
  return msg;
}

/** Chạy thật (chuyển vào Thùng rác). Chỉ chạy SAU KHI đã xem kết quả chạy thử. */
function spx_cleanupJunkMasterShards_Run() {
  return spx_cleanupJunkMasterShards(false);
}