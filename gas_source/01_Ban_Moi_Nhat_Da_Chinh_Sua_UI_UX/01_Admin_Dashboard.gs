// =========================================================================
// spx_translateText(text, targetLang) — NỀN TẢNG En/Vi, PHƯƠNG ÁN DỰ PHÒNG
// =========================================================================
// [MỤC ĐÍCH — theo đúng yêu cầu "cơ sở làm nền, chỗ nào cấu trúc chưa có thì
// dùng GG Translate, nhưng phải đúng logic ngữ nghĩa"] Từ điển tay ở frontend
// (I18N_NAV/I18N_SECTION) đã cover đúng 28 module + 8 nhóm hiện có — hàm này
// CHỈ được gọi khi 1 nhãn tĩnh MỚI xuất hiện mà chưa kịp cập nhật từ điển tay
// (VD: thêm module thứ 29 sau này). Dùng LanguageApp.translate() — dịch vụ
// Google Translate có sẵn trong Apps Script, không cần API key riêng.
// [AN TOÀN] Chỉ dùng cho NHÃN GIAO DIỆN TĨNH — KHÔNG được gọi cho dữ liệu
// thật (tên trạm/tên người/mã đơn...) vì máy dịch có thể biến tên riêng
// thành nghĩa khác hoàn toàn (dịch sai ngữ nghĩa) — việc này được ép ở phía
// frontend (spxTranslateDynamic() chỉ gọi từ spxNavLabel()/spxSectionLabel(),
// không có đường nào khác gọi vào hàm backend này).
// Cache 6 giờ bằng CacheService — tránh gọi lại Google Translate cho cùng 1
// chuỗi nhiều lần (áp lực lên dịch vụ ngoài + độ trễ không cần thiết).
function spx_translateText(text, targetLang) {
  try {
    if (!text || typeof text !== 'string') return '';
    targetLang = targetLang || 'en';
    var cache = CacheService.getScriptCache();
    var cacheKey = 'i18n_' + targetLang + '_' + Utilities.base64Encode(Utilities.newBlob(text).getBytes()).substring(0, 60);
    var cached = cache.get(cacheKey);
    if (cached) return cached;
    // sourceLang='vi' cố định — mọi nhãn gốc trong hệ thống đều là tiếng Việt.
    var translated = LanguageApp.translate(text, 'vi', targetLang);
    if (translated) cache.put(cacheKey, translated, 21600); // 6 giờ
    return translated || text;
  } catch (e) {
    // Lỗi dịch vụ ngoài (quota/mạng...) -> trả nguyên văn, KHÔNG chặn UI,
    // frontend tự hiểu "không có bản dịch" và giữ nguyên tiếng Việt.
    return text;
  }
}

// =====================================================================================
// [MỚI 2026-10-24] TỔNG QUAN CHIA PHẦN — spx_getOverviewPart(part, previewHub, force)
// Executions đo thật: spx_getRoleOverviewData trung vị 61 giây, chỉ ~5% lượt trúng cache, vì gọi TUẦN TỰ 5 hàm
// con. Client nay gọi 5 phần SONG SONG (thời gian chờ = phần chậm nhất, không phải tổng) và vẽ từng thẻ khi có số.
//
// CAM KẾT ĐỘ MỚI (không để số cũ khi đã có số mới) — mỗi phần dùng đúng tín hiệu đổi dữ liệu của nó:
//   · aging     : khoá cache gắn phiên bản bản chụp + mốc sửa file nguồn (Drive lastUpdated, kiểm tối đa 20 giây/lần).
//   · kpifail   : khoá cache gắn phiên bản cache "lite" (được tăng ngay khi dữ liệu KPI đổi) — trước đây chỉ gắn
//                 phiên bản "idx" chỉ tăng khi bấm Làm mới nên có thể giữ số cũ tới hết TTL.
//   · violation : khoá cache gắn mốc sửa file nguồn + cache dữ liệu thô tự bỏ khi file nguồn đổi (tối đa trễ ~60 giây).
//   · rescue / riderplan: KHÔNG cache thêm — luôn tính lại từ nguồn (đơn "đã xử lý" đổi ngay khi người dùng thao tác).
//   · force=true (bấm Làm mới / phát hiện bản dữ liệu mới): bỏ qua cache ĐỌC của phần đó và tính lại từ nguồn.
// Mỗi phần trả generatedAt để giao diện hiện rõ "cập nhật lúc" và không bao giờ ghi đè số mới bằng phản hồi cũ.
// Hàm cũ spx_getRoleOverviewData giữ nguyên (tab cũ chưa tải lại vẫn chạy).
// =====================================================================================
var _SPX_OV_FORCE_ = false;   // true trong lúc spx_getOverviewPart(force) — các hàm tóm tắt bỏ qua cache ĐỌC (mỗi lượt thực thi 1 giá trị riêng)

/** Mốc "file nguồn được sửa lần cuối" (Drive), cache 20 giây để không gọi Drive ở mỗi lượt. Lỗi/không đọc được -> '0' (quay về hành vi theo TTL cũ). */
function _spxSrcStamp_(fileId) {
  if (!fileId) return '0';
  var sc = null, key = 'srcstamp_v1_' + fileId;
  try { sc = CacheService.getScriptCache(); var h = sc.get(key); if (h) return h; } catch (e0) {}
  var v = '0';
  try { v = String(DriveApp.getFileById(fileId).getLastUpdated().getTime()); } catch (e1) { return '0'; }
  try { if (sc) sc.put(key, v, 20); } catch (e2) {}
  return v;
}

/** Phiên bản bản chụp Quá hạn (dùng chung cache 45 giây với aging_getDataVersion). */
function _spxAgingVerTag_() {
  try {
    var sc = CacheService.getScriptCache(), info = null;
    try { var hit = sc.get('aging_dataver_v1'); if (hit) info = JSON.parse(hit); } catch (eC) {}
    if (!info) {
      var m = _kpifail_getMetaMap_(_aging_getSnapshotMetaSheet_(_DS.ss(ADMIN_DB_ID))) || {};
      info = { snapshotVersion: Number(m.snapshot_version) || 0, savedAt: m.snapshot_saved_at || '', sourceVersion: String(m.snapshot_source_version || '').split('|')[0] };
      try { sc.put('aging_dataver_v1', JSON.stringify(info), 45); } catch (eP) {}
    }
    return String(info.snapshotVersion || 0);
  } catch (e) { return '0'; }
}

function _spxOvFail_(part, msg) { return JSON.stringify({ success: false, part: String(part || ''), error: String(msg || 'Lỗi không xác định'), generatedAt: Date.now() }); }

function spx_getOverviewPart(part, previewHub, force) {
  var t0 = Date.now();
  try {
    part = String(part || '');
    var access = getModuleAccess();
    if (!access || access.role === 'denied') return _spxOvFail_(part, 'Không có quyền truy cập.');
    var ph = (previewHub && String(previewHub).trim() && String(previewHub).trim().toUpperCase() !== 'ALL') ? String(previewHub).trim() : null;
    var out = { success: true, part: part, generatedAt: Date.now() };
    _SPX_OV_FORCE_ = !!force;
    var r;
    switch (part) {
      case 'meta':
        out.data = { levelCode: access.levelCode, hubs: access.hubs || [] };
        break;
      case 'aging':
        r = JSON.parse(aging_getIndexSummary('', ph));
        if (!r.success) return _spxOvFail_(part, r.error);
        out.data = { overdueCount: r.overdueCount || 0, closedLostCount: r.closedLostCount || 0, processingCount: r.processingCount || 0,
                     otherFlaggedCount: r.otherFlaggedCount || 0, hubs: r.hubs || [] };
        out.dataVersion = _spxAgingVerTag_(); out.cacheHit = !!r._cacheHit;
        break;
      case 'kpifail':
        r = JSON.parse(kpifail_getIndexSummary('', ph));
        if (!r.success) return _spxOvFail_(part, r.error);
        out.data = { totalFM: r.totalFM || 0, totalLM: r.totalLM || 0, totalSOP: r.totalSOP || 0, totalFail: r.totalFail || 0,
                     trendPct: r.trendPct, riskLevel: r.riskLevel || 'green' };
        try { out.dataVersion = _kpifail_dataVersionString_(); } catch (eV) {}
        break;
      case 'rescue':
        r = JSON.parse(rq_getIndexSummary(ph));
        if (!r.success) return _spxOvFail_(part, r.error);
        out.data = { redCount: r.redCount || 0, totalCount: r.totalCount || 0 };
        break;
      case 'violation':
        r = JSON.parse(vp_getIndexSummary(ph));
        if (!r.success) return _spxOvFail_(part, r.error);
        out.data = { noTicketCount: r.noTicketCount || 0, totalCount: r.totalCount || 0 };
        out.cacheHit = !!r._cacheHit;
        break;
      case 'riderplan':
        r = JSON.parse(rp_getIndexSummary(ph));
        if (!r.success) return _spxOvFail_(part, r.error);
        out.data = { missingCount: r.missingCount || 0, totalCount: r.totalCount || 0, single: r.single || null };
        break;
      default:
        return _spxOvFail_(part, 'Phần không hợp lệ.');
    }
    out.generatedAt = Date.now();
    out.ms = out.generatedAt - t0;
    return JSON.stringify(out);
  } catch (e) {
    return _spxOvFail_(part, e && e.message ? e.message : e);
  } finally {
    _SPX_OV_FORCE_ = false;
  }
}

/**
 * spx_getRoleOverviewData(previewHub)
 * [PERF 2026-10] Executions đo thật: 27 lượt, trung bình 81 giây, tối đa 131 giây — mỗi lượt
 * giữ 1 trong 30 chỗ chạy đồng thời suốt hơn 1 phút. Các hàm con (aging/kpifail/rescue/
 * violation/riderplan) vốn đã có cache + snapshot riêng; lớp này chỉ thêm 1 cache KẾT QUẢ
 * 90 giây theo (email + vai trò + hub + previewHub) để mở lại/F5/đổi tab liên tục KHÔNG phải
 * tính lại cả 5 hàm. Chỉ cache kết quả thành công. Có trường generatedAt để biết số liệu
 * được tính lúc nào. Số liệu gốc từ snapshot nên độ trễ thêm tối đa 90 giây.
 */
function spx_getRoleOverviewData(previewHub) {
  try {
    var access = getModuleAccess();
    if (!access || access.role === 'denied') return _spx_getRoleOverviewDataCore_(previewHub);
    var sig = JSON.stringify([
      String(access.email || ''), access.role, access.level || '', access.levelCode || '',
      (access.hubs || []).map(String).sort(), String(previewHub || '').trim().toUpperCase()
    ]);
    var dg = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig, Utilities.Charset.UTF_8)
      .map(function (b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length < 2 ? '0' + x : x; }).join('');
    var key = 'ov_cache_v1_' + dg;
    var sc = CacheService.getScriptCache();
    try { var hit = sc.get(key); if (hit) return hit; } catch (eH) {}
    var res = _spx_getRoleOverviewDataCore_(previewHub);
    try {
      var okObj = JSON.parse(res);
      if (okObj && okObj.success && res.length < 90000) sc.put(key, res, 90);
    } catch (eP) {}
    return res;
  } catch (e) {
    return _spx_getRoleOverviewDataCore_(previewHub);
  }
}

/**
 * spx_getRoleOverviewData()
 * [FIX 2026-08-16 — Trang thử nghiệm UI mới] Nối số liệu KPI ở trang tổng quan mỗi
 * cấp (Admin/AOM/SUP/Lead) với DỮ LIỆU THẬT đã có sẵn — KHÔNG viết logic tính toán
 * mới, chỉ gọi lại các hàm thật đang chạy production (aging_getIndexSummary(),
 * kpifail_getIndexSummary(), _rp_getAllHubsFromSA()) và gói lại thành 1 lệnh gọi
 * duy nhất cho gọn phía client. Mọi lớp kiểm tra quyền của các hàm gốc vẫn nguyên
 * vẹn — hàm này chỉ gọi hubName RỖNG, để chính các hàm đó tự lọc đúng theo
 * access.hubs của người gọi (đã xác nhận an toàn — xem aging_getIndexSummary()).
 * ROM/Staff: CHƯA có nguồn dữ liệu thật (đã thống nhất bổ sung sau) — không gọi gì
 * thêm cho 2 cấp này, trang thử nghiệm tự hiện cảnh báo "đang xây dựng".
 */
function _spx_getRoleOverviewDataCore_(previewHub) {
  try {
    var access = getModuleAccess();
    if (access.role === 'denied') {
      return JSON.stringify({ success: false, error: 'Không có quyền truy cập.' });
    }

    var out = {
      success: true,
      levelCode: access.levelCode,
      hubs: access.hubs || [],
      totalHubs: null,
      aging: null,
      kpifail: null,
      rescue: null,
      violation: null,
      riderplan: null
    };

    // Tổng số hub — admin: toàn hệ thống; còn lại: đúng số hub được cấp quyền
    try {
      out.totalHubs = (access.role === 'admin') ? _rp_getAllHubsFromSA().length : (access.hubs || []).length;
    } catch (eH) { out.totalHubsError = eH.message; }

    // [FIX — hoàn thành phần backend đã chuẩn bị sẵn từ trước, theo yêu cầu
    // trực tiếp "Tổng quan không đổi theo level, sao biết đúng sai"] Cả 5 hàm
    // con bên dưới đã CÓ SẴN tham số overrideHub (ghi rõ đúng mục đích này
    // trong comment của chính chúng) — chỉ thiếu bước cuối cùng: hàm tổng hợp
    // này chưa từng nhận/truyền previewHub xuống. Giờ đã nối đủ dây.
    var _ph = (previewHub && String(previewHub).trim() && String(previewHub).trim().toUpperCase() !== 'ALL') ? String(previewHub).trim() : null;
    // [CHẨN ĐOÁN — báo cáo: Tổng quan tải rất lâu] Đo thời gian TỪNG phần để
    // biết phần nào chậm thay vì đoán. Trả về trong out._timing (mili-giây).
    var _tm = {}, _tmLast = Date.now(), _tmStart = _tmLast;
    var _tmMark = function (k) { var n = Date.now(); _tm[k] = n - _tmLast; _tmLast = n; };

    // Aging (Quá Hạn) — overdueCount/closedLostCount/processingCount, đã tự lọc theo quyền bên trong
    try {
      var agingRes = JSON.parse(aging_getIndexSummary('', _ph));
      _tmMark('aging'); try { _tm.agingHit = !!(agingRes && agingRes._cacheHit); } catch (eHt) {}
      if (agingRes.success) {
        out.aging = {
          overdueCount: agingRes.overdueCount || 0,
          closedLostCount: agingRes.closedLostCount || 0,
          processingCount: agingRes.processingCount || 0,
          hubs: agingRes.hubs || []
        };
      } else { out.agingError = agingRes.error; }
    } catch (eA) { out.agingError = eA.message; }

    // KPIFail — totalFM/totalLM/totalSOP/totalFail/trendPct/riskLevel, đã tự lọc theo quyền bên trong
    try {
      var kpiRes = JSON.parse(kpifail_getIndexSummary('', _ph));
      _tmMark('kpi');
      if (kpiRes.success) {
        out.kpifail = {
          totalFM: kpiRes.totalFM || 0,
          totalLM: kpiRes.totalLM || 0,
          totalSOP: kpiRes.totalSOP || 0,
          totalFail: kpiRes.totalFail || 0,
          trendPct: kpiRes.trendPct,
          riskLevel: kpiRes.riskLevel || 'green'
        };
      } else { out.kpifailError = kpiRes.error; }
    } catch (eK) { out.kpifailError = eK.message; }

    // [MỚI — theo yêu cầu "Rider Plan/Vi phạm/Đơn cầu cứu cũng phải cần" trong
    // Tổng quan] Đơn cầu cứu — số đơn Đỏ khẩn cấp chưa xử lý, đã tự lọc theo
    // quyền bên trong rq_getIndexSummary().
    try {
      var rqRes = JSON.parse(rq_getIndexSummary(_ph));
      _tmMark('rescue');
      if (rqRes.success) {
        out.rescue = { redCount: rqRes.redCount || 0, totalCount: rqRes.totalCount || 0 };
      } else { out.rescueError = rqRes.error; }
    } catch (eRq) { out.rescueError = eRq.message; }

    // Vi phạm — số vụ chưa gắn ticket, đã tự lọc theo quyền bên trong vp_getIndexSummary().
    try {
      var vpRes = JSON.parse(vp_getIndexSummary(_ph));
      _tmMark('violation'); try { _tm.violationHit = !!(vpRes && vpRes._cacheHit); } catch (eHt) {}
      if (vpRes.success) {
        out.violation = { noTicketCount: vpRes.noTicketCount || 0, totalCount: vpRes.totalCount || 0 };
      } else { out.violationError = vpRes.error; }
    } catch (eVp) { out.violationError = eVp.message; }

    // Rider Plan — số trạm chưa nhập Inbound hôm nay, đã tự lọc theo quyền bên trong rp_getIndexSummary().
    try {
      var rpRes = JSON.parse(rp_getIndexSummary(_ph));
      _tmMark('riderplan');
      if (rpRes.success) {
        out.riderplan = { missingCount: rpRes.missingCount || 0, totalCount: rpRes.totalCount || 0, single: rpRes.single || null };
      } else { out.riderplanError = rpRes.error; }
    } catch (eRp) { out.riderplanError = eRp.message; }

    out.generatedAt = Date.now();
    _tm.total = Date.now() - _tmStart; out._timing = _tm; out._ver = 'OV-2209-D';  // dấu phiên bản — đổi mỗi lần sửa để xác nhận đã deploy
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}
/**
 * spx_checkLuongAccess()
 * Public wrapper — index gọi khi load để cache kết quả quyền lương.
 * Dùng ScriptCache 300s để tránh gọi lại Admin_Access nhiều lần.
 */
function spx_checkLuongAccess() {
  try {
    var sc = CacheService.getScriptCache();
    var email = Session.getActiveUser().getEmail().toLowerCase().trim();
    var cacheKey = 'luong_access_v1_' + email.replace(/[^a-z0-9]/g, '_');
    var cached = sc.get(cacheKey);
    if (cached) return cached; // 'granted' | 'denied' | 'not_found'

    var ss    = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName('Admin_Access');
    if (!sheet) { sc.put(cacheKey, 'denied', 300); return 'denied'; }

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var emailInSheet = data[i][0] ? data[i][0].toString().toLowerCase().trim() : '';
      if (emailInSheet === email) {
        var status = data[i][3] ? data[i][3].toString().trim() : '';
        var result = (status === 'Duyệt') ? 'granted' : 'denied';
        sc.put(cacheKey, result, 300);
        return result;
      }
    }
    sc.put(cacheKey, 'not_found', 300);
    return 'not_found';
  } catch(e) {
    return 'denied';
  }
}


// ============================================================
// ADMIN CACHE UTILITIES — Chạy thủ công từ Apps Script Editor
// ============================================================

/**
 * spx_invalidateLuongCache()
 * Xóa cache quyền lương của tất cả user trong Admin_Access.
 * Chạy sau khi update col D (Duyệt truy cập Lương) trong sheet Admin_Access.
 */
function spx_invalidateLuongCache() {
  // [SECURITY FIX 2026-08] Bump cache quyền Lương toàn hệ thống — trước đây không
  // kiểm tra quyền. Chỉ admin mới được chạy.
  _requireAdmin_(2);
  try {
    var sc = CacheService.getScriptCache();
    var ss = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName('Admin_Access');
    if (!sheet) return JSON.stringify({ success: false, error: 'No Admin_Access sheet' });
    var data = sheet.getDataRange().getValues();
    var keys = [];
    for (var i = 1; i < data.length; i++) {
      var email = data[i][0] ? data[i][0].toString().toLowerCase().trim() : '';
      if (email) keys.push('luong_access_v1_' + email.replace(/[^a-z0-9]/g, '_'));
    }
    if (keys.length) sc.removeAll(keys);
    _LOG.d('[spx_invalidateLuongCache] Cleared ' + keys.length + ' entries');
    return JSON.stringify({ success: true, cleared: keys.length });
  } catch(e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_invalidateAllCache()
 * Xóa toàn bộ ScriptCache liên quan đến phân quyền + data modules.
 * Chạy sau khi:
 *   - Cập nhật sheet SA (thêm/sửa/xóa quyền AOM/SUP/Hub)
 *   - Thêm nhân viên mới vào DS Nhân viên
 *   - Cần force refresh data cho tất cả users
 *
 * Cách chạy: Apps Script Editor → chọn hàm spx_invalidateAllCache → Run
 */
function spx_invalidateAllCache() {
  // [SECURITY FIX 2026-08] Hàm bump version cache TOÀN HỆ THỐNG (buộc mọi user đọc
  // lại từ Sheets, tốn quota) — trước đây không kiểm tra quyền, có thể bị spam gọi
  // để làm chậm hệ thống cho mọi người. Chỉ admin mới được chạy.
  _requireAdmin_(2);
  var sc = CacheService.getScriptCache();
  var report = { cleared: [], errors: [] };

  // ── 1. Access permission cache (mod_access_v2_*) ──
  // ScriptCache không hỗ trợ list-by-prefix → xóa bằng cách bump version
  // Cách hiệu quả: xóa cache của tất cả email trong sheet SA + DS Nhân viên
  try {
    var srcSS = _DS.ss(RP_SOURCE_ID);

    // Đọc tất cả email từ sheet SA
    var saSheet = srcSS.getSheetByName('AOM SUP') || srcSS.getSheetByName('SA');
    var emails = [];
    if (saSheet) {
      var saData = saSheet.getDataRange().getValues();
      for (var i = 1; i < saData.length; i++) {
        var e1 = String(saData[i][3] || '').toLowerCase().trim(); // AOM_Email
        var e2 = String(saData[i][5] || '').toLowerCase().trim(); // Sup_Email
        if (e1 && emails.indexOf(e1) < 0) emails.push(e1);
        if (e2 && emails.indexOf(e2) < 0) emails.push(e2);
      }
    }

    // Đọc email từ DS Nhân viên
    var empSheet = srcSS.getSheetByName('DS Nhân viên');
    if (empSheet) {
      var empData = empSheet.getDataRange().getValues();
      for (var j = 1; j < empData.length; j++) {
        var empEmail = String(empData[j][7] || '').toLowerCase().trim();
        if (empEmail && emails.indexOf(empEmail) < 0) emails.push(empEmail);
      }
    }

    // Xóa cache permission từng email
    var accessKeys = emails.map(function(e) {
      return 'mod_access_v3_' + e.replace(/[^a-z0-9]/g, '_');
    });
    if (accessKeys.length) {
      sc.removeAll(accessKeys);
      report.cleared.push('access_permission: ' + accessKeys.length + ' users');
    }
  } catch(e) {
    report.errors.push('access_permission: ' + e.message);
  }

  // ── 2. Aging data cache (aging_master_v3_*) ──
  // Xóa cache của admin (giữ đúng phạm vi hiện tại — chỉ admin, chưa mở rộng)
  // [FIX 2026-07] aging_getMasterData() đã chuyển sang ghi cache qua CacheMgr (xem hàm
  // đó) — key vật lý đổi từ 'aging_master_v3_admin_meta' sang key có tiền tố 'cm_AGING_'.
  // Nếu không cập nhật ở đây, nút "Refresh System" sẽ xoá nhầm key cũ không còn ai ghi
  // vào, giống hệt bug đã tìm thấy ở _aging_invalidateMasterCache() — dùng CacheMgr.invalidateChunked
  // để luôn đồng bộ đúng key thật, bất kể sau này đổi tiếp cách đặt tên bên trong CacheMgr.
  try {
    CacheMgr.invalidateChunked('AGING', 'master_v3_admin');
    // Bump bằng cách ghi một giá trị sentinel khiến key cũ không match
    sc.put('aging_cache_bust', String(Date.now()), 1);
    report.cleared.push('aging_data: flushed');
  } catch(e) {
    report.errors.push('aging_data: ' + e.message);
  }

  // ── 3. KPI Fail index summary cache ──
  try {
    _kpifail_bumpIdxCacheVersion_();
    _kpifail_invalidateNotesCache_();
    report.cleared.push('kpifail_index: bumped');
  } catch(e) {
    report.errors.push('kpifail_index: ' + e.message);
  }

  // ── 4. Rider Plan forecast cache (nếu có) ──
  try {
    var rpKey = 'rp_forecast_cache';
    sc.remove(rpKey);
    report.cleared.push('rider_plan: cleared');
  } catch(e) {
    report.errors.push('rider_plan: ' + e.message);
  }

  // ── 5. Luong access cache ──
  try {
    var luongRes = JSON.parse(spx_invalidateLuongCache());
    report.cleared.push('luong_access: ' + (luongRes.cleared || 0) + ' users');
  } catch(e) {
    report.errors.push('luong_access: ' + e.message);
  }

  // ── 6. Station Map, Admin & ROM cache ──
  try {
    if (typeof _ssMapInvalidate_ === 'function') _ssMapInvalidate_();
    if (typeof _admin_invalidateCache === 'function') _admin_invalidateCache();
    if (typeof _rom_invalidateCache === 'function') _rom_invalidateCache();
    report.cleared.push('station_map_and_admin_cache: cleared');
  } catch(e) {
    report.errors.push('station_map_and_admin_cache: ' + e.message);
  }

  _LOG.d('[spx_invalidateAllCache] ' + JSON.stringify(report, null, 2));
  return JSON.stringify({ success: true, report: report, ts: new Date().toISOString() });
}

/**
 * spx_invalidatePermissionOnly()
 * Chỉ xóa cache phân quyền — dùng khi chỉ cập nhật sheet SA/DS Nhân viên
 * mà không muốn reset data cache (aging/kpifail sẽ giữ nguyên cache)
 */
function spx_invalidatePermissionOnly() {
  var report = { cleared: [], errors: [] };
  try {
    var sc = CacheService.getScriptCache();
    var srcSS = _DS.ss(RP_SOURCE_ID);

    var saSheet = srcSS.getSheetByName('AOM SUP') || srcSS.getSheetByName('SA');
    var emails = [];
    if (saSheet) {
      var saData = saSheet.getDataRange().getValues();
      for (var i = 1; i < saData.length; i++) {
        var e1 = String(saData[i][3] || '').toLowerCase().trim();
        var e2 = String(saData[i][5] || '').toLowerCase().trim();
        if (e1 && emails.indexOf(e1) < 0) emails.push(e1);
        if (e2 && emails.indexOf(e2) < 0) emails.push(e2);
      }
    }
    var empSheet = srcSS.getSheetByName('DS Nhân viên');
    if (empSheet) {
      var empData = empSheet.getDataRange().getValues();
      for (var j = 1; j < empData.length; j++) {
        var empEmail = String(empData[j][7] || '').toLowerCase().trim();
        if (empEmail && emails.indexOf(empEmail) < 0) emails.push(empEmail);
      }
    }

    // Thêm admin emails (mảng cũ + sheet Admin_Roles 2 cấp)
    (RP_ADMIN_EMAIL || []).forEach(function(e) {
      var em = e.toLowerCase().trim();
      if (em && emails.indexOf(em) < 0) emails.push(em);
    });
    Object.keys(_admin_getAdminMap()).forEach(function(em) {
      if (em && emails.indexOf(em) < 0) emails.push(em);
    });

    var keys = emails.map(function(e) {
      return 'mod_access_v3_' + e.replace(/[^a-z0-9]/g, '_');
    });
    if (keys.length) sc.removeAll(keys);

    report.cleared.push('permission_cache: ' + keys.length + ' users cleared');
    _LOG.d('[spx_invalidatePermissionOnly] ' + JSON.stringify(report));
    return JSON.stringify({ success: true, count: keys.length, report: report });
  } catch(e) {
    _LOG.d('[spx_invalidatePermissionOnly] ERROR: ' + e.message);
    return JSON.stringify({ success: false, error: e.message });
  }
}

// [FIX 2026-08-03] "AGING RAW SNAPSHOT" — chuyển từ ScriptCache (CacheMgr,
// trần cứng ~3.6MB/key) sang lưu trong Sheet kiểu ping-pong (2 slot A/B, y hệt
// pattern đã chứng minh hiệu quả cho KPI Fail persistent snapshot). Log
// Executions xác nhận aging_getMasterData chỉ còn ~5% lượt cache-hit (từ ~95%+
// trước đó) đúng lúc traffic tăng đột biến — code đọc/ghi đã soát kỹ, không có
// bug logic → khả năng cao nhất là dữ liệu Core+Lost+FM giờ đã VƯỢT trần
// 3.6MB của CacheMgr.setChunked(), khiến việc ghi cache ÂM THẦM THẤT BẠI mọi
// lúc (setChunked trả false, không throw) — mỗi lượt tưởng ghi xong nhưng thực
// ra chưa từng lưu được, lượt sau luôn miss. Sheet không có trần 3.6MB này.
var AGING_SNAPSHOT_SHEET      = 'Aging_Snapshot_Data';
var AGING_SNAPSHOT_META_SHEET = 'Aging_Snapshot_Meta';
// [MỚI] Phiên bản CÁCH ĐỌC CỘT của bản chụp. Bản chụp dựng bằng cách đọc cột cũ (theo vị trí
// cố định) chứa dữ liệu SAI (tên trạm = trạng thái đơn...) — đổi chuỗi này để mọi bản chụp
// cũ bị coi là không hợp lệ và dựng lại ngay, không phải chờ hết hạn 3 giờ.
var AGING_SNAPSHOT_SCHEMA = 'lm-header-map-v2';

function _aging_getSnapshotSheet_(ss, slot) {
  var name = AGING_SNAPSHOT_SHEET + '_' + (slot === 'B' ? 'B' : 'A');
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['Key', 'ChunkIndex', 'ChunkData']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  return sheet;
}
function _aging_getSnapshotMetaSheet_(ss) {
  var sheet = ss.getSheetByName(AGING_SNAPSHOT_META_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AGING_SNAPSHOT_META_SHEET);
    sheet.appendRow(['Key', 'Value']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  return sheet;
}

// Đọc bản snapshot đang ACTIVE — trả về {coreData, lostData, fmData} hoặc null
// nếu chưa từng ghi (lần đầu deploy).
function _aging_readRawSnapshot_() {
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    var metaSheet = _aging_getSnapshotMetaSheet_(ss);
    var metaMap = _kpifail_getMetaMap_(metaSheet); // hàm dùng chung, không riêng KPI Fail
    if (!metaMap.snapshot_version) return null;
    // [MỚI] Bản chụp dựng bằng cách đọc cột cũ -> bỏ, dựng lại từ nguồn thật.
    if (metaMap.snapshot_schema !== AGING_SNAPSHOT_SCHEMA) {
      try { _LOG.d('[Aging Snapshot] Bản chụp khác schema (' + (metaMap.snapshot_schema || 'không có') + ') - dựng lại.'); } catch (eSc) {}
      return null;
    }
    // [SỬA LỖI THẬT — "toàn bộ data hiển thị đều là data cũ, sai lệch 100%"]
    // Đo thật trạm 45-DLK Krong Pak 02: màn hình 233 đơn / nguồn 161 đơn, không nhóm
    // tồn nào khớp. Module đọc BẢN CHỤP dựng sẵn, trước đây dùng BẤT KỂ DỰNG TỪ BAO
    // GIỜ -> job dựng lại không chạy thì giao diện phục vụ số cũ vô thời hạn.
    // Nguồn cập nhật mỗi giờ (7:00-18:00): bản chụp quá 3 giờ -> trả null để luồng
    // phía trên dựng lại ngay từ sheet thật.
    var _snapAgeMs = Date.now() - (Number(metaMap.snapshot_version) || 0);
    if (!isFinite(_snapAgeMs) || _snapAgeMs > 3 * 3600 * 1000) {
      try { _LOG.d('[Aging Snapshot] Ban chup cu ' + Math.round(_snapAgeMs / 60000) + ' phut - dung lai tu nguon that.'); } catch (eLg) {}
      return null;
    }
    var activeSlot = metaMap.snapshot_active_slot === 'B' ? 'B' : 'A';
    var dataSheet = _aging_getSnapshotSheet_(ss, activeSlot);
    if (dataSheet.getLastRow() < 2) return null;
    var rows = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 3).getDisplayValues();
    var chunks = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] !== 'snapshot') continue;
      var _cell = rows[i][2] == null ? '' : String(rows[i][2]);
      if (_cell.charAt(0) === AGING_CHUNK_PREFIX) _cell = _cell.slice(1);   // gỡ ký tự mở đầu an toàn
      chunks.push({ idx: Number(rows[i][1]) || 0, data: _cell });
    }
    if (!chunks.length) return null;
    chunks.sort(function(a, b) { return a.idx - b.idx; });
    var json = chunks.map(function(c) { return c.data; }).join('');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// Ghi snapshot mới — kiểu ping-pong: ghi vào slot KHÔNG active, chỉ đổi con trỏ
// sau khi ghi xong hẳn (an toàn nếu bị giết giữa chừng — slot active cũ vẫn nguyên).
/**
 * _aging_getSourceVersion_()
 * [MỚI — tận dụng nhịp cập nhật của nguồn: "Update daily at 7:00-18:00, mỗi tiếng
 * 1 lần"] Mọi dòng trong sheet nguồn đều mang cùng mốc 'report_datetime' — chính là
 * DẤU PHIÊN BẢN của lần cập nhật đó. Đọc ĐÚNG 1 Ô (rất rẻ) là biết nguồn đã đổi hay
 * chưa, thay vì phải đọc 91.000 dòng mới biết. Kèm số dòng để bắt trường hợp nguồn
 * ghi lại cùng mốc nhưng khác dữ liệu.
 */
/**
 * _aging_countSourceOrders_() — SỐ ĐƠN THẬT (dòng có mã đơn) của sheet LM. Dùng cho chốt chặn "nguồn ghi
 * dở": lastRow của sheet không phản ánh khối lượng thật (file export: 91.500 dòng nhưng chỉ 12.419 đơn,
 * còn lại là dòng trống) nên so lastRow gần như không bao giờ phát hiện được ghi dở.
 */
function _aging_countSourceOrders_() {
  var sh = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA').getSheetByName('1. LM high aging');
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < 3) return 0;
  var M = _aging_lmColumnMap_(sh.getRange(2, 1, 1, Math.min(sh.getMaxColumns(), Math.max(sh.getLastColumn(), 18))).getValues()[0]);
  var col = sh.getRange(3, M.ship + 1, last - 2, 1).getValues();
  var n = 0;
  for (var i = 0; i < col.length; i++) { if (col[i][0] !== '' && col[i][0] != null && String(col[i][0]).trim() !== '') n++; }
  return n;
}

function _aging_getSourceVersion_() {
  try {
    var sh = _DS.ss('1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA').getSheetByName('1. LM high aging');
    if (!sh) return '';
    return String(sh.getRange(3, 8).getDisplayValue() || '').trim() + '|' + sh.getLastRow();  // cột H = report_datetime
  } catch (e) { return ''; }
}

function _aging_writeRawSnapshot_(coreData, lostData, fmDataSlim, srcVerStamp) {
  // [SỬA LỖI THẬT — "lỗi cứ lặp lại, phải vào chạy lại lệnh"] Trước đây dấu phiên bản nguồn
  // được đọc NGAY LÚC GHI. Nhưng một chu kỳ dựng (core -> lost -> fm -> finalize) có thể kéo
  // qua nhiều lượt trigger khi 1 giai đoạn lỗi/bị cắt: phần core đã đọc từ TRƯỚC giờ cập nhật
  // nguồn, mà bản chụp lại đóng dấu phiên bản MỚI -> vòng nền tin "đã khớp nguồn" và nghỉ tới
  // 3 giờ trong khi giao diện hiện số cũ. Nay finalize truyền vào phiên bản đã đọc TRƯỚC KHI đọc
  // core; không truyền (đường dựng trực tiếp) thì lấy phiên bản hiện tại như cũ.
  var _stampVer = srcVerStamp ? String(srcVerStamp) : '';
  if (!_stampVer) { try { _stampVer = _aging_getSourceVersion_(); } catch (eSv0) { _stampVer = ''; } }
  var ss = _DS.ss(ADMIN_DB_ID);
  var metaSheet = _aging_getSnapshotMetaSheet_(ss);
  var oldMeta = _kpifail_getMetaMap_(metaSheet);
  var oldActiveSlot = oldMeta.snapshot_active_slot === 'B' ? 'B' : 'A';
  var newSlot = oldActiveSlot === 'A' ? 'B' : 'A';
  var dataSheet = _aging_getSnapshotSheet_(ss, newSlot);

  var json = JSON.stringify({ coreData: coreData, lostData: lostData, fmData: fmDataSlim });
  var chunkSize = 45000;
  var rows = [['Key', 'ChunkIndex', 'ChunkData']];
  var idx = 0;
  for (var pos = 0; pos < json.length; pos += chunkSize) {
    // [SỬA] Cùng lỗi đã làm hỏng dữ liệu 7 ngày ở sheet tạm: ô bắt đầu bằng '=',
    // '+', '-', '@' bị Google Sheets hiểu thành CÔNG THỨC. Bản chụp cũng ghi theo
    // khúc nên mang đúng rủi ro đó — thêm ký tự mở đầu an toàn.
    rows.push(['snapshot', idx++, AGING_CHUNK_PREFIX + json.slice(pos, pos + chunkSize)]);
  }
  dataSheet.clearContents();
  dataSheet.getRange(1, 1, rows.length, 3).setValues(rows);
  dataSheet.getRange(1, 1, 1, 3).setFontWeight('bold');

  var nowIso = Utilities.formatDate(new Date(), SPX_TZ, "yyyy-MM-dd'T'HH:mm:ss");
  _kpifail_setMetaMap_(metaSheet, {
    snapshot_version: String(Date.now()),
    snapshot_saved_at: nowIso,
    snapshot_active_slot: newSlot,
    // [MỚI] Dấu phiên bản NGUỒN mà bản chụp này dựng từ đó.
    snapshot_source_version: _stampVer,
    snapshot_schema: AGING_SNAPSHOT_SCHEMA,
    // Số dòng nguồn tại thời điểm dựng — dùng làm mốc so sánh khối lượng cho lần sau,
    // vì nguồn GHI ĐÈ TOÀN BỘ nên giữa chừng số dòng có thể tụt hẳn.
    snapshot_row_count: String(Number((_stampVer || '|0').split('|')[1]) || 0),
    snapshot_core_count: String(Array.isArray(coreData) ? coreData.length : 0)
  });
}

