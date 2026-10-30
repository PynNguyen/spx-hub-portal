// =========================================================================
// [FIX 2026-08-14] "XÂY THEO GIAI ĐOẠN" — chia _aging_buildRawData_() (đọc 3
// nguồn Core/Lost/FM RỒI MỚI ghi snapshot, TẤT CẢ trong 1 lần chạy) thành 4
// LƯỢT TRIGGER RIÊNG BIỆT (core → lost → fm → finalize), mỗi lượt chỉ đọc ĐÚNG
// 1 nguồn. Lý do: nguồn thật đã xác nhận rất lớn (sheet "Detail orders" của
// FMS Live tương tự có 194.000 dòng — cùng lớp quy mô); dồn cả 3 lần đọc lớn
// vào 1 lần chạy có nguy cơ chạm trần 6 phút/lần — CỨNG, không có ngoại lệ cho
// tài khoản Workspace (mức 30 phút từng có đã bị Google thu hồi, xác nhận qua
// tài liệu 2026).
//
// AN TOÀN QUAN TRỌNG: KHÔNG đụng vào _aging_getCoreDataFromSS/_aging_getLostDataFromSS/
// _aging_getFMDataFromSS (giữ nguyên 100% — đây là các hàm đã qua thực chiến,
// từng có bài học "chia nhỏ theo CỘT bị rollback vì kém tin cậy hơn 1 lệnh đọc
// duy nhất" — không lặp lại rủi ro đó). Chỉ chia theo NGUỒN (mỗi nguồn 1 lệnh
// đọc trọn vẹn, y hệt cũ), KHÔNG chia theo dòng bên trong 1 sheet. Cũng KHÔNG
// đụng _aging_writeRawSnapshot_ (cơ chế ping-pong A/B có sẵn) — chỉ gọi nó Ở
// GIAI ĐOẠN FINALIZE, sau khi đã có đủ cả 3 phần.
//
// KHÔNG thay thế _aging_buildRawData_() — hàm đó vẫn giữ nguyên, vẫn được dùng
// cho đường "build trực tiếp lúc user đang chờ" (khi giành được cold-lock trong
// aging_getMasterData()) — đường đó CẦN trả lời ngay trong 1 lần, không thể
// trải ra nhiều lượt trigger. CHỈ đổi cách aging_prewarmCache() (job NỀN, không
// ai đang chờ) gọi — xem sửa đổi ở aging_prewarmCache() bên dưới.
// =========================================================================
var AGING_BUILD_STAGE_KEY = 'aging_build_stage_v1';

function _aging_stagingSheet_(ss) {
  var sheet = ss.getSheetByName('AgingBuild_Staging');
  if (!sheet) {
    sheet = ss.insertSheet('AgingBuild_Staging');
    sheet.appendRow(['Stage', 'ChunkIndex', 'ChunkData']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  return sheet;
}

/** Ghi kết quả của 1 giai đoạn — CHỈ xoá/ghi lại các dòng của ĐÚNG giai đoạn này, giữ nguyên các giai đoạn khác đã lưu trước đó trong cùng sheet tạm. */
// Ky tu mo dau an toan cho moi khuc du lieu ghi vao o Google Sheets — tranh bi
// hieu nham la cong thuc khi khuc bat dau bang '=', '+', '-', '@'.
var AGING_CHUNK_PREFIX = '~';

function _aging_writeStageResult_(ss, stageName, dataObj) {
  var sheet = _aging_stagingSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var keepRows = [values[0]]; // header
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] !== stageName) keepRows.push(values[i]);
  }
  var json = JSON.stringify(dataObj);
  var chunkSize = 45000;
  var wrote = false;
  // [SỬA LỖI THẬT — chẩn đoán: phần 'core' hỏng, JSON đứt ở vị trí 2.430.009 =
  // ĐÚNG 54 x 45.000 -> khúc số 54 bị biến dạng, giai đoạn finalize lỗi 7 ngày]
  // Nguyên nhân: mỗi khúc được ghi THẲNG vào ô Google Sheets. Sheets tự diễn giải
  // chuỗi mở đầu bằng '=', '+', '-', '@' thành CÔNG THỨC -> nội dung ô khác hẳn
  // chuỗi gốc. JSON bị cắt ở vị trí bất kỳ nên sớm muộn cũng có khúc rơi vào đó.
  // Cách sửa: thêm ký tự mở đầu an toàn (AGING_CHUNK_PREFIX) vào MỌI khúc, và gỡ
  // ra khi đọc. Ô luôn bắt đầu bằng ký tự thường -> Sheets giữ nguyên dạng văn bản.
  for (var pos = 0; pos < json.length; pos += chunkSize) {
    keepRows.push([stageName, Math.floor(pos / chunkSize), AGING_CHUNK_PREFIX + json.slice(pos, pos + chunkSize)]);
    wrote = true;
  }
  if (!wrote) keepRows.push([stageName, 0, AGING_CHUNK_PREFIX + json]); // mảng rỗng ('[]') vẫn cần 1 dòng đánh dấu "đã xong giai đoạn này"
  sheet.clearContents();
  sheet.getRange(1, 1, keepRows.length, 3).setValues(keepRows);
}

/** Đọc lại kết quả của 1 giai đoạn — trả về null nếu giai đoạn đó CHƯA từng ghi xong (khác với ghi xong nhưng rỗng). */
function _aging_readStageResult_(ss, stageName) {
  var sheet = _aging_stagingSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var chunks = [];
  var found = false;
  var maxIdx = -1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === stageName) {
      var idx = Number(values[i][1]);
      var cell = values[i][2] == null ? '' : String(values[i][2]);
      // Gỡ ký tự mở đầu an toàn (khúc ghi bằng bản cũ không có -> vẫn đọc được).
      if (cell.charAt(0) === AGING_CHUNK_PREFIX) cell = cell.slice(1);
      chunks[idx] = cell;
      if (idx > maxIdx) maxIdx = idx;
      found = true;
    }
  }
  if (!found) return null;
  // [SỬA LỖI THẬT] Trước đây dùng chunks.join('') — khúc thiếu bị nối IM LẶNG
  // thành JSON hỏng, và lỗi chỉ lộ ra ở bước cuối dưới dạng "Expected ',' or '}'".
  // Nay: thiếu khúc -> trả null (coi như giai đoạn CHƯA xong) để hệ thống dựng lại
  // từ đầu, thay vì ghi bản chụp hỏng hoặc kẹt vòng lặp.
  for (var k = 0; k <= maxIdx; k++) {
    if (chunks[k] === undefined) {
      _LOG.d('[Aging Stage] Thieu khuc so ' + k + '/' + maxIdx + ' cua giai doan ' + stageName + ' - coi nhu chua xong.');
      return null;
    }
  }
  try {
    return JSON.parse(chunks.join(''));
  } catch (eParse) {
    _LOG.d('[Aging Stage] Du lieu giai doan ' + stageName + ' hong: ' + eParse.message + ' - coi nhu chua xong, se dung lai.');
    return null;
  }
}

/**
 * Job nền chạy XÂY THEO GIAI ĐOẠN — gọi thay cho _aging_buildRawData_() từ
 * aging_prewarmCache(). Mỗi lượt gọi chỉ làm ĐÚNG 1 việc rồi dừng (đọc 1 nguồn,
 * hoặc finalize). Best-effort: lỗi giữa chừng KHÔNG làm nhảy cursor sai (chỉ
 * setProperty sang giai đoạn kế tiếp SAU KHI đã ghi xong giai đoạn hiện tại —
 * xem mô phỏng đã kiểm chứng), lượt trigger sau tự thử lại đúng giai đoạn đang
 * dang dở.
 */
/**
 * spx_diagAgingSnapshot() — CHẠY THỦ CÔNG (chọn hàm rồi bấm Run).
 * [MỚI — báo cáo: "toàn bộ data module Kiểm soát Giao hàng là data cũ"]
 * Module KHÔNG đọc sheet trực tiếp mà đọc BẢN CHỤP dựng sẵn. Hàm này cho biết
 * bản chụp dựng lúc nào, đang ở giai đoạn nào, và VÌ SAO job dựng lại không chạy
 * (cầu dao ngân sách hay khoá chống chạy chồng) — thay vì đoán.
 */
/**
 * spx_diagAgingFinalize() — CHẠY THỦ CÔNG (chọn hàm rồi bấm Run).
 * [MỚI — chẩn đoán: giai đoạn dựng bản chụp kẹt ở 'finalize' 7 ngày]
 * Nhánh finalize trong aging_stagedBuildRunner bọc try/catch chỉ GHI LOG rồi bỏ
 * qua, KHÔNG đổi giai đoạn -> lỗi lặp lại mỗi lượt mà không ai thấy. Hàm này chạy
 * đúng các bước của finalize và TRẢ VỀ câu lỗi thật, kèm kích thước từng phần —
 * để biết lỗi do dữ liệu quá lớn, sheet tạm hỏng, hay nguyên nhân khác.
 */
function spx_diagAgingFinalize() {
  var out = { buoc: [] };
  try {
    var ssStaging = _DS.ss(ADMIN_DB_ID);
    out.buoc.push('Mở Admin DB: OK');
    var core = null, lost = null, fm = null;
    try { core = _aging_readStageResult_(ssStaging, 'core'); out.buoc.push('Đọc phần core: ' + (core === null ? 'NULL (thiếu)' : core.length + ' dòng')); }
    catch (e1) { out.buoc.push('Đọc phần core LỖI: ' + e1.message); }
    try { lost = _aging_readStageResult_(ssStaging, 'lost'); out.buoc.push('Đọc phần lost: ' + (lost === null ? 'NULL (thiếu)' : lost.length + ' dòng')); }
    catch (e2) { out.buoc.push('Đọc phần lost LỖI: ' + e2.message); }
    try { fm = _aging_readStageResult_(ssStaging, 'fm'); out.buoc.push('Đọc phần fm: ' + (fm === null ? 'NULL (thiếu)' : fm.length + ' dòng')); }
    catch (e3) { out.buoc.push('Đọc phần fm LỖI: ' + e3.message); }
    if (core === null || lost === null || fm === null) {
      out.ketLuan = 'Thiếu dữ liệu giai đoạn -> lẽ ra phải reset về core. Chạy spx_rebuildAgingSnapshotNow() để dựng lại từ đầu.';
      Logger.log(JSON.stringify(out, null, 2)); return JSON.stringify(out, null, 2);
    }
    var json = JSON.stringify({ coreData: core, lostData: lost, fmData: fm });
    out.kichThuocBanChup_kyTu = json.length;
    out.soO50kCanDung = Math.ceil(json.length / 45000);
    try {
      _aging_writeRawSnapshot_(core, lost, fm);
      out.buoc.push('GHI BẢN CHỤP: THÀNH CÔNG');
      PropertiesService.getScriptProperties().setProperty(AGING_BUILD_STAGE_KEY, 'core');
      out.ketLuan = 'Đã ghi bản chụp mới thành công — giai đoạn đặt lại về core. Dữ liệu module sẽ đúng ngay.';
    } catch (eW) {
      out.buoc.push('GHI BẢN CHỤP LỖI: ' + eW.message);
      out.loiGoc = eW.message;
      out.ketLuan = 'ĐÂY là lỗi khiến bản chụp kẹt 7 ngày. Xem "loiGoc" để xử lý gốc.';
    }
  } catch (e) { out.loi = e.message; }
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

function spx_diagAgingSnapshot() {
  var out = {};
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    var meta = _kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(ss));
    var ver  = Number(meta.snapshot_version) || 0;
    out.banChup = {
      dungLuc: ver ? Utilities.formatDate(new Date(ver), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss') : '(chưa có)',
      cuBaoNhieuPhut: ver ? Math.round((Date.now() - ver) / 60000) : null,
      oDangDung: meta.snapshot_active_slot || '(?)'
    };
  } catch (e) { out.banChup = { loi: e.message }; }
  try {
    var props = PropertiesService.getScriptProperties();
    out.giaiDoanKeTiep = props.getProperty(AGING_BUILD_STAGE_KEY) || 'core';
  } catch (e) { out.giaiDoanKeTiep = '(?)'; }
  try {
    var b = _spxReadDailyBudget_();
    out.nganSach = {
      daDung_phut: Math.round(b.usedMinutes || 0),
      nguongBoQua_phut: SPX_DAILY_BUDGET_SKIP_THRESHOLD,
      dangChanJob: (b.usedMinutes || 0) >= SPX_DAILY_BUDGET_SKIP_THRESHOLD
    };
  } catch (e) { out.nganSach = { loi: e.message }; }
  try {
    var got = _anaAcquireNamedLock('aging_staged_build_lock_v1', 1000, 600000);
    out.khoaChongChayChong = got ? 'RẢNH (không phải nguyên nhân)' : 'ĐANG BỊ GIỮ — job không chạy được vì chốt này';
    if (got) _anaReleaseNamedLock('aging_staged_build_lock_v1');
  } catch (e) { out.khoaChongChayChong = 'lỗi: ' + e.message; }
  // [SỬA] Xét TUỔI BẢN CHỤP trước: bản chụp còn mới thì mọi thứ đang chạy đúng,
  // không việc gì phải đi xem Executions (dòng kết luận cũ gây hiểu nhầm).
  var _snapMin = (out.banChup && typeof out.banChup.cuBaoNhieuPhut === 'number') ? out.banChup.cuBaoNhieuPhut : null;
  out.ketLuan = (_snapMin !== null && _snapMin <= 180) ? ('Bản chụp mới ' + _snapMin + ' phút trước (CHỈ xét tuổi — muốn biết có khớp nguồn hiện tại không, chạy spx_diagAgingHealth).')
              : (out.nganSach && out.nganSach.dangChanJob) ? 'Cầu dao ngân sách đang chặn job dựng bản chụp.'
              : (String(out.khoaChongChayChong).indexOf('ĐANG BỊ GIỮ') >= 0) ? 'Khoá chống chạy chồng đang giữ — job bị bỏ qua mỗi lượt.'
              : 'Cả 2 chốt đều KHÔNG chặn — cần xem Executions của aging_prewarmCache để biết job dừng ở đâu.';
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

/**
 * spx_diagAgingHealth() — CHẠY THỦ CÔNG ĐÚNG LÚC thấy số cũ/sai (trước khi chạy lệnh dựng lại!).
 * Khác spx_diagAgingSnapshot (chỉ xét TUỔI bản chụp): hàm này so bản chụp với NGUỒN THẬT và đọc
 * thử NỘI DUNG bản chụp đang phục vụ, kèm lý do vòng nền không dựng được (lỗi gần nhất, thời gian
 * chạy, chu kỳ dang dở, cầu dao). Gửi kết quả này để biết chính xác vì sao nó lặp lại.
 */
function spx_diagAgingHealth() {
  var out = { canhBao: [] };
  var warn = function (m) { out.canhBao.push(m); };
  var props = PropertiesService.getScriptProperties();
  var meta = {};
  try { meta = _kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))) || {}; } catch (e) { warn('Không đọc được meta bản chụp: ' + e.message); }
  var ver = Number(meta.snapshot_version) || 0;
  var live = ''; try { live = _aging_getSourceVersion_(); } catch (e2) {}
  var stamped = String(meta.snapshot_source_version || '');
  var ageMin = ver ? Math.round((Date.now() - ver) / 60000) : null;
  out.banChup = {
    dungLuc: ver ? Utilities.formatDate(new Date(ver), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss') : '(chưa có)',
    cuBaoNhieuPhut: ageMin,
    schemaDung: meta.snapshot_schema === AGING_SNAPSHOT_SCHEMA,
    dauNguonDaDong: stamped || '(trống)',
    nguonHienTai: live || '(không đọc được)',
    banTamDungTrucTiep: /^COLD/.test(stamped),
    nguonDaDoiSauKhiDung: !!(live && stamped && !/^COLD/.test(stamped) && live !== stamped)
  };
  var _cw = _spx_getColWarn_(); if (_cw) warn('Cảnh báo cột nguồn: ' + _cw);
  if (out.banChup.banTamDungTrucTiep) warn('Bản chụp TẠM (dựng trực tiếp khi không có bản hợp lệ) — vòng nền sẽ dựng lại đúng quy trình ở lượt kế.');
  if (!ver) warn('Chưa có bản chụp nào.');
  if (ver && !out.banChup.schemaDung) warn('Bản chụp sai schema — sẽ bị bỏ và dựng lại.');
  if (ageMin !== null && ageMin > 180) warn('Bản chụp đã ' + ageMin + ' phút (>180) — người dùng đầu tiên sẽ phải chờ dựng trực tiếp.');
  if (out.banChup.nguonDaDoiSauKhiDung) warn('Nguồn đã đổi sau khi dựng bản chụp — lượt trigger kế tiếp sẽ dựng lại; nếu cứ lặp lại, xem loiGanNhat/thoiGianChay bên dưới.');
  var hasStage = props.getProperty(AGING_BUILD_STAGE_KEY) || 'core';
  out.tienTrinh = {
    giaiDoanKeTiep: hasStage,
    dauNguonLucDocCore: props.getProperty('aging_stage_core_srcver') || '(không có chu kỳ dở)',
    soLanLoiLienTiep: { core: props.getProperty('aging_stage_fail_core') || 0, lost: props.getProperty('aging_stage_fail_lost') || 0, fm: props.getProperty('aging_stage_fail_fm') || 0, finalize: props.getProperty('aging_stage_fail_finalize') || 0 },
    chuoiNguonItDong: props.getProperty('aging_low_rows_streak') || 0
  };
  if (hasStage !== 'core') warn('Chu kỳ dựng đang DANG DỞ ở giai đoạn "' + hasStage + '" — dữ liệu core trong sheet tạm có thể đã cũ.');
  try {
    out.dieuKien = { khungGioVang_23h_5h: _spxIsPrewarmQuietHours_(), cauDaoNganSachDangChan: _spxShouldSkipForBudget_() };
    if (out.dieuKien.cauDaoNganSachDangChan) warn('Cầu dao ngân sách đang chặn job dựng.');
  } catch (e3) {}
  try {
    var errs = JSON.parse(props.getProperty('spx_fn_last_errors') || '{}');
    out.loiGanNhat = { aging_prewarmCache: errs.aging_prewarmCache || [], spxDispatcher10Min: errs.spxDispatcher10Min || [] };
    if ((errs.aging_prewarmCache || []).length) warn('aging_prewarmCache có lỗi gần đây — xem loiGanNhat.');
  } catch (e4) {}
  try {
    var st = JSON.parse(props.getProperty(SPX_DISPATCH_TIMING_KEY) || '{}');
    out.thoiGianChay = {};
    ['aging_prewarmCache', 'aging_lmFullPicPrewarm', 'kpifail_prewarmCache', 'fms_live_prewarmCache', 'spx_usageStats_flushBuffer'].forEach(function (fn) {
      if (st[fn]) out.thoiGianChay[fn] = { lan: st[fn].count, tbGiay: Math.round(st[fn].totalS / st[fn].count), maxGiay: Math.round(st[fn].maxS), lanLoi: st[fn].errCount };
    });
  } catch (e5) {}
  try {
    var snap = _aging_readRawSnapshot_();
    if (!snap) { warn('Bản chụp đang phục vụ KHÔNG hợp lệ (sai schema / quá 3 giờ / rỗng).'); }
    else {
      var arr = Array.isArray(snap.coreData) ? snap.coreData : ((snap.coreData && snap.coreData.data) || []);
      var hubs = {}, hubLike = 0, newestIn = '';
      arr.forEach(function (r) {
        var h = String(r.hubName || ''); hubs[h] = 1;
        if (/hub|soc|station/i.test(h)) hubLike++;
        if (r.inboundAt && String(r.inboundAt) > newestIn) newestIn = String(r.inboundAt);
      });
      out.noiDungBanChup = { soDon: arr.length, soTram: Object.keys(hubs).length, tyLeDongCoTenTram: arr.length ? Math.round(hubLike / arr.length * 100) + '%' : 'n/a',
                             mauTram: Object.keys(hubs).slice(0, 3), ngayVeTramMoiNhat: newestIn || '(không có)' };
      if (arr.length && hubLike / arr.length < 0.5) warn('Nội dung bản chụp có cột trạm KHÔNG giống tên trạm — dữ liệu sai bố cục.');
      if (!arr.length) warn('Bản chụp không có đơn nào.');
    }
  } catch (e6) { warn('Không đọc được nội dung bản chụp: ' + e6.message); }
  out.ketLuan = out.canhBao.length ? 'CÓ ' + out.canhBao.length + ' ĐIỂM CẦN XEM — đọc mục canhBao.' : 'Khớp nguồn, vòng nền không có dấu hiệu bất thường.';
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

/**
 * spx_rebuildAgingSnapshotNow() — CHẠY THỦ CÔNG khi cần dữ liệu đúng NGAY.
 * Chạy liên tiếp các giai đoạn dựng bản chụp, BỎ QUA cầu dao ngân sách, cho tới
 * khi hoàn tất hoặc gần chạm giới hạn 6 phút/lượt của Apps Script. Nếu chưa xong,
 * chạy lại hàm này (nó tiếp tục từ giai đoạn đang dở).
 */
function spx_rebuildAgingSnapshotNow() {
  // [SỬA LỖI THẬT — bản trước của chính hàm này dừng sai] Nó thoát ngay khi giai
  // đoạn quay về 'core', hiểu nhầm là "xong 1 chu kỳ". Thực tế 'core' là lúc BẮT
  // ĐẦU: phát hiện dữ liệu hỏng -> đặt lại về đầu -> thoát mà chưa dựng gì.
  // Nay căn cứ vào SỰ THẬT: bản chụp đã được ghi mới hay chưa (mốc thời gian đổi).
  function _verNow() {
    try { return Number(_kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))).snapshot_version) || 0; }
    catch (e) { return 0; }
  }
  var t0 = Date.now(), verBefore = _verNow(), steps = [], lastStage = '';
  for (var i = 0; i < 12; i++) {
    if (Date.now() - t0 > 4.5 * 60 * 1000) {
      steps.push('DỪNG vì gần hết 6 phút/lượt — CHẠY LẠI hàm này để tiếp tục từ giai đoạn đang dở.');
      break;
    }
    var before = PropertiesService.getScriptProperties().getProperty(AGING_BUILD_STAGE_KEY) || 'core';
    try { aging_stagedBuildRunner(true); }
    catch (eRun) { steps.push('LỖI ở giai đoạn ' + before + ': ' + eRun.message); break; }
    var after = PropertiesService.getScriptProperties().getProperty(AGING_BUILD_STAGE_KEY) || 'core';
    steps.push(before + ' -> ' + after);
    if (_verNow() !== verBefore) { steps.push('✅ ĐÃ GHI BẢN CHỤP MỚI — dữ liệu module đúng ngay từ bây giờ.'); break; }
    // Không tiến triển 2 lượt liên tiếp ở cùng giai đoạn -> dừng, tránh lặp vô ích.
    if (before === after && lastStage === before) { steps.push('Giai đoạn ' + after + ' không tiến triển 2 lượt — dừng. Chạy spx_diagAgingFinalize() để xem lỗi thật.'); break; }
    lastStage = before;
  }
  var res = { cacBuoc: steps, banChupDaDoiMoi: _verNow() !== verBefore, sau: JSON.parse(spx_diagAgingSnapshot()) };
  Logger.log(JSON.stringify(res, null, 2));
  return JSON.stringify(res, null, 2);
}

function aging_stagedBuildRunner(_forceIgnoreBudget) {
  // [SỬA] Cho phép chạy thủ công bỏ qua cầu dao (xem spx_rebuildAgingSnapshotNow).
  if (!_forceIgnoreBudget && _spxShouldSkipForBudget_()) { _LOG.d('[Aging Staged Build] Bỏ qua — ngân sách runtime hôm nay đã cao.'); return; }
  var gotLock = _anaAcquireNamedLock('aging_staged_build_lock_v1', 10000, 600000);
  if (!gotLock) { _LOG.d('[Aging Staged Build] Bỏ qua — lượt trước còn đang chạy.'); return; }
  var _t0 = Date.now();
  try {
    var props = PropertiesService.getScriptProperties();
    var stage = props.getProperty(AGING_BUILD_STAGE_KEY) || 'core';
    var ssStaging = _DS.ss(ADMIN_DB_ID); // cùng chỗ với sheet snapshot ping-pong thật

    if (stage === 'core') {
      var ssCore = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
      // [MỚI] Ghi nhớ phiên bản nguồn TRƯỚC khi đọc: nguồn đổi giữa chừng thì dấu này cũ hơn dữ
      // liệu mới đọc -> vòng nền thấy lệch và dựng lại, thay vì tin nhầm là đã khớp.
      try { props.setProperty('aging_stage_core_srcver', _aging_getSourceVersion_() || ''); } catch (eCv) {}
      var coreRes = JSON.parse(_aging_getCoreDataFromSS(ssCore)); // [KHÔNG ĐỔI] hàm gốc, nguyên vẹn
      if (!coreRes.success) throw new Error('Lỗi đọc Core: ' + coreRes.error);
      _aging_writeStageResult_(ssStaging, 'core', coreRes.data);
      props.setProperty(AGING_BUILD_STAGE_KEY, 'lost');
      _LOG.d('[Aging Staged Build] Giai đoạn CORE xong (' + coreRes.data.length + ' dòng) → tiếp theo: lost');

    } else if (stage === 'lost') {
      var ssLost = _DS.ss('1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE');
      var lostRes = JSON.parse(_aging_getLostDataFromSS(ssLost)); // [KHÔNG ĐỔI]
      if (!lostRes.success) throw new Error('Lỗi đọc Lost: ' + lostRes.error);
      _aging_writeStageResult_(ssStaging, 'lost', lostRes.data);
      props.setProperty(AGING_BUILD_STAGE_KEY, 'fm');
      _LOG.d('[Aging Staged Build] Giai đoạn LOST xong (' + lostRes.data.length + ' dòng) → tiếp theo: fm');

    } else if (stage === 'fm') {
      var ssCoreForFm = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
      var fmRes = JSON.parse(_aging_getFMDataFromSS(ssCoreForFm)); // [KHÔNG ĐỔI]
      if (!fmRes.success) throw new Error('Lỗi đọc FM: ' + fmRes.error);
      // [KHÔNG ĐỔI logic rỗng-hoá — y hệt _aging_buildRawData_() gốc]
      var fmDataSlim = new Array(fmRes.count || 0).fill(0).map(function () { return {}; });
      _aging_writeStageResult_(ssStaging, 'fm', fmDataSlim);
      props.setProperty(AGING_BUILD_STAGE_KEY, 'finalize');
      _LOG.d('[Aging Staged Build] Giai đoạn FM xong (' + fmDataSlim.length + ' dòng) → tiếp theo: finalize');

    } else { // finalize
      var coreData = _aging_readStageResult_(ssStaging, 'core');
      var lostData = _aging_readStageResult_(ssStaging, 'lost');
      var fmDataSlim2 = _aging_readStageResult_(ssStaging, 'fm');
      if (coreData === null || lostData === null || fmDataSlim2 === null) {
        // Thiếu 1 phần (hiếm — VD sheet tạm bị ai đó xoá tay giữa chừng) -> an
        // toàn quay lại từ đầu thay vì ghi snapshot thiếu dữ liệu.
        props.setProperty(AGING_BUILD_STAGE_KEY, 'core');
        throw new Error('Thiếu dữ liệu 1 giai đoạn khi finalize — reset về core, chạy lại từ đầu ở lượt sau.');
      }
      // [SỬA] Đóng dấu bằng phiên bản nguồn LÚC ĐỌC core (xem _aging_writeRawSnapshot_).
      _aging_writeRawSnapshot_(coreData, lostData, fmDataSlim2, props.getProperty('aging_stage_core_srcver') || ''); // cơ chế ping-pong gốc
      // Dọn sheet tạm sau khi đã ghi xong snapshot thật — không giữ lại dữ liệu cũ vô ích
      var stagingSheet = _aging_stagingSheet_(ssStaging);
      stagingSheet.clearContents();
      stagingSheet.appendRow(['Stage', 'ChunkIndex', 'ChunkData']);
      stagingSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
      props.setProperty(AGING_BUILD_STAGE_KEY, 'core'); // reset cho chu kỳ tiếp theo
      try { props.deleteProperty('aging_stage_core_srcver'); } catch (eDv) {}
      try { ['core','lost','fm','finalize'].forEach(function (s) { props.deleteProperty('aging_stage_fail_' + s); }); } catch (eClr) {}
      _LOG.d('[Aging Staged Build] FINALIZE xong — đã ghi snapshot thật (ping-pong), bắt đầu chu kỳ mới từ core.');
    }
  } catch (e) {
    _LOG.d('[Aging Staged Build] LỖI ở giai đoạn hiện tại: ' + e.message + ' — sẽ tự thử lại đúng giai đoạn này ở lượt trigger sau.');
    // [SỬA LỖI THẬT — sự cố ẩn 7 ngày] Trước đây lỗi chỉ được ghi log rồi bỏ qua,
    // GIỮ NGUYÊN giai đoạn -> cùng một lỗi lặp lại mỗi 15 phút suốt nhiều ngày,
    // bản chụp không bao giờ được dựng lại, và KHÔNG AI BIẾT. Đo thật: bản chụp
    // đứng yên từ 16/09, giai đoạn kẹt ở 'finalize'.
    // Nay: đếm số lần lỗi LIÊN TIẾP của cùng giai đoạn. Quá 3 lần -> tự quay lại
    // từ đầu (core) để thoát vòng lặp, và ghi cảnh báo để còn truy được nguyên nhân.
    try {
      var _failKey = 'aging_stage_fail_' + (props.getProperty(AGING_BUILD_STAGE_KEY) || 'core');
      var _n = Number(props.getProperty(_failKey) || 0) + 1;
      props.setProperty(_failKey, String(_n));
      if (_n >= 3) {
        props.setProperty(AGING_BUILD_STAGE_KEY, 'core');
        props.deleteProperty(_failKey);
        _LOG.d('[Aging Staged Build] ⚠️ Giai đoạn lỗi ' + _n + ' lượt liên tiếp — tự quay lại từ đầu (core) để thoát vòng lặp.');
      }
    } catch (eFail) {}
  } finally {
    _anaReleaseNamedLock('aging_staged_build_lock_v1');
    var _elapsedMin = (Date.now() - _t0) / 60000;
    _spxTrackExecMinutes_(_elapsedMin);
    if (_elapsedMin >= 3) {
      _LOG.d('[Aging Staged Build] ⚠️ CẢNH BÁO: 1 giai đoạn đơn lẻ đã chạy ' + _elapsedMin.toFixed(1) +
        ' phút (>50% trần 6 phút) — dữ liệu 1 nguồn đơn lẻ đang lớn tới mức cần cân nhắc chia nhỏ hơn nữa.');
    }
  }
}


// riêng — dùng chung cho cả 2 nhánh của khóa chống chồng lấn trong
// aging_getMasterData() (nhánh giành được khóa, và nhánh hiếm khi phải tự build
// độc lập do chờ khóa quá lâu) — tránh lặp code, đảm bảo cả 2 đường luôn cùng
// logic đọc/ghi.
/**
 * aging_getOrderDetail(shipmentId)
 * [MỚI — theo yêu cầu trực tiếp "kết hợp Quá Hạn + Live, show chi tiết hành
 * trình đơn hàng, mỗi level đúng góc nhìn"] Tra cứu LƯỜI (lazy) — CHỈ chạy khi
 * user click xem chi tiết 1 đơn cụ thể, KHÔNG đụng gì tới đường tải bảng
 * chính _aging_getMasterDataCore_() (giữ nguyên tốc độ hiện tại cho mọi user,
 * tránh lặp lại đúng lỗi hiệu năng "tải hết rồi lọc" đã sửa ở Rider Plan).
 *
 * Vì "Detail orders" (nguồn Live) chỉ giữ đơn CÒN TỒN ĐỌNG tại thời điểm đọc
 * (đã xác nhận qua đối chiếu dữ liệu thật: chỉ ~25% đơn Quá Hạn join được),
 * hàm này trả found:false cho 75% còn lại — KHÔNG giả vờ có dữ liệu không
 * tồn tại, để frontend tự ẩn đúng phần Timeline/Trạng thái hiện tại.
 */
function aging_getOrderDetail(shipmentId) {
  try {
    if (!shipmentId || !String(shipmentId).trim()) {
      return JSON.stringify({ success: false, error: 'Thiếu mã đơn.' });
    }
    var sid = String(shipmentId).trim();

    var ss = _DS.ss(FMS_LIVE_SHEET_ID);
    var sheet = ss.getSheetByName(FMS_LIVE_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) {
      return JSON.stringify({ success: true, found: false });
    }

    // TextFinder — tra cứu hiệu quả (built-in Apps Script search), KHÔNG đọc
    // toàn bộ 144k dòng mỗi lần như _fmsLive_buildRawSnapshot_() (hàm đó phục
    // vụ mục đích khác — build toàn bộ snapshot FMS, không phải tra 1 đơn).
    var match = sheet.createTextFinder(sid).matchEntireCell(true).findNext();
    if (!match) {
      return JSON.stringify({ success: true, found: false });
    }

    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var rowNum = match.getRow();
    var rowVals = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];

    function _val(names) {
      var idx = _fmsLive_findIdxAny_(headers, names);
      return idx === -1 ? null : rowVals[idx];
    }

    var hubName = _val(['station_name', 'Current Station']);

    // [FIX BẢO MẬT — defense-in-depth, cùng nguyên tắc đã áp dụng xuyên suốt
    // hệ thống] Apps Script không có "hàm nội bộ" thật — ai cũng gọi được RPC
    // này qua console với BẤT KỲ shipmentId nào. Dù frontend chỉ cho click vào
    // dòng đã hiện trong bảng (đã lọc đúng quyền/level từ trước), vẫn PHẢI
    // kiểm tra lại ở đây — không tin tưởng phía client.
    var access = getModuleAccess();
    if (access.role === 'denied') {
      return JSON.stringify({ success: false, error: 'Không có quyền truy cập.' });
    }
    if (access.role !== 'admin' && hubName && access.hubs.indexOf(hubName) === -1) {
      return JSON.stringify({ success: false, error: 'Không có quyền xem đơn hàng thuộc hub này.' });
    }

    var rawReason = _val(['last_on_hold_reason_code', 'OnHoldReason']);
    var toIso = function (v) { return (v instanceof Date) ? v.toISOString() : null; };

    return JSON.stringify({
      success: true,
      found: true,
      shipmentId: sid,
      hubName: hubName,
      action: _val(['action']),
      backlogStage: _val(['backlog_stage']),
      reasonLabel: _fmsLive_reasonLabel_(rawReason),
      agingLeadtime: _val(['aging_leadtime']),
      timeline: {
        createdTime: toIso(_val(['created_time'])),
        pickupDone: toIso(_val(['pickup_done'])),
        inboundTime: toIso(_val(['inbound_time'])),
        arrivedTime: toIso(_val(['arrived_time'])),
        lastTouchAt: toIso(_val(['last_touch_at']))
      },
      lastTouchBy: _val(['last_touch_by']),
      codAmount: _val(['cod_amount']),
      deliverAttempt: _val(['deliver_attempt']),
      buyerAddr: {
        state: _val(['buyer_addr_state']),
        city: _val(['buyer_addr_city']),
        district: _val(['buyer_addr_district']),
        ward: _val(['buyer_ward_old'])
      }
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

var AGING_LM_FULLPIC_CACHE_KEY = 'aging_lm_fullpic_v1';
var AGING_LM_FULLPIC_TTL_S = 1200; // 20 phút — cùng bậc TTL đã kiểm chứng ở FMS Live cho cùng nguồn dữ liệu

// Nhóm status_desc theo prefix — an toàn hơn liệt kê hết giá trị cụ thể (có
// thể phát sinh giá trị mới chưa từng thấy), đồng thời giữ NGUYÊN chuỗi gốc
// để hiển thị chi tiết (nhóm chỉ dùng cho đếm tổng hợp).
function _aging_groupStatusDesc_(status) {
  var s = (status || '').toString().trim();
  if (!s) return 'unknown';
  if (s === 'OnHold') return 'onhold';
  if (s === 'Delivering') return 'delivering';
  if (s.indexOf('Return_') === 0) return 'return';
  if (s === 'Missing' || s.indexOf('Exception_') === 0) return 'issue';
  return 'processing'; // LMHub_*, SOC_* — đang trong quy trình xử lý/vận chuyển, chưa tới bước giao
}

/**
 * _aging_buildLmFullPicture_()
 * [TÁCH RA từ aging_getLmFullPicture() cũ — theo đúng bài học FMS Live đã rút
 * ra với CHÍNH nguồn dữ liệu này: sheet "Detail orders" đã tới ~194.000 dòng
 * (comment fms_live_installPrewarmTrigger() xác nhận), khiến "user tự build
 * đồng bộ mỗi lần gọi" (thiết kế cũ của CHÍNH aging_getLmFullPicture(), y hệt
 * thiết kế FMS Live đã TỪ BỎ) gây đúng triệu chứng "build dở dang giữ khoá,
 * mọi request sau đều bị chặn 'thử lại sau'" — xác nhận qua báo cáo trực tiếp
 * "load xong không trả về, báo thử lại nhiều lần". Hàm này CHỈ tính toán
 * thuần, không tự cache/khoá — để dùng chung cho cả trigger nền lẫn
 * forceRefresh thủ công.
 */
/**
 * _aging_getOrgMapCached_()
 * [MỚI — TỐI ƯU, theo yêu cầu trực tiếp "tối ưu nâng cấp GAS, không đánh đổi
 * trải nghiệm/tốc độ"] Đọc sheet "AOM SUP" (mapping Hub->AOM/SUP), cache 1
 * giờ — dữ liệu tổ chức hiếm khi đổi trong ngày, không cần đọc lại mỗi 10
 * phút như trước. Trả về { hubKey: {aom, sup} }.
 */
function _aging_getOrgMapCached_() {
  var cached = CacheMgr.getChunked('AGING', 'org_map_hub_aom_sup_v1');
  if (cached) return cached;
  var map = {};
  var _orgOk = true;
  try {
    var ssPerm = SpreadsheetApp.openById(RESCUE_PERMISSION_SPREADSHEET_ID);
    var aomSupSheet = ssPerm.getSheetByName(SHEET_NAME_AOM_SUP);
    if (aomSupSheet && aomSupSheet.getLastRow() > 1) {
      var permData = aomSupSheet.getDataRange().getValues();
      var permIdx = buildHeaderIndex_(permData[0]);
      var cHub = findCol_(permIdx, ['Hub']);
      var cAom = findCol_(permIdx, ['AOM']);
      var cSupName = findCol_(permIdx, ['Sup_Name', 'Sup Name']);
      if (cHub != null) {
        for (var i = 1; i < permData.length; i++) {
          var hubRaw2 = String(permData[i][cHub] || '').trim();
          if (!hubRaw2) continue;
          var hubKey2 = normStationKey_(hubRaw2);
          map[hubKey2] = {
            aom: (cAom != null) ? String(permData[i][cAom] || '').trim() : '',
            sup: (cSupName != null) ? String(permData[i][cSupName] || '').trim() : ''
          };
        }
      }
    }
  } catch (eOrg) { _orgOk = false; /* không chặn — trả map rỗng/1 phần nếu lỗi giữa chừng, hub vẫn hiển thị, chỉ thiếu aom/sup */ }
  // [SỬA] KHÔNG cache bản đồ rỗng/dở dang do lỗi đọc — trước đây một lần Sheets lỗi thoáng qua làm mất
  // AOM/SUP của mọi trạm suốt 1 giờ. Lỗi/rỗng thì trả tạm, lượt sau đọc lại.
  if (_orgOk && Object.keys(map).length > 0) CacheMgr.setChunked('AGING', 'org_map_hub_aom_sup_v1', map, 3600);
  return map;
}

function _aging_buildLmFullPicture_() {
  // ── Nguồn 1: Live — TOÀN BỘ pipeline LM ──────────────────────────
  var ss = _DS.ss(FMS_LIVE_SHEET_ID);
  var sheet = ss.getSheetByName(FMS_LIVE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    return { success: false, error: 'Không tìm thấy sheet "' + FMS_LIVE_SHEET_NAME + '" hoặc sheet rỗng.' };
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });

  var c = {
    cur: _fmsLive_findIdxAny_(headers, ['station_name', 'Current Station']),
    stage: _fmsLive_findIdxAny_(headers, ['backlog_stage']),
    status: _fmsLive_findIdxAny_(headers, ['status_desc']),
    aging: _fmsLive_findIdxAny_(headers, ['aging_leadtime']),
    // [MỚI — theo yêu cầu trực tiếp "tổng hợp OnHold theo reason code"]
    reason: _fmsLive_findIdxAny_(headers, ['last_on_hold_reason_code', 'OnHoldReason'])
  };
  if (c.cur === -1 || c.stage === -1 || c.status === -1 || c.aging === -1) {
    return { success: false, error: 'Sheet "Detail orders" thiếu cột station_name, backlog_stage, status_desc, hoặc aging_leadtime.' };
  }
  var colIdxs = [c.cur, c.stage, c.status, c.aging];
  if (c.reason !== -1) colIdxs.push(c.reason); // không có cột này vẫn chạy được — chỉ thiếu phần breakdown reason
  var colMin = Math.min.apply(null, colIdxs);
  var colMax = Math.max.apply(null, colIdxs);
  var relC = {};
  Object.keys(c).forEach(function (k) { relC[k] = (c[k] === -1) ? -1 : (c[k] - colMin); });
  var rows = sheet.getRange(2, colMin + 1, lastRow - 1, colMax - colMin + 1).getValues();

  var byHub = {}; // hubKey -> { rawName, statusGroups:{}, agingBuckets:{}, onHoldReasons:{}, liveTotal }
  rows.forEach(function (r) {
    var hubRaw = (r[relC.cur] || '').toString().trim();
    if (!hubRaw) return;
    var stage = (r[relC.stage] || '').toString().trim().toUpperCase();
    if (stage !== 'LM') return; // CHỈ LM — chưa đụng FM theo đúng chỉ đạo

    var hubKey = normStationKey_(hubRaw);
    if (!byHub[hubKey]) byHub[hubKey] = { rawName: hubRaw, statusGroups: {}, agingBuckets: {}, onHoldReasons: {}, liveTotal: 0 };
    var h = byHub[hubKey];

    var group = _aging_groupStatusDesc_(r[relC.status]);
    h.statusGroups[group] = (h.statusGroups[group] || 0) + 1;

    var agingRaw = (r[relC.aging] || '').toString().trim() || '(chưa có mốc)';
    h.agingBuckets[agingRaw] = (h.agingBuckets[agingRaw] || 0) + 1;

    // [MỚI] Chỉ tính lý do cho đơn ĐANG OnHold thật sự — reason code không có
    // ý nghĩa với đơn đang ở trạng thái khác (đang giao/đã giao/đang xử lý).
    if (group === 'onhold' && relC.reason !== -1) {
      var reasonLabel = _fmsLive_reasonLabel_(r[relC.reason]);
      h.onHoldReasons[reasonLabel] = (h.onHoldReasons[reasonLabel] || 0) + 1;
    }

    h.liveTotal++;
  });

  // ── Nguồn 2: mapping tổ chức — sheet "AOM SUP", ĐỘC LẬP với aging cũ ──
  // [TỐI ƯU — theo yêu cầu trực tiếp "tối ưu nâng cấp, không đánh đổi trải
  // nghiệm/tốc độ"] Cache riêng 1 giờ — mapping tổ chức (Hub->AOM/SUP) hiếm
  // khi đổi trong ngày, không cần đọc lại sheet mỗi 10 phút như trước. Không
  // ảnh hưởng gì tới độ tươi dữ liệu vận hành thật (Live/Core/Lost vẫn đúng
  // tần suất 10 phút như cũ) — chỉ riêng bảng tổ chức, đổi rất hiếm, được
  // phép "cũ" tối đa 1 giờ mà không ai nhận ra khác biệt.
  // ── Nguồn 2+3+4 — TÁCH RA HÀM DÙNG CHUNG (xem _aging_mergeOrgCoreLost_) để
  // hàm staged build mới (aging_lmFullPicStagedBuildRunner) tái dùng đúng y
  // hệt logic, không lặp lại code.
  byHub = _aging_mergeOrgCoreLost_(byHub);

  return { success: true, byHub: byHub, generatedAt: new Date().toISOString() };
}

/**
 * _aging_mergeOrgCoreLost_(byHub)
 * [MỚI — tách ra từ _aging_buildLmFullPicture_ để dùng chung với staged
 * build] Gộp mapping tổ chức (Nguồn 2) + backlog cũ/Lost hôm nay (Nguồn 3) +
 * đã chốt Lost (Nguồn 4) vào byHub đã có sẵn dữ liệu Live (Nguồn 1). KHÔNG
 * đổi logic — copy nguyên vẹn từ bản gốc.
 */
function _aging_mergeOrgCoreLost_(byHub) {
  var orgMap = _aging_getOrgMapCached_();
  Object.keys(orgMap).forEach(function (hubKey2) {
    if (byHub[hubKey2]) {
      byHub[hubKey2].aom = orgMap[hubKey2].aom;
      byHub[hubKey2].sup = orgMap[hubKey2].sup;
    }
  });

  // ── Nguồn 3+4 GỘP LẠI — TỐI ƯU HIỆU NĂNG (theo yêu cầu trực tiếp "tối ưu
  // nâng cấp, không đánh đổi trải nghiệm/tốc độ") — tái dùng snapshot ĐÃ CÓ
  // SẴN của aging_getMasterData() (_aging_readRawSnapshot_) thay vì tự đọc lại
  // "1. LM high aging" (~91k dòng) + "Raw" (Lost) từ đầu mỗi 10 phút. Cả 2
  // nguồn này CÙNG được aging_prewarmCache() làm mới đều đặn CÙNG tần suất 10
  // phút với chính hàm này — snapshot luôn đủ mới, KHÔNG hề giảm độ tươi dữ
  // liệu, chỉ loại bỏ 1 lượt quét trùng lặp thật sự không cần thiết mỗi chu
  // kỳ. Giữ NGUYÊN fallback đọc trực tiếp nếu snapshot chưa từng có (lần đầu
  // deploy) hoặc lỗi đọc — không bao giờ để rớt dữ liệu chỉ vì thiếu snapshot.
  var snap = _aging_readRawSnapshot_();
  if (snap && snap.coreData) {
    snap.coreData.forEach(function (r) {
      var hubKey3 = normStationKey_(r.hubName || '');
      if (!hubKey3) return;
      if (!byHub[hubKey3]) byHub[hubKey3] = { rawName: r.hubName, statusGroups: {}, agingBuckets: {}, onHoldReasons: {}, liveTotal: 0 };
      var h3 = byHub[hubKey3];
      if (!h3.coreBacklogTotal) h3.coreBacklogTotal = 0;
      if (!h3.coreLostTodayCount) h3.coreLostTodayCount = 0;
      h3.coreBacklogTotal++;
      if (r.lostToday) h3.coreLostTodayCount++;
    });
    (snap.lostData || []).forEach(function (r) {
      var hubKey4 = normStationKey_(r.hubName || '');
      if (!hubKey4) return;
      if (!byHub[hubKey4]) byHub[hubKey4] = { rawName: r.hubName, statusGroups: {}, agingBuckets: {}, onHoldReasons: {}, liveTotal: 0 };
      var h4 = byHub[hubKey4];
      if (!h4.confirmedLostCount) h4.confirmedLostCount = 0;
      h4.confirmedLostCount++;
    });
  } else {
    // [Fallback — KHÔNG xoá, giữ nguyên cách đọc trực tiếp gốc] Chỉ chạy khi
    // snapshot thật sự chưa từng có hoặc lỗi đọc — đảm bảo không bao giờ mất
    // dữ liệu chỉ vì phụ thuộc snapshot của 1 hàm khác.
    try {
      var ssCore = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
      var coreRes = JSON.parse(_aging_getCoreDataFromSS(ssCore));
      if (coreRes.success && coreRes.data) {
        coreRes.data.forEach(function (r) {
          var hubKey3f = normStationKey_(r.hubName || '');
          if (!hubKey3f) return;
          if (!byHub[hubKey3f]) byHub[hubKey3f] = { rawName: r.hubName, statusGroups: {}, agingBuckets: {}, onHoldReasons: {}, liveTotal: 0 };
          var h3f = byHub[hubKey3f];
          if (!h3f.coreBacklogTotal) h3f.coreBacklogTotal = 0;
          if (!h3f.coreLostTodayCount) h3f.coreLostTodayCount = 0;
          h3f.coreBacklogTotal++;
          if (r.lostToday) h3f.coreLostTodayCount++;
        });
      }
    } catch (eCore) { /* không chặn toàn bộ nếu nguồn cũ tạm lỗi */ }
    try {
      var ssLostF = _DS.ss('1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE');
      var lostRes = JSON.parse(_aging_getLostDataFromSS(ssLostF));
      if (lostRes.success && lostRes.data) {
        lostRes.data.forEach(function (r) {
          var hubKey4f = normStationKey_(r.hubName || '');
          if (!hubKey4f) return;
          if (!byHub[hubKey4f]) byHub[hubKey4f] = { rawName: r.hubName, statusGroups: {}, agingBuckets: {}, onHoldReasons: {}, liveTotal: 0 };
          var h4f = byHub[hubKey4f];
          if (!h4f.confirmedLostCount) h4f.confirmedLostCount = 0;
          h4f.confirmedLostCount++;
        });
      }
    } catch (eLost) { /* không chặn toàn bộ nếu nguồn cũ tạm lỗi */ }
  }
  return byHub;
}

var AGING_LM_BUILD_CHUNK_ROWS = 40000; // giống FMS Live — đã kiểm chứng an toàn trong 6 phút/lần
var AGING_LM_BUILD_CURSOR_KEY = 'aging_lm_build_cursor_v1';
var AGING_LM_STAGING_KEY = 'aging_lm_staging_byhub_v1';

/**
 * aging_lmFullPicPrewarm()
 * [SỬA — xác nhận bằng số liệu ĐO THẬT qua spxGetDispatcherTimingReport():
 * hàm này chiếm ~186.5 phút/ngày — THỦ PHẠM LỚN NHẤT toàn hệ thống — do đọc
 * TOÀN BỘ "Detail orders" (Nguồn 1) trong 1 lần MỖI 10 PHÚT. Trong khi đó
 * fms_live_prewarmCache (đọc CÙNG sheet, số cột tương đương) chỉ tốn ~52.6
 * phút/ngày nhờ kỹ thuật "chia lô" (staged build) đã kiểm chứng ổn định từ
 * trước. Áp dụng lại đúng nguyên tắc đó — đọc theo TỪNG LÔ
 * (AGING_LM_BUILD_CHUNK_ROWS dòng/lượt) thay vì toàn bộ 1 lần, tích luỹ qua
 * nhiều lượt trigger 10 phút liên tiếp, chỉ ghi đè cache thật (đang phục vụ
 * người dùng) khi đã đọc xong hết sheet (isFinalChunk) — cache cũ vẫn còn
 * hiệu lực suốt các lượt đang gộp dở, không có khoảng trống dữ liệu.
 * [QUYẾT ĐỊNH KIẾN TRÚC — đã hỏi ý kiến trực tiếp] Viết RIÊNG cho aging,
 * KHÔNG tái dùng/động vào fmsLive_stagedBuildRunner() (hệ thống đã ổn định,
 * phức tạp, có cơ chế phát hiện "sheet bị thay file giữa chừng" mà aging
 * không cần tới) — đánh đổi: vẫn có 2 lượt quét "Detail orders" độc lập thay
 * vì 1, nhưng an toàn hơn, không rủi ro ảnh hưởng module khác đang chạy tốt.
 * Đơn giản hoá so với bản gốc FMS Live — KHÔNG cần cơ chế phát hiện thay file
 * (aging không yêu cầu độ chính xác tuyệt đối như FMS Live, tần suất cập
 * nhật ~30-50 phút/chu kỳ vẫn đủ mới cho mục đích cảnh báo quản lý).
 * _aging_buildLmFullPicture_() (đọc toàn bộ 1 lần) GIỮ NGUYÊN KHÔNG ĐỔI, vẫn
 * dùng cho forceRefresh=true (user chủ động bấm "Build ngay" — hành động thủ
 * công, hiếm, chấp nhận được vì không lặp lại tự động mỗi 10 phút).
 */
function aging_lmFullPicPrewarm() {
  if (_spxIsPrewarmQuietHours_()) { try { Logger.log('aging_lmFullPicPrewarm — bỏ qua, khung giờ vắng user (23h-5h).'); } catch (e) {} return; }
  if (_spxShouldSkipForBudget_()) { try { Logger.log('aging_lmFullPicPrewarm — bỏ qua, ngân sách runtime hôm nay đã cao.'); } catch (e) {} return; }
  var gotLock = _anaAcquireNamedLock('aging_lm_fullpic_build_lock_v1', 20000, 600000);
  if (!gotLock) { try { Logger.log('aging_lmFullPicPrewarm — bỏ qua, lượt trước hoặc forceRefresh đang giữ khoá.'); } catch (e) {} return; }
  var _t0 = Date.now();
  try {
    var ss = _DS.ss(FMS_LIVE_SHEET_ID);
    var sheet = ss.getSheetByName(FMS_LIVE_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) { try { Logger.log('aging_lmFullPicPrewarm — sheet "Detail orders" trống hoặc không tồn tại.'); } catch (e) {} return; }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var props = PropertiesService.getScriptProperties();
    var cursor = Number(props.getProperty(AGING_LM_BUILD_CURSOR_KEY)) || 0; // 0 = bắt đầu chu kỳ mới

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var c = {
      cur: _fmsLive_findIdxAny_(headers, ['station_name', 'Current Station']),
      stage: _fmsLive_findIdxAny_(headers, ['backlog_stage']),
      status: _fmsLive_findIdxAny_(headers, ['status_desc']),
      aging: _fmsLive_findIdxAny_(headers, ['aging_leadtime']),
      reason: _fmsLive_findIdxAny_(headers, ['last_on_hold_reason_code', 'OnHoldReason'])
    };
    if (c.cur === -1 || c.stage === -1 || c.status === -1 || c.aging === -1) {
      try { Logger.log('aging_lmFullPicPrewarm — sheet thiếu cột bắt buộc, huỷ chu kỳ, reset cursor.'); } catch (e) {}
      props.setProperty(AGING_LM_BUILD_CURSOR_KEY, '0');
      return;
    }
    var colIdxs = [c.cur, c.stage, c.status, c.aging];
    if (c.reason !== -1) colIdxs.push(c.reason);
    var colMin = Math.min.apply(null, colIdxs);
    var colMax = Math.max.apply(null, colIdxs);
    var relC = {};
    Object.keys(c).forEach(function (k) { relC[k] = (c[k] === -1) ? -1 : (c[k] - colMin); });

    var dataStartRow = cursor + 2; // +2: bỏ header (dòng 1), cursor=0 -> dòng dữ liệu đầu tiên là dòng 2
    var rowsToRead = Math.min(AGING_LM_BUILD_CHUNK_ROWS, lastRow - dataStartRow + 1);
    var isFinalChunk = rowsToRead <= 0 || (dataStartRow + rowsToRead - 1) >= lastRow;

    // Đọc lại phần đã tích luỹ từ các lượt trước (nếu đang giữa chu kỳ)
    var byHub = (cursor > 0) ? (CacheMgr.getChunked('AGING', AGING_LM_STAGING_KEY) || {}) : {};

    if (rowsToRead > 0) {
      var rows = sheet.getRange(dataStartRow, colMin + 1, rowsToRead, colMax - colMin + 1).getValues();
      rows.forEach(function (r) { // [KHÔNG ĐỔI logic phân loại — y hệt _aging_buildLmFullPicture_() Nguồn 1]
        var hubRaw = (r[relC.cur] || '').toString().trim();
        if (!hubRaw) return;
        var stage = (r[relC.stage] || '').toString().trim().toUpperCase();
        if (stage !== 'LM') return;

        var hubKey = normStationKey_(hubRaw);
        if (!byHub[hubKey]) byHub[hubKey] = { rawName: hubRaw, statusGroups: {}, agingBuckets: {}, onHoldReasons: {}, liveTotal: 0 };
        var h = byHub[hubKey];

        var group = _aging_groupStatusDesc_(r[relC.status]);
        h.statusGroups[group] = (h.statusGroups[group] || 0) + 1;

        var agingRaw = (r[relC.aging] || '').toString().trim() || '(chưa có mốc)';
        h.agingBuckets[agingRaw] = (h.agingBuckets[agingRaw] || 0) + 1;

        if (group === 'onhold' && relC.reason !== -1) {
          var reasonLabel = _fmsLive_reasonLabel_(r[relC.reason]);
          h.onHoldReasons[reasonLabel] = (h.onHoldReasons[reasonLabel] || 0) + 1;
        }
        h.liveTotal++;
      });
    }

    if (!isFinalChunk) {
      // Còn dở — lưu tạm, tăng cursor, ĐỢI lượt trigger sau tiếp tục (KHÔNG
      // ghi đè cache thật đang phục vụ người dùng — cache cũ vẫn còn hiệu lực).
      CacheMgr.setChunked('AGING', AGING_LM_STAGING_KEY, byHub, 1800); // 30 phút — đủ cho vài lượt 10 phút nối tiếp
      props.setProperty(AGING_LM_BUILD_CURSOR_KEY, String(dataStartRow + rowsToRead - 2));
      try { Logger.log('aging_lmFullPicPrewarm — lô ' + dataStartRow + '-' + (dataStartRow + rowsToRead - 1) + '/' + lastRow + ' xong, tiếp tục lượt sau.'); } catch (e) {}
      return;
    }

    // [Lô CUỐI] — gộp Nguồn 2+3+4 (dùng chung hàm đã tách), ghi cache thật, reset chu kỳ
    byHub = _aging_mergeOrgCoreLost_(byHub);
    var result = { success: true, byHub: byHub, generatedAt: new Date().toISOString() };
    CacheMgr.setChunked('AGING', AGING_LM_FULLPIC_CACHE_KEY, result, AGING_LM_FULLPIC_TTL_S);
    props.setProperty(AGING_LM_BUILD_CURSOR_KEY, '0');
    try { Logger.log('aging_lmFullPicPrewarm — hoàn tất chu kỳ (' + lastRow + ' dòng), đã ghi cache thật.'); } catch (e) {}
  } finally {
    _anaReleaseNamedLock('aging_lm_fullpic_build_lock_v1');
    _spxTrackExecMinutes_((Date.now() - _t0) / 60000);
  }
}

/**
 * aging_resetLmBuildCursor() — CHẠY THỦ CÔNG (Apps Script Editor) nếu nghi
 * ngờ chu kỳ chia lô bị kẹt giữa chừng (VD cột sheet đổi cấu trúc, hoặc dữ
 * liệu tạm bị lỗi) — xoá cursor + dữ liệu đang gộp dở, lượt trigger kế tiếp
 * sẽ tự bắt đầu lại từ đầu. KHÔNG ảnh hưởng cache thật đang phục vụ người
 * dùng (vẫn giữ nguyên tới khi chu kỳ mới hoàn tất).
 */
function aging_resetLmBuildCursor() {
  PropertiesService.getScriptProperties().deleteProperty(AGING_LM_BUILD_CURSOR_KEY);
  CacheMgr.invalidateChunked('AGING', AGING_LM_STAGING_KEY);
  return 'Đã xoá cursor + dữ liệu đang gộp dở — lượt trigger kế tiếp sẽ tự bắt đầu lại từ đầu.';
}

/**
 * aging_installLmFullPicTrigger() — CHẠY THỦ CÔNG 1 LẦN (từ trình soạn thảo
 * Apps Script, chọn hàm này rồi bấm Run) để cài time-driven trigger. Không tự
 * động cài lại — dọn trigger cũ trước khi tạo mới, an toàn khi chạy lại.
 */
function aging_installLmFullPicTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 10-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher10Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher10Min() thay thế.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'aging_lmFullPicPrewarm') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('aging_lmFullPicPrewarm').timeBased().everyMinutes(10).create();
  return 'Đã cài trigger prewarm cache Bức tranh toàn cảnh LM (mỗi 10 phút). Chạy tay aging_lmFullPicPrewarm() 1 lần ngay sau đó để có dữ liệu sớm, không phải chờ tới chu kỳ đầu tiên.';
}

/**
 * aging_getLmFullPicture(forceRefresh)
 * [SỬA DỨT ĐIỂM — xác nhận qua báo cáo trực tiếp "load xong không trả về kết
 * quả, báo thử lại nhiều lần"] TRƯỚC ĐÂY mỗi request không có cache đều tự
 * thử build đồng bộ (dù có khoá) — với sheet ~194.000 dòng, lần build đầu
 * chạy rất lâu, giữ khoá suốt thời gian đó, khiến MỌI request khác (kể cả từ
 * chính user đó bấm lại) đều nhận "đang có tiến trình khác, thử lại sau" liên
 * tục mà không bao giờ thấy kết quả — đúng vòng lặp trong ảnh chụp thực tế.
 * Giờ mặc định CHỈ đọc cache (rất nhanh) — cache do trigger nền lo, không bao
 * giờ để user phải chờ/kẹt trong 1 lần build trực tiếp nữa.
 */
/**
 * _aging_scopeFullPicByAccess_(payload)
 * [BẢO MẬT] aging_getLmFullPicture() trước đây trả về byHub của TOÀN BỘ hub cho
 * mọi user — Lead/Staff 1 trạm vẫn nhận đủ số liệu của cả nghìn trạm khác, lọc
 * chỉ diễn ra ở phía trình duyệt (dễ dàng xem được). Nay lọc NGAY TẠI MÁY CHỦ
 * theo đúng phạm vi quyền thật. Admin/ROM (unrestricted) giữ nguyên toàn bộ nên
 * panel cấp cao KHÔNG bị ảnh hưởng.
 */
function _aging_scopeFullPicByAccess_(payload) {
  try {
    if (!payload || !payload.byHub) return payload;
    var access = getCurrentUserAccess_();
    if (!access || access.unrestricted) return payload;
    var allow = {};
    (access.stations || access.hubs || []).forEach(function (h) {
      var k = normStationKey_(h);
      if (k) allow[k] = 1;
    });
    if (!Object.keys(allow).length) return payload; // không xác định được phạm vi -> giữ nguyên, không tự ý chặn
    var out = {};
    Object.keys(payload.byHub).forEach(function (k) { if (allow[k]) out[k] = payload.byHub[k]; });
    var copy = {};
    Object.keys(payload).forEach(function (k) { copy[k] = payload[k]; });
    copy.byHub = out;
    copy.scopedByAccess = true;
    return copy;
  } catch (e) { return payload; } // lỗi đọc quyền -> giữ nguyên, không làm hỏng module
}

function aging_getLmFullPicture(forceRefresh) {
  try {
    if (!forceRefresh) {
      var cached = CacheMgr.getChunked('AGING', AGING_LM_FULLPIC_CACHE_KEY);
      if (cached) return JSON.stringify(_aging_scopeFullPicByAccess_(cached));
      return JSON.stringify({
        success: false, notReady: true,
        error: 'Dữ liệu đang được cập nhật, vui lòng thử lại sau vài phút. Nếu tình trạng kéo dài, báo quản trị viên hệ thống.'
      });
    }

    // forceRefresh=true — hành động CHỦ ĐỘNG, hiếm khi xảy ra (user bấm nút
    // "Làm mới" tự ý) — vẫn có khoá bảo vệ để không chồng lấn với trigger nền.
    var gotLock = _anaAcquireNamedLock('aging_lm_fullpic_build_lock_v1', 30000, 600000);
    if (!gotLock) {
      var staleCached = CacheMgr.getChunked('AGING', AGING_LM_FULLPIC_CACHE_KEY);
      if (staleCached) return JSON.stringify(_aging_scopeFullPicByAccess_(staleCached));
      return JSON.stringify({ success: false, busy: true, error: 'Đang có tiến trình khác tổng hợp dữ liệu, vui lòng thử lại sau ít giây.' });
    }
    try {
      var result = _aging_buildLmFullPicture_();
      if (result.success) CacheMgr.setChunked('AGING', AGING_LM_FULLPIC_CACHE_KEY, result, AGING_LM_FULLPIC_TTL_S);
      return JSON.stringify(_aging_scopeFullPicByAccess_(result));
    } finally {
      _anaReleaseNamedLock('aging_lm_fullpic_build_lock_v1');
    }
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

function _aging_buildRawData_() {
  var _verBefore = ''; try { _verBefore = _aging_getSourceVersion_(); } catch (eVb) {}
  var ssCore = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA');
  var ssLost = _DS.ss('1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE');

  var coreRes = JSON.parse(_aging_getCoreDataFromSS(ssCore));
  if (!coreRes.success) throw new Error('Lỗi đọc file Aging Core: ' + coreRes.error);

  var lostRes = JSON.parse(_aging_getLostDataFromSS(ssLost));
  if (!lostRes.success) throw new Error('Lỗi đọc file Lost: ' + lostRes.error);

  var fmRes = JSON.parse(_aging_getFMDataFromSS(ssCore));
  if (!fmRes.success) throw new Error('Lỗi đọc file FM: ' + fmRes.error);

  var coreData = coreRes.data;
  var lostData = lostRes.data;
  // [OPT 2026-07] fmData: đã đối chiếu index.html + JS_FMS.html, không nơi nào đọc
  // field cụ thể (shipment_id, station_name, pickup_done, fleet_final_status,
  // pickup_station_name, order_type, leadtime_hour(SUM), timing_day(SUM), cogs(SUM))
  // -- chỉ dùng fmData.length để đếm badge. RUNTIME_CACHE.fmsData thực tế được
  // JS_FMS.html GHI ĐÈ bằng dữ liệu từ file CSV user tự nạp (schema hoàn toàn khác:
  // {shipmentId, processStatus, hubName}) nên field gốc ở đây chưa từng được dùng.
  // Giữ nguyên ĐỘ DÀI mảng (mọi chỗ .length ở FE không đổi hành vi), chỉ rỗng hoá
  // nội dung từng phần tử để giảm băng thông (mỗi dòng ~200+ byte -> ~2 byte).
  var fmDataSlim = new Array(fmRes.count || 0).fill(0).map(function () { return {}; });

  // [FIX 2026-08-03] Lưu RAW (chưa lọc quyền) vào SHEET SNAPSHOT (ping-pong, xem
  // _aging_writeRawSnapshot_) thay vì ScriptCache — CacheMgr.setChunked() có trần
  // cứng ~3.6MB/key, log Executions xác nhận cache-hit rớt gần về 0% đúng lúc
  // traffic tăng đột biến (dữ liệu Core+Lost+FM nhiều khả năng đã vượt trần này,
  // khiến ghi cache âm thầm thất bại mọi lúc — setChunked trả false, không throw).
  // Sheet không có trần 3.6MB — loại bỏ hẳn rủi ro này.
  // [SỬA LỖI THẬT] Đường dựng TRỰC TIẾP (người dùng đầu tiên sau >3 giờ, sai schema...) không có chốt
  // chặn nào của vòng nền (đọc lại sau 8 giây, kiểm khối lượng) mà trước đây vẫn đóng dấu "khớp nguồn" —
  // nguồn đang ghi dở lúc đó sẽ bị đóng băng tới lần đổi kế tiếp. Nay đây chỉ là bản TẠM: dấu 'COLD'
  // không bao giờ khớp nguồn nên vòng nền dựng lại ĐÚNG QUY TRÌNH ở lượt kế (tối đa ~10 phút).
  _aging_writeRawSnapshot_(coreData, lostData, fmDataSlim, 'COLD|' + (Number(String(_verBefore || '|0').split('|')[1]) || 0));

  return { coreData: coreData, lostData: lostData, fmDataSlim: fmDataSlim };
}

// [FIX 2026-07-31] Tách "lõi lấy dữ liệu" (_aging_getMasterDataCore_) khỏi điểm
// vào RPC công khai (aging_getMasterData, ngay dưới) — trước đây tracking nằm
// trong hàm này, nhưng hàm này còn bị gọi NỘI BỘ (không qua RPC thật) từ
// aging_prewarmCache() (trigger nền, chạy tự động) và _aging_findHubById_()
// (mỗi lần lưu note) — khiến Usage_Stats đếm nhầm các lượt trigger/lưu note
// thành "user mở module". Giờ chỉ hàm aging_getMasterData() (bên dưới) mới
// track, còn lõi này không track gì cả — 2 nơi gọi nội bộ đã chuyển sang gọi
// thẳng lõi này để không còn bị đếm nhầm.
function _aging_getMasterDataCore_() {

  // ── LẤY ACCESS ──────────────────────────────────────────────────────────
  var access = getModuleAccess();
  // denied → trả về lỗi rõ ràng thay vì data rỗng gây nhầm lẫn
  if (access.role === 'denied') {
    return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
  }

  // [FIX 2026-07-28] TÁCH cache "dữ liệu thô" (Core+Lost+FM, đọc từ Sheets — tốn
  // 20-350s theo log Executions) ra khỏi cache "theo từng user" cũ. Lý do: trước
  // đây cache key có userKey riêng cho từng người (master_v3_<email>) → (1)
  // aging_prewarmCache() chạy dưới danh nghĩa 1 tài khoản duy nhất (admin) nên
  // CHỈ làm nóng đúng 1 cache — mọi vai trò Hub/SUP/AOM khác (chính là người
  // dùng thật hằng ngày) không bao giờ hưởng được cache làm nóng sẵn, luôn phải
  // đọc cold; (2) aging_saveNote() — hàm được chính code ghi chú là "dùng
  // THƯỜNG XUYÊN NHẤT cả app, mọi trạm mọi ca, liên tục cả ngày" — mỗi lần lưu
  // note lại xoá cache CỦA CHÍNH NGƯỜI ĐÓ, ép họ đọc cold ngay sau đó dù dữ
  // liệu Core/Lost/FM chẳng liên quan gì tới việc lưu note. Cộng dồn 2 lý do
  // trên khiến phần lớn user gần như luôn cache-miss → "Quá Hạn load chậm".
  // Sửa: RAW data (chưa lọc quyền) giờ dùng 1 cache CHUNG duy nhất, ai đọc
  // cũng dùng lại được, phần lọc theo hub của từng user áp lên SAU (rẻ, in-memory).
  // [FIX 2026-08-03] Đọc thẳng snapshot Sheet (luôn có sẵn sau lần build đầu
  // tiên, do aging_prewarmCache làm mới đều đặn mỗi 10 phút) — KHÔNG còn khái
  // niệm "TTL hết hạn" kiểu ScriptCache nữa. User luôn đọc bản ĐÃ CÓ SẴN (nhanh,
  // không rebuild), đúng triết lý đã dùng cho KPI Fail persistent snapshot. Chỉ
  // khi CHƯA TỪNG có snapshot nào (lần đầu deploy) mới cần build đồng bộ 1 lần,
  // có khóa chống nhiều user cùng build lần đầu đó.
  var snap = _aging_readRawSnapshot_();
  var coreData, lostData, fmDataSlim;

  if (snap && snap.coreData) {
    coreData = snap.coreData; lostData = snap.lostData; fmDataSlim = snap.fmData;
  } else {
    var _agGotLock = _anaAcquireNamedLock('aging_masterdata_cold_lock_v1', 90000, 180000);
    if (_agGotLock) {
      try {
        var _agRecheck = _aging_readRawSnapshot_();
        if (_agRecheck && _agRecheck.coreData) {
          coreData = _agRecheck.coreData; lostData = _agRecheck.lostData; fmDataSlim = _agRecheck.fmData;
        } else {
          var _agBuilt = _aging_buildRawData_();
          coreData = _agBuilt.coreData; lostData = _agBuilt.lostData; fmDataSlim = _agBuilt.fmDataSlim;
        }
      } catch (eAgLock) {
        return JSON.stringify({ success: false, error: eAgLock.message, stack: eAgLock.stack || '' });
      } finally {
        _anaReleaseNamedLock('aging_masterdata_cold_lock_v1');
      }
    } else {
      // Không giành được khóa trong 90s (hiếm — nghĩa là lượt đang giữ khóa
      // cũng đang bị chậm bất thường) — vẫn tự build độc lập, thà chậm hơn 1
      // chút còn hơn để user bị treo response vô thời hạn.
      try {
        var _agBuilt2 = _aging_buildRawData_();
        coreData = _agBuilt2.coreData; lostData = _agBuilt2.lostData; fmDataSlim = _agBuilt2.fmDataSlim;
      } catch (eAgNoLock) {
        return JSON.stringify({ success: false, error: eAgNoLock.message, stack: eAgNoLock.stack || '' });
      }
    }
  }

  // ── LỌC THEO QUYỀN (áp lên RAW data, dù lấy từ cache chung hay vừa đọc mới) ──
  try {
    // admin → không lọc gì cả (thấy tất cả)
    // aom/sup/station → chỉ giữ records có hub thuộc access.hubs
    if (access.role !== 'admin' && access.hubs.length > 0) {
      // [FIX] Dùng object làm hash set → tra cứu O(1) mỗi dòng, tổng chi phí O(số
      // dòng), không phụ thuộc số hub được cấp (trước đây indexOf() là O(số hub)
      // mỗi dòng, chậm hẳn với user nhiều trạm).
      var allowedSet = Object.create(null);
      access.hubs.forEach(function(s) { allowedSet[_normStationKey_(s, { pakFix: false, stripSuffix: false })] = true; });

      var filterByHub = function(arr, hubGetter) {
        return arr.filter(function(r) {
          var h = _normStationKey_(hubGetter(r), { pakFix: false, stripSuffix: false });
          return !!h && allowedSet[h] === true;
        });
      };

      // coreData: hub field là r.hubName (từ cột fleet_final_station của sheet LM high aging — dò theo tiêu đề)
      coreData = filterByHub(coreData, function(r) { return r.hubName || r.hub || r.Hub || ''; });
      lostData = filterByHub(lostData, function(r) { return r.hubName || r.hub || r.Hub || ''; });
      // fmDataSlim đã bị rỗng hoá nội dung ở trên nên không còn field hub để lọc
      // theo — giữ nguyên như hành vi cũ (chỉ dùng .length, không lọc theo hub).
    }

    var ssNote = _DS.ss(ADMIN_DB_ID);
    var noteRes = JSON.parse(_aging_getNotesWithCache(ssNote, null));
    if (!noteRes.success) throw new Error('Lỗi hệ thống Note CRM: ' + noteRes.error);

    var result = JSON.stringify({
      success:  true,
      coreData: coreData,
      lostData: lostData,
      fmData:   fmDataSlim,
      notes:    noteRes.notes || {},
      access:   { role: access.role, hubs: access.hubs }, // gửi lên frontend để UI biết role
      // [MỚI — minh bạch độ mới] Cho giao diện biết số liệu này thuộc LẦN CẬP NHẬT
      // NÀO CỦA NGUỒN (nguồn chạy mỗi giờ, 7:00-18:00) và bản chụp dựng lúc nào.
      // Người dùng nhìn là biết đang xem số của lần cập nhật nào, không phải đoán.
      dataInfo: (function () {
        try {
          var _m = _kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))) || {};
          return {
            nguonLuc:  String(_m.snapshot_source_version || '').split('|')[0],
            dungLuc:   _m.snapshot_saved_at || '',
            tuoiPhut:  _m.snapshot_version ? Math.round((Date.now() - Number(_m.snapshot_version)) / 60000) : null,
            // [MỚI] Mốc phiên bản bản chụp — client so với aging_getDataVersion() để biết có bản mới hay chưa
            snapshotVersion: Number(_m.snapshot_version) || 0,
            // [MỚI] Cảnh báo cột nguồn (VD sheet Raw đổi tên cột) — hiện ở thanh trạng thái đồng bộ
            canhBao: _spx_getColWarn_('aging:')
          };
        } catch (eDi) { return null; }
      })()
    });

    return result;

  } catch(e) {
    return JSON.stringify({ success: false, error: e.message, stack: e.stack || '' });
  }
}

/**
 * aging_getDataVersion()
 * [MỚI — "Quá Hạn hiện số liệu cũ nhiều ngày dù nguồn đã đổi"] Frontend giữ dữ liệu
 * trong bộ nhớ và trước đây KHÔNG BAO GIỜ tự hỏi lại máy chủ — chỉ tải lúc mở trang hoặc
 * khi bấm Đồng bộ. Tab mở nhiều ngày thì hiện số của lần tải cuối. Muốn hỏi định kỳ mà
 * không kéo cả payload hàng MB, dùng hàm thăm dò này: chỉ trả mốc phiên bản của bản chụp
 * (1 ô trong sheet meta, cache 45 giây dùng chung) — client so với mốc mình đang giữ,
 * khác mới tải lại. KHÔNG đọc dữ liệu đơn, KHÔNG track usage.
 */
function aging_getDataVersion() {
  try {
    var access = getModuleAccess();
    if (!access || access.role === 'denied') {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
    }
    var sc = CacheService.getScriptCache();
    var info = null;
    try { var hit = sc.get('aging_dataver_v1'); if (hit) info = JSON.parse(hit); } catch (eC) {}
    if (!info) {
      var m = _kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))) || {};
      info = {
        snapshotVersion: Number(m.snapshot_version) || 0,
        savedAt: m.snapshot_saved_at || '',
        sourceVersion: String(m.snapshot_source_version || '').split('|')[0]
      };
      try { sc.put('aging_dataver_v1', JSON.stringify(info), 45); } catch (eP) {}
    }
    return JSON.stringify({
      success: true,
      snapshotVersion: info.snapshotVersion,
      savedAt: info.savedAt,
      sourceVersion: info.sourceVersion,
      ageMin: info.snapshotVersion ? Math.round((Date.now() - info.snapshotVersion) / 60000) : null
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// [FIX 2026-07-31] Điểm vào RPC công khai THẬT — chỉ chỗ này track usage (user
// thật sự mở module qua JS_Quahan.html gọi google.script.run.aging_getMasterData()
// mới tới đây). Mọi lời gọi NỘI BỘ trong code (trigger, note-lookup...) phải gọi
// thẳng _aging_getMasterDataCore_(), không qua wrapper này.
function aging_getMasterData() {
  return _aging_getMasterDataCore_();
}

// ── aging_clearCache() — xóa cache v1 (cũ) + cache raw dùng chung (mới) ──────
// [FIX 2026-07-28] Trước đây xoá cache v3 CỦA RIÊNG user đang gọi (per-user) —
// giờ dữ liệu Core/Lost/FM dùng 1 cache CHUNG (raw_v1, xem aging_getMasterData())
// nên xoá đúng key chung này — ai bấm cũng cho TẤT CẢ mọi user đọc lại dữ liệu
// mới ở lượt kế tiếp, không chỉ riêng người bấm nút.
function aging_clearCache() {
  try {
    var sc = CacheService.getScriptCache();
    // Xóa cache cũ (v1 — global)
    var oldKey = 'aging_master_v1';
    try {
      var oldMeta = sc.get(oldKey + '_meta');
      if (oldMeta) {
        var om = JSON.parse(oldMeta);
        var oldKeys = [oldKey + '_meta'];
        for (var i = 0; i < om.chunks; i++) oldKeys.push(oldKey + '_c' + i);
        sc.removeAll(oldKeys);
      }
    } catch(e1) {}

    // Xóa cache raw dùng chung (mới) — ảnh hưởng TẤT CẢ user, không chỉ người gọi
    CacheMgr.invalidateChunked('AGING', 'raw_v1');
    var access = getModuleAccess();

    // Invalidate access cache của user này
    getModuleAccess_invalidate(access.email);

    return JSON.stringify({ success: true });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

