/**
 * ============================================================
 * FIRESTORE BRIDGE — SPX HUB
 * Cầu nối REST API tới Firestore, dùng để ARCHIVE dữ liệu
 * Station_Daily / Driver_Daily trước khi bị trendNightlyPurgeRunner
 * xoá khỏi Sheet (hiện đang xoá cứng sau 62 ngày, mất vĩnh viễn).
 *
 * KHÔNG cần thư viện ngoài — tự ký JWT bằng Utilities.computeRsaSha256Signature.
 *
 * SETUP THỦ CÔNG (làm 1 lần):
 *   1. Firebase Console > Project Settings > lấy đúng "Project ID" (không phải
 *      tên hiển thị "SPXshopee" trong ảnh — Project ID thường có dạng
 *      "spxshopee-xxxxx", xem ở dưới tên hiển thị).
 *   2. Google Cloud Console (cùng project) > IAM & Admin > Service Accounts
 *      > Create Service Account > gán role "Cloud Datastore User".
 *   3. Tạo key JSON cho service account đó > tải file .json về.
 *   4. Apps Script Editor > Project Settings > Script Properties, thêm 2 property:
 *        FIRESTORE_PROJECT_ID = <project id ở bước 1>
 *        FIRESTORE_SERVICE_ACCOUNT_JSON = <toàn bộ nội dung file .json ở bước 3, dán nguyên>
 *   5. Chạy thử hàm testFirestoreConnection() bên dưới để xác nhận kết nối OK.
 * ============================================================
 */

// [MỚI — "dashboard theo dõi hạn mức Firestore" theo yêu cầu trực tiếp, cho
// Admin] Spark (gói miễn phí) giới hạn CỨNG 50K đọc/20K ghi/20K xoá MỖI NGÀY —
// vượt là Firestore NGỪNG PHỤC VỤ tới hết ngày (giờ UTC), không phải trả phí
// thêm (Spark không gắn thẻ thanh toán). Đếm ở ĐÚNG các hàm gọi Firestore thật
// (dưới đây) — dùng CacheService (rẻ, không tốn hạn mức Firestore để đếm),
// TTL ~25 giờ để dư qua nửa đêm giờ VN. LƯU Ý QUAN TRỌNG cần nói rõ với user:
// đây CHỈ đếm được các lệnh gọi Firestore từ PHÍA APPS SCRIPT (service
// account) — các lượt đọc realtime qua onSnapshot() chạy TRỰC TIẾP từ trình
// duyệt (xem spxInitAnnouncement() ở index.html) KHÔNG đi qua đây, Apps
// Script không nhìn thấy được — dashboard là bức tranh MỘT PHẦN (phần lớn,
// nhưng không phải 100%), không phải số liệu Google báo cáo chính thức.
function _fsQuotaIncr_(kind, n) {
  try {
    var dateKey = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    var cache = CacheService.getScriptCache();
    var key = 'fsq_' + kind + '_' + dateKey;
    var cur = parseInt(cache.get(key) || '0', 10) || 0;
    cache.put(key, String(cur + (n || 1)), 90000); // ~25h
  } catch (e) { /* đếm lỗi không được làm gãy thao tác Firestore thật */ }
}

/**
 * spx_adminGetFirestoreQuota()
 * [Tab "Quản lý Module" → thẻ hạn mức Firestore] Admin cấp 1 xem được — dữ
 * liệu nhạy cảm ở mức "vận hành hệ thống", cùng nhóm với Trạm quản lý/Dọn dẹp
 * hệ thống/Tuỳ chọn nâng cao.
 */
function spx_adminGetFirestoreQuota() {
  try {
    _requireAdmin_(1);
    var dateKey = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    var cache = CacheService.getScriptCache();
    var reads = parseInt(cache.get('fsq_read_' + dateKey) || '0', 10) || 0;
    var writes = parseInt(cache.get('fsq_write_' + dateKey) || '0', 10) || 0;
    var deletes = parseInt(cache.get('fsq_delete_' + dateKey) || '0', 10) || 0;
    return JSON.stringify({
      success: true,
      date: dateKey,
      reads: reads, writesN: writes, deletes: deletes,
      caps: { reads: 50000, writes: 20000, deletes: 20000 }
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

function _fsProjectId_() {
  var id = PropertiesService.getScriptProperties().getProperty('FIRESTORE_PROJECT_ID');
  if (!id) throw new Error('Chưa set Script Property FIRESTORE_PROJECT_ID.');
  return id;
}

function _fsBaseUrl_() {
  return 'https://firestore.googleapis.com/v1/projects/' + _fsProjectId_() + '/databases/(default)/documents';
}

/** Lấy access token, cache 3500s (token thật sống 3600s) để không ký JWT mỗi lần gọi.
 * [FIX 2026-07-21] Thêm tham số forceRefresh — dùng khi 1 request vừa bị Firestore từ
 * chối với 401/403 (token cache đang hỏng/hết hạn sớm/bị thu hồi): nếu không có cách nào
 * bỏ qua cache để lấy token MỚI, mọi lần retry tiếp theo (kể cả cơ chế tự thử lại 3 lần ở
 * _anaSaveInboundState) đều dùng lại ĐÚNG token hỏng đó cho tới khi cache tự hết hạn (tối
 * đa gần 58 phút) — đây là 1 nguồn "chập chờn" kéo dài âm thầm mà retry thường không sửa
 * được, phải chủ động refresh mới khỏi.
 */
function _fsGetAccessToken_(forceRefresh) {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Hàm này trả THẲNG access token
  // thật của Service Account (quyền đọc/ghi TOÀN BỘ Firestore, bỏ qua cả
  // Security Rules lẫn phân quyền theo Sheet của hệ thống) — TRƯỚC ĐÂY không
  // hề kiểm tra người gọi. Gọi trực tiếp qua google.script.run (bất kể có
  // được duyệt hay chưa) là lấy được token này, dùng thẳng với Firestore REST
  // API để đọc/ghi/xoá TOÀN BỘ dữ liệu mọi trạm. Đây là hàm nguy hiểm nhất
  // trong toàn bộ file — chặn tối thiểu bằng _requireApproved_() (nâng từ
  // "ai cũng gọi được" lên "chỉ nhân viên đã duyệt"). LƯU Ý: đây KHÔNG phải
  // vá triệt để 100% — nhân viên đã duyệt vẫn lấy được token và có thể đọc/ghi
  // Firestore vượt phạm vi Sheet của họ; vá triệt để cần thêm Security Rules
  // + giới hạn phạm vi token ở tầng Firestore, ngoài khả năng sửa qua code.
  _requireApproved_();
  return _fsSignAndGetToken_('https://www.googleapis.com/auth/datastore', 'fs_access_token_v1', forceRefresh);
}

/**
 * _fsGetFcmAccessToken_()
 * [MỚI — "FCM foreground" theo yêu cầu trực tiếp] Cùng service account, khác
 * SCOPE (Cloud Messaging thay vì Datastore) — dùng để gọi FCM v1 API gửi
 * thông báo đẩy. Tự khoá admin cấp 1 bên trong (xem lý do trong hàm) — không
 * dựa vào nơi gọi đã kiểm tra hộ.
 */
function _fsGetFcmAccessToken_(forceRefresh) {
  // [SECURITY FIX — tự rà lại ngay khi viết, tránh lặp lại đúng lỗi vừa vá ở
  // _fsGetAccessToken_] Suýt để hàm này KHÔNG có kiểm tra gì (nghĩ nhầm là
  // "chỉ gọi từ hàm admin nên không cần") — nhưng đây VẪN là hàm top-level,
  // gọi thẳng được qua google.script.run bất kể ai gọi từ đâu. Không chặn sẽ
  // lộ token gửi FCM, dùng để gửi thông báo đẩy giả danh hệ thống tới toàn bộ
  // user đã đăng ký. Khoá admin cấp 1 — khớp đúng mức đã áp dụng cho
  // spx_adminSetBanner (nơi hàm này thực sự được gọi).
  _requireAdmin_(1);
  return _fsSignAndGetToken_('https://www.googleapis.com/auth/firebase.messaging', 'fs_fcm_token_v1', forceRefresh);
}

/**
 * _fsSignAndGetToken_(scope, cacheKey, forceRefresh)
 * [DỌN TRÙNG LẶP — theo tôn chỉ "không phình code, cái nào ghép được thì lồng
 * vào nhau"] Lõi ký JWT + đổi lấy access token dùng CHUNG cho cả Firestore
 * (Datastore scope) lẫn FCM (Messaging scope) — chỉ khác scope/cacheKey.
 */
function _fsSignAndGetToken_(scope, cacheKey, forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var cached = cache.get(cacheKey);
    if (cached) return cached;
  } else {
    try { cache.remove(cacheKey); } catch (eRm) {}
  }

  var raw = PropertiesService.getScriptProperties().getProperty('FIRESTORE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('Chưa set Script Property FIRESTORE_SERVICE_ACCOUNT_JSON.');
  var svc = JSON.parse(raw);

  var now = Math.floor(Date.now() / 1000);
  var header   = { alg: 'RS256', typ: 'JWT' };
  var claimSet = {
    iss:   svc.client_email,
    scope: scope,
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now
  };
  var toSign = Utilities.base64EncodeWebSafe(JSON.stringify(header)) + '.' +
               Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
  var sigBytes = Utilities.computeRsaSha256Signature(toSign, svc.private_key);
  var jwt = toSign + '.' + Utilities.base64EncodeWebSafe(sigBytes);

  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });
  var data = JSON.parse(resp.getContentText());
  if (!data.access_token) throw new Error('OAuth lỗi (' + scope + '): ' + resp.getContentText());

  cache.put(cacheKey, data.access_token, 3500);
  return data.access_token;
}

// ── ENCODE / DECODE giá trị theo định dạng REST của Firestore ──────────────
// [2026-07] Thêm hỗ trợ arrayValue (CHỈ THÊM, không đổi hành vi cũ) — cần cho
// field "stations" của collection "permissions" (xem _fsSyncPermissionDoc_ +
// _fsMintFirebaseAuthToken_ bên dưới), để Firestore Security Rules dùng được
// .hasAny()/.hasOnly() trên field này. Mọi lệnh gọi cũ chỉ truyền primitive
// (string/number/boolean) nên không bị ảnh hưởng.
function _fsEncodeValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(_fsEncodeValue_) } };
  }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'boolean') return { booleanValue: v };
  return { stringValue: String(v) };
}
function _fsEncodeDoc_(obj) {
  var fields = {};
  Object.keys(obj).forEach(function(k) { fields[k] = _fsEncodeValue_(obj[k]); });
  return { fields: fields };
}
function _fsDecodeValue_(v) {
  if (!v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue'   in v) return ((v.arrayValue && v.arrayValue.values) || []).map(_fsDecodeValue_);
  return null;
}
function _fsDecodeDoc_(doc) {
  var out = {};
  var fields = doc.fields || {};
  Object.keys(fields).forEach(function(k) { out[k] = _fsDecodeValue_(fields[k]); });
  return out;
}


/** Upsert 1 doc — idempotent vì docId cố định (stationKey_date) */
// [SECURITY FIX — rà soát bảo mật toàn diện] Danh sách collection HỢP LỆ duy
// nhất mà hệ thống thực sự dùng (đối chiếu toàn bộ lệnh gọi thật trong file
// này) — dùng để chặn bớt rủi ro "ghi/đọc vào collection tuỳ ý" ở 4 hàm
// nguyên thuỷ tổng quát bên dưới. Đây KHÔNG phải vá triệt để (vẫn cho phép
// đọc/ghi SAI docId trong ĐÚNG collection nếu người gọi có quyền hệ thống),
// nhưng chặn được kịch bản xấu nhất: tạo/ghi vào 1 collection hoàn toàn lạ.
function _fsIsAllowedCollection_(collection) {
  var c = String(collection || '');
  var allowed = ['inbound_live', 'alerts_active', 'inbound_archive', 'permissions', 'fireboard_daily',
    // [MỚI — "Thông báo & Bảo trì toàn hệ thống" chuyển sang Firestore realtime,
    // thay polling 120s] Document TOÀN CỤC (không theo trạm) — mọi user đã
    // đăng nhập đều cần đọc được (khác các collection theo trạm khác trong
    // danh sách này, vốn bị giới hạn theo _fsRequireStationAccess_).
    'system_status'];
  if (allowed.indexOf(c) >= 0) return true;
  // Subcollection dạng fireboard_daily/{docId}/drivers
  if (/^fireboard_daily\/[^\/]+\/drivers$/.test(c)) return true;
  return false;
}

function _fsUpsertDoc_(collection, docId, obj) {
  // [SECURITY FIX — cùng đợt rà soát] Hàm ghi Firestore TỔNG QUÁT — TRƯỚC ĐÂY
  // không kiểm tra gì, gọi trực tiếp qua google.script.run với collection/docId
  // TUỲ Ý là ghi được vào bất kỳ đâu trong Firestore. Chặn 2 lớp: phải là
  // nhân viên đã duyệt, VÀ collection phải nằm trong danh sách hệ thống thật
  // sự dùng (xem _fsIsAllowedCollection_ ở trên).
  _requireApproved_();
  if (!_fsIsAllowedCollection_(collection)) throw new Error('_fsUpsertDoc_: collection không hợp lệ.');
  var url = _fsBaseUrl_() + '/' + collection + '/' + encodeURIComponent(docId);
  var payload = JSON.stringify(_fsEncodeDoc_(obj));
  // [FIX 2026-07-21] Cùng cơ chế tự refresh token khi 401/403 — xem giải thích ở _fsPatchFields_.
  for (var _attempt = 1; _attempt <= 2; _attempt++) {
    var token = _fsGetAccessToken_(_attempt === 2);
    var resp = UrlFetchApp.fetch(url, {
      method: 'patch',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: payload,
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code < 300) { _fsQuotaIncr_('write'); return JSON.parse(resp.getContentText()); }
    if ((code === 401 || code === 403) && _attempt === 1) continue;
    throw new Error('Firestore upsert lỗi (' + collection + '/' + docId + '): ' + resp.getContentText());
  }
}

/**
 * Cập nhật CHỈ MỘT SỐ field cụ thể của 1 document, dùng updateMask —
 * KHÔNG đụng tới các field khác không được liệt kê (khác với _fsUpsertDoc_,
 * PATCH không kèm updateMask sẽ GHI ĐÈ TOÀN BỘ document). Tạo document mới
 * nếu chưa tồn tại, y hệt PATCH thường, nhưng chỉ với đúng các field truyền vào.
 *
 * Dùng cho các trường hợp cần ghi thường xuyên 1 vài field nhỏ trên 1 document
 * đã có sẵn field lớn khác (ví dụ: inbound_live đã có idDatesJson ~900.000 ký
 * tự — nếu dùng _fsUpsertDoc_ để cập nhật thêm vài số Tồn/Tồn Mới, mỗi lần ghi
 * sẽ phải đọc lại + gửi lại nguyên field lớn đó, vừa chậm vừa tốn quota).
 */
function _fsPatchFields_(collection, docId, fields) {
  // [SECURITY FIX — cùng đợt rà soát, cùng lý do _fsUpsertDoc_ ở trên]
  _requireApproved_();
  if (!_fsIsAllowedCollection_(collection)) throw new Error('_fsPatchFields_: collection không hợp lệ.');
  var keys = Object.keys(fields || {});
  if (!keys.length) return null;
  var maskParams = keys.map(function(k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
  var url = _fsBaseUrl_() + '/' + collection + '/' + encodeURIComponent(docId) + '?' + maskParams;
  var payload = JSON.stringify(_fsEncodeDoc_(fields));

  // [FIX 2026-07-21] Thử tối đa 2 lần: lần 1 dùng token cache bình thường, nếu bị từ chối
  // đúng do AUTH (401/403 — token cache đang hỏng/hết hạn sớm/thu hồi, KHÔNG phải lỗi dữ
  // liệu) thì ép lấy token MỚI (forceRefresh) rồi thử lại NGAY LẦN NỮA. Nếu không có bước
  // này, mọi lần gọi (kể cả từ vòng retry-3-lần bên App_Backend.gs) đều tái sử dụng ĐÚNG
  // token hỏng đó cho tới khi cache tự hết hạn (tối đa ~58 phút) — 1 nguồn gây "chập chờn"
  // kéo dài khó tự khỏi. Lỗi KHÁC 401/403 (mạng, quota, dữ liệu) vẫn throw ngay như cũ, để
  // vòng retry bên ngoài (có backoff) xử lý, tránh gọi dồn dập vô ích khi lỗi không phải do
  // token.
  for (var _attempt = 1; _attempt <= 2; _attempt++) {
    var token = _fsGetAccessToken_(_attempt === 2);
    var resp = UrlFetchApp.fetch(url, {
      method: 'patch',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: payload,
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code < 300) { _fsQuotaIncr_('write'); return JSON.parse(resp.getContentText()); }
    if ((code === 401 || code === 403) && _attempt === 1) {
      continue; // thử lại ngay với token mới
    }
    throw new Error('Firestore patch field lỗi (' + collection + '/' + docId + '): ' + resp.getContentText());
  }
}

/**
 * [2026-07 COST] Bản bọc cache của _fsGetInboundLive_ — CHỈ dùng cho đường ĐỌC
 * bị POLL lặp lại nhiều lần (ana_getTonState, 25s/lần từ mỗi tab client — xem
 * Analytics_Block.html window._tonPollServer). KHÔNG dùng cho _anaReadInboundState
 * (getStationData) vì đường đó cần idDatesJson đầy đủ, có thể tới ~900KB —
 * vượt trần 100KB/key của CacheService, cache sẽ vô nghĩa (luôn miss hoặc lỗi).
 *
 * CacheService.getScriptCache() dùng CHUNG cho mọi user của script (khác
 * PropertiesService/UserCache) — nghĩa là nhiều SUP/AOM cùng xem 1 trạm trong
 * cùng khoảng TTL sẽ CHUNG 1 lần đọc Firestore thay vì mỗi tab đọc riêng.
 * TTL 30s (nhỉnh hơn chu kỳ poll 25s) để cùng 1 tab poll 2 lần liên tiếp cũng
 * có cơ hội trúng cache — độ trễ dữ liệu tăng thêm tối đa ~30s, chấp nhận được
 * vì đây vốn đã là dữ liệu "gần đúng" đồng bộ qua poll, không phải nguồn ghi.
 *
 * An toàn: nếu doc lớn hơn ngưỡng cache hoặc CacheService.put() lỗi, bỏ qua
 * cache lặng lẽ và vẫn trả kết quả đọc trực tiếp — không bao giờ throw thêm
 * lỗi mới do lớp cache này gây ra.
 */
function _fsGetInboundLiveCached_(stationKey, ttlSec) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'fs_live_ton_' + stationKey;
  try {
    var cached = cache.get(cacheKey);
    if (cached !== null) {
      return cached === '__NULL__' ? null : JSON.parse(cached);
    }
  } catch (eCacheGet) { /* lỗi đọc cache — coi như miss, đọc thẳng Firestore */ }

  var live = _fsGetInboundLive_(stationKey);

  try {
    var toCache = live ? JSON.stringify(live) : '__NULL__';
    if (toCache.length <= 95000) { // an toàn dưới trần 100.000 ký tự/key của CacheService
      cache.put(cacheKey, toCache, ttlSec || 30);
    }
    // Nếu vượt trần: bỏ qua cache lần này (trạm có idDatesJson lớn), vẫn trả live bình thường.
  } catch (eCachePut) { /* lỗi ghi cache — bỏ qua, không ảnh hưởng kết quả trả về */ }

  return live;
}

/** Đọc 1 doc — trả về null nếu không tồn tại (404), throw nếu lỗi khác (network/quota/auth). */
function _fsGetDoc_(collection, docId) {
  // [SECURITY FIX — cùng đợt rà soát, cùng lý do _fsUpsertDoc_ ở trên] Đây là
  // hàm ĐỌC nên rủi ro thấp hơn ghi, nhưng vẫn có thể lộ dữ liệu trạm khác nếu
  // gọi trực tiếp với docId tuỳ ý trong đúng 1 collection hợp lệ — chặn tối
  // thiểu bằng 2 lớp giống các hàm kia.
  _requireApproved_();
  if (!_fsIsAllowedCollection_(collection)) throw new Error('_fsGetDoc_: collection không hợp lệ.');
  var url = _fsBaseUrl_() + '/' + collection + '/' + encodeURIComponent(docId);
  // [FIX 2026-07-21] Cùng cơ chế tự refresh token khi 401/403 như _fsPatchFields_ — xem
  // giải thích chi tiết ở đó. Ở ĐÂY càng quan trọng hơn: đây là đường ĐỌC chính của
  // _anaReadInboundState(), nếu lỗi auth bị nhầm xử lý giống lỗi mạng thông thường, có thể
  // khiến hệ thống fallback nhầm sang Sheet cache liên tục dù Firestore vẫn khỏe mạnh, chỉ
  // là token đang hỏng.
  for (var _attempt = 1; _attempt <= 2; _attempt++) {
    var token = _fsGetAccessToken_(_attempt === 2);
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 404) { _fsQuotaIncr_('read'); return null; }
    if (code < 300) { _fsQuotaIncr_('read'); return _fsDecodeDoc_(JSON.parse(resp.getContentText())); }
    if ((code === 401 || code === 403) && _attempt === 1) {
      continue; // thử lại ngay với token mới
    }
    throw new Error('Firestore get lỗi (' + collection + '/' + docId + '): ' + resp.getContentText());
  }
}

/**
 * ============================================================
 * INBOUND_LIVE — nguồn sự thật SỐNG cho Inbound Lock (thay thế Sheet cell 45.000
 * ký tự bằng Firestore document field ~1 MiB, tăng ~20 lần sức chứa).
 * ============================================================
 * 1 document/trạm, docId = stationKey. Field idDatesJson = TOÀN BỘ sổ luỹ kế
 * { orderId: "yyyy-MM-dd" }, y hệt cấu trúc cột F cũ trên Sheet — chỉ đổi nơi lưu.
 *
 * [2026-07] MỞ RỘNG — TỒN / TỒN MỚI / ĐƠN VÔ CHỦ (đồng bộ đa người dùng):
 * Tận dụng ĐÚNG document này (không tạo collection mới) để lưu thêm vài field
 * nhỏ, ghi/đọc qua _fsPatchInboundLiveOps_() / ana_getTonState() — ghi bằng
 * _fsPatchFields_ (updateMask) nên KHÔNG đụng tới idDatesJson/seenIdsJson:
 *   tonDate         "yyyy-MM-dd"  — ngày của lần tính Tồn gần nhất
 *   tonDataTs       number        — mốc "giờ nạp dữ liệu" phía client (dùng để
 *                                   so sánh ai mới hơn, y hệt cơ chế NT-06)
 *   tonMoiCount / tonTongCount    — số đếm hiển thị nhanh (không cần parse JSON)
 *   tonMoiIdsJson / tonTongIdsJson — JSON array orderId (giới hạn ~400KB/field,
 *                                   tự trim ở ana_pushTonState nếu vượt)
 *   orphanTotal / orphanUrgent / orphanCodOrders / orphanCodValue — snapshot
 *                                   tóm tắt đơn vô chủ (không lưu full list)
 *   tonUpdatedAt / tonUpdatedBy   — audit nhẹ
 *
 * LƯU Ý VẬN HÀNH: Firestore mặc định tạo single-field index cho MỌI field, và
 * field string được index có giới hạn 1.500 byte. Field idDatesJson ở đây cố
 * tình để KHÔNG bao giờ được truy vấn theo giá trị (chỉ đọc nguyên document
 * theo docId) — nếu Firestore Console báo lỗi khi ghi do vượt giới hạn index,
 * vào Firestore Console > Indexes > Single field > thêm exemption cho field
 * "idDatesJson" của collection "inbound_live" (tắt indexing field đó, chỉ 1 lần).
 */
// [SECURITY FIX — rà soát bảo mật toàn diện] Dùng chung cho mọi hàm đọc/ghi
// dữ liệu THEO TRẠM bên dưới — bắt buộc người gọi phải có quyền Analytics
// THẬT với ĐÚNG trạm đang thao tác, không chỉ "đã duyệt truy cập hệ thống"
// chung chung (lớp đó đã có sẵn ở _fsGetDoc_/_fsUpsertDoc_/_fsPatchFields_ mà
// các hàm này gọi bên trong). TRƯỚC ĐÂY hoàn toàn không có lớp này — gọi trực
// tiếp qua google.script.run với stationKey của TRẠM KHÁC là đọc/ghi/xoá được
// dữ liệu Tồn/Trend/Alert của trạm đó, dù không có quyền quản lý trạm đó.
function _fsRequireStationAccess_(stationKey) {
  var email = Session.getActiveUser().getEmail();
  var perm = checkAnalyticsPermission(email);
  if (!perm || !perm.allowed) throw new Error('Không có quyền truy cập Analytics.');
  var normKey = String(stationKey || '');
  var hasIt = (perm.stations || []).some(function(s) { return _normStationKey_(s) === normKey; });
  if (!hasIt) throw new Error('Không có quyền truy cập dữ liệu trạm: ' + stationKey);
}

function _fsGetInboundLive_(stationKey) {
  _fsRequireStationAccess_(stationKey);
  return _fsGetDoc_('inbound_live', stationKey);
}
function _fsSaveInboundLive_(stationKey, obj) {
  _fsRequireStationAccess_(stationKey);
  // [FIX 2026-07-16] TRƯỚC ĐÂY dùng _fsUpsertDoc_ — PATCH KHÔNG kèm updateMask,
  // nghĩa là Firestore GHI ĐÈ TOÀN BỘ document, xoá mất mọi field không được
  // liệt kê trong `obj` — kể cả tonDate/tonDataTs/tonMoiIdsJson/tonTongIdsJson/
  // orphan*/tonUpdatedAt/tonUpdatedBy mà ana_pushTonState() vừa ghi trước đó
  // bằng _fsPatchInboundLiveOps_ (CÓ updateMask, an toàn). Hệ quả thực tế: mỗi
  // lần saveStationData() chốt sổ Inbound (gọi hàm này) sẽ âm thầm xoá sạch sổ
  // Tồn/Tồn Mới của CHÍNH trạm đó — đúng nguyên nhân gây lệch dữ liệu Tồn vs
  // Inbound quan sát được trên document inbound_live (tonDate mới nhưng date/
  // idDatesJson vẫn cũ, và ngược lại tuỳ luồng nào ghi sau).
  // SỬA: đổi sang _fsPatchFields_ (updateMask CHỈ đúng các field truyền vào,
  // CÙNG cơ chế _fsPatchInboundLiveOps_ đang dùng bên Tồn) — không đụng tới
  // field nào khác đã có sẵn trên document, dù bên nào ghi trước/ghi sau.
  return _fsPatchFields_('inbound_live', stationKey, obj);
}
/**
 * Ghi CHỈ các field Tồn/Tồn Mới/đơn vô chủ (xem mô tả field ở comment đầu khối
 * inbound_live phía trên) — dùng updateMask nên an toàn với field lớn idDatesJson/
 * seenIdsJson đã có sẵn trên cùng document, không đọc-ghi lại chúng.
 */
function _fsPatchInboundLiveOps_(stationKey, fields) {
  _fsRequireStationAccess_(stationKey);
  return _fsPatchFields_('inbound_live', stationKey, fields);
}
function _fsDeleteInboundLive_(stationKey) {
  _fsRequireStationAccess_(stationKey);
  var token = _fsGetAccessToken_();
  var url = _fsBaseUrl_() + '/inbound_live/' + encodeURIComponent(stationKey);
  var resp = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  // 404 = doc vốn không tồn tại, coi như đã "xóa" xong, không phải lỗi.
  if (resp.getResponseCode() >= 300 && resp.getResponseCode() !== 404) {
    throw new Error('Firestore xóa inbound_live lỗi (' + stationKey + '): ' + resp.getContentText());
  }
  _fsQuotaIncr_('delete');
}

/** Test riêng inbound_live — không đụng dữ liệu trạm thật. */
function testInboundLiveFirestore() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Công cụ test dev-only — khoá
  // admin cấp 1, không để bất kỳ ai gọi được qua google.script.run.
  _requireAdmin_(1);
  var fakeStationKey = 'demotesthub_live';
  var fakeIdDates = { 'DEMO_ORDER_A': '2026-07-08', 'DEMO_ORDER_B': '2026-07-08' };
  _fsSaveInboundLive_(fakeStationKey, {
    station: 'DEMO_TEST_HUB_LIVE',
    date: '2026-07-08',
    inboundLock: 2,
    idDatesJson: JSON.stringify(fakeIdDates),
    totalDrivers: 0,
    updatedAt: '2026-07-08T10:00:00+07:00'
  });
  var back = _fsGetInboundLive_(fakeStationKey);
  Logger.log('Inbound live đọc lại: ' + JSON.stringify(back));
  var missing = _fsGetInboundLive_('khong_ton_tai_' + Date.now());
  Logger.log('Doc không tồn tại → phải là null: ' + JSON.stringify(missing));
  return 'Xong — kiểm tra Logger.log: doc đọc lại phải có 2 DEMO_ORDER_x, và doc không tồn tại phải trả null (không throw).';
}

/**
 * Test riêng field Tồn/Tồn Mới/vô chủ (patch qua updateMask) — dùng CHUNG doc
 * demo với testInboundLiveFirestore() ở trên để xác nhận: (1) _fsPatchFields_
 * không xoá mất idDatesJson đã ghi trước đó, (2) đọc lại đúng field vừa patch.
 * Chạy SAU testInboundLiveFirestore() (để đã có doc demo tồn tại).
 */
function testTonStateFirestore() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Công cụ test dev-only — khoá
  // admin cấp 1, không để bất kỳ ai gọi được qua google.script.run.
  _requireAdmin_(1);
  var fakeStationKey = 'demotesthub_live';
  _fsPatchInboundLiveOps_(fakeStationKey, {
    tonDate: '2026-07-08',
    tonDataTs: Date.now(),
    tonMoiCount: 2,
    tonTongCount: 3,
    tonMoiIdsJson: JSON.stringify(['DEMO_TM_1', 'DEMO_TM_2']),
    tonTongIdsJson: JSON.stringify(['DEMO_TM_1', 'DEMO_TM_2', 'DEMO_TT_3']),
    orphanTotal: 5, orphanUrgent: 1, orphanCodOrders: 2, orphanCodValue: 350000,
    tonUpdatedAt: '2026-07-08T10:05:00+07:00', tonUpdatedBy: 'test@spx.vn'
  });
  var back = _fsGetInboundLive_(fakeStationKey);
  Logger.log('Doc sau khi patch field Tồn: ' + JSON.stringify(back));
  return 'Xong — kiểm tra Logger.log: PHẢI thấy CẢ idDatesJson (ghi bởi testInboundLiveFirestore) ' +
    'LẪN tonMoiIdsJson/tonTongIdsJson/orphanTotal... (vừa patch) trong CÙNG 1 document — ' +
    'nếu idDatesJson biến mất nghĩa là patch đang ghi đè nhầm, cần kiểm tra lại updateMask.';
}

/**
 * Ghi hàng loạt (dùng cho Driver_Daily — nhiều tài xế/ngày/trạm).
 * writes: [{ collection, docId, obj }, ...]
 * Firestore giới hạn 500 writes/request — chia chunk 450 cho an toàn.
 */
function _fsBatchUpsert_(writes) {
  if (!writes || !writes.length) return;
  // [SECURITY FIX — cùng đợt rà soát, cùng lý do _fsUpsertDoc_ ở trên] Ghi
  // hàng loạt — kiểm tra TỪNG collection trong writes, không chỉ 1 lần.
  _requireApproved_();
  for (var _wi = 0; _wi < writes.length; _wi++) {
    if (!_fsIsAllowedCollection_(writes[_wi] && writes[_wi].collection)) {
      throw new Error('_fsBatchUpsert_: collection không hợp lệ tại phần tử ' + _wi + '.');
    }
  }
  var token = _fsGetAccessToken_();
  var url = 'https://firestore.googleapis.com/v1/projects/' + _fsProjectId_() +
    '/databases/(default)/documents:batchWrite';
  var CHUNK = 450;

  for (var i = 0; i < writes.length; i += CHUNK) {
    var chunk = writes.slice(i, i + CHUNK);
    var body = {
      writes: chunk.map(function(w) {
        return {
          update: {
            name: 'projects/' + _fsProjectId_() + '/databases/(default)/documents/' +
                  w.collection + '/' + w.docId,
            fields: _fsEncodeDoc_(w.obj).fields
          }
        };
      })
    };
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 300) {
      throw new Error('Firestore batchWrite lỗi: ' + resp.getContentText());
    }
    _fsQuotaIncr_('write', chunk.length); // đếm ĐÚNG số doc trong chunk, không phải 1 lượt API call
  }
}

/**
 * Query theo khoảng ngày cho 1 trạm.
 * LƯU Ý: lần chạy đầu tiên Firestore sẽ báo lỗi kèm link để tạo composite index
 * (station ASC, date ASC) — bấm link đó 1 lần trong Firebase Console, đợi index
 * build xong (vài phút) là query chạy bình thường về sau.
 */
function _fsQueryStationRange_(stationKey, fromDate, toDate) {
  _fsRequireStationAccess_(stationKey);
  var token = _fsGetAccessToken_();
  var url = 'https://firestore.googleapis.com/v1/projects/' + _fsProjectId_() +
    '/databases/(default)/documents:runQuery';
  var body = {
    structuredQuery: {
      from: [{ collectionId: 'fireboard_daily' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'station' }, op: 'EQUAL',
                value: { stringValue: stationKey } } },
            { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL',
                value: { stringValue: fromDate } } },
            { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN_OR_EQUAL',
                value: { stringValue: toDate } } }
          ]
        }
      },
      orderBy: [{ field: { fieldPath: 'date' }, direction: 'ASCENDING' }]
    }
  };
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Firestore query lỗi: ' + resp.getContentText());
  }
  var rows = JSON.parse(resp.getContentText());
  var docs = (rows || []).filter(function(r) { return r.document; });
  _fsQuotaIncr_('read', Math.max(1, docs.length)); // Firestore tính phí đọc theo SỐ DOC TRẢ VỀ của query, tối thiểu 1
  return docs.map(function(r) { return _fsDecodeDoc_(r.document); });
}

/**
 * Query driver theo khoảng ngày cho 1 trạm — dùng collectionGroup query trên
 * subcollection "drivers" (nằm dưới mỗi fireboard_daily/{stationKey_date}).
 * LƯU Ý: cũng cần tạo composite index khi Firestore báo lỗi lần đầu (giống
 * _fsQueryStationRange_), nhưng đây là collection-group index (nhớ tick
 * "Collection group" khi tạo, không phải "Collection").
 */
function _fsQueryDriverRange_(stationKey, fromDate, toDate) {
  _fsRequireStationAccess_(stationKey);
  var token = _fsGetAccessToken_();
  var url = 'https://firestore.googleapis.com/v1/projects/' + _fsProjectId_() +
    '/databases/(default)/documents:runQuery';
  var body = {
    structuredQuery: {
      from: [{ collectionId: 'drivers', allDescendants: true }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'stationKey' }, op: 'EQUAL',
                value: { stringValue: stationKey } } },
            { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL',
                value: { stringValue: fromDate } } },
            { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN_OR_EQUAL',
                value: { stringValue: toDate } } }
          ]
        }
      },
      orderBy: [{ field: { fieldPath: 'date' }, direction: 'ASCENDING' }]
    }
  };
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Firestore driver query lỗi: ' + resp.getContentText());
  }
  var rows = JSON.parse(resp.getContentText());
  var docs = (rows || []).filter(function(r) { return r.document; });
  _fsQuotaIncr_('read', Math.max(1, docs.length)); // Firestore tính phí đọc theo SỐ DOC TRẢ VỀ của query, tối thiểu 1
  return docs.map(function(r) { return _fsDecodeDoc_(r.document); });
}

// ── BUILDER: chuyển 1 row Sheet (mảng giá trị) → doc Firestore ─────────────
// Thứ tự cột PHẢI khớp CHÍNH XÁC với HEADERS trong _trendStationSheet()/
// _trendDriverSheet() (backend__FIXED.gs). Nếu sau này thêm/bớt cột ở đó,
// nhớ sửa lại 2 hàm builder này cho khớp.

/** Station_Daily (19 cột) → doc fireboard_daily/{stationKey_date} */
function _fsBuildStationDoc_(row) {
  var rawDate = row[0];
  var dateStr = rawDate instanceof Date
    ? Utilities.formatDate(rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
    : String(rawDate || '').slice(0, 10);
  var stationName = String(row[1] || '');
  var stationKey  = _normStationKey_(stationName);
  return {
    docId: stationKey + '_' + dateStr,
    obj: {
      station: stationName, stationKey: stationKey, date: dateStr,
      total: row[2] || 0, delivered: row[3] || 0, rate: row[4] || 0,
      delivering: row[5] || 0, onhold: row[6] || 0, hoan: row[7] || 0,
      reattempts: row[8] || 0, cod_total: row[9] || 0, cod_delivered: row[10] || 0,
      driver_count: row[11] || 0, inbound: row[12] || 0, outbound: row[13] || 0,
      pickup_total: row[14] || 0, pickup_done: row[15] || 0, pickup_rate: row[16] || 0,
      saved_by: String(row[17] || ''), saved_at: String(row[18] || '')
    }
  };
}

/** Driver_Daily (18 cột) → doc fireboard_daily/{stationKey_date}/drivers/{driverId} */
function _fsBuildDriverDoc_(row) {
  var rawDate = row[0];
  var dateStr = rawDate instanceof Date
    ? Utilities.formatDate(rawDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
    : String(rawDate || '').slice(0, 10);
  var stationName = String(row[1] || '');
  var stationKey  = _normStationKey_(stationName);
  var driverId    = String(row[2] || '');
  return {
    parentDocId: stationKey + '_' + dateStr,
    docId: driverId || Utilities.getUuid(),
    obj: {
      station: stationName, stationKey: stationKey, date: dateStr,
      driver_id: driverId, driver_name: String(row[3] || ''),
      total: row[4] || 0, delivered: row[5] || 0, rate: row[6] || 0,
      delivering: row[7] || 0, onhold: row[8] || 0, hoan: row[9] || 0,
      reattempts: row[10] || 0, cod: row[11] || 0, cod_delivered: row[12] || 0,
      top_zone: String(row[13] || ''), pickup_assigned: row[14] || 0,
      pickup_done: row[15] || 0, pickup_rate: row[16] || 0, saved_at: String(row[17] || '')
    }
  };
}

/**
 * Archive callback dùng cho _trendPurgeSheet(..., archiveFn) — nhận mảng rows
 * (mảng giá trị, đúng totalCols) sắp bị xoá khỏi Sheet, ghi hết vào Firestore
 * TRƯỚC khi Sheet xoá. Nếu throw, _trendPurgeSheet sẽ huỷ purge lần đó (an toàn).
 */
function _fsArchiveStationRows_(rows) {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Không có caller thật nào trong
  // production (chỉ gọi từ hàm test trong chính file này) — xử lý hàng loạt,
  // không có 1 "trạm" cụ thể để khớp quyền như các hàm khác, nên khoá theo
  // admin cấp 1 (đúng mức đã áp dụng cho các thao tác nội bộ/hàng loạt tương
  // tự trong backend.gs) thay vì để trống hoàn toàn.
  _requireAdmin_(1);
  var writes = rows.map(function(row) {
    var built = _fsBuildStationDoc_(row);
    return { collection: 'fireboard_daily', docId: built.docId, obj: built.obj };
  });
  _fsBatchUpsert_(writes);
}

function _fsArchiveDriverRows_(rows) {
  // [SECURITY FIX — cùng lý do _fsArchiveStationRows_ ở trên]
  _requireAdmin_(1);
  var writes = rows.map(function(row) {
    var built = _fsBuildDriverDoc_(row);
    return {
      collection: 'fireboard_daily/' + built.parentDocId + '/drivers',
      docId: built.docId,
      obj: built.obj
    };
  });
  _fsBatchUpsert_(writes);
}

/**
 * ============================================================
 * INBOUND_LOCK ARCHIVE — audit trail 1 chiều
 * ============================================================
 * Khác với fireboard_daily (Trend, có đọc ngược lại vào getTrendStation/Drivers),
 * inbound_archive CHỈ GHI — không merge ngược vào luồng dedup sống, vì nghiệp vụ
 * hiện tại không cần dedupe ID đã cũ (xem comment trong _anaSaveInboundState).
 * Mục đích: có bản sao để tra cứu/kiểm toán sau này, không để mất trắng.
 *
 * Ghi thành nhiều doc rời rạc mỗi lần trim (KHÔNG đọc-sửa-ghi lại 1 doc chung) để
 * tránh race giữa nhiều session cùng trạm ghi đồng thời — chấp nhận nhiều doc nhỏ
 * cho cùng (station, ngày), ưu tiên KHÔNG MẤT DỮ LIỆU hơn là gọn số lượng doc.
 */
function _fsArchiveInboundDropped_(stationKey, stationName, droppedIdDates) {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Gọi từ luồng lưu Inbound thật
  // của user (không phải trigger nền) — dùng ĐÚNG helper theo trạm giống các
  // hàm inbound_live khác. Nơi gọi đã bọc try/catch (bỏ qua lỗi archive, vẫn
  // tiếp tục lưu chính) nên an toàn để throw ở đây.
  _fsRequireStationAccess_(stationKey);
  var todayKey = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  var docId = stationKey + '_' + todayKey + '_' + Utilities.getUuid().slice(0, 8);
  _fsUpsertDoc_('inbound_archive', docId, {
    station: stationName,
    stationKey: stationKey,
    archivedAt: todayKey,
    count: Object.keys(droppedIdDates).length,
    idsJson: JSON.stringify(droppedIdDates)
  });
}

/**
 * Tra cứu audit: gộp toàn bộ ID đã bị trim của 1 trạm trong khoảng ngày archivedAt.
 * Dùng khi cần điều tra 1 đơn cũ ("đơn này đã inbound chưa, ngày nào") — KHÔNG dùng
 * trong luồng dedup sống (quá chậm cho mỗi lần save, chỉ chạy khi cần tra cứu thủ công).
 */
function _fsQueryInboundArchive_(stationKey, fromDate, toDate) {
  _fsRequireStationAccess_(stationKey);
  var token = _fsGetAccessToken_();
  var url = 'https://firestore.googleapis.com/v1/projects/' + _fsProjectId_() +
    '/databases/(default)/documents:runQuery';
  var body = {
    structuredQuery: {
      from: [{ collectionId: 'inbound_archive' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'stationKey' }, op: 'EQUAL',
                value: { stringValue: stationKey } } },
            { fieldFilter: { field: { fieldPath: 'archivedAt' }, op: 'GREATER_THAN_OR_EQUAL',
                value: { stringValue: fromDate } } },
            { fieldFilter: { field: { fieldPath: 'archivedAt' }, op: 'LESS_THAN_OR_EQUAL',
                value: { stringValue: toDate } } }
          ]
        }
      }
    }
  };
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Firestore inbound_archive query lỗi: ' + resp.getContentText());
  }
  var rows = JSON.parse(resp.getContentText());
  var merged = {}; // gộp idsJson của nhiều doc lại thành 1 map { orderId: date }
  var _docs = (rows || []).filter(function(r) { return r.document; });
  _fsQuotaIncr_('read', Math.max(1, _docs.length));
  _docs.forEach(function(r) {
    var doc = _fsDecodeDoc_(r.document);
    try {
      var ids = JSON.parse(doc.idsJson || '{}');
      Object.keys(ids).forEach(function(id) { merged[id] = ids[id]; });
    } catch (e) {}
  });
  return merged; // { orderId: "yyyy-MM-dd", ... }
}

/** Test riêng inbound_archive — không đụng Inbound_Lock thật. */
function testInboundArchive() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Công cụ test dev-only — khoá
  // admin cấp 1, không để bất kỳ ai gọi được qua google.script.run.
  _requireAdmin_(1);
  var fakeDropped = {
    'DEMO_ORDER_001': '2026-06-01',
    'DEMO_ORDER_002': '2026-06-02'
  };
  _fsArchiveInboundDropped_('demotesthub', 'DEMO_TEST_HUB', fakeDropped);

  var back = _fsQueryInboundArchive_('demotesthub', '2026-01-01', '2026-12-31');
  Logger.log('Inbound archive đọc lại: ' + JSON.stringify(back));
  return 'Xong — kiểm tra Logger.log có đúng 2 DEMO_ORDER_00x không.';
}

/**
 * ============================================================
 * ALERTS_ACTIVE — cache SỐNG cho cảnh báo đang mở của 1 trạm, phục vụ
 * real-time push (thay poll) cho Alert Drawer / Tab 10. KHÔNG thay thế
 * sheet Alert_Aggregate — sheet vẫn là nguồn audit đầy đủ duy nhất (có
 * resolved_by, resolved_at, snapshot lúc resolve — những thứ Firestore ở
 * đây không lưu). Đây chỉ là bản rút gọn CÁC ALERT ĐANG 'open' để đẩy
 * real-time tới client, ghi/đọc song song với sheet, không phải bản thay thế.
 * ============================================================
 * 1 document/trạm, docId = stationKey.
 *   activeAlertsJson  string  — JSON array các alert đang mở, tối đa
 *                                ALERT_FS_MAX_ITEMS mục gần nhất (dồn bớt
 *                                item cũ nhất khi vượt ngưỡng, xem
 *                                _alertFsPush_ ở backend.gs)
 *   openCount         number  — đếm nhanh, không cần parse JSON
 *   criticalCount     number  — đếm nhanh severity=3 đang mở
 *   updatedAt         string  — ISO GMT+7, audit nhẹ
 */
function _fsGetAlertsActive_(stationKey) {
  _fsRequireStationAccess_(stationKey);
  return _fsGetDoc_('alerts_active', stationKey);
}
function _fsSaveAlertsActive_(stationKey, obj) {
  _fsRequireStationAccess_(stationKey);
  return _fsUpsertDoc_('alerts_active', stationKey, obj);
}

/**
 * ============================================================
 * FIREBASE AUTH CUSTOM TOKEN — nền tảng để bỏ polling 25s qua GAS
 * ============================================================
 * MỤC ĐÍCH: cho phép CLIENT (trình duyệt) nói chuyện TRỰC TIẾP với Firestore
 * qua Firebase Web SDK (onSnapshot, WebSocket) thay vì poll qua google.script.run
 * mỗi 25s (window._tonPollServer trong Analytics_Block.html) — loại bỏ hẳn phần
 * đọc lặp lại đó khỏi quota UrlFetchApp của GAS (đang deploy "Execute as: Me"
 * nên quota dồn CHUNG cho mọi user, xem phân tích đã trao đổi).
 *
 * CƠ CHẾ: GAS tự KÝ 1 JWT "custom token" bằng ĐÚNG private key service account
 * đã dùng cho _fsGetAccessToken_ (không cần API call nào để mint — chỉ ký cục
 * bộ), client dùng token này gọi signInWithCustomToken() của Firebase Auth SDK.
 * Token hết hạn 1 giờ — client cần gọi lại getFirebaseAuthToken() (backend.gs)
 * định kỳ trước khi hết hạn để refresh (1 UrlFetch call/giờ/tab thay vì
 * 1 call/25s/tab — giảm ~144 lần).
 *
 * PHÂN QUYỀN: KHÔNG nhét danh sách trạm vào custom claims của token (tài
 * khoản admin/AOM quản nhiều hub dễ vượt trần 1000 byte của claims). Thay vào
 * đó, Security Rules trên Firebase Console sẽ dùng get() để tra field
 * "stations" của đúng document permissions/{uid} (xem _fsSyncPermissionDoc_)
 * — document này được GHI LẠI mỗi lần mint token, luôn khớp quyền hiện tại.
 *
 * SETUP THỦ CÔNG CÒN THIẾU (làm 1 lần, ngoài phạm vi sửa code):
 *   1. Firebase Console > Authentication > bật provider "Custom" (mặc định đã
 *      bật sẵn khi có ít nhất 1 provider khác — nếu chưa từng bật provider nào,
 *      bật tạm "Anonymous" 1 lần cho Authentication có hiệu lực).
 *   2. Firebase Console > Firestore > Rules > thêm rule cho "permissions" +
 *      cập nhật rule "inbound_live" để cho phép client đọc (mẫu rule ở cuối
 *      comment khối này) — bản rules mặc định hiện tại (chỉ service account
 *      qua REST như code này đang dùng) sẽ TỪ CHỐI client, cần rule mới mới
 *      client đọc được.
 *
 * MẪU SECURITY RULES (dán vào Firebase Console > Firestore > Rules):
 *   match /permissions/{uid} {
 *     allow read: if request.auth != null && request.auth.uid == uid;
 *   }
 *   match /inbound_live/{stationKey} {
 *     allow read: if request.auth != null &&
 *       get(/databases/$(database)/documents/permissions/$(request.auth.uid))
 *         .data.stations.hasAny([stationKey]);
 *   }
 *   match /alerts_active/{stationKey} {
 *     allow read: if request.auth != null &&
 *       get(/databases/$(database)/documents/permissions/$(request.auth.uid))
 *         .data.stations.hasAny([stationKey]);
 *   }
 * (Các collection khác — fireboard_daily, inbound_archive — KHÔNG mở thêm rule
 * đọc cho client, vẫn chỉ truy cập qua service account REST như hiện tại.)
 * ============================================================
 */

/** Firebase Auth yêu cầu uid không rỗng, ổn định — dùng email đã chuẩn hoá. */
function _fsAuthUidFromEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Ký JWT "custom token" cục bộ bằng private key service account — KHÔNG gọi
 * network (khác _fsGetAccessToken_, hàm đó phải đổi JWT lấy access token qua
 * oauth2.googleapis.com; custom token thì tự JWT này CHÍNH LÀ token trả cho
 * client, Firebase Auth sẽ tự verify chữ ký bằng public key của service
 * account khi client gọi signInWithCustomToken()).
 * exp tối đa Firebase cho phép là 3600s (1 giờ) kể từ iat.
 */
function _fsMintFirebaseAuthToken_(uid) {
  if (!uid) throw new Error('_fsMintFirebaseAuthToken_: thiếu uid.');
  // [SECURITY FIX — rà soát bảo mật toàn diện, phát hiện qua Firestore_bridge.gs
  // vừa được cung cấp] uid TRƯỚC ĐÂY hoàn toàn tin tham số truyền vào — vì Apps
  // Script cho gọi thẳng MỌI hàm top-level qua google.script.run bất kể có dấu
  // "_" ở tên hay không (đó chỉ là QUY ƯỚC đặt tên, KHÔNG phải access control
  // thật), bất kỳ ai cũng gọi thẳng hàm này với uid TUỲ Ý (VD email 1 admin đã
  // biết) để lấy token đăng nhập Firebase HỢP LỆ giả danh người đó. Chặn bằng
  // cách bắt buộc uid phải khớp ĐÚNG uid suy ra từ session THẬT của người gọi
  // (Session.getActiveUser() do Google xác thực, không thể giả mạo từ client).
  var callerUid = _fsAuthUidFromEmail_(Session.getActiveUser().getEmail());
  if (uid !== callerUid) {
    throw new Error('_fsMintFirebaseAuthToken_: uid không khớp người gọi — từ chối.');
  }
  var raw = PropertiesService.getScriptProperties().getProperty('FIRESTORE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('Chưa set Script Property FIRESTORE_SERVICE_ACCOUNT_JSON.');
  var svc = JSON.parse(raw);

  var now = Math.floor(Date.now() / 1000);
  var header   = { alg: 'RS256', typ: 'JWT' };
  var claimSet = {
    iss: svc.client_email,
    sub: svc.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid: uid
  };
  var toSign = Utilities.base64EncodeWebSafe(JSON.stringify(header)) + '.' +
               Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
  var sigBytes = Utilities.computeRsaSha256Signature(toSign, svc.private_key);
  return toSign + '.' + Utilities.base64EncodeWebSafe(sigBytes);
}

/**
 * Ghi lại document permissions/{uid} = { stations: [stationKey,...], updatedAt }
 * — dùng field arrayValue (mới thêm ở _fsEncodeValue_ phía trên) để Security
 * Rules dùng được .hasAny(). Gọi lại MỖI LẦN mint token nên luôn khớp quyền
 * hiện tại (nếu quyền đổi, tối đa lệch tới lần refresh token kế tiếp — 1 giờ
 * — chấp nhận được vì đây chỉ dùng để đọc dữ liệu Tồn/Inbound live, không
 * dùng cho hành động ghi/nhạy cảm hơn).
 */
function _fsSyncPermissionDoc_(uid, stationKeys) {
  // [SECURITY FIX — cùng đợt rà soát] TRƯỚC ĐÂY tin thẳng cả uid lẫn
  // stationKeys do nơi gọi truyền vào — gọi trực tiếp hàm này (bỏ qua
  // getFirebaseAuthToken() ở backend.gs) là tự ghi được document
  // permissions/{uid} với DANH SÁCH TRẠM TUỲ Ý, tự cấp quyền đọc Firestore
  // vượt xa quyền thật. Chặn 2 lớp: (1) uid phải khớp đúng session thật của
  // người gọi — không cho ghi hộ uid người khác; (2) KHÔNG tin stationKeys
  // truyền vào nữa — tính lại NGAY TẠI ĐÂY từ quyền thật qua
  // checkAnalyticsPermission() (backend.gs), tham số stationKeys giữ lại
  // trên chữ ký hàm chỉ để KHÔNG phải sửa nơi gọi cũ, giá trị truyền vào từ
  // giờ bị bỏ qua hoàn toàn.
  var email = Session.getActiveUser().getEmail();
  var callerUid = _fsAuthUidFromEmail_(email);
  if (uid !== callerUid) {
    throw new Error('_fsSyncPermissionDoc_: uid không khớp người gọi — từ chối.');
  }
  var perm = checkAnalyticsPermission(email);
  var realStationKeys = (perm && perm.allowed && Array.isArray(perm.stations))
    ? perm.stations.map(function(s) { return _normStationKey_(s); })
    : [];
  var now = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ss'+07:00'");
  _fsUpsertDoc_('permissions', uid, {
    stations: realStationKeys,
    updatedAt: now
  });
}

/** Test riêng — chạy thủ công để xác nhận mint token + sync permission chạy được. */
function testFirebaseAuthToken() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Công cụ test dev-only — khoá
  // admin cấp 1, không để bất kỳ ai gọi được qua google.script.run.
  _requireAdmin_(1);
  var uid = _fsAuthUidFromEmail_('demo@spx.vn');
  _fsSyncPermissionDoc_(uid, ['demotesthub', 'demotesthub2']);
  var token = _fsMintFirebaseAuthToken_(uid);
  Logger.log('Custom token (dán vào https://jwt.io để kiểm tra claims): ' + token);
  return 'Xong — kiểm tra Logger.log. Token phải là chuỗi 3 phần cách nhau bằng dấu chấm (JWT).';
}

/**
 * Test ĐỦ luồng thật — KHÔNG chỉ ký JWT cục bộ như testFirebaseAuthToken(), mà
 * còn gọi thật Identity Toolkit REST API để đổi custom token lấy idToken, y hệt
 * việc client sẽ làm khi gọi signInWithCustomToken() ở trình duyệt. Test này
 * xác nhận CẢ 3 bước setup thủ công cùng lúc:
 *   - Bước 2 (bật Authentication provider) — nếu chưa bật, API trả lỗi dạng
 *     "ADMIN_ONLY_OPERATION" hoặc "OPERATION_NOT_ALLOWED".
 *   - Bước 3 (FIREBASE_WEB_API_KEY đúng + cùng project) — nếu sai/thiếu key,
 *     API trả lỗi "API key not valid" hoặc 400.
 *   - Chữ ký JWT hợp lệ (đã xác nhận qua testFirebaseAuthToken(), test này
 *     xác nhận Firebase Auth THỰC SỰ chấp nhận chữ ký đó, không chỉ đúng
 *     hình thức JWT).
 * Rules ở bước 1 KHÔNG được test ở đây (signInWithCustomToken không đụng tới
 * Firestore Rules) — muốn test rules thật, phải làm ở bước sau (đọc thử
 * document permissions/{uid} bằng idToken trả về, xem gợi ý ở cuối Logger.log).
 */
function testFirebaseAuthFullFlow() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Công cụ test dev-only — khoá
  // admin cấp 1, không để bất kỳ ai gọi được qua google.script.run.
  _requireAdmin_(1);
  var apiKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_WEB_API_KEY');
  if (!apiKey) throw new Error('Chưa set Script Property FIREBASE_WEB_API_KEY (xem bước 3 hướng dẫn setup).');

  var uid = _fsAuthUidFromEmail_('demo@spx.vn');
  _fsSyncPermissionDoc_(uid, ['demotesthub', 'demotesthub2']);
  var customToken = _fsMintFirebaseAuthToken_(uid);

  var url = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + encodeURIComponent(apiKey);
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ token: customToken, returnSecureToken: true }),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();
  Logger.log('HTTP status: ' + code);
  Logger.log('Response body: ' + body);

  if (code !== 200) {
    Logger.log('❌ THẤT BẠI — kiểm tra lại bước 2 (Authentication provider) và bước 3 (FIREBASE_WEB_API_KEY) trong hướng dẫn setup.');
    throw new Error('signInWithCustomToken lỗi (' + code + '): ' + body);
  }

  var data = JSON.parse(body);
  Logger.log('✅ THÀNH CÔNG — Bước 2 và Bước 3 đã đúng.');
  Logger.log('idToken (dùng để test Rules ở bước tiếp theo, gọi REST Firestore /documents/permissions/' + uid + ' kèm header Authorization: Bearer <idToken> này): ' + data.idToken);
  Logger.log('localId trả về: ' + data.localId + ' (phải khớp uid đã mint: ' + uid + ')');

  return 'Xong — kiểm tra Logger.log. HTTP 200 nghĩa là Bước 2 + Bước 3 đã đúng.';
}

/**
 * Test Bước 1 (Firestore Rules) — dùng idToken THẬT lấy từ
 * testFirebaseAuthFullFlow() để gọi trực tiếp Firestore REST API (không qua
 * service account, đúng như client trình duyệt sẽ làm qua Firebase SDK).
 * Xác nhận rule "permissions/{uid}" cho phép user đọc đúng doc của chính mình
 * VÀ rule "inbound_live/{stationKey}" cho phép đọc đúng trạm nằm trong
 * "stations" của permissions/{uid} (đã sync = ['demotesthub', 'demotesthub2']
 * trong testFirebaseAuthFullFlow()).
 *
 * CÁCH DÙNG: chạy testFirebaseAuthFullFlow() trước, copy idToken trong
 * Logger.log, dán vào biến idToken bên dưới rồi chạy hàm này (Apps Script
 * không cho truyền tham số khi bấm Run trên UI nên phải dán tay).
 */
function testFirestoreRulesWithIdToken(idToken) {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Công cụ test dev-only — khoá
  // admin cấp 1, không để bất kỳ ai gọi được qua google.script.run.
  _requireAdmin_(1);
  if (!idToken) throw new Error('Thiếu idToken — chạy testFirebaseAuthFullFlow() trước rồi dán idToken vào đây.');
  var uid = 'demo@spx.vn';
  var base = _fsBaseUrl_();

  function _readAs(path) {
    var resp = UrlFetchApp.fetch(base + '/' + path, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + idToken },
      muteHttpExceptions: true
    });
    return { code: resp.getResponseCode(), body: resp.getContentText() };
  }

  // 1) Đọc đúng doc của chính mình — PHẢI cho phép (200).
  var r1 = _readAs('permissions/' + encodeURIComponent(uid));
  Logger.log('[permissions/' + uid + '] status=' + r1.code + ' body=' + r1.body);
  Logger.log(r1.code === 200 ? '✅ Đọc permissions của chính mình: OK.' : '❌ Bị chặn — kiểm tra lại rule "permissions/{uid}".');

  // 2) Đọc inbound_live của trạm CÓ trong danh sách quyền — PHẢI cho phép (200).
  var r2 = _readAs('inbound_live/demotesthub');
  Logger.log('[inbound_live/demotesthub] status=' + r2.code + ' body=' + r2.body);
  Logger.log(r2.code === 200 ? '✅ Đọc trạm có quyền: OK.' : '⚠️ Bị chặn (200 nếu doc tồn tại và có quyền; 404 vẫn coi là rule pass nếu chỉ do CHƯA CÓ document — kiểm tra kỹ error.status trong body để phân biệt PERMISSION_DENIED với NOT_FOUND).');

  // 3) Đọc inbound_live của trạm KHÔNG có trong danh sách quyền — PHẢI bị chặn (403).
  var r3 = _readAs('inbound_live/tramkhongduockquyen');
  Logger.log('[inbound_live/tramkhongduockquyen] status=' + r3.code + ' body=' + r3.body);
  Logger.log(r3.code === 403 ? '✅ Đúng như kỳ vọng — bị chặn 403 vì trạm này không nằm trong quyền.' : '❌ SAI — lẽ ra phải bị chặn 403, kiểm tra lại rule "inbound_live/{stationKey}" (có thể đang cho đọc quá rộng).');

  return 'Xong — kiểm tra Logger.log: mục (1) và (2) phải PASS (không phải PERMISSION_DENIED), mục (3) PHẢI bị chặn 403.';
}



// ── TEST NHANH — chạy thủ công trong Apps Script Editor sau khi setup xong ──
/**
 * testArchiveWithFakeRow() — test ĐÚNG đường đi thật (_fsArchiveStationRows_ /
 * _fsArchiveDriverRows_) mà trendNightlyPurgeRunner sẽ dùng, nhưng với 1 row GIẢ
 * (station = "DEMO_TEST_HUB") — KHÔNG đụng gì tới Station_Daily/Driver_Daily thật.
 * Chạy xong, vào Firebase Console > Firestore > Data > collection "fireboard_daily"
 * > tìm doc bắt đầu bằng "demotesthub_" — thấy field đúng như dưới là builder OK.
 */
function testArchiveWithFakeRow() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Công cụ test dev-only — khoá
  // admin cấp 1, không để bất kỳ ai gọi được qua google.script.run.
  _requireAdmin_(1);
  // Row giả — ĐÚNG THỨ TỰ 19 cột như _trendStationSheet() HEADERS:
  // date, station, total, delivered, rate, delivering, onhold, hoan, reattempts,
  // cod_total, cod_delivered, driver_count, inbound, outbound, pickup_total,
  // pickup_done, pickup_rate, saved_by, saved_at
  var fakeStationRow = [
    '2026-07-08', 'DEMO_TEST_HUB', 500, 450, 90, 30, 15, 5, 12,
    100, 95, 8, 200, 180, 50, 45, 90, 'test@spx.vn', '2026-07-08T22:30:00+07:00'
  ];
  _fsArchiveStationRows_([fakeStationRow]);

  // Row giả — ĐÚNG THỨ TỰ 18 cột như _trendDriverSheet() HEADERS:
  // date, station, driver_id, driver_name, total, delivered, rate, delivering,
  // onhold, hoan, reattempts, cod, cod_delivered, top_zone, pickup_assigned,
  // pickup_done, pickup_rate, saved_at
  var fakeDriverRow = [
    '2026-07-08', 'DEMO_TEST_HUB', 'TX999', 'Tài Xế Test', 50, 45, 90, 3,
    2, 0, 1, 10, 9, 'Zone A', 5, 4, 80, '2026-07-08T22:30:00+07:00'
  ];
  _fsArchiveDriverRows_([fakeDriverRow]);

  // Đọc lại bằng đúng hàm query thật để xác nhận vòng lặp ghi → đọc hoạt động
  var stationBack = _fsQueryStationRange_('demotesthub', '2026-07-01', '2026-07-31');
  var driverBack  = _fsQueryDriverRange_('demotesthub', '2026-07-01', '2026-07-31');

  Logger.log('Station archive đọc lại: ' + JSON.stringify(stationBack));
  Logger.log('Driver archive đọc lại: '  + JSON.stringify(driverBack));

  return 'Xong — kiểm tra Logger.log. Nếu cả 2 mảng có 1 phần tử đúng số liệu ' +
    'DEMO_TEST_HUB thì luồng archive (builder → batchWrite → query lại) chạy đúng ' +
    'y hệt cách trendNightlyPurgeRunner sẽ dùng với data thật.';
}

/** Dọn dẹp toàn bộ doc test (TEST_STATION + DEMO_TEST_HUB) sau khi xác nhận xong. */
function cleanupTestFirestoreDocs() {
  var token = _fsGetAccessToken_();
  var toDelete = [
    'fireboard_daily/demotesthub_2026-07-08',
    'fireboard_daily/demotesthub_2026-07-08/drivers/TX999',
    'inbound_live/demotesthub_live'
  ];
  // TEST_STATION có docId random theo Date.now() — liệt kê thủ công qua Console rồi xoá,
  // hoặc bỏ qua (không ảnh hưởng gì, chỉ là rác 1-2 doc).
  toDelete.forEach(function(path) {
    var resp = UrlFetchApp.fetch(_fsBaseUrl_() + '/' + path, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    Logger.log(path + ' → ' + resp.getResponseCode());
  });
  return 'Đã xoá doc demo. Doc TEST_STATION (docId random) xoá tay trong Firebase Console > Firestore > Data.';
}

// =========================================================================
// [MỚI — "FCM foreground" theo yêu cầu trực tiếp "tận dụng Firebase, nhớ hạn
// mức"] Cloud Messaging (FCM) MIỄN PHÍ KHÔNG GIỚI HẠN kể cả gói Spark — khác
// hẳn Firestore. Dùng TOPIC (không lặp theo từng token) để gửi 1 lượt duy
// nhất tới TẤT CẢ thiết bị đã đăng ký, bất kể có 10 hay 10.000 người — tránh
// đúng rủi ro "lặp theo từng user" từng cân nhắc (có thể vượt 6 phút chạy tối
// đa của Apps Script nếu số người dùng lớn).
// LƯU Ý ĐÃ TRAO ĐỔI RÕ: chỉ nhận được khi TAB ĐANG MỞ (kể cả không active) —
// Apps Script không serve được file Service Worker ở path riêng cần cho
// thông báo khi ĐÃ ĐÓNG hẳn tab, đây là giới hạn kiến trúc của Apps Script.
// =========================================================================
var FCM_TOPIC = 'spx_hub_all';

/**
 * spx_registerFcmToken(fcmToken)
 * [Client gọi 1 lần sau khi user đồng ý nhận thông báo đẩy] Đăng ký token
 * thiết bị vào topic dùng chung — dùng Instance ID API (cùng access token FCM
 * vừa mint, không cần thêm scope khác).
 */
function spx_registerFcmToken(fcmToken) {
  try {
    _requireApproved_();
    if (!fcmToken || typeof fcmToken !== 'string') throw new Error('Thiếu FCM token.');
    var token = _fsGetFcmAccessToken_();
    var url = 'https://iid.googleapis.com/iid/v1/' + encodeURIComponent(fcmToken) +
      '/rel/topics/' + encodeURIComponent(FCM_TOPIC);
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'access_token_auth': 'true' },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() >= 300) {
      throw new Error('Đăng ký FCM topic lỗi: ' + resp.getContentText());
    }
    return JSON.stringify({ success: true });
  } catch (e) {
    console.warn('[FCM] spx_registerFcmToken lỗi: ' + e.message);
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * _fsSendFcmTopic_(title, body)
 * Gửi 1 thông báo đẩy tới TOÀN BỘ thiết bị đã đăng ký topic — ĐÚNG 1 lệnh gọi
 * API duy nhất bất kể số lượng người nhận (khác hẳn kiểu lặp theo từng
 * token — an toàn với ngân sách 6 phút/lần chạy của Apps Script).
 */
function _fsSendFcmTopic_(title, body) {
  _requireAdmin_(1);
  var token = _fsGetFcmAccessToken_();
  var url = 'https://fcm.googleapis.com/v1/projects/' + _fsProjectId_() + '/messages:send';
  var payload = {
    message: {
      topic: FCM_TOPIC,
      notification: { title: title, body: body },
      webpush: { fcm_options: { link: '/' } }
    }
  };
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    // Không throw — gửi push là tiện ích thêm, KHÔNG được làm gãy luồng gửi
    // banner chính (PropertiesService + Firestore realtime) nếu FCM lỗi.
    console.warn('[FCM] Gửi topic lỗi: ' + resp.getContentText());
    return false;
  }
  return true;
}

function testFirestoreConnection() {
  // [SECURITY FIX — rà soát bảo mật toàn diện] Công cụ test dev-only — khoá
  // admin cấp 1, không để bất kỳ ai gọi được qua google.script.run.
  _requireAdmin_(1);
  var testDocId = 'TEST_' + Date.now();
  _fsUpsertDoc_('fireboard_daily', testDocId, {
    station: 'TEST_STATION',
    date: '2026-07-08',
    total: 123,
    note: 'ping từ Apps Script'
  });
  var result = _fsQueryStationRange_('TEST_STATION', '2026-07-01', '2026-07-31');
  Logger.log(JSON.stringify(result));
  return 'OK — kiểm tra Logger.log và collection fireboard_daily trên Firebase Console.';
}