//  RIDER PLAN API — Append vào cuối backend.gs  (V1.1)
//
//  Spreadsheet NGUỒN (READ-ONLY):  1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA
//    Chứa 4 sheets: FC (auto) | #Riders | Sheet1 (auto) | SA
//
//  Spreadsheet GHI (WRITE):        145-rfoh-hLPPa5o8Uoy1SFl04ryh9N4x5Roi2ByxwPY
//    = ADMIN_DB_ID (đã có sẵn trong backend.gs)
//    Tạo thêm 2 sheets: Rider_Plan | Rider_Plan_Driver
//
//  PHÂN QUYỀN (đọc từ sheet SA trong RP_SOURCE_ID):
//    Admin:  xuan.nguyenthanh01@spxexpress.com — xem toàn bộ, không giới hạn
//    AOM:    email trong cột AOM_Email (col D / index 3) — xem tất cả hub thuộc AOM
//    SUP:    email trong cột Sup_Email (col F / index 5) — xem hub thuộc SUP đó
//    Denied: email không tồn tại trong SA → trả về role='denied'
//
//  AUTO-SYNC:
//    Mỗi lần openModule('riderplan') → gọi loadForecastData() lấy data mới nhất
//    Mỗi 5 phút frontend tự gọi lại loadForecastData() (silent refresh FC)
//    syncRiderPlanMonth() nên set trigger time-based đầu tháng (1st, 00:05)
// ════════════════════════════════════════════════════════════════════════════

var RP_SOURCE_ID    = '1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA';
var RP_ADMIN_EMAIL = [
  'xuan.nguyenthanh01@spxexpress.com',
  'admin_thu_ba@spxexpress.com'
];

// SA sheet columns (0-indexed):
//  0=STT | 1=Provinces | 2=AOM | 3=AOM_Email | 4=Sup_Name | 5=Sup_Email | 6=Hub | 7=Sup_Name 02 | 8=Hub_Name AMH
var RP_SA_COL_AOM_EMAIL = 3;
var RP_SA_COL_SUP_EMAIL = 5;
var RP_SA_COL_HUB       = 6;
var RP_SA_COL_PROVINCE  = 1;
var RP_SA_COL_SUP_NAME  = 4;

// ── 0. loadAllData(month) ─────────────────────────────────────────────────────
// Gộp getCurrentUserAccess + loadForecastData + loadRiderPlan + loadDriverPlan
// thành 1 round-trip duy nhất → giảm thời gian load từ ~4s xuống ~1s
function loadAllData(month, overrideHub) {
  try {
    var access = getCurrentUserAccess();
    // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"]
    if (access.role === 'denied') {
      return { success: false, msg: 'Không có quyền truy cập Rider Plan.', access: access };
    }
    var monthStr = month || _rp_currentMonth();

    // [MỚI — theo yêu cầu trực tiếp "Rider Plan cũng phải cần view theo từng
    // level để xác định đúng sai, thiếu hay đủ"] Khi Admin đang "Xem thử
    // Lead/Staff" ở 1 Hub cụ thể, truyền overrideHub xuống CẢ 3 hàm con — mỗi
    // hàm đã tự có logic lọc đúng (an toàn: chỉ Admin thật mới dùng được tham
    // số này). Trước đây chỉ loadRiderPlan() hỗ trợ sẵn — loadForecastData()/
    // loadDriverPlan() vừa được bổ sung để đồng bộ cả 3.
    // [GỠ CHỐT CHẶN — báo cáo trực tiếp: "admin trước đây load được toàn bộ, sao
    // giờ lại chặn?" và "AOM/SUP cũng không load được, vẫn báo 370 trạm của Admin"]
    // Chốt chặn tuần trước dựa trên PHỎNG ĐOÁN chưa từng đo ("vượt thời lượng Apps
    // Script hoặc treo trình duyệt") — đúng lỗi đã lặp lại nhiều lần trong phiên này
    // (đặt ngưỡng trước, đo sau). Nó gây ra 2 hồi quy:
    //   1) Admin xem bình thường (không Xem thử) không có overrideHub -> bị chặn dù
    //      trước đây tải được — hồi quy thật, không phải sửa lỗi.
    //   2) Xem thử SUP/AOM nhưng tính phạm vi phía trình duyệt trả về rỗng (đọc
    //      window._spxHubOrgDir — danh bạ chỉ nạp SAU 800ms từ lúc mở app; mở thẳng
    //      Rider Plan trong khoảng đó là dính) -> rơi vào cùng nhánh "thiếu phạm vi +
    //      Admin thật" -> bị chặn với thông báo nhầm là 370 trạm của Admin.
    // Đo thật (đã ghi ở trên): 3 hàm tải chỉ đọc MỘT sheet, chi phí đọc không đổi
    // theo số trạm — lo ngại "vượt thời lượng" không có cơ sở.
    // Nay LUÔN cho tải, chỉ đo và ghi log gói trả về để có số liệu thật trước khi
    // quyết định có cần tối ưu hay không — đúng cách đã làm đúng với KPI.
    var _rpScope = _spxScopeHubs_(overrideHub);

    var fcResult  = loadForecastData(monthStr, access, overrideHub);
    var rpResult  = loadRiderPlan(monthStr, access, overrideHub);
    var drvResult = loadDriverPlan(monthStr, access, overrideHub);

    var _out = {
      success:  true,
      access:   access,
      forecast: fcResult,
      plan:     rpResult,
      drivers:  drvResult,
    };
    // [MỚI] Đo kích thước gói trả về thay vì đoán — nếu thật sự nặng thì có số liệu
    // để quyết định (tải theo trang, thu gọn trường) thay vì chặn theo phỏng đoán.
    try {
      var _sizeChk = JSON.stringify(_out).length;
      _out._payloadInfo = {
        kyTu: _sizeChk, soTram: _rpScope.empty ? '(toàn quyền)' : _rpScope.list.length
      };
      if (_sizeChk > 6000000) {
        _LOG.d('[RiderPlan Payload] LỚN: ' + Math.round(_sizeChk / 1048576 * 10) / 10 +
               'MB, phạm vi ' + _out._payloadInfo.soTram);
      }
    } catch (ePl) {}
    return _out;
  } catch(e) {
    return { success: false, msg: e.message };
  }
}

// ── 1. getCurrentUserAccess() ──
function getCurrentUserAccess() {
  try {
    var email = Session.getActiveUser().getEmail().toLowerCase().trim();
    
    // Admin bypass — dùng sheet Admin_Roles (2 cấp), có failsafe cứng trong code
    var adminMapRP = _admin_getAdminMap();

    if (adminMapRP[email]) {
      return { role: 'admin', level: adminMapRP[email], email: email, hubs: _rp_getAllHubsFromSA() };
    }
    // [SỬA — dùng CÙNG nguồn tổ chức chính thức như getModuleAccess() và
    // checkAnalyticsPermission(). Nguồn cũ chỉ còn là dự phòng.]
    try {
      var _orgM = _spxBuildOrgAccessMap_();
      var _meG = (_orgM && _orgM.byEmail) ? _orgM.byEmail[email] : null;
      if (_meG && _meG.stations && _meG.stations.length) {
        var _rG = String(_meG.role || '').toUpperCase();
        return { role: (_rG === 'AOM') ? 'aom' : (_rG === 'SUP') ? 'sup' : 'station',
                 email: email, hubs: _meG.stations.slice(), title: _meG.position || null };
      }
    } catch (eOrgG) {}
    var srcSS = _DS.ss(RP_SOURCE_ID);
    var sa = _rp_lookupSA(email, srcSS);
    if (!sa) return { role: 'denied', email: email, hubs: [] };
    return { role: sa.role, email: email, hubs: sa.hubs };
  } catch(e) {
    return { role: 'denied', email: '', hubs: [], error: e.message };
  }
}

// [FIX 2026-08-01] Tách phần build thật (đọc 4 sheet nguồn + tính toán) ra hàm
// riêng — dùng trong khối có khóa bảo vệ của loadForecastData() (chống stampede
// khi nhiều user cùng cache-miss). Luôn ghi cache TTL 300s khi build xong.
function _rp_buildFullForecastData_(year, mon, monthStr) {
  var srcSS     = _DS.ss(RP_SOURCE_ID);
  var prodMap   = _rp_buildProdTargetMap(srcSS, year, mon);
  var fcMap     = _rp_buildFCMap(srcSS, year, mon);
  var ridersMap = _rp_buildRidersMap(srcSS, year, mon);
  var saMap     = _rp_buildSAMap(srcSS);

  var days = new Date(year, mon, 0).getDate();
  var allStationsFull = Object.keys(saMap).sort();
  var fullRows = [];
  allStationsFull.forEach(function(station) {
    var meta   = saMap[station] || {};
    var target = prodMap[station] || 0;
    for (var d = 1; d <= days; d++) {
      var dd      = d < 10 ? '0' + d : '' + d;
      var dateStr = monthStr + '-' + dd;
      var key     = station + '|' + dateStr;
      var fc      = fcMap[key]     || { lm: 0, fm: 0 };
      var rp      = ridersMap[key] || 0;
      fullRows.push({
        station:      station,
        date:         dateStr,
        sup:          meta.sup      || '',
        province:     meta.province || '',
        target:       target,
        fc_lm:        Math.round(fc.lm),
        fc_fm:        Math.round(fc.fm),
        fc_total:     Math.round(fc.lm + fc.fm),
        riders_plan:  Math.round(rp * 100) / 100,
        fc_per_rider: rp > 0 ? Math.round((fc.lm + fc.fm) / rp * 10) / 10 : 0,
      });
    }
  });
  var full = { allStations: allStationsFull, rows: fullRows };
  // TTL 5 phút — đủ ngắn để không lệch quá lâu nếu nguồn FC/Riders có cập nhật mới,
  // đủ dài để cắt phần lớn chi phí đọc Sheet cho các lượt tải liên tiếp trong cùng phiên làm việc.
  CacheMgr.setChunked('RIDER_PLAN', 'fc_full_' + monthStr, full, 300);
  return full;
}

// ── 2. loadForecastData(month) ──
function loadForecastData(month, access, overrideHub) {
  try {
    // [FIX BẢO MẬT NGHIÊM TRỌNG — phát hiện qua rà soát chủ động theo yêu cầu
    // kiểm tra lỗ hổng] TRƯỚC ĐÂY "if (!access) access = getCurrentUserAccess();"
    // — CHỈ tự tính quyền NẾU access KHÔNG được truyền vào. Vì đây là hàm PUBLIC
    // (Apps Script KHÔNG có khái niệm "hàm nội bộ" thật — MỌI hàm top-level đều
    // gọi được trực tiếp qua google.script.run từ Console trình duyệt, kể cả
    // không có onclick/lời gọi nào trong code client), BẤT KỲ AI cũng có thể mở
    // F12 và gọi: google.script.run.loadForecastData('2026-09', {role:'admin',
    // unrestricted:true}) — hàm sẽ TIN TƯỞNG HOÀN TOÀN access giả đó, bỏ qua
    // mọi kiểm tra quyền thật, trả về TOÀN BỘ dữ liệu forecast mọi trạm. Sửa:
    // LUÔN tự tính lại access từ session thật (Session.getActiveUser()), KHÔNG
    // BAO GIỜ tin tham số truyền vào từ bên ngoài nữa — an toàn tuyệt đối, và
    // KHÔNG ảnh hưởng gì tới lời gọi hợp lệ từ loadAllData() (vẫn ra kết quả
    // giống hệt vì cùng 1 session thật, chỉ tính lại 1 lần thay vì tái dùng).
    access = getCurrentUserAccess();
    if (access.role === 'denied') return { success: false, msg: 'Không có quyền truy cập Rider Plan.' };

    var monthStr = month || _rp_currentMonth();
    var parsed   = _rp_parseMonth(monthStr);
    var year = parsed.year, mon = parsed.mon;

    // Bước 1: lấy dữ liệu FULL (mọi trạm) — ưu tiên từ cache dùng chung (CacheMgr, key
    // theo tháng, KHÔNG theo user/role, để mọi user cùng tháng đều hưởng lợi, kể cả
    // admin lẫn station). Dùng CacheMgr.getChunked/setChunked — API chunk dùng chung
    // (xem CacheMgr ở đầu file), KHÔNG tự viết lại thuật toán chunk riêng cho Rider Plan.
    // Chỉ cache dữ liệu FC/Riders/Target (đọc-only, đến từ auto-sync ngoài — Rider Plan
    // không ghi gì vào các sheet nguồn đó). TUYỆT ĐỐI không cache Rider_Plan/Rider_Plan_Driver
    // (dữ liệu user tự nhập) — xem loadRiderPlan()/saveRiderPlan() bên dưới, luôn đọc trực tiếp.
    var full = CacheMgr.getChunked('RIDER_PLAN', 'fc_full_' + monthStr);

    if (!full) {
      // [FIX 2026-08-01] "CACHE STAMPEDE" — cùng lớp lỗi đã gặp và vá ở KPI Fail/
      // Aging, nhưng module Rider Plan chưa từng được vá. TTL cache chỉ 5 phút;
      // nếu nhiều user cùng mở Rider Plan đúng lúc cache vừa hết hạn (vd đầu ca),
      // MỖI người tự build lại độc lập từ 4 sheet nguồn (Sheet1 (auto), FC (auto),
      // #Riders (auto), SA map) — sheet FC (auto) đọc TOÀN BỘ cột ngày (rộng dần
      // theo thời gian, không chỉ lọc đúng tháng cần) nên phép build này không hề
      // rẻ. Nhiều lượt build song song chính là nguyên nhân khả dĩ nhất gây "load
      // chậm/không trả về" — thêm khóa để chỉ 1 lượt build thật, còn lại chờ rồi
      // dùng lại kết quả (double-check sau khi giành khóa).
      var gotRpLock = _anaAcquireNamedLock('riderplan_fc_build_lock_v1', 45000, 180000);
      if (gotRpLock) {
        try {
          full = CacheMgr.getChunked('RIDER_PLAN', 'fc_full_' + monthStr);
          if (!full) full = _rp_buildFullForecastData_(year, mon, monthStr);
        } finally {
          _anaReleaseNamedLock('riderplan_fc_build_lock_v1');
        }
      } else {
        // Hiếm khi xảy ra (lượt giữ khóa cũng đang chậm bất thường) — vẫn tự
        // build độc lập, thà chậm hơn 1 chút còn hơn để user bị treo response.
        full = _rp_buildFullForecastData_(year, mon, monthStr);
      }
    }

    // Bước 2: lọc theo quyền user — thao tác mảng thuần JS, không đụng tới Sheet, rất rẻ.
    // [MỚI — theo yêu cầu trực tiếp "Rider Plan cũng phải cần view theo từng
    // level để xác định đúng sai"] Khi Admin đang "Xem thử Lead/Staff" ở 1 Hub
    // cụ thể, cho phép ghi đè xuống ĐÚNG 1 trạm đó — cùng nguyên tắc bảo mật đã
    // dùng ở loadRiderPlan() (chỉ Admin thật mới dùng được, không phải lỗ hổng
    // cho non-admin lách qua ngoài quyền thật của họ).
    // [SỬA — Xem thử cấp SUP/AOM/ROM] overrideHub nay có thể là DANH SÁCH trạm
  // (ngăn cách '||'), vì mỗi cấp quản nhiều trạm. Trước đây chỉ nhận 1 trạm nên
  // xem thử cấp SUP vẫn tải theo quyền Admin -> 370 trạm -> bị chặn.
  var _ovSc = (access.role === 'admin' && overrideHub) ? _spxScopeHubs_(overrideHub) : null;
  var _normOverride = (_ovSc && !_ovSc.empty) ? _ovSc : null;
    var stations = full.allStations.filter(function(s) {
      if (_normOverride) return _normOverride.has(s);
      if (access.role === 'admin') return true;
      return access.hubs.indexOf(s) >= 0;
    });
    var stationSet = {};
    stations.forEach(function(s){ stationSet[s] = true; });
    var rows = full.rows.filter(function(r){ return stationSet[r.station]; });

    return { success: true, stations: stations.length, rows: rows };
  } catch(e) {
    return { success: false, msg: e.message };
  }
}

// ── 3. loadRiderPlan(month) ───────────────────────────────────────────────────

// ── 3. loadRiderPlan(month) ───────────────────────────────────────────────────
// Schema MỚI: Month | Station | Data (JSON: { "FC LM":[31], "Inbound TT":[31], ... })
// Mỗi (Month, Station) chỉ có DUY NHẤT 1 dòng.
function loadRiderPlan(month, access, overrideHub) {
  try {
    // [FIX BẢO MẬT NGHIÊM TRỌNG — cùng lỗ hổng/cùng cách sửa đã áp dụng ở
    // loadForecastData() phía trên] Xem giải thích đầy đủ tại đó.
    // [GHI NHẬN — phát hiện phụ khi rà soát cho Tổng quan, CHƯA sửa vì ngoài
    // phạm vi hiện tại] Dòng dưới đây GHI ĐÈ tham số access truyền vào bằng
    // getCurrentUserAccess() gọi lại từ đầu — nghĩa là "truyền access vào để
    // tránh gọi lại SA sheet 3 lần thừa" (comment ở loadAllData()) không thực
    // sự có tác dụng cho hàm này.
    access = getCurrentUserAccess();
    if (access.role === 'denied') return { success:false, msg:'Không có quyền.' };
    var monthStr = month || _rp_currentMonth();
    var ss    = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName('Rider_Plan');
    if (!sheet || sheet.getLastRow() <= 1) return { success:true, month:monthStr, data:{} };

    var values = sheet.getRange(2, 1, sheet.getLastRow()-1, 3).getValues();
    var result = {};
    // [MỚI — theo yêu cầu trực tiếp "Tổng quan không đổi theo level"] Khi
    // Admin đang "Xem thử Lead/Staff" ở 1 Hub cụ thể, chỉ Admin mới dùng được
    // — không phải lỗ hổng cho non-admin lách qua ngoài quyền thật của họ.
    // [SỬA — Xem thử cấp SUP/AOM/ROM] overrideHub nay có thể là DANH SÁCH trạm
  // (ngăn cách '||'), vì mỗi cấp quản nhiều trạm. Trước đây chỉ nhận 1 trạm nên
  // xem thử cấp SUP vẫn tải theo quyền Admin -> 370 trạm -> bị chặn.
  var _ovSc = (access.role === 'admin' && overrideHub) ? _spxScopeHubs_(overrideHub) : null;
  var _normOverride = (_ovSc && !_ovSc.empty) ? _ovSc : null;
    for (var i = 0; i < values.length; i++) {
      var rowMonth = _rp_monthCellToStr(values[i][0]);
      var station  = String(values[i][1]||'').trim();
      if (rowMonth !== monthStr || !station) continue;
      if (_normOverride) {
        if (!_normOverride.has(station)) continue;
      } else if (access.role !== 'admin' && access.hubs.indexOf(station) < 0) continue;
      try {
        var parsed = JSON.parse(values[i][2] || '{}');
        var clean  = {};
        Object.keys(parsed).forEach(function(metric){
          clean[metric] = (parsed[metric]||[]).map(function(v){
            return (v===''||v===null||v===undefined) ? null : Number(v);
          });
        });
        result[station] = clean;
      } catch(e) { /* JSON lỗi → bỏ qua dòng này */ }
    }
    return { success:true, month:monthStr, data:result };
  } catch(e) {
    return { success:false, msg:e.message };
  }
}

// ── 4. saveRiderPlan(payload) ─────────────────────────────────────────────────
// payload.rows: [{station, metric, values:[31]}, ...] (giữ nguyên format frontend gửi)
// Backend GROUP theo station → merge vào JSON hiện có → upsert DUY NHẤT 1 dòng/(Month,Station)
// ── [FIX NGHẼN LOCK 2026-07-24] NAMED LOCK RIÊNG CHO RIDER_PLAN ──
// TRƯỚC ĐÂY saveRiderPlan() đổi từ getUserLock() sang thẳng LockService.getScriptLock()
// (xem comment cũ "FIX RACE ĐA NGƯỜI DÙNG" phía trên _rp_getOrCreateSheet) để chặn race
// giữa 2 user khác nhau lưu cùng trạm/tháng — nhưng getScriptLock() là khóa TOÀN CỤC
// của CẢ SCRIPT, đang bị ÍT NHẤT 15 hàm khác dùng chung (saveSnapshot/savePickupOnly,
// trendNightlyPurge chờ tới 60s, syncSmartData...). Rider Plan tự thân RẤT NHẸ (chỉ vài
// con số/ngày) nhưng mỗi lần lưu phải XẾP HÀNG sau MỌI thao tác nặng không liên quan gì
// ở module khác đang giữ khóa toàn cục đó — với hàng trăm trạm autosave liên tục, hàng
// đợi này dễ kéo dài nhiều phút dù bản thân việc ghi chỉ mất <1s. Đây chính là NGUYÊN
// NHÂN user báo "đang lưu" treo 10-15 phút dù trước đây chỉ 2-3s.
// FIX: dùng named lock riêng cho Rider_Plan qua PropertiesService — ĐÚNG kỹ thuật đã áp
// dụng cho KPIFail_Notes (_kpifail_acquireNoteLock_ ở trên) — chỉ chặn LẪN NHAU giữa các
// lượt lưu Rider Plan, hoàn toàn tách biệt khỏi mọi module khác trong hệ thống. Vẫn giữ
// đúng mục tiêu chống race đa người dùng ban đầu (chỉ 1 lượt lưu Rider_Plan chạy tại 1
// thời điểm), chỉ khác là không còn kéo theo cả hệ thống chờ chung.
var RIDERPLAN_SAVE_LOCK_KEY = 'riderplan_save_lock_v1';

function _riderplan_acquireSaveLock_(maxWaitMs, staleMs) {
  maxWaitMs = maxWaitMs || 20000;
  staleMs   = staleMs   || 30000; // lock cũ quá staleMs coi như process trước crash, tự giải phóng
  var props = PropertiesService.getScriptProperties();
  var waitStart = Date.now();
  while (Date.now() - waitStart < maxWaitMs) {
    var acquireLock = LockService.getScriptLock();
    var gotIt = false;
    try {
      acquireLock.waitLock(2000); // chỉ giữ ScriptLock rất ngắn để check-and-set an toàn
      var existing = props.getProperty(RIDERPLAN_SAVE_LOCK_KEY);
      if (!existing || (Date.now() - parseInt(existing, 10)) > staleMs) {
        props.setProperty(RIDERPLAN_SAVE_LOCK_KEY, String(Date.now()));
        gotIt = true;
      }
    } catch (eAcquire) {
      // ScriptLock ngắn (2s) timeout — hiếm, thử lại vòng sau.
    } finally {
      try { acquireLock.releaseLock(); } catch (e2) {}
    }
    if (gotIt) return true;
    Utilities.sleep(200);
  }
  return false;
}

function _riderplan_releaseSaveLock_() {
  try { PropertiesService.getScriptProperties().deleteProperty(RIDERPLAN_SAVE_LOCK_KEY); } catch (e) {}
}

function saveRiderPlan(payload) {
  if (!_riderplan_acquireSaveLock_(20000)) {
    return { success:false, msg:'Hệ thống đang bận lưu Rider Plan cho trạm khác, vui lòng thử lại sau ít giây.' };
  }
  try {
    var access = getCurrentUserAccess();
    if (access.role === 'denied') return { success:false, msg:'Không có quyền.' };
    var monthStr = String(payload.month || _rp_currentMonth()).trim();
    var rows     = payload.rows || [];
    var ss    = _DS.ss(ADMIN_DB_ID);
    var sheet = _rp_getOrCreateSheet(ss, 'Rider_Plan', ['Month','Station','Data']);

    // Gom theo station: { station: { metric: [31] } }
    var byStation = {};
    rows.forEach(function(r) {
      var station = String(r.station||'').trim();
      var metric  = String(r.metric ||'').trim();
      if (!station || !metric) return;
      if (access.role !== 'admin' && access.hubs.indexOf(station) < 0) return;
      var vals = (r.values||[]).slice(0,31);
      while(vals.length < 31) vals.push(null);
      if (!byStation[station]) byStation[station] = {};
      byStation[station][metric] = vals;
      if (Array.isArray(r.biEdited) && r.biEdited.length) {
        byStation[station]['__edited__' + metric] = r.biEdited.map(Number);
      }
    });

    var stations = Object.keys(byStation);
    if (!stations.length) return { success:true, updated:0, inserted:0 };

    // Map (Month|Station) → rowIndex (1-based, hàng thật trong sheet)
    var lastRow = sheet.getLastRow();
    var keyMap  = {};
    if (lastRow > 1) {
      var existing = sheet.getRange(2, 1, lastRow-1, 2).getValues();
      for (var i = 0; i < existing.length; i++) {
        var m = _rp_monthCellToStr(existing[i][0]);
        var s = String(existing[i][1]||'').trim();
        if (m && s) keyMap[m+'|'+s] = i + 2;
      }
    }

    var newRows = [], updated = 0;
    stations.forEach(function(station) {
      var k = monthStr + '|' + station;
      var dataObj = {};
      if (keyMap.hasOwnProperty(k)) {
        // Đọc JSON cũ để MERGE (giữ lại các metric không nằm trong lần lưu này)
        var oldJson = sheet.getRange(keyMap[k], 3).getValue();
        try { dataObj = JSON.parse(oldJson || '{}'); } catch(e) { dataObj = {}; }
      }
      // [MỚI — sửa lỗi Rider Plan ghi đè số mới của BI bằng bản cũ trong bộ nhớ]
      // Rider Plan gửi NGUYÊN mảng 31 ngày của mọi chỉ số, lấy từ bản nó đang giữ.
      // Nếu bản đó tải TRƯỚC khi BI đồng bộ, lượt lưu sẽ đè số mới của BI bằng số
      // cũ (đã xảy ra thật: ô Tổng đơn / Giao TC mất viền 'do BI điền').
      // Quy tắc: ô đang DO BI SỞ HỮU (giá trị hiện tại == dấu BI) CHỈ bị thay khi
      // người dùng THỰC SỰ SỬA TAY ô đó (có trong danh sách __edited__). Còn lại
      // giữ số của BI. Bảo vệ cả khi người khác, trên máy khác, đang mở Rider Plan.
      Object.keys(byStation[station]).forEach(function(metric){
        if (metric.indexOf('__edited__') === 0) return;
        var incoming = byStation[station][metric];
        var mk = dataObj['__bi__' + metric];
        if (RP_BI_SYNC_METRICS.indexOf(metric) >= 0 && Array.isArray(mk) && Array.isArray(dataObj[metric])) {
          var edited = {}; (byStation[station]['__edited__' + metric] || []).forEach(function(d){ edited[d] = 1; });
          var cur = dataObj[metric], merged = incoming.slice();
          for (var d = 0; d < 31; d++) {
            var biOwned = mk[d] !== null && mk[d] !== undefined && cur[d] !== null && cur[d] !== undefined && Number(cur[d]) === Number(mk[d]);
            if (biOwned && !edited[d]) merged[d] = cur[d];      // giữ số của BI
          }
          dataObj[metric] = merged;
        } else {
          dataObj[metric] = incoming;
        }
      });
      var json = JSON.stringify(dataObj);

      if (keyMap.hasOwnProperty(k)) {
        sheet.getRange(keyMap[k], 1, 1, 3).setValues([[monthStr, station, json]]);
        updated++;
      } else {
        newRows.push([monthStr, station, json]);
      }
    });

    if (newRows.length)
      sheet.getRange(sheet.getLastRow()+1, 1, newRows.length, 3).setValues(newRows);

    return { success:true, updated:updated, inserted:newRows.length };
  } catch(e) {
    return { success:false, msg:e.message };
  } finally {
    _riderplan_releaseSaveLock_();
  }
}

// ── 4b. riderPlan_exportToSheetLink(pool, monthStr) ───────────────────────────
// Xuất dữ liệu Rider Plan của các trạm trong `pool` sang spreadsheet cố định
// (RP_EXPORT_SPREADSHEET_ID), gộp nhóm chỉ số giống bản Excel client (METRIC_GROUPS).
// Mỗi tab = 1 SUP thật (lấy từ AOM SUP sheet, KHÔNG phải role của người xuất — 1 AOM
// có thể quản nhiều SUP, mỗi SUP xuất ra 1 tab riêng) + tháng, vd "Nguyễn Văn A_2026-07".
// Tab đã tồn tại thì GHI ĐÈ (clearContents rồi ghi lại) — không cộng dồn dữ liệu cũ.
//
// [QUAN TRỌNG] KHÔNG dùng LockService.getScriptLock() ở đây — hàm này ghi vào 1
// spreadsheet KHÁC hẳn (không đụng Rider_Plan/App_Notes/KPIFail_Notes), và có thể chạy
// khá lâu khi xuất nhiều SUP/nhiều trạm cùng lúc. Giữ script lock (dùng chung toàn bộ
// backend) trong lúc này sẽ chặn note-save/rider-plan-save của TẤT CẢ user khác suốt
// thời gian export — đúng lớp lỗi vừa sửa ở aging_saveNote (xem ghi chú ở đó).
/**
 * rp_upsertDayFromBI(payloadJson)
 * [MỚI — theo yêu cầu: "cập nhật dữ liệu BI thì cập nhật luôn sang Rider Plan"]
 * Ghi số liệu THỰC TẾ của 1 ngày từ module BI sang Rider Plan.
 *
 * QUYẾT ĐỊNH NGHIỆP VỤ (đã xác nhận):
 *   - Inbound TT / Giao LM TT CÙNG cách tính với Inbound / Tổng đơn của BI,
 *     lệch nhau chỉ do khác thời điểm -> đồng bộ cả 4 chỉ số.
 *   - LUÔN GHI ĐÈ bằng số mới nhất của BI, NHƯNG đánh dấu ô do BI điền.
 *
 * VÌ SAO KHÔNG dùng saveRiderPlan() có sẵn: hàm đó thay NGUYÊN MẢNG 31 NGÀY
 * của mỗi chỉ số — BI chỉ có số của 1 ngày, dùng hàm cũ sẽ XOÁ 30 ngày còn lại.
 * Hàm này gộp theo TỪNG NGÀY, và dùng CHUNG khoá chống ghi đè với saveRiderPlan.
 *
 * ĐÁNH DẤU "DO BI ĐIỀN": lưu thêm khoá '__bi__<chỉ số>' là MẢNG SỐ chứa đúng
 * giá trị BI đã ghi. Phải là mảng số vì loadRiderPlan() ép mọi khoá thành mảng
 * — lưu dạng object sẽ làm lỗi và BỎ QUA CẢ DÒNG của trạm (đã chạy thử).
 * Ô hiển thị "do BI điền" khi giá trị hiện tại == giá trị trong dấu -> người
 * dùng sửa tay thì giá trị lệch dấu -> tự hết đánh dấu, không cần sửa luồng lưu.
 *
 * KHOÁ CHỈ SỐ: màn hình hiện "Giao TC (thực tế)" nhưng Rider Plan LƯU bằng khoá
 * 'Giao TT' — phải ghi đúng 'Giao TT', nếu không số sẽ không bao giờ hiện lên.
 */
// [SỬA theo phản hồi] KHÔNG ghi Rider TT / Prod TT — đó là số KẾ HOẠCH người quản
// trạm tự lập. Backend CHẶN CỨNG: dù client gửi lên cũng bị bỏ qua.
var RP_BI_SYNC_METRICS = ['Inbound TT', 'Giao LM TT', 'Giao TT', 'Lấy FM TT', 'Đơn hủy', 'Đơn hẹn'];

/**
 * rp_reconcileFromStationDaily(monthStr, stationFilter)
 * [MỚI — theo phản hồi: "dữ liệu hàng lấy chỉ lưu tạm ở lượt upload, làm sao đồng
 * bộ lại nếu miss?"]
 * Thực tế dữ liệu hàng lấy CÓ nằm trên máy chủ: savePickupOnly() ghi vào Station_Daily
 * (cột O/P/Q = tổng / đã lấy / tỉ lệ) theo từng trạm/ngày. Nghĩa là không cần phụ
 * thuộc trình duyệt nữa.
 * Hàm này đối chiếu: ngày nào Station_Daily CÓ số hàng lấy mà Rider Plan CHƯA có
 * thì bù vào. Nhờ vậy dù người dùng đóng tab, đổi máy, hay xoá dữ liệu trình duyệt,
 * số vẫn về đúng chỗ.
 * KHÔNG đụng ô người dùng tự nhập tay — dùng lại đúng quy tắc của rp_upsertDayFromBI.
 */
function rp_reconcileFromStationDaily(monthStr, stationFilter, xemTruoc) {
  // [MỚI] xemTruoc = true -> CHỈ LIỆT KÊ sẽ đổi gì, KHÔNG ghi vào dữ liệu thật.
  // Có chế độ này thì trước khi để job đêm chạy diện rộng, người vận hành xem
  // trước được từng ô "cũ -> mới" và tự đối chiếu với số trên BI.
  try {
    // [SỬA — cùng bẫy đã làm hỏng 5 job nền trước đó] Chạy theo lịch ban đêm thì
    // KHÔNG có người đăng nhập -> getCurrentUserAccess() trả 'denied' -> job im lặng
    // không bù gì. Nay: không có email tức là hệ thống tự gọi -> quét toàn bộ trạm.
    // Có email (người dùng bấm chạy) -> vẫn kiểm tra quyền như thường.
    var _rcEmail = '';
    try { _rcEmail = String(Session.getActiveUser().getEmail() || '').trim(); } catch (eEm) {}
    var _isSystemRun = !_rcEmail;
    var access = _isSystemRun ? { role: 'admin', hubs: [] } : getCurrentUserAccess();
    if (!_isSystemRun && (!access || access.role === 'denied')) {
      return JSON.stringify({ success: false, msg: 'Không có quyền.' });
    }
    monthStr = String(monthStr || _rp_currentMonth()).slice(0, 7);
    var only = String(stationFilter || '').trim().toLowerCase();

    var stSheet = _trendStationSheet(_DS.ss(MASTER_DB_ID));
    if (!stSheet || stSheet.getLastRow() < 2) return JSON.stringify({ success: true, buSung: 0, ghiChu: 'Chưa có dữ liệu Station_Daily.' });

    var vals = stSheet.getRange(2, 1, stSheet.getLastRow() - 1, 17).getValues();
    var isAdm = (access.role === 'admin');
    var allowed = {};
    (access.hubs || []).forEach(function (h) { allowed[_normStationKey_(h)] = 1; });

    var candidates = [];
    for (var i = 0; i < vals.length; i++) {
      // [SỬA LỖI THẬT — chạy thử ra "Không có ngày nào cần bù" dù dữ liệu có thật]
      // Ô ngày trong Station_Daily là kiểu DATE của Sheets, không phải chuỗi. Dùng
      // String() trên nó ra dạng "Tue Sep 22 2026..." -> cắt 10 ký tự thành "Tue Sep 2"
      // -> không khớp tháng -> danh sách luôn rỗng và job bù thành vô tác dụng.
      // Hàm _trendFindStationRow() sẵn có đã xử lý đúng việc này; nay dùng cùng cách.
      var _rawD = vals[i][0];
      var dkey = (_rawD instanceof Date)
        ? Utilities.formatDate(_rawD, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
        : String(_rawD || '').slice(0, 10);
      var st   = String(vals[i][1] || '').trim();            // cột B: trạm
      if (!dkey || !st) continue;
      if (dkey.slice(0, 7) !== monthStr) continue;
      if (only && st.toLowerCase() !== only) continue;
      if (!isAdm && !allowed[_normStationKey_(st)]) continue;

      // [MỞ RỘNG — kiểm tra 5 chỉ số còn lại] Chỉ bù những chỉ số Station_Daily lưu
      // ĐÚNG BẰNG con số BI gửi sang, tránh bù ra số sai (nguy hiểm hơn không bù):
      //   · Lấy FM TT   = pickup_done (cột P)          -> khớp tuyệt đối
      //   · Giao LM TT  = total       (cột C)          -> khớp tuyệt đối
      //   · Giao TT     = delivered   (cột D)          -> khớp tuyệt đối
      //   · Inbound TT  = inbound     (cột M)          -> khớp tuyệt đối
      // KHÔNG bù 2 chỉ số sau, vì Station_Daily không lưu đúng cách BI tính:
      //   · Đơn hẹn = onhold + đơn đã quay về kho; Station_Daily chỉ có 'onhold'
      //   · Đơn hủy = đếm theo lý do huỷ trên từng đơn; Station_Daily không có cột này
      var mtr = {};
      var _pDone = Number(vals[i][15]);   // cột P
      var _total = Number(vals[i][2]);    // cột C
      var _deli  = Number(vals[i][3]);    // cột D
      var _inb   = Number(vals[i][12]);   // cột M
      if (isFinite(_pDone) && _pDone > 0) mtr['Lấy FM TT']  = _pDone;
      if (isFinite(_total) && _total > 0) mtr['Giao LM TT'] = _total;
      if (isFinite(_deli)  && _deli  > 0) mtr['Giao TT']    = _deli;
      if (isFinite(_inb)   && _inb   > 0) mtr['Inbound TT'] = _inb;
      if (!Object.keys(mtr).length) continue;
      candidates.push({ dateKey: dkey, station: st, metrics: mtr });
    }
    // [MỚI] Khi ra 0, nói rõ LÝ DO thay vì chỉ "không có ngày nào cần bù" — lần chạy
    // thử đầu tiên ra 0 vì lỗi đọc cột ngày, mà thông báo cũ không giúp truy ra.
    if (!candidates.length) {
      var _sample = [];
      for (var s = 0; s < Math.min(vals.length, 3); s++) {
        var _rd = vals[s][0];
        _sample.push((_rd instanceof Date)
          ? Utilities.formatDate(_rd, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd')
          : String(_rd || '').slice(0, 10));
      }
      return JSON.stringify({
        success: true, buSung: 0, thang: monthStr,
        soDongDaQuet: vals.length,
        ngayMauTrongSheet: _sample,
        ghiChu: 'Không có ngày nào cần bù. Nếu "ngayMauTrongSheet" khác tháng đang xét thì đổi tháng khi gọi hàm.'
      });
    }

    // Chế độ xem trước cần biết Rider Plan HIỆN đang có số gì -> đọc bảng đúng 1 lần.
    var _rpNow = {};
    if (xemTruoc) {
      try {
        var _shRP = _rp_getOrCreateSheet(_DS.ss(ADMIN_DB_ID), 'Rider_Plan', ['Month', 'Station', 'Data']);
        if (_shRP && _shRP.getLastRow() > 1) {
          var _vRP = _shRP.getRange(2, 1, _shRP.getLastRow() - 1, 3).getValues();
          for (var z = 0; z < _vRP.length; z++) {
            if (_rp_monthCellToStr(_vRP[z][0]) !== monthStr) continue;
            try { _rpNow[String(_vRP[z][1] || '').trim()] = JSON.parse(_vRP[z][2] || '{}'); } catch (eP) {}
          }
        }
      } catch (eRP) {}
    }

    var buSung = 0, boQua = 0, chiTiet = [];
    for (var k = 0; k < candidates.length && k < 200; k++) {
      var c = candidates[k];
      var res;
      if (xemTruoc) {
        // Đọc SỐ HIỆN CÓ trong Rider Plan để so cũ/mới. Bảng Rider_Plan đọc đúng 1
        // lần cho cả lượt (xem _rpNow bên dưới) nên không tốn thêm lượt gọi sheet.
        var _cur = (_rpNow[c.station] || {});
        var _dIdx = parseInt(c.dateKey.substring(8, 10), 10) - 1;
        var _diffs = [];
        Object.keys(c.metrics).forEach(function (m) {
          var arrNow = Array.isArray(_cur[m]) ? _cur[m] : [];
          var biNow  = Array.isArray(_cur['__bi__' + m]) ? _cur['__bi__' + m] : [];
          var cu = arrNow[_dIdx];
          var laNhapTay = (cu !== null && cu !== '' && typeof cu !== 'undefined') &&
                          (biNow[_dIdx] === null || typeof biNow[_dIdx] === 'undefined');
          if (laNhapTay && Number(cu) !== c.metrics[m]) {
            _diffs.push(m + ': GIỮ số nhập tay ' + cu + ' (bỏ qua ' + c.metrics[m] + ')');
          } else if (Number(cu) === c.metrics[m]) {
            // đã đúng, không đổi
          } else {
            _diffs.push(m + ': ' + ((cu === null || cu === '' || typeof cu === 'undefined') ? 'trống' : cu) +
                        ' -> ' + c.metrics[m]);
          }
        });
        if (_diffs.length) {
          buSung++;
          chiTiet.push('[XEM TRƯỚC] ' + c.station + ' · ' + c.dateKey + ' | ' + _diffs.join(' ; '));
        } else { boQua++; }
        continue;
      }
      try {
        res = JSON.parse(rp_upsertDayFromBI(JSON.stringify({
          station: c.station, dateKey: c.dateKey, metrics: c.metrics, asOf: {}
        })));
      } catch (eU) { res = { success: false, msg: eU.message }; }
      if (res && res.success && res.written && res.written.length) {
        buSung++;
        chiTiet.push(c.station + ' · ' + c.dateKey + ' | ' +
          res.written.map(function (w) {
            return (w && w.metric) ? (w.metric + ': ' + w.cu + ' -> ' + w.moi) : String(w);
          }).join(' ; '));
      } else { boQua++; }
    }
    return JSON.stringify({
      success: true, thang: monthStr,
      soNgayXet: candidates.length,
      daXuLyLuotNay: Math.min(candidates.length, 200),
      conLaiChuaXuLy: Math.max(0, candidates.length - 200),
      buSung: buSung,          // số ngày THẬT SỰ được ghi số mới
      khongDoi: boQua,         // ngày đã có sẵn số đúng — không cần đụng
      chiTiet: chiTiet.slice(0, 20),
      ghiChu: (candidates.length > 200)
        ? 'Còn ' + (candidates.length - 200) + ' ngày chưa xử lý — chạy lại hàm này để tiếp tục.'
        : 'Đã xử lý hết trong tháng này.'
    });
  } catch (e) { return JSON.stringify({ success: false, msg: e.message }); }
}

/** Chạy tay: bù cho tháng hiện tại, trong phạm vi quyền của người chạy. */
// Đổi tháng cần bù ở đây nếu muốn chạy cho tháng trước (dạng 'YYYY-MM'), để trống
// là tháng hiện tại.
var SPX_RECONCILE_MONTH = '';
// Đặt true để XEM TRƯỚC (không ghi gì), false để bù thật.
var SPX_RECONCILE_PREVIEW = false;
function spx_runReconcilePickup() {
  var out = rp_reconcileFromStationDaily(SPX_RECONCILE_MONTH || null, null, SPX_RECONCILE_PREVIEW);
  Logger.log(out);
  return out;
}

function rp_upsertDayFromBI(payloadJson) {
  var p;
  try { p = (typeof payloadJson === 'string') ? JSON.parse(payloadJson) : payloadJson; }
  catch (e) { return JSON.stringify({ success: false, msg: 'Dữ liệu gửi lên không hợp lệ.' }); }
  var station = String((p && p.station) || '').trim();
  var dateKey = String((p && p.dateKey) || '').trim();
  var metrics = (p && p.metrics) || {};
  if (!station) return JSON.stringify({ success: false, msg: 'Thiếu trạm.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return JSON.stringify({ success: false, msg: 'Ngày dữ liệu không hợp lệ: ' + dateKey });

  // Chỉ nhận ngày trong 40 ngày gần nhất và không ở tương lai — chặn số rác do
  // file cũ / đồng hồ máy người dùng sai.
  var today = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  var diff = (new Date(today + 'T00:00:00Z') - new Date(dateKey + 'T00:00:00Z')) / 86400000;
  if (diff < 0 || diff > 40) return JSON.stringify({ success: false, msg: 'Ngày dữ liệu ngoài phạm vi đồng bộ: ' + dateKey });

  // [SỬA — cùng bẫy job nền] Được job đêm (rp_reconcileFromStationDaily) gọi lại,
  // khi đó KHÔNG có người đăng nhập -> getCurrentUserAccess() trả 'denied' và hàm
  // này chặn hết, job bù thành vô tác dụng. Không có email = hệ thống tự gọi.
  var _upEmail = '';
  try { _upEmail = String(Session.getActiveUser().getEmail() || '').trim(); } catch (eUe) {}
  var access = _upEmail ? getCurrentUserAccess() : { role: 'admin', hubs: [] };
  if (!access || access.role === 'denied') return JSON.stringify({ success: false, msg: 'Không có quyền.' });
  if (access.role !== 'admin' && (access.hubs || []).indexOf(station) < 0) {
    return JSON.stringify({ success: false, msg: 'Trạm ngoài phạm vi quản lý.' });
  }

  var monthStr = dateKey.substring(0, 7);
  var dayIdx = parseInt(dateKey.substring(8, 10), 10) - 1;   // 0..30

  if (!_riderplan_acquireSaveLock_(20000)) {
    return JSON.stringify({ success: false, msg: 'Rider Plan đang được lưu, sẽ thử lại lần sau.' });
  }
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    var sheet = _rp_getOrCreateSheet(ss, 'Rider_Plan', ['Month', 'Station', 'Data']);
    var rowIdx = -1, dataObj = {};
    var last = sheet.getLastRow();
    if (last > 1) {
      var keys = sheet.getRange(2, 1, last - 1, 2).getValues();
      for (var i = 0; i < keys.length; i++) {
        if (_rp_monthCellToStr(keys[i][0]) === monthStr && String(keys[i][1] || '').trim() === station) { rowIdx = i + 2; break; }
      }
    }
    if (rowIdx > 0) {
      try { dataObj = JSON.parse(sheet.getRange(rowIdx, 3).getValue() || '{}'); } catch (e) { dataObj = {}; }
    }
    // [MỚI] Giờ THẬT của dữ liệu (lấy từ tên file xuất phía BI), lưu kèm theo từng
    // ngày/chỉ số để Rider Plan phân biệt SỐ CHỐT (file xuất sau khi ngày đã kết thúc)
    // với SỐ TRONG NGÀY (file xuất giữa ca, có thể chưa phải số cuối). Vận hành không
    // có mốc giờ chốt cố định nên KHÔNG dùng mốc giờ — chỉ so ngày xuất với ngày dữ liệu.
    var asOfMap = (p && p.asOf) || {};
    var _nowMs = Date.now();
    var written = [], skipped = [], unchanged = [];
    RP_BI_SYNC_METRICS.forEach(function (m) {
      if (!metrics.hasOwnProperty(m)) return;
      var v = Number(metrics[m]);
      if (!isFinite(v) || v < 0) return;
      var arr = Array.isArray(dataObj[m]) ? dataObj[m].slice(0, 31) : [];
      while (arr.length < 31) arr.push(null);
      var mk = '__bi__' + m;
      var marr = Array.isArray(dataObj[mk]) ? dataObj[mk].slice(0, 31) : [];
      while (marr.length < 31) marr.push(null);

      // [SỬA LỖI THẬT — tình huống: user bỏ dở đồng bộ ngày 24, hôm sau mới mở lại]
      // Dữ liệu vẫn vào ĐÚNG ngày 24 (tháng/ngày suy từ dateKey, không phải ngày gửi).
      // NHƯNG trước đây dòng ghi là ghi đè VÔ ĐIỀU KIỆN: nếu trong lúc chờ người dùng
      // đã TỰ NHẬP TAY số cho ngày đó, bản đồng bộ muộn sẽ XOÁ số họ nhập — mất công
      // sức và không ai biết.
      // Quy tắc: ô đang có số mà KHÔNG mang dấu của BI ('__bi__') tức là người dùng
      // tự nhập -> GIỮ NGUYÊN, chỉ ghi nhận là đã bỏ qua. Người nhập tay luôn thắng.
      var _cur = arr[dayIdx];
      var _isUserTyped = (_cur !== null && _cur !== '' && typeof _cur !== 'undefined') &&
                         (marr[dayIdx] === null || typeof marr[dayIdx] === 'undefined');
      if (_isUserTyped && Number(_cur) !== v) {
        skipped.push({ metric: m, giuLai: _cur, boQua: v });
        return;
      }
      // [MỚI] Ô đã có ĐÚNG số này và do BI ghi -> không cần ghi lại. Trước đây vẫn
      // ghi đè nên bộ đối chiếu đếm nhầm là "đã bù", làm con số báo cáo bị thổi phồng
      // (chạy thử ra 200 trong khi phần lớn chỉ là ghi lại y nguyên).
      if (Number(_cur) === v && marr[dayIdx] !== null && typeof marr[dayIdx] !== 'undefined') {
        unchanged.push(m);
        return;
      }

      arr[dayIdx] = v;                                  // CHỈ đụng đúng 1 ngày
      dataObj[m] = arr;
      marr[dayIdx] = v;
      dataObj[mk] = marr;
      // Giờ dữ liệu (mili-giây). Bỏ qua giá trị vô lý (tương lai quá 2 giờ hoặc quá cũ).
      var at = Number(asOfMap[m]);
      if (isFinite(at) && at > 0 && at < _nowMs + 7200000 && (_nowMs - at) < 400 * 86400000) {
        var ak = '__bi_at__' + m;
        var aarr = Array.isArray(dataObj[ak]) ? dataObj[ak].slice(0, 31) : [];
        while (aarr.length < 31) aarr.push(null);
        aarr[dayIdx] = at;
        dataObj[ak] = aarr;
      }
      // [MỚI — theo phản hồi: "bổ sung mà không biết bổ sung giá trị gì thì làm sao
      // kiểm chứng đúng sai"] Ghi kèm GIÁ TRỊ CŨ và GIÁ TRỊ MỚI để đối chiếu được
      // với số trên BI, thay vì chỉ nêu tên chỉ số.
      written.push({ metric: m, cu: (_cur === null || _cur === '' || typeof _cur === 'undefined') ? 'trống' : _cur, moi: v });
    });
    if (!written.length) return JSON.stringify({ success: true, written: [], unchanged: unchanged, skipped: skipped });
    var json = JSON.stringify(dataObj);
    if (rowIdx > 0) sheet.getRange(rowIdx, 3).setValue(json);
    else sheet.appendRow([monthStr, station, json]);
    return JSON.stringify({ success: true, written: written, unchanged: unchanged, skipped: skipped, month: monthStr, day: dayIdx + 1 });
  } catch (e) {
    return JSON.stringify({ success: false, msg: e.message });
  } finally {
    _riderplan_releaseSaveLock_();
  }
}

var RP_EXPORT_SPREADSHEET_ID = '1oKLgSfShJbdeeWWVS2Hw8mLmBk2tvT7Uy0I-rRebM_g';

function _rp_sanitizeSheetTitle(s) {
  // Tên sheet Google Sheets không được chứa [ ] : * ? / \ và tối đa 100 ký tự.
  // Chuẩn hoá khoảng trắng thừa/đầu-cuối trước — tránh 2 lần xuất cùng SUP nhưng lệch
  // khoảng trắng trong dữ liệu nguồn lại tạo ra 2 tab khác nhau cho cùng SUP+tháng.
  return String(s||'').replace(/\s+/g,' ').trim().replace(/[\[\]\*\?\/\\:]/g, '_').substring(0, 90) || 'Chưa rõ SUP';
}

function riderPlan_exportToSheetLink(pool, monthStr) {
  try {
    var access = getCurrentUserAccess();
    if (access.role === 'denied') return { success:false, msg:'Không có quyền.' };

    // [YÊU CẦU] Chỉ AOM/SUP (và admin) được dùng tính năng xuất link Google Sheet —
    // HUB dù quản lý nhiều hơn 1 trạm vẫn KHÔNG được, chỉ có mục xuất file (CSV/Excel).
    // Chặn lại ở server (không chỉ ẩn nút phía client) để không thể gọi vòng qua console.
    if (access.role !== 'admin' && access.role !== 'aom' && access.role !== 'sup') {
      return { success:false, msg:'Tính năng này chỉ dành cho AOM/SUP.' };
    }

    if (!monthStr) monthStr = _rp_currentMonth();

    // Lọc lại pool theo quyền thật của user — an toàn ngay cả khi client gửi sai/thiếu.
    pool = (pool||[]).filter(function(s){ return access.role === 'admin' || access.hubs.indexOf(s) >= 0; });
    if (!pool.length) return { success:false, msg:'Không có trạm nào để xuất.' };

    var shortUser = access.email ? access.email.split('@')[0].toUpperCase() : 'USER';
    return _rp_doExportToSheetLink(pool, monthStr, shortUser);

  } catch(e) {
    return { success:false, msg:e.message };
  }
}

// ── 4c. riderPlan_subscribeAutoExport(pool, monthStr) ─────────────────────────
// Đăng ký TỰ ĐỘNG xuất lại mỗi ngày lúc ~23:30 cho tới hết monthStr (không có nút tắt
// riêng — sang tháng mới, dòng đăng ký cũ tự động không còn khớp tháng hiện tại nữa
// nên trigger tự bỏ qua và dọn luôn, coi như tự huỷ).
//
// Lưu đăng ký vào 1 sheet cấu hình DÙNG CHUNG (RiderPlan_ExportSubscriptions), 1 dòng
// / (Month, SupName) — nhiều SUP/AOM đăng ký cùng lúc thì CHỈ 1 trigger chung xử lý
// tuần tự tất cả (xem riderPlan_dailyAutoExportRun), không tạo trigger riêng cho từng
// SUP (Apps Script giới hạn số trigger/script, và tạo lắt nhắt sẽ khó quản lý).
//
// [FIX 2026-07-26] Hàm này KHÔNG còn tự tạo trigger nữa. Trước đây gọi
// _rp_ensureDailyExportTrigger_() ngay tại đây — nhưng web app chạy dưới
// "Execute as: User accessing the web app" (xem Session.getActiveUser() dùng khắp
// file), nên ScriptApp.newTrigger() gọi từ trong hàm này sẽ tạo trigger đứng tên
// TÀI KHOẢN CỦA NGƯỜI ĐANG BẤM NÚT — không phải tài khoản hệ thống cố định. Hệ quả:
// mỗi lần SUP/AOM khác nhau bấm "Tự động mỗi ngày", trigger cũ (thuộc tài khoản
// người bấm trước) không bị thấy/xoá được (ScriptApp.getProjectTriggers() chỉ trả
// về trigger của CHÍNH người đang gọi), nên có thể tồn tại nhiều trigger trôi nổi
// dưới nhiều tài khoản cá nhân khác nhau. Nếu tài khoản đang "giữ" trigger sống gặp
// vấn đề (đổi mật khẩu cần re-auth, mất quyền truy cập sheet đích, nghỉ việc...) thì
// TOÀN BỘ SUP đã đăng ký (không riêng gì tài khoản đó) sẽ ngừng được auto-export mà
// không có cảnh báo nào tới hệ thống — đây là nguyên nhân của lỗi "đã đăng ký tự
// động nhưng không thấy cập nhật".
//
// Trigger giờ được cài CỐ ĐỊNH 1 LẦN DUY NHẤT bởi admin/chủ script, chạy tay hàm
// riderPlan_installDailyExportTrigger_ADMIN() từ Apps Script Editor (xem hàm đó bên
// dưới) — cùng pattern với setupKPIFailCleanupTrigger(), pick_live_installPrewarmTrigger()
// đã có sẵn trong file này. riderPlan_subscribeAutoExport() giờ chỉ làm đúng 1 việc:
// ghi dòng đăng ký vào sheet cấu hình — KHÔNG đụng gì tới trigger.
var RP_EXPORT_SUB_SHEET = 'RiderPlan_ExportSubscriptions'; // Month | SupName | Pool(JSON) | RequestedBy | UpdatedAt

function _rp_getExportSubSheet_() {
  var ss = _DS.ss(ADMIN_DB_ID);
  var sheet = ss.getSheetByName(RP_EXPORT_SUB_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RP_EXPORT_SUB_SHEET);
    sheet.appendRow(['Month','SupName','Pool','RequestedBy','UpdatedAt']);
  }
  return sheet;
}

function riderPlan_subscribeAutoExport(pool, monthStr) {
  var lock = LockService.getScriptLock();
  try {
    var access = getCurrentUserAccess();
    if (access.role === 'denied') return { success:false, msg:'Không có quyền.' };
    if (access.role !== 'admin' && access.role !== 'aom' && access.role !== 'sup') {
      return { success:false, msg:'Tính năng này chỉ dành cho AOM/SUP.' };
    }
    if (!monthStr) monthStr = _rp_currentMonth();

    pool = (pool||[]).filter(function(s){ return access.role === 'admin' || access.hubs.indexOf(s) >= 0; });
    if (!pool.length) return { success:false, msg:'Không có trạm nào để xuất.' };

    var srcSS = _DS.ss(RP_SOURCE_ID);
    var saMap = _rp_buildSAMap(srcSS);
    var byRealSup = {};
    pool.forEach(function(station){
      var meta = saMap[station] || {};
      var supName = meta.sup || 'Chưa rõ SUP';
      if (!byRealSup[supName]) byRealSup[supName] = [];
      byRealSup[supName].push(station);
    });

    var shortUser = access.email ? access.email.split('@')[0].toUpperCase() : 'USER';

    lock.waitLock(10000);
    var sheet = _rp_getExportSubSheet_();
    var data  = sheet.getDataRange().getValues();
    var nowStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm");

    Object.keys(byRealSup).forEach(function(supName){
      var rowIdx = -1;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === monthStr && String(data[i][1]).trim() === supName) { rowIdx = i + 1; break; }
      }
      var poolJson = JSON.stringify(byRealSup[supName]);
      if (rowIdx > 0) {
        // Đã đăng ký từ trước (vd đăng ký lại sau khi thêm trạm) → cập nhật danh sách trạm
        sheet.getRange(rowIdx, 3, 1, 3).setValues([[poolJson, shortUser, nowStr]]);
      } else {
        sheet.appendRow([monthStr, supName, poolJson, shortUser, nowStr]);
      }
    });

    // [FIX 2026-07-26] KHÔNG tự tạo trigger ở đây nữa — xem giải thích ở comment đầu
    // hàm. Trigger đứng tên hệ thống được cài cố định 1 lần bởi admin qua
    // riderPlan_installDailyExportTrigger_ADMIN(), không phụ thuộc ai bấm nút subscribe.

  } catch(e) {
    return { success:false, msg:e.message };
  } finally {
    try { lock.releaseLock(); } catch(eLock){}
  }

  // Xuất ngay 1 lần để user thấy kết quả liền — không cần đợi tới 23:30 mới biết có
  // đúng/đủ dữ liệu hay không. Đặt NGOÀI try/finally ở trên để không giữ script lock
  // trong lúc ghi Sheet (cùng lý do đã ghi ở riderPlan_exportToSheetLink). `pool` và
  // `shortUser` là biến `var` khai báo trong try nên vẫn dùng lại được ở đây (hoisted
  // theo scope hàm, không phải scope block).
  var res = _rp_doExportToSheetLink(pool, monthStr, shortUser);
  res.subscribed = true;
  return res;
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN — CHẠY TAY 1 LẦN] riderPlan_installDailyExportTrigger_ADMIN()
// ══════════════════════════════════════════════════════════════════════════
// Cài trigger CỐ ĐỊNH cho riderPlan_dailyAutoExportRun. KHÔNG được gọi tự động
// từ bất kỳ hàm nào chạy dưới ngữ cảnh web app (Session.getActiveUser()) — phải
// chạy TAY, 1 LẦN, từ Apps Script Editor, bởi admin/chủ script (chọn hàm này
// trong dropdown "Select function" rồi bấm Run). Cùng pattern với
// setupKPIFailCleanupTrigger() / pick_live_installPrewarmTrigger() đã có sẵn.
//
// LÝ DO tách khỏi riderPlan_subscribeAutoExport(): web app này deploy ở chế độ
// "Execute as: User accessing the web app" — nếu tạo trigger từ trong hàm mà
// user bấm nút gọi tới, trigger sẽ đứng tên TÀI KHOẢN CỦA NGƯỜI ĐÓ, không phải
// tài khoản hệ thống. ScriptApp.getProjectTriggers() khi chạy dưới quyền 1 user
// chỉ thấy trigger CỦA CHÍNH USER ĐÓ, nên lần subscribe kế tiếp (bởi SUP/AOM
// khác) sẽ không xoá được trigger cũ — sinh ra nhiều trigger trôi nổi dưới nhiều
// tài khoản cá nhân khác nhau, và nếu tài khoản đang giữ trigger sống gặp vấn đề
// (đổi mật khẩu cần re-auth, mất quyền truy cập sheet đích, nghỉ việc...) thì
// TOÀN BỘ SUP đã đăng ký — không riêng gì tài khoản đó — sẽ ngừng auto-export mà
// không có cảnh báo nào. Chạy hàm này 1 lần bằng tài khoản admin cố định (vd tài
// khoản chủ script/service account) để trigger không phụ thuộc bất kỳ user nào
// đang thao tác trên web app.
//
// Sau khi chạy, kiểm tra lại trong Triggers (icon đồng hồ bên trái Apps Script
// Editor) — đăng nhập ĐÚNG tài khoản vừa chạy hàm này mới thấy được trigger đó
// (đây là giới hạn hiển thị theo user của Apps Script, không phải bug).
function riderPlan_installDailyExportTrigger_ADMIN() {
  // [FIX 2026-07-19] Mốc chạy 23:30 (trước đó 23:55 có thể lọt sang ngày mới qua
  // 00:00, khiến lượt "xuất cuối ngày N" thật ra chạy vào ngày N+1). 23:30 dao
  // động trong khung 23:15→23:45, luôn nằm gọn trong ngày hiện tại.
  //
  // Xoá hết trigger cùng handler MÀ TÀI KHOẢN ĐANG CHẠY HÀM NÀY nhìn thấy được,
  // rồi tạo lại — an toàn khi chạy lại nhiều lần miễn là luôn dùng cùng 1 tài
  // khoản admin cố định để cài đặt (không đổi người chạy hàm installer này).
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'riderPlan_dailyAutoExportRun') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  // [LƯU Ý] Apps Script KHÔNG đảm bảo chạy đúng chính xác 23:30:00 — atHour+nearMinute
  // chỉ định "gần" mốc giờ:phút đó, thực tế Google có thể chạy lệch trong khung
  // khoảng ±15 phút quanh mốc. Đây là giới hạn của nền tảng, không phải bug.
  ScriptApp.newTrigger('riderPlan_dailyAutoExportRun')
    .timeBased()
    .inTimezone(SPX_TZ)
    .everyDays(1)
    .atHour(23)
    .nearMinute(30)
    .create();

  var msg = '✅ Đã cài trigger riderPlan_dailyAutoExportRun (chạy ~23:30 hằng ngày, giờ VN), đứng tên tài khoản: ' +
            Session.getEffectiveUser().getEmail() + '. Đã xoá ' + removed + ' trigger cũ (nếu có, cùng tài khoản này).';
  _LOG.d(msg);
  return msg;
}

// [ADMIN — kiểm tra nhanh] Xác nhận trigger có tồn tại + thuộc tài khoản đang
// chạy hàm này không. Chạy tay trong Editor để soát khi nghi trigger bị mất/hỏng
// (cùng pattern với kpifail_checkOnChangeTrigger... trong file này).
function riderPlan_checkDailyExportTrigger_ADMIN() {
  var found = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'riderPlan_dailyAutoExportRun';
  });
  return {
    triggerVisibleToThisAccount: found,
    checkedAsAccount: Session.getEffectiveUser().getEmail(),
    note: found
      ? 'Trigger tồn tại và thuộc tài khoản đang kiểm tra.'
      : 'Không thấy trigger dưới tài khoản này — hoặc chưa cài, hoặc trigger thuộc 1 tài khoản khác (đăng nhập đúng tài khoản đã chạy riderPlan_installDailyExportTrigger_ADMIN() để kiểm tra lại).'
  };
}

// ── Hàm được TRIGGER gọi mỗi ngày — KHÔNG có "user đang xem" nên KHÔNG được gọi
// getCurrentUserAccess() để lọc quyền lại (chạy dưới danh nghĩa chủ sở hữu trigger,
// không phải SUP/AOM đã đăng ký) — pool đã được vét quyền sẵn 1 lần lúc đăng ký rồi,
// nên chỉ cần dùng lại nguyên, an toàn.
function riderPlan_dailyAutoExportRun() {
  // [SECURITY FIX 2026-08] Trước đây không kiểm tra quyền. Chỉ admin (hoặc trigger
  // ~23:30 hằng ngày chạy dưới danh nghĩa admin đã cài) mới được gọi.
  _requireAdmin_(2);
  try {
    var sheet = _rp_getExportSubSheet_();
    var data  = sheet.getDataRange().getValues();
    var curMonth = _rp_currentMonth();
    var rowsToDelete = [];

    for (var i = 1; i < data.length; i++) {
      var month   = String(data[i][0]).trim();
      var supName = String(data[i][1]).trim();
      if (!month) continue;

      // [YÊU CẦU] Không có nút tắt riêng — đăng ký chỉ chạy tới hết THÁNG đã đăng ký,
      // sang tháng mới thì dòng này không còn khớp curMonth nữa → coi như hết hạn,
      // dọn luôn cho gọn bảng cấu hình.
      if (month !== curMonth) { rowsToDelete.push(i + 1); continue; }

      var pool = [];
      try { pool = JSON.parse(data[i][2] || '[]'); } catch (eParse) {}
      if (!pool.length) continue;

      try {
        _rp_doExportToSheetLink(pool, month, 'AUTO');
      } catch (eOne) {
        // 1 SUP lỗi (vd trạm bị xoá khỏi AOM SUP sheet) không được làm hỏng các SUP
        // khác trong cùng batch — bỏ qua, xử lý tiếp SUP kế tiếp. [FIX 2026-07-26]
        // Trước đây bỏ qua HOÀN TOÀN không log gì — khiến lỗi vô hình, không cách
        // nào chẩn đoán vì sao 1 SUP không được cập nhật dù trigger vẫn chạy đúng
        // giờ. Giờ ghi lại console.error để còn tra trong Executions log.
        console.error('riderPlan_dailyAutoExportRun: lỗi export SUP "' + supName +
                       '" tháng ' + month + ': ' + (eOne && eOne.message));
      }
    }

    // Xoá từ dưới lên để không bị lệch chỉ số dòng khi xoá nhiều dòng liên tiếp
    rowsToDelete.sort(function(a,b){ return b - a; });
    rowsToDelete.forEach(function(r){ sheet.deleteRow(r); });

  } catch(e) {
    // Trigger chạy nền, không có ai nhận JSON trả về — ghi log để còn tra qua
    // Apps Script Editor → Thực thi (Executions) nếu cần debug.
    console.error('riderPlan_dailyAutoExportRun failed: ' + e.message);
  }
}

// ── Hàm lõi DÙNG CHUNG cho cả xuất thủ công lẫn xuất tự động (trigger) ─────────
// pool: DANH SÁCH TRẠM ĐÃ ĐƯỢC VÉT QUYỀN từ nơi gọi — hàm này không tự kiểm tra lại
// quyền (không có "current user" hợp lệ trong ngữ cảnh trigger).
function _rp_doExportToSheetLink(pool, monthStr, shortUserLabel) {
  // access truyền 'admin' để loadRiderPlan() không lọc lại theo hubs của trigger owner
  // — pool truyền vào đây đã được vét quyền đúng đắn từ lúc đăng ký/xuất thủ công rồi.
  var loaded = loadRiderPlan(monthStr, { role: 'admin', hubs: [] });
  if (!loaded.success) return { success:false, msg: loaded.msg || 'Không tải được dữ liệu kế hoạch.' };
  var dataByStation = loaded.data || {};

  var srcSS  = _DS.ss(RP_SOURCE_ID);
  var saMap  = _rp_buildSAMap(srcSS);
  var parsed = _rp_parseMonth(monthStr);
  var daysInMonth = new Date(parsed.year, parsed.mon, 0).getDate();
  var dateLabels = [];
  for (var d = 1; d <= daysInMonth; d++) {
    dateLabels.push((d<10?'0'+d:''+d) + '/' + (parsed.mon<10?'0'+parsed.mon:''+parsed.mon));
  }

  // Gom trạm theo ĐÚNG tên SUP thật (cột Sup_Name trong AOM SUP sheet) — không theo
  // role của người xuất, vì AOM quản nhiều SUP cùng lúc thì mỗi SUP ra 1 tab riêng.
  var byRealSup = {};
  pool.forEach(function(station){
    var meta = saMap[station] || {};
    var supName = meta.sup || 'Chưa rõ SUP';
    if (!byRealSup[supName]) byRealSup[supName] = [];
    byRealSup[supName].push(station);
  });

  var METRIC_GROUPS = [
    { name:'Dòng vào & Năng lực', metrics:['FC LM','Inbound TT','Tỉ lệ Inbound-FC (%)'] },
    { name:'Giao hàng LM',        metrics:['FC Riders','Rider TT','Giao LM TT','Giao TC (thực tế)','Prod TT'] },
    { name:'First-mile',          metrics:['FC FM','Lấy FM TT'] },
    { name:'Backlog & Ngoại lệ',  metrics:['Tồn Backlog','Đơn hủy','Đơn hẹn'] },
    { name:'Lực lượng RS',        metrics:['Rider RS','Prod RS','Vol RS'] },
  ];

  var destSS     = SpreadsheetApp.openById(RP_EXPORT_SPREADSHEET_ID);
  var exportedAt = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm");

  var results = [];
  Object.keys(byRealSup).sort().forEach(function(supName){
    var stationsOfSup = byRealSup[supName];
    // [YÊU CẦU] Cùng SUP + cùng tháng → CHỈ CẬP NHẬT dữ liệu vào đúng tab đã có,
    // KHÔNG tạo tab mới. getSheetByName() tìm theo tên (đã gồm cả SUP lẫn tháng)
    // nên tự nhiên đã đúng yêu cầu này — chỉ insertSheet() khi thật sự chưa có tab.
    var tabName = _rp_sanitizeSheetTitle(supName + '_' + monthStr);
    var sheet = destSS.getSheetByName(tabName);
    var isNewTab = !sheet;
    if (isNewTab) sheet = destSS.insertSheet(tabName);

    // Phá hết merge cũ (nếu đây là lần CẬP NHẬT lại tab đã tồn tại) trước khi ghi đè —
    // nếu không, merge cũ có thể lệch với dữ liệu mới và gây lỗi khi merge lại.
    if (!isNewTab) {
      try {
        sheet.getDataRange().getMergedRanges().forEach(function(r){ r.breakApart(); });
      } catch (eBreak) {}
    }
    sheet.clear();

    var aoa = [];
    var groupHeaderRows = []; // dòng tiêu đề nhóm (vd "Dòng vào & Năng lực") — bold + màu nền + merge ngang
    var colHeaderRows   = []; // dòng header cột (Trạm/Tỉnh/Chỉ số/Loại/...) — bold + màu nền nhạt

    aoa.push(['', '', 'SUP: ' + supName + '    ·    Tháng: ' + monthStr + '    ·    Xuất bởi: ' + shortUserLabel + '    ·    Lúc: ' + exportedAt]);
    aoa.push([]);

    METRIC_GROUPS.forEach(function(group){
      // [FIX] KHÔNG được để ô bắt đầu bằng dấu "=" — Google Sheets tự hiểu là công
      // thức và báo "Formula parse error" (đây chính là lỗi #ERROR! anh gặp). Đổi
      // sang tên nhóm thuần + định dạng riêng (bold/màu nền/merge) để vẫn nổi bật
      // như 1 tiêu đề bảng, không cần ký tự "==" nữa.
      groupHeaderRows.push(aoa.length + 1);
      aoa.push(['', '', group.name]);

      colHeaderRows.push(aoa.length + 1);
      aoa.push(['Trạm','Tỉnh','Chỉ số','Loại'].concat(dateLabels).concat(['Kết quả']));

      stationsOfSup.forEach(function(station){
        var meta = saMap[station] || {};
        var metricsOfStation = dataByStation[station] || {};

        group.metrics.forEach(function(metricLabel){
          var isPct = metricLabel.indexOf('%') >= 0;
          var vals  = metricsOfStation[metricLabel] || [];
          var sum = 0, cnt = 0;
          var rowVals = dateLabels.map(function(_, i){
            var v = vals[i];
            if (v === null || v === undefined || v === '' || isNaN(v)) return '';
            v = Number(v);
            sum += v; cnt++;
            // [FIX 2026-07-19] Hàng % (Tỉ lệ Inbound-FC) trước đây xuất số trần
            // (vd 84.7) khác với app đang hiện "85%" (làm tròn NGUYÊN + có dấu %,
            // xem buildRateCells() ở JS_Rider_plan_FIXED.html) — đồng bộ lại cho
            // đúng 1-1: làm tròn số nguyên + thêm "%" khi xuất Sheet.
            return isPct ? (Math.round(v) + '%') : Math.round(v*10)/10;
          });
          var summary = cnt>0 ? (isPct ? (Math.round(sum/cnt) + '%') : Math.round(sum*10)/10) : '';
          aoa.push([station, meta.province||'', metricLabel, isPct?'TB':'Tổng'].concat(rowVals).concat([summary]));
        });
      });
      aoa.push([]);
    });

    var maxCols = aoa.reduce(function(m,r){ return Math.max(m, r.length); }, 1);
    var padded = aoa.map(function(r){
      var row = r.slice();
      while (row.length < maxCols) row.push('');
      return row;
    });

    // Ghi dữ liệu dạng TEXT thô (không phải công thức) — phòng trường hợp về sau có
    // ô nào khác lỡ bắt đầu bằng =, +, -, @ thì vẫn hiển thị như text, không bị Sheets
    // tự diễn giải thành công thức.
    var dataRange = sheet.getRange(1, 1, padded.length, maxCols);
    dataRange.setNumberFormat('@');
    dataRange.setValues(padded);

    // ── Định dạng cho dễ nhìn ──
    // [FIX 2026-07-19] TRƯỚC ĐÂY merge từ cột 1 → maxCols (bao trùm luôn 2 cột
    // Trạm/Tỉnh sẽ bị ghim), trong khi bên dưới lại setFrozenColumns(2) — 1 merge
    // trải dài từ trong vùng ghim (cột 1-2) ra ngoài vùng ghim (cột 3+) LUÔN bị
    // Google Sheets từ chối với lỗi "can't freeze columns which contain only part
    // of a merged cell", làm hỏng TOÀN BỘ export giữa chừng (dữ liệu ở dataRange.
    // setValues() phía trên đã ghi xong, nhưng hàm crash ngay tại đây → ném lỗi lên
    // client, không kịp trả kết quả) — đây là lý do dù data đã có sẵn trên sheet
    // (ghi từ lần chạy trước), lần export MỚI vẫn báo lỗi và không "ra" gì thêm.
    // Sửa: CHỈ merge từ cột 3 trở đi (ngoài vùng sẽ ghim), 2 cột đầu (Trạm/Tỉnh) chỉ
    // tô nền cùng màu chứ không merge — nên không còn merge nào cắt ngang biên ghim.
    sheet.getRange(1, 1, 1, 2).setBackground('#eef2f7');
    sheet.getRange(1, 3, 1, maxCols - 2).merge()
      .setFontWeight('bold').setBackground('#eef2f7').setFontSize(10.5);

    groupHeaderRows.forEach(function(r){
      sheet.getRange(r, 1, 1, 2).setBackground('#3b6d11');
      sheet.getRange(r, 3, 1, maxCols - 2).merge()
        .setFontWeight('bold').setFontColor('#ffffff').setBackground('#3b6d11')
        .setHorizontalAlignment('center').setFontSize(11);
    });

    colHeaderRows.forEach(function(r){
      sheet.getRange(r, 1, 1, maxCols)
        .setFontWeight('bold').setBackground('#f1f5f9').setHorizontalAlignment('center');
    });

    sheet.setColumnWidth(1, 170); // Trạm
    sheet.setColumnWidth(2, 90);  // Tỉnh
    sheet.setColumnWidth(3, 170); // Chỉ số
    sheet.setColumnWidth(4, 60);  // Loại
    for (var c = 5; c <= maxCols; c++) sheet.setColumnWidth(c, 62); // các cột ngày + Kết quả

    // [FIX 2026-07-19] Bọc try/catch làm lưới an toàn — dù đã sửa merge ở trên để
    // không còn xung đột, vẫn giữ lại phòng hờ: nếu có ca lạ nào đó (vd maxCols quá
    // nhỏ) khiến freeze lỗi, KHÔNG để nó làm mất toàn bộ dữ liệu/định dạng đã ghi
    // xong ở trên — chỉ bỏ qua mỗi việc ghim cột.
    try {
      sheet.setFrozenRows(1);
      sheet.setFrozenColumns(2); // giữ Trạm/Tỉnh khi cuộn ngang qua nhiều cột ngày
    } catch (eFreeze) {}

    results.push({
      sup:      supName,
      tab:      tabName,
      stations: stationsOfSup.length,
      url:      'https://docs.google.com/spreadsheets/d/' + RP_EXPORT_SPREADSHEET_ID + '/edit#gid=' + sheet.getSheetId()
    });
  });

  // Đảm bảo file ở chế độ CHIA SẺ CHỈ XEM cho người có link — không phải editor.
  // Dùng DOMAIN_WITH_LINK (chỉ người trong domain công ty có link mới xem được),
  // KHÔNG dùng ANYONE_WITH_LINK — vì đây là dữ liệu vận hành nội bộ, không nên lộ
  // ra ngoài internet. Nếu cần chia sẻ cho người ngoài domain, phải đổi thủ công.
  try {
    var file = DriveApp.getFileById(RP_EXPORT_SPREADSHEET_ID);
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (eShare) {}

  return { success:true, sheets:results };
}

// ── 4d. riderPlan_getSubscribedSheetLinks(pool, monthStr) — CHỈ TRA CỨU, KHÔNG XUẤT ──
// [FEATURE 2026-07-19] Trigger tự động (riderPlan_dailyAutoExportRun) chạy ngầm lúc
// ~23:30, không có user nào đang mở app để "thấy" link lúc đó. Vì tab đích KHÔNG bị
// xoá/tạo lại giữa các lần tự động xuất (_rp_doExportToSheetLink chỉ clear nội dung
// rồi ghi đè, giữ nguyên sheet/gid) nên link luôn ổn định — hàm này cho phép tra cứu
// lại link bất cứ lúc nào mà KHÔNG phải trigger 1 lượt xuất mới (rẻ, không đụng dữ
// liệu, không cần loadRiderPlan() nặng).
function riderPlan_getSubscribedSheetLinks(pool, monthStr) {
  try {
    var access = getCurrentUserAccess();
    if (access.role === 'denied') return { success:false, msg:'Không có quyền.' };
    if (access.role !== 'admin' && access.role !== 'aom' && access.role !== 'sup') {
      return { success:false, msg:'Tính năng này chỉ dành cho AOM/SUP.' };
    }
    if (!monthStr) monthStr = _rp_currentMonth();
    pool = (pool||[]).filter(function(s){ return access.role === 'admin' || access.hubs.indexOf(s) >= 0; });
    if (!pool.length) return { success:false, msg:'Không có trạm nào để tra cứu.' };

    var srcSS = _DS.ss(RP_SOURCE_ID);
    var saMap = _rp_buildSAMap(srcSS);
    var byRealSup = {};
    pool.forEach(function(station){
      var meta = saMap[station] || {};
      var supName = meta.sup || 'Chưa rõ SUP';
      if (!byRealSup[supName]) byRealSup[supName] = [];
      byRealSup[supName].push(station);
    });

    var destSS = SpreadsheetApp.openById(RP_EXPORT_SPREADSHEET_ID);
    var results = [];
    Object.keys(byRealSup).sort().forEach(function(supName){
      var tabName = _rp_sanitizeSheetTitle(supName + '_' + monthStr);
      var sheet = destSS.getSheetByName(tabName);
      if (!sheet) return; // chưa từng xuất tab này — bỏ qua, không tạo mới ở đây
      results.push({
        sup:      supName,
        tab:      tabName,
        stations: byRealSup[supName].length,
        url:      'https://docs.google.com/spreadsheets/d/' + RP_EXPORT_SPREADSHEET_ID + '/edit#gid=' + sheet.getSheetId()
      });
    });

    return { success:true, sheets:results };
  } catch(e) {
    return { success:false, msg:e.message };
  }
}

// ── 4f. riderPlan_backfillDerivedMetrics(monthStr) — CHẠY 1 LẦN, VÁ DỮ LIỆU CŨ ────
// [FIX 2026-07-19] Các dòng Rider_Plan đã lưu TRƯỚC bản vá (đổi tên khóa ở
// saveRiderPlanToServer) vẫn đang thiếu/lệch tên 4 khóa 'FC Riders' /
// 'Tỉ lệ Inbound-FC (%)' / 'Giao TC (thực tế)' / 'Tồn Backlog' — dù export lại,
// vẫn đọc đúng JSON CŨ đó nên vẫn trống. Hàm này KHÔNG cần user vào sửa tay từng
// trạm: tính lại 4 chỉ số này TRỰC TIẾP từ dữ liệu thô đã có sẵn trong chính JSON
// đã lưu (Inbound TT/FC LM/Giao LM TT/Rider TT/Giao TT/Prod TT/Đơn hủy/Rider RS/
// Prod RS đều đã đúng tên từ trước, không bị ảnh hưởng bởi bug) — công thức PORT
// Y HỆT _rp_computeStationMetrics() bên frontend (JS_Rider_plan_FIXED.html) để số
// ra luôn khớp UI. Idempotent — chạy lại nhiều lần vẫn an toàn (luôn tính lại từ
// đầu, không cộng dồn/nhân đôi).
function riderPlan_backfillDerivedMetrics(monthStr) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var access = getCurrentUserAccess();
    if (access.role !== 'admin') return { success:false, msg:'Chỉ admin được chạy vá dữ liệu.' };
    if (!monthStr) monthStr = _rp_currentMonth();
    var parsed = _rp_parseMonth(monthStr);

    // target/rider theo hub — chỉ cần cho phần fallback của 'FC Riders' khi ngày đó
    // chưa có kế hoạch rider thô (riders_plan) > 0.
    var srcSS     = _DS.ss(RP_SOURCE_ID);
    var targetMap = _rp_buildProdTargetMap(srcSS, parsed.year, parsed.mon);

    var ss    = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName('Rider_Plan');
    if (!sheet || sheet.getLastRow() <= 1) return { success:true, updated:0 };

    var lastRow = sheet.getLastRow();
    var values  = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    var updated = 0;
    var n = 31;

    function arr(m, key){
      var a = (m[key] || []).slice(0, n);
      while (a.length < n) a.push(null);
      return a;
    }

    for (var i = 0; i < values.length; i++) {
      var rowMonth = _rp_monthCellToStr(values[i][0]);
      var station  = String(values[i][1] || '').trim();
      if (rowMonth !== monthStr || !station) continue;

      var m;
      try { m = JSON.parse(values[i][2] || '{}'); } catch (eParse) { continue; }

      var fcLm     = arr(m, 'FC LM');
      var inbound  = arr(m, 'Inbound TT');
      var ridersFC = arr(m, 'Riders FC');
      var outLM    = arr(m, 'Giao LM TT');
      var riderTT  = arr(m, 'Rider TT');
      var giaoTT   = arr(m, 'Giao TT');
      var prodTT   = arr(m, 'Prod TT');
      var cancel   = arr(m, 'Đơn hủy');
      var appt     = arr(m, 'Đơn hẹn');
      var rsRider  = arr(m, 'Rider RS');
      var rsProd   = arr(m, 'Prod RS');
      var target   = targetMap[station] || 0;

      var fcRiders = [], rate = [], giaoTC = [], backlog = [];
      var carry = 0;
      for (var d = 0; d < n; d++) {
        var rp = ridersFC[d];
        fcRiders.push(rp && rp > 0 ? rp : (target > 0 ? Math.round((fcLm[d] || 0) / target * 10) / 10 : 0));

        var fc0 = fcLm[d] || 0, ib = inbound[d];
        rate.push((fc0 > 0 && ib !== null) ? Math.round(ib / fc0 * 1000) / 10 : null);

        giaoTC.push(giaoTT[d]);

        var ibN = inbound[d] || 0, arN = riderTT[d] || 0, prN = prodTT[d] || 0, outLMn = outLM[d] || 0;
        var ddN = giaoTT[d] !== null ? giaoTT[d] : null, cancelN = cancel[d] || 0;
        var rR  = rsRider[d] || 0, rP = rsProd[d] || 0, vRS = (rR > 0 && rP > 0) ? rR * rP : 0;
        var hasData = inbound[d] !== null || riderTT[d] !== null || prodTT[d] !== null || giaoTT[d] !== null
                    || outLM[d] !== null || cancel[d] !== null || appt[d] !== null;
        if (!hasData && carry === 0) { backlog.push(null); continue; }
        var totalDemand    = outLMn > 0 ? outLMn : (carry + ibN);
        var totalDelivered = ddN !== null ? ddN : (arN * prN + vRS);
        carry = Math.max(0, totalDemand - totalDelivered - cancelN);
        backlog.push(carry);
      }

      m['FC Riders']            = fcRiders;
      m['Tỉ lệ Inbound-FC (%)'] = rate;
      m['Giao TC (thực tế)']    = giaoTC;
      m['Tồn Backlog']          = backlog;

      sheet.getRange(i + 2, 3).setValue(JSON.stringify(m));
      updated++;
    }

    return { success:true, updated:updated, month:monthStr };
  } catch (e) {
    return { success:false, msg:e.message };
  } finally {
    try { lock.releaseLock(); } catch (eLock) {}
  }
}

// Wrapper KHÔNG tham số — để bấm nút "Run" trực tiếp trong Apps Script Editor (dropdown
// chọn hàm rồi Run không truyền được tham số) — luôn vá cho THÁNG HIỆN TẠI. Chạy 1 LẦN
// ngay sau khi deploy bản vá 2026-07-19, sau đó bấm "Xuất link Sheet" lại là thấy đủ số.
function riderPlan_backfillDerivedMetrics_RUN_NOW() {
  var res = riderPlan_backfillDerivedMetrics(_rp_currentMonth());
  console.log(JSON.stringify(res));
  return res;
}

// ── 5. loadDriverPlan(month) ──────────────────────────────────────────────────
// Schema MỚI: Month | Station | Drivers (JSON: [{driver, attendance:[31]}, ...])
// Mỗi (Month, Station) chỉ có DUY NHẤT 1 dòng.
function loadDriverPlan(month, access, overrideHub) {
  try {
    // [FIX BẢO MẬT NGHIÊM TRỌNG — cùng lỗ hổng/cùng cách sửa đã áp dụng ở
    // loadForecastData() phía trên] Xem giải thích đầy đủ tại đó.
    access = getCurrentUserAccess();
    if (access.role === 'denied') return { success:false, msg:'Không có quyền.' };
    var monthStr = month || _rp_currentMonth();
    var ss    = _DS.ss(ADMIN_DB_ID);
    var sheet = ss.getSheetByName('Rider_Plan_Driver');
    if (!sheet || sheet.getLastRow() <= 1) return { success:true, month:monthStr, data:{} };

    var values = sheet.getRange(2, 1, sheet.getLastRow()-1, 3).getValues();
    var result = {};
    var groupsMap = {};  // groupsMap[station] = [{id,name,colorIdx}, ...]
    // [MỚI — theo yêu cầu trực tiếp "Rider Plan cũng phải cần view theo từng
    // level"] Cùng nguyên tắc/cùng cách đã dùng ở loadRiderPlan() — chỉ Admin
    // thật mới dùng được, không phải lỗ hổng cho non-admin lách qua.
    // [SỬA — Xem thử cấp SUP/AOM/ROM] overrideHub nay có thể là DANH SÁCH trạm
  // (ngăn cách '||'), vì mỗi cấp quản nhiều trạm. Trước đây chỉ nhận 1 trạm nên
  // xem thử cấp SUP vẫn tải theo quyền Admin -> 370 trạm -> bị chặn.
  var _ovSc = (access.role === 'admin' && overrideHub) ? _spxScopeHubs_(overrideHub) : null;
  var _normOverride = (_ovSc && !_ovSc.empty) ? _ovSc : null;
    for (var i = 0; i < values.length; i++) {
      var rowMonth = _rp_monthCellToStr(values[i][0]);
      var station  = String(values[i][1]||'').trim();
      if (rowMonth !== monthStr || !station) continue;
      if (_normOverride) {
        if (!_normOverride.has(station)) continue;
      } else if (access.role !== 'admin' && access.hubs.indexOf(station) < 0) continue;
      try {
        var parsed = JSON.parse(values[i][2] || '{}');
        // Hỗ trợ cả schema cũ (array) lẫn schema mới (object {drivers, groups})
        var arr, grps;
        if (Array.isArray(parsed)) {
          arr  = parsed;
          grps = [];
        } else {
          arr  = parsed.drivers || [];
          grps = parsed.groups  || [];
        }
        result[station] = arr.map(function(d){
          var att = (d.attendance||[]).slice(0,31);
          while(att.length<31) att.push(0);
          return {
            driver:     String(d.driver||'').trim(),
            groupId:    d.groupId || null,
            attendance: att.map(function(v){return Number(v)||0;})
          };
        }).filter(function(d){ return !!d.driver; });
        groupsMap[station] = grps;
      } catch(e) { /* JSON lỗi → bỏ qua */ }
    }
    return { success:true, month:monthStr, data:result, groupsMap:groupsMap };
  } catch(e) {
    return { success:false, msg:e.message };
  }
}

// ── 6. saveDriverPlan(payload) ────────────────────────────────────────────────
// payload.rows: [{station, driver, attendance:[31]}, ...]
// Frontend luôn gửi TOÀN BỘ danh sách tài xế hiện tại của 1 trạm mỗi lần lưu
// → backend GHI ĐÈ (replace) toàn bộ JSON của (Month,Station) đó. Không append/duplicate.
// ── 3. saveDriverPlan(payload) ──
function saveDriverPlan(payload) {
  // [FIX NGHẼN LOCK 2026-07-24] TRƯỚC ĐÂY dùng thẳng LockService.getScriptLock() —
  // CÙNG bug với saveRiderPlan() (xem giải thích đầy đủ ở đó), vì đây thực chất là
  // module song sinh (tab "Tài xế" của Rider Plan) autosave với cùng tần suất/quy mô.
  // Đổi sang named lock riêng cho Rider_Plan_Driver qua _anaAcquireNamedLock().
  if (!_anaAcquireNamedLock('riderplan_driver_save_lock_v1', 20000)) {
    return { success:false, msg:'Hệ thống đang bận lưu Rider Plan (tài xế) cho trạm khác, vui lòng thử lại sau ít giây.' };
  }
  try {
    var access = getCurrentUserAccess();
    if (access.role === 'denied') return { success: false, msg: 'Không có quyền.' };
    var monthStr = String(payload.month || _rp_currentMonth()).trim();
    var rows     = payload.rows || [];
    var ss       = _DS.ss(ADMIN_DB_ID);
    var sheet    = _rp_getOrCreateSheet(ss, 'Rider_Plan_Driver', ['Month','Station','Drivers']);

    // Gom groups theo trạm từ payload
    // payload.groups = [{id, name, colorIdx}, ...] — flat array cho 1 trạm (gửi từng trạm 1)
    // payload.groupsMap = {station: [{id,name,colorIdx},...]} — nếu cần lưu nhiều trạm cùng lúc
    var groupsByStation = {};
    if (payload.groupsMap) {
      groupsByStation = payload.groupsMap;
    } else if (payload.groups && payload.rows && payload.rows.length) {
      // Suy luận station từ rows đầu tiên (1 lần save = 1 trạm)
      var inferStation = String((payload.rows[0]||{}).station||'').trim();
      if (inferStation) groupsByStation[inferStation] = payload.groups;
    }

    // Gom tập hợp dữ liệu theo Trạm
    var byStation = {};
    rows.forEach(function(r) {
      var station = String(r.station || '').trim();
      var driver  = String(r.driver || '').trim();
      if (!station || !driver) return;

      // Chặn quyền nếu user cố tình sửa trạm của người khác
      if (access.role !== 'admin' && access.hubs.indexOf(station) < 0) return;

      var att = (r.attendance || []).slice(0,31);
      while(att.length < 31) att.push(0);
      if (!byStation[station]) byStation[station] = [];
      byStation[station].push({
        driver:     driver,
        groupId:    r.groupId || null,
        attendance: att
      });
    });

    var stations = Object.keys(byStation);
    if (!stations.length) return { success: true, updated: 0, inserted: 0 };

    // Tạo bản đồ ánh xạ các dòng hiện tại đang có trên Sheet
    var lastRow = sheet.getLastRow();
    var keyMap  = {};
    if (lastRow > 1) {
      var existing = sheet.getRange(2, 1, lastRow-1, 2).getValues();
      for (var i = 0; i < existing.length; i++) {
        var m = _rp_monthCellToStr(existing[i][0]);
        var s = String(existing[i][1] || '').trim();
        if (m && s) keyMap[m + '|' + s] = i + 2;
      }
    }

    var newRows = [], updated = 0;
    stations.forEach(function(station) {
      var k = monthStr + '|' + station;
      // Schema mới: lưu object {drivers:[...], groups:[...]} thay vì array thô
      var payload_json = JSON.stringify({
        drivers: byStation[station],
        groups:  groupsByStation[station] || []
      });

      if (keyMap.hasOwnProperty(k)) {
        sheet.getRange(keyMap[k], 1, 1, 3).setValues([[monthStr, station, payload_json]]);
        updated++;
      } else {
        newRows.push([monthStr, station, payload_json]);
      }
    });

    if (newRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
    }

    return { success: true, updated: updated, inserted: newRows.length };
  } catch(e) {
    return { success: false, msg: e.message };
  } finally {
    _anaReleaseNamedLock('riderplan_driver_save_lock_v1');
  }
}

// ── 7. syncRiderPlanMonth() ───────────────────────────────────────────────────
// Giữ 2 tháng (hiện tại + trước), xóa cũ hơn
// Set time-based trigger: mỗi ngày 1 đầu tháng lúc 00:05
function syncRiderPlanMonth() {
  // [SECURITY FIX 2026-08] Job nền ghi/xoá dữ liệu Rider_Plan/Rider_Plan_Driver toàn
  // hệ thống mỗi đầu tháng — trước đây không kiểm tra quyền. Chỉ admin (hoặc trigger
  // đầu tháng chạy dưới danh nghĩa admin đã cài) mới được gọi.
  _requireAdmin_(2);
  // [FIX NGHẼN LOCK 2026-07-24] TRƯỚC ĐÂY giữ LockService.getScriptLock() (toàn cục)
  // tới 60s — vì đây là job NỀN chạy hằng đêm nên khi chạy sẽ CHẶN TOÀN BỘ hệ thống
  // (Rider Plan, Admin Access, Quá Hạn note...) trong lúc đó, dù mục đích thật sự chỉ
  // cần tránh đụng saveRiderPlan()/saveDriverPlan(). Vẫn giữ ĐÚNG lý do phối hợp (xoá
  // dòng làm lệch rowIndex của 1 lượt save đang chạy) nhưng giờ chỉ cần giữ đúng 2
  // named lock của saveRiderPlan()/saveDriverPlan() — không đụng gì tới phần còn lại
  // của hệ thống nữa. Giữ CẢ 2 lock cùng lúc (job này đụng cả 2 sheet).
  var gotRP = _anaAcquireNamedLock('riderplan_save_lock_v1', 60000);
  if (!gotRP) return { success:false, msg:'Không lấy được lock Rider_Plan (có lệnh save khác đang chạy quá lâu), thử lại sau.' };
  var gotDriver = _anaAcquireNamedLock('riderplan_driver_save_lock_v1', 60000);
  if (!gotDriver) {
    _anaReleaseNamedLock('riderplan_save_lock_v1');
    return { success:false, msg:'Không lấy được lock Rider_Plan_Driver (có lệnh save khác đang chạy quá lâu), thử lại sau.' };
  }
  try {
    var _vnYM = _spxVnDateStr_(0).split('-');   // [SỬA] tháng hiện tại theo GIỜ VIỆT NAM
    var keep = [];
    for (var i = 0; i <= 3; i++) {
      var d = new Date(Date.UTC(Number(_vnYM[0]), Number(_vnYM[1]) - 1 - i, 1));
      keep.push(_rp_monthStr(d.getUTCFullYear(), d.getUTCMonth() + 1));
    }
    var ss = _DS.ss(ADMIN_DB_ID);
    var sheetNames = ['Rider_Plan','Rider_Plan_Driver'];
    var cleaned = 0;
    sheetNames.forEach(function(name) {
      var sh = ss.getSheetByName(name); if (!sh || sh.getLastRow()<=1) return;
      var vals = sh.getDataRange().getValues();
      for (var i = vals.length-1; i >= 1; i--) {
        var m = _rp_monthCellToStr(vals[i][0]);
        if (m && keep.indexOf(m) < 0) { sh.deleteRow(i+1); cleaned++; }
      }
    });
    return { success:true, kept:keep, cleaned:cleaned };
  } catch(e) { return { success:false, msg:e.message };
  } finally {
    _anaReleaseNamedLock('riderplan_driver_save_lock_v1');
    _anaReleaseNamedLock('riderplan_save_lock_v1');
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  PRIVATE HELPERS
// ════════════════════════════════════════════════════════════════════════════

function _rp_currentMonth() {
  // [FIX 2026-07-26] Trước đây dùng now.getFullYear()/getMonth() — phụ thuộc
  // timezone CẤU HÌNH CỦA PROJECT Apps Script, không chắc là GMT+7. Trigger
  // riderPlan_dailyAutoExportRun chạy ~23:30 giờ VN — nếu timezone project lệch,
  // dòng đăng ký "hết hạn" (curMonth khác month đã đăng ký) có thể bị đánh dấu
  // sai/xoá sớm ở các ngày giáp ranh tháng. Ép cứng về Asia/Ho_Chi_Minh cho khớp
  // với mọi chỗ khác trong module này đang dùng GMT+7 (vd nowStr ở subscribeAutoExport).
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM');
}
function _rp_monthStr(y,m) {
  return y+'-'+(m<10?'0'+m:''+m);
}
function _rp_parseMonth(s) {
  var p=s.split('-'); return {year:parseInt(p[0]),mon:parseInt(p[1])};
}
// Đọc cell Month: nếu Sheets auto-convert "2026-06" thành Date object thì
// vẫn chuẩn hóa về chuỗi "YYYY-MM" — tránh lệch khóa upsert.
function _rp_monthCellToStr(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Ho_Chi_Minh', 'yyyy-MM');
  return String(v||'').trim();
}
// [ĐÃ XOÁ — _rp_dHeaders(), không còn nơi nào gọi tới trong toàn dự án]

function _rp_parseDateCols(headerRow, year, month) {
  var res = [];
  var tz = SPX_TZ;
  headerRow.forEach(function(cell, idx) {
    if (!(cell instanceof Date)) return;
    var y = parseInt(Utilities.formatDate(cell, tz, 'yyyy'));
    var m = parseInt(Utilities.formatDate(cell, tz, 'MM'));
    var d = parseInt(Utilities.formatDate(cell, tz, 'dd'));
    if (y === year && m === month)
      res.push({ colIdx: idx, day: d });
  });
  return res;
}

function _rp_buildProdTargetMap(ss, year, month, access) {
  var map={}, sheet=ss.getSheetByName('Sheet1 (auto)');
  if(!sheet) return map;
  var data=sheet.getDataRange().getValues();
  var isAdmin = !access || access.role==='admin';
  var allowedHubs = access && access.hubs ? access.hubs : null;
  for(var i=1;i<data.length;i++){
    var kpi=data[i][0], station=String(data[i][1]||'').trim(), target=data[i][2];
    if(!station||target===''||target===null) continue;
    // PERF FIX: bỏ qua ngay trạm không thuộc quyền user (không phải admin) — tránh
    // parse Number()/Date() thừa cho các trạm không dùng đến (xem giải thích ở _rp_buildFCMap).
    if(!isAdmin && allowedHubs && allowedHubs.indexOf(station) < 0) continue;
    var d=(kpi instanceof Date)?kpi:new Date(kpi);
    if(d.getFullYear()===year&&(d.getMonth()+1)===month) map[station]=Number(String(target).replace(/,/g,'').trim())||0;
  }
  return map;
}

// FC (auto): row0=header, row1=sub-header (skip), row2+=data
// flm_type col0, region col1, station_name col2, Date cols...
function _rp_buildFCMap(ss, year, month, access) {
  var map = {};
  var sheet = ss.getSheetByName('FC (auto)');
  if (!sheet) return map;
  var data = sheet.getDataRange().getValues();
  if (data.length < 3) return map;

  // Row 0 = header (flm_type | region | station_name | Date | Date ...)
  // Row 1 = sub-header (None | None | None | 'Volume' ...)  → skip
  // Row 2+ = data (LM/FM rows)
  var dateCols = _rp_parseDateCols(data[0], year, month);
  if (!dateCols.length) {
    _LOG.d('[FC] no date cols for ' + year + '-' + month);
    return map;
  }

  var isAdmin = !access || access.role === 'admin';
  var allowedHubs = access && access.hubs ? access.hubs : null;

  var mm = month < 10 ? '0' + month : '' + month;
  for (var i = 2; i < data.length; i++) {
    var type    = String(data[i][0] || '').trim().toUpperCase();
    var station = String(data[i][2] || '').trim();
    if (!station || (type !== 'LM' && type !== 'FM')) continue;
    // PERF FIX (2026-07): trước đây dateCols.forEach() (31 lần/trạm) chạy cho TẤT CẢ
    // trạm trong sheet rồi mới lọc theo access.hubs ở loadForecastData() — khiến user
    // quản lý 1-2 trạm phải chờ y hệt admin quản lý toàn bộ. Bỏ qua ngay ở đây, trước
    // vòng lặp 31 ngày, cho các trạm không thuộc quyền user (trừ admin).
    if (!isAdmin && allowedHubs && allowedHubs.indexOf(station) < 0) continue;
    dateCols.forEach(function(dc) {
      var raw = data[i][dc.colIdx];
      if (raw === null || raw === undefined) return;
      if (String(raw).indexOf('N/A') >= 0 || raw === '') return;
      // raw có thể là number thật, hoặc text có dấu phẩy ngăn cách hàng nghìn
      // (vd "1,480") tùy vào cách cột ngày đó được tạo trong sheet nguồn.
      // Number("1,480") = NaN → bị bỏ qua silently → hiển thị 0 (đây chính là
      // bug khiến FC LM về 0 từ ngày 2 trở đi, trong khi FC FM luôn <1000
      // nên không dính lỗi). Loại bỏ dấu phẩy/khoảng trắng trước khi parse.
      var val = Number(String(raw).replace(/,/g, '').trim());
      if (isNaN(val)) return;
      var dd  = dc.day < 10 ? '0' + dc.day : '' + dc.day;
      var key = station + '|' + year + '-' + mm + '-' + dd;
      if (!map[key]) map[key] = { lm: 0, fm: 0 };
      if (type === 'LM') map[key].lm += val;
      else               map[key].fm += val;
    });
  }
  return map;
}

// #Riders: row0=header, row1=totals (skip), row2+=data
// Province col0, SUP col1, station_name col2, Date cols...
function _rp_buildRidersMap(ss, year, month, access) {
  var map = {};
  var sheet = ss.getSheetByName('#Riders');
  if (!sheet) return map;
  var data = sheet.getDataRange().getValues();

  // Row 0 = header (None | None | station_name | Date ...)
  // Row 1 = grand total row   → skip
  // Row 2 = #N/A filler row   → skip
  // Row 3+ = data (Province | SUP | station | values ...)
  var dateCols = _rp_parseDateCols(data[0], year, month);
  if (!dateCols.length) {
    _LOG.d('[Riders] no date cols for ' + year + '-' + month);
    return map;
  }

  var isAdmin = !access || access.role === 'admin';
  var allowedHubs = access && access.hubs ? access.hubs : null;

  var mm = month < 10 ? '0' + month : '' + month;
  for (var i = 3; i < data.length; i++) {
    var station = String(data[i][2] || '').trim();
    if (!station) continue;
    if (station.indexOf('N/A') >= 0) continue;
    if (!isNaN(Number(station))) continue;
    // PERF FIX: cùng lý do như _rp_buildFCMap — bỏ qua trạm không thuộc quyền user.
    if (!isAdmin && allowedHubs && allowedHubs.indexOf(station) < 0) continue;
    dateCols.forEach(function(dc) {
      var raw = data[i][dc.colIdx];
      if (raw === null || raw === undefined) return;
      if (String(raw).indexOf('N/A') >= 0 || raw === '') return;
      var val = Number(String(raw).replace(/,/g, '').trim());
      if (isNaN(val) || val <= 0) return;
      var dd  = dc.day < 10 ? '0' + dc.day : '' + dc.day;
      map[station + '|' + year + '-' + mm + '-' + dd] = Math.round(val * 100) / 100;
    });
  }
  return map;
}

// SA: col0=STT | col1=Provinces | col2=AOM | col3=AOM_Email | col4=Sup_Name | col5=Sup_Email | col6=Hub
function _rp_buildSAMap(ss) {
  // [FIX 2026-08-02] Đọc qua _rp_getSASheetValues_() (cache dùng chung 180s) —
  // xem giải thích đầy đủ ở hàm đó (định nghĩa bên dưới, hoisting tự động).
  var map={};
  var data = _rp_getSASheetValues_(ss);
  for(var i=1;i<data.length;i++){
    var hub=String(data[i][RP_SA_COL_HUB]||'').trim(); if(!hub) continue;
    if(!map[hub]) map[hub]={
      province: String(data[i][RP_SA_COL_PROVINCE]||'').trim(),
      sup:      String(data[i][RP_SA_COL_SUP_NAME] ||'').trim(),
    };
  }
  return map;
}

// ── 4. _rp_lookupSA(email) ──
// [FIX 2026-08-02] Đọc CHUNG 2 sheet phân quyền nguồn (AOM SUP, DS Nhân viên) qua
// cache dùng chung — trước đây _rp_lookupSA() (đường NÓNG NHẤT, chạy ở MỌI cache-
// miss của getModuleAccess(), tức mọi ~180s/user hoạt động) tự đọc lại TOÀN BỘ 2
// sheet này ĐỘC LẬP cho TỪNG user khác nhau — dù nội dung 2 sheet là Y HỆT NHAU
// cho mọi user. Ở quy mô ~2000 user (ước tính ~1 trạm/2 user khi lên 1000 trạm),
// tần suất cache-miss dồn lại có thể tới hàng chục lượt/giây vào giờ cao điểm,
// mỗi lượt quét lại toàn bộ danh sách nhân viên — đúng lớp lỗi đã gặp và vá ở
// module Tra Cứu (Mail/Data), nhưng đây còn NÓNG HƠN NHIỀU vì chạy ở mọi request,
// không riêng 1 module. TTL 180s khớp với TTL kết quả per-user đã có sẵn.
function _rp_getSASheetValues_(srcSS) {
  var cached = CacheMgr.getChunked('SA', 'sa_sheet_values_v1');
  if (cached) return cached;
  var sheet = srcSS.getSheetByName('AOM SUP') || srcSS.getSheetByName('SA');
  var values = sheet ? sheet.getDataRange().getValues() : [];
  try { CacheMgr.setChunked('SA', 'sa_sheet_values_v1', values, 180); } catch (e) {}
  return values;
}
/**
 * _rp_getEmpSheetValues_(srcSS)
 * [SỬA LỖI THẬT — báo cáo: user Vị trí "Staff" nhưng giao diện hiện "Lead"]
 * Trước đây CHỈ đọc sheet 'DS Nhân viên'. File nguồn thực tế KHÔNG còn sheet tên
 * đó — dữ liệu nhân sự nằm ở sheet 'FTE' (có đủ cột Email / Nơi làm việc / Vị trí).
 * Không tìm thấy sheet -> không đọc được chức danh -> title rỗng -> MỌI user cấp
 * trạm mặc định thành LEAD (xem _spx_mapRoleToLevel_).
 * Nay thử lần lượt các tên sheet đang dùng trong hệ thống và chọn sheet ĐẦU TIÊN
 * có cột Email thật. Tên sheet trong ngoặc là các biến thể đã gặp qua các đời file.
 */
var RP_EMP_SHEET_NAMES = ['DS Nhân viên', 'FTE', 'FLM infor', 'FLM info'];
function _rp_getEmpSheetValues_(srcSS) {
  var cached = CacheMgr.getChunked('SA', 'emp_sheet_values_v2');
  if (cached) return cached;
  var values = [];
  for (var i = 0; i < RP_EMP_SHEET_NAMES.length; i++) {
    var sheet = srcSS.getSheetByName(RP_EMP_SHEET_NAMES[i]);
    if (!sheet) continue;
    var v = sheet.getDataRange().getValues();
    if (!v || v.length < 2) continue;
    var head = v[0].map(function (h) { return String(h).toLowerCase().trim(); });
    if (head.indexOf('email') < 0) continue;      // không phải sheet nhân sự
    values = v;
    break;
  }
  try { CacheMgr.setChunked('SA', 'emp_sheet_values_v2', values, 180); } catch (e) {}
  return values;
}

/**
 * _rp_titleFromOrgFTE_(email)
 * [SỬA LỖI THẬT — user Vị trí "Staff" nhưng giao diện hiện "Lead"]
 * Sheet nhân sự mà phân quyền đang đọc (file RP_SOURCE) CHƯA có cột chức danh —
 * ghi chú trong code từ 2026-08-16 đã nêu, và hệ quả là access.title luôn rỗng ->
 * mọi user cấp trạm mặc định thành LEAD (xem _spx_mapRoleToLevel_).
 * Nhưng file tổ chức (ORG_SOURCE) có sheet 'FTE' với cột 'Vị trí' ĐẦY ĐỦ và đang
 * được luồng đồng bộ tổ chức dùng đúng. Nay tra sang đó khi thiếu.
 * Đọc 1 lần, lưu đệm 10 phút cho toàn hệ thống (bảng email -> chức danh).
 */
function _rp_titleFromOrgFTE_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return '';
  var map = null;
  try { map = CacheMgr.getChunked('SA', 'org_fte_titles_v1'); } catch (e) {}
  if (!map) {
    map = {};
    try {
      var sh = _DS.ss(ORG_SOURCE_SPREADSHEET_ID).getSheetByName(ORG_SHEET_FTE);
      if (sh && sh.getLastRow() > 1) {
        var v = sh.getDataRange().getValues();
        var head = v[0].map(function (h) { return String(h).toLowerCase().trim(); });
        var eIdx = head.indexOf('email');
        var tIdx = -1;
        ['vị trí', 'chức danh', 'chức vụ', 'position', 'title'].some(function (n) { var i = head.indexOf(n); if (i >= 0) { tIdx = i; return true; } return false; });
        if (eIdx >= 0 && tIdx >= 0) {
          for (var i = 1; i < v.length; i++) {
            var em = String(v[i][eIdx] || '').trim().toLowerCase();
            var ti = String(v[i][tIdx] || '').trim();
            // Người đã nghỉ việc: bỏ qua nếu có cột ngày nghỉ và đã điền.
            if (em && ti) map[em] = ti;
          }
        }
      }
    } catch (e) { return ''; }
    try { CacheMgr.setChunked('SA', 'org_fte_titles_v1', map, 600); } catch (e) {}
  }
  return map[email] || '';
}

/**
 * spx_diagEmployeeTitles(email) — CHẠY THỦ CÔNG trong Apps Script Editor.
 * Báo cáo hệ thống ĐANG đọc sheet nào, có cột chức danh không, và cấp bậc tính
 * ra cho một email cụ thể — để kiểm chứng thay vì đoán.
 */
// ── Chạy chẩn đoán phân quyền ────────────────────────────────────────────
// Nút Run của Apps Script KHÔNG truyền được tham số, nên dùng 2 hàm dưới đây:
//   · spx_diagMyPermission()    -> kiểm tra CHÍNH email đang chạy (không cần sửa gì)
//   · spx_diagEmailPermission() -> kiểm tra email khác: sửa SPX_DIAG_EMAIL bên dưới,
//                                  Ctrl+S, chọn hàm này rồi bấm Run.
// Kết quả xem ở tab "Execution log".
var SPX_DIAG_EMAIL = 'hongvi.vothi@spxexpress.com';   // đổi email cần kiểm tra ở đây

function spx_diagMyPermission()    { return spx_diagEmployeeTitles(''); }
function spx_diagEmailPermission() { return spx_diagEmployeeTitles(SPX_DIAG_EMAIL); }

function spx_diagEmployeeTitles(email) {
  // [CHẨN ĐOÁN] So sánh 2 nguồn phân quyền cho 1 email và cho biết giao diện sẽ
  // hiện cấp nào. Chạy thủ công trong Apps Script Editor.
  email = String(email || '').trim().toLowerCase();
  if (!email) { try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (eMe) {} }
  if (!email) return 'Không xác định được email — sửa SPX_DIAG_EMAIL rồi chạy spx_diagEmailPermission().';
  var out = { email: email, nguonChinhThuc: {}, nguonCu: {}, ketQua: {} };
  try {
    var map = _spxBuildOrgAccessMap_();
    var me = (map && map.byEmail) ? map.byEmail[email] : null;
    out.nguonChinhThuc = me
      ? { coTrongNguon: true, chucDanh: me.position, role: me.role, hubGoc: me.hubName, soTram: (me.stations || []).length, tram: (me.stations || []).slice(0, 5) }
      : { coTrongNguon: false, ghiChu: 'Không thấy email trong file tổ chức (FTE / Khu vực quản lý)' };
    out.nguonChinhThuc.tongSoNguoiTrongNguon = (map && map.byEmail) ? Object.keys(map.byEmail).length : 0;
  } catch (e) { out.nguonChinhThuc = { loi: e.message }; }
  try {
    var sa = _rp_lookupSA(email, _DS.ss(RP_SOURCE_ID));
    out.nguonCu = sa ? { coTrongNguon: true, role: sa.role, chucDanh: sa.title || '(không có cột chức danh)', soTram: (sa.hubs || []).length } : { coTrongNguon: false };
  } catch (e) { out.nguonCu = { loi: e.message }; }
  // Tính cấp bậc bằng ĐÚNG logic giao diện dùng (_spx_mapRoleToLevel_), dựa trên
  // nguồn chính thức nếu có, nếu không thì nguồn cũ.
  try {
    var src = out.nguonChinhThuc.coTrongNguon ? 'org' : (out.nguonCu.coTrongNguon ? 'legacy' : null);
    if (!src) {
      out.ketQua = { levelLabel: 'Không có quyền', nguonDung: 'không nguồn nào có email này' };
    } else {
      var r = (src === 'org') ? String(out.nguonChinhThuc.role || '').toUpperCase() : String(out.nguonCu.role || '');
      var roleOut = (src === 'org')
        ? ((r === 'AOM') ? 'aom' : (r === 'SUP') ? 'sup' : 'station')
        : r;
      var title = (src === 'org') ? out.nguonChinhThuc.chucDanh : out.nguonCu.chucDanh;
      var lv = _spx_mapRoleToLevel_({ role: roleOut, title: title });
      out.ketQua = { nguonDung: src, role: roleOut, chucDanh: title, levelLabel: lv.levelLabel, levelCode: lv.levelCode };
    }
    getModuleAccess_invalidate(email);   // xoá đệm để lần đăng nhập sau tính lại
  } catch (e) { out.ketQua = { loi: e.message }; }
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

function _rp_lookupSA(email, srcSS) {
  var em = (email || '').toLowerCase().trim();
  if (!em) return null;
  // [FIX 2026-07-21 PERF] Trước đây hàm này LUÔN đọc trực tiếp toàn bộ sheet
  // 'AOM SUP' + 'DS Nhân viên' (getDataRange().getValues()) MỖI LẦN được gọi —
  // mà checkAnalyticsPermission() (gọi hàm này) lại được gọi ở ĐẦU MỌI request
  // getStationData()/getSupplementData()/saveStationData(). Kết quả: mỗi lần
  // load 1 trạm tốn Ít NHẤT 2 lượt đọc sheet quyền đầy đủ (getStationData +
  // getSupplementData chạy song song), cộng dồn với việc đọc Data_/Sup_/
  // Inbound_Lock → tổng độ trễ tăng rõ rệt, đặc biệt khi chuyển qua lại
  // nhiều trạm liên tục. CacheMgr đã CÓ SẴN namespace 'SA' dành riêng cho
  // việc này (xem khai báo NAMESPACES ở đầu file) nhưng chưa từng được dùng
  // ở đây — giờ nối vào, cache theo từng email, TTL 180s (đủ ngắn để không
  // trễ khi phân quyền thay đổi, đủ dài để loại bỏ chi phí đọc lặp lại khi
  // user thao tác nhanh trong vài phút).
  var _cached = CacheMgr.get('SA', 'lookup_' + em);
  if (_cached !== null) return _cached; // đã cache kể cả kết quả null (không có quyền) để tránh dò lặp

  if (!srcSS) srcSS = _DS.ss(RP_SOURCE_ID);
  var hubs = [], role = null;

  // ── BƯỚC 1: Quét sheet AOM SUP — nguồn xác định ROLE ──
  // Chỉ sheet này mới phân biệt aom/sup. DS Nhân viên không có role nào khác station.
  // [FIX 2026-08-02] Đọc qua _rp_getSASheetValues_() (cache dùng chung 180s) thay vì
  // tự getDataRange() riêng — xem giải thích đầy đủ ở hàm đó.
  var data = _rp_getSASheetValues_(srcSS);
  for (var i = 1; i < data.length; i++) {
    var aomE = String(data[i][RP_SA_COL_AOM_EMAIL] || '').toLowerCase().trim();
    var supE = String(data[i][RP_SA_COL_SUP_EMAIL] || '').toLowerCase().trim();
    var hub  = String(data[i][RP_SA_COL_HUB] || '').trim();
    if (!hub) continue;
    if (aomE === em) {
      role = role || 'aom';       // AOM: role ưu tiên cao nhất
      if (hubs.indexOf(hub) < 0) hubs.push(hub);
    }
    if (supE === em && aomE !== em) {
      role = role || 'sup';       // SUP: chỉ gán khi không phải AOM dòng đó
      if (hubs.indexOf(hub) < 0) hubs.push(hub);
    }
  }

  // ── BƯỚC 2: Quét DS Nhân viên — chỉ lấy hub bổ sung, KHÔNG đổi role ──
// Dù email có hay không có trong AOM SUP, DS Nhân viên chỉ dùng để bổ sung hub.
// Vị trí (Team Lead/Staff/Supervisor) không ảnh hưởng role — role luôn là 'station'
// nếu không có trong AOM SUP, hoặc giữ nguyên role từ AOM SUP nếu email đã tìm thấy.
// [FIX 2026-08-02] Đọc qua _rp_getEmpSheetValues_() (cache dùng chung 180s).
var empData = _rp_getEmpSheetValues_(srcSS);
var empTitle = null; // [FIX 2026-08-16] Vị trí/chức danh — CHƯA có cột thật trong sheet hôm nay
if (empData.length > 1) {
    var headers = empData[0].map(function(h) { return String(h).toLowerCase().trim(); });
    // Lưu ý: headers.indexOf nên dùng chữ thường hoàn toàn vì bạn đã .toLowerCase() ở trên
    var emailIdx  = headers.indexOf('email');        if (emailIdx  < 0) emailIdx  = 7;
    var hubIdx    = headers.indexOf('nơi làm việc'); if (hubIdx    < 0) hubIdx    = 4;
    // [FIX 2026-08-16] SẴN SÀNG CHO TƯƠNG LAI — đội vận hành xác nhận sheet "DS Nhân
    // viên" HIỆN CHƯA có cột chức danh (Lead/Staff), sẽ bổ sung sau. Dò theo TÊN CỘT
    // (không theo vị trí cột cố định) với vài cách gọi phổ biến — khi cột thật được
    // thêm vào (bất kể đặt tên theo cách nào trong số này), hệ thống TỰ ĐỘNG nhận ra
    // và bắt đầu tách Lead/Staff mà KHÔNG CẦN sửa lại dòng code này. Nếu chưa có cột
    // nào khớp (đúng hiện trạng hôm nay) -> titleIdx = -1, empTitle luôn null, mọi
    // role 'station' mặc định là LEAD (xem _spx_mapRoleToLevel_()) — không suy đoán.
    var titleIdx = -1;
    ['chức danh', 'vị trí', 'chức vụ', 'position', 'title'].some(function(name) {
      var idx = headers.indexOf(name);
      if (idx >= 0) { titleIdx = idx; return true; }
      return false;
    });

    for (var j = 1; j < empData.length; j++) {
      var empEmail = String(empData[j][emailIdx] || '').toLowerCase().trim();
      if (empEmail !== em) continue;
      
      var empHub = String(empData[j][hubIdx] || '').trim();
      if (empHub && hubs.indexOf(empHub) < 0) {
        hubs.push(empHub);
      }
      if (titleIdx >= 0 && !empTitle) {
        var _t = String(empData[j][titleIdx] || '').trim();
        if (_t) empTitle = _t;
      }
      
      // Nếu email này chưa có trong AOM SUP → gán role station (mặc định thấp nhất)
      if (!role) role = 'station';
    }
  }

  // [MỚI — phân cấp ROM > AOM > SUP > Lead/Staff] ROM không có trong sheet
  // nguồn (sheet chỉ có cột AOM_Email/Sup_Email), nên phải tra riêng từ cấu
  // hình ROM_Roles của hệ thống. Đặt Ở ĐÂY, SAU khi đã quét sheet nguồn, và
  // GHI ĐÈ role — vì ROM là cấp CAO NHẤT: 1 người vừa là ROM vừa có tên trong
  // cột AOM thì vẫn phải nhận góc nhìn ROM (rộng hơn), không bị hạ xuống AOM.
  try {
    var _rs = _rom_getScope(em);
    if (_rs.isRom && _rs.stations.length) {
      role = 'rom';
      hubs = _rs.stations;
    }
  } catch (eRom) { /* lỗi đọc cấu hình ROM không được làm gãy phân quyền chung */ }

  // [SỬA] Sheet nhân sự không có cột chức danh -> tra sang sheet 'FTE' của file tổ
  // chức (nơi cột 'Vị trí' đầy đủ). Không có ở cả 2 nơi thì giữ nguyên hành vi cũ.
  if (!empTitle) { try { empTitle = _rp_titleFromOrgFTE_(email) || null; } catch (eT) {} }
  var _result = (role && hubs.length) ? { role: role, hubs: hubs, title: empTitle } : null;
  CacheMgr.set('SA', 'lookup_' + em, _result, 180);
  return _result;
}

function _rp_getAllHubsFromSA() {
  // [FIX 2026-07-21 PERF] Cùng lý do như _rp_lookupSA() ở trên — tài khoản admin
  // (như trong ảnh chụp màn hình lỗi) đi qua nhánh này ở checkAnalyticsPermission()
  // trên MỌI request, đọc sống toàn bộ ~391 hub mỗi lần. Cache 180s.
  var _cachedHubs = CacheMgr.get('SA', 'all_hubs');
  if (_cachedHubs !== null) return _cachedHubs;
  var sheet=_DS.ss(RP_SOURCE_ID).getSheetByName('AOM SUP')||_DS.ss(RP_SOURCE_ID).getSheetByName('SA');
  if(!sheet) return [];
  var data=sheet.getDataRange().getValues(), hubs=[];
  for(var i=1;i<data.length;i++){
    var h=String(data[i][RP_SA_COL_HUB]||'').trim();
    if(h&&hubs.indexOf(h)<0) hubs.push(h);
  }
  hubs.sort();
  CacheMgr.set('SA', 'all_hubs', hubs, 180);
  return hubs;
}

function _rp_getOrCreateSheet(ss, name, headers) {
  var sheet=ss.getSheetByName(name);
  if(!sheet){
    sheet=ss.insertSheet(name);
    _LOG.d('Created sheet: '+name);
  }
  // Nếu sheet đã tồn tại nhưng trống (chưa có header) → ghi header
  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.getRange(1,1,1,headers.length)
      .setBackground('#0f4c81').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1); sheet.setFrozenColumns(2);
    sheet.setColumnWidth(1, 90);
    sheet.setColumnWidth(2, 240);
    sheet.setColumnWidth(3, 700);
    // Ép cột Month (A) là dạng TEXT để Sheets không tự convert "2026-06" thành Date
    // (tránh lệch khóa khi upsert theo Month|Station)
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(),1000), 1).setNumberFormat('@');
    _LOG.d('Header written: '+name);
  }
  return sheet;
}

// ── Trigger setup: gọi 1 lần để set time trigger xóa tháng cũ ──
function setupSyncTrigger() {
  // Xóa trigger cũ nếu có
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==='syncRiderPlanMonth') ScriptApp.deleteTrigger(t);
  });
  // Tạo trigger mới: chạy lúc 00:05 ngày 1 hàng tháng
  ScriptApp.newTrigger('syncRiderPlanMonth')
    .timeBased().inTimezone(SPX_TZ).onMonthDay(1).atHour(0).nearMinute(5).create();
  _LOG.d('✅ Trigger syncRiderPlanMonth created.');
}

// ── Manual test ──
function testRiderPlanAccess()  { _LOG.d(JSON.stringify(getCurrentUserAccess())); }
function testLoadForecast_()     {
  var r=loadForecastData('2026-06');
  _LOG.d('stations='+r.stations+' rows='+(r.rows||[]).length);
  if(r.rows&&r.rows[0]) _LOG.d(JSON.stringify(r.rows[0]));
}
function testSetupSheets() {
  // [SECURITY FIX 2026-08] Hàm setup thủ công (chạy 1 lần khi khởi tạo) — trước đây
  // không kiểm tra quyền. Rủi ro thấp (chỉ tạo sheet nếu CHƯA có, không xoá gì) nhưng
  // vẫn khoá lại vì không có lý do gì để user thường gọi tới.
  _requireAdmin_(2);
  var ss=_DS.ss(ADMIN_DB_ID);
  _rp_getOrCreateSheet(ss,'Rider_Plan',['Month','Station','Data']);
  _rp_getOrCreateSheet(ss,'Rider_Plan_Driver',['Month','Station','Drivers']);
  _LOG.d('Done.');
}

// ── ⚠️ CHẠY 1 LẦN: dọn schema cũ (34 cột, bị duplicate x2/x3) ────────────────
// Xóa hẳn 2 sheet Rider_Plan / Rider_Plan_Driver và tạo lại theo schema mới
// (Month | Station | JSON). Dữ liệu cũ sẽ mất — bình thường vì đang là dữ liệu
// test bị lỗi duplicate. Sau khi chạy, mở lại Rider Plan và lưu lại bình thường.
function resetRiderPlanSheets() {
  // [SECURITY FIX 2026-08] Hàm này XOÁ VĨNH VIỄN toàn bộ Rider_Plan/Rider_Plan_Driver
  // của MỌI trạm, mọi tháng. Trước đây không có bất kỳ kiểm tra quyền nào — bất kỳ ai
  // gọi google.script.run.resetRiderPlanSheets() cũng xoá được ngay lập tức. Giờ chỉ
  // admin cấp 1 mới được chạy (thao tác phá huỷ dữ liệu diện rộng).
  _requireAdmin_(1);
  var ss = _DS.ss(ADMIN_DB_ID);
  ['Rider_Plan','Rider_Plan_Driver'].forEach(function(name){
    var sh = ss.getSheetByName(name);
    if (sh) ss.deleteSheet(sh);
  });
  _rp_getOrCreateSheet(ss,'Rider_Plan',['Month','Station','Data']);
  _rp_getOrCreateSheet(ss,'Rider_Plan_Driver',['Month','Station','Drivers']);
  _LOG.d('✅ Đã reset Rider_Plan & Rider_Plan_Driver theo schema mới (Month | Station | JSON).');
}
// ============================================================
// [LAZY-LOAD 2026-07] Trả về HTML+JS của 1 module theo yêu cầu
// từ client (dùng cho _spxLoadModule trong index.html) — cùng cơ
// chế với include() ở trên, chỉ thêm whitelist để client không
// gọi google.script.run.getModuleHtml() đọc tuỳ ý file khác trong
// project. KHÔNG đụng tới include() hay doGet() hiện có.
//
// [PHÂN QUYỀN] KHÔNG thêm quyền hạn mới nào so với trước — module
// vẫn mở/khoá y hệt logic gốc trong openModule() và trong chính các
// hàm backend của từng module (checkAnalyticsPermission, loadRiderPlan,
// v.v. — không đụng gì tới các hàm đó). Duy nhất 1 điều cần bù lại:
// trước đây 5 module này CHỈ tới được trình duyệt qua index.html, mà
// index.html CHỈ render sau khi doGet() gọi checkUserAccess() thành
// công. Giờ getModuleHtml() là 1 hàm global riêng, gọi được từ BẤT KỲ
// trang HTML nào của web app này (kể cả UI_RequestAccess — trang dành
// cho người CHƯA được duyệt) qua google.script.run, không phân biệt
// theo trang. Nếu không tự check lại ở đây, người chưa từng được duyệt
// vào app có thể lấy được source của 5 module này bằng cách gọi thẳng
// hàm này từ console — điều TRƯỚC ĐÂY không thể xảy ra. Dòng check bên
// dưới chỉ khôi phục ĐÚNG rào chắn tương đương doGet(), không thêm gì
// mới hơn mức đã có.
// ============================================================
function getModuleHtml(moduleName) {
  var ALLOWED_MODULES = SPX_LAZY_MODULE_NAMES_;

  if (ALLOWED_MODULES.indexOf(moduleName) === -1) {
    throw new Error('Module không hợp lệ hoặc không được phép tải: ' + moduleName);
  }

  var email = Session.getActiveUser().getEmail();
  if (!checkUserAccess(email)) {
    return ''; // y hệt mức chặn của doGet() — chưa Duyệt thì không lấy được nội dung module nào
  }

  // [XOÁ — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu, không
  // phải lúc mở module"] Trước đây track NGAY TẠI ĐÂY — nghĩa là chỉ cần bấm
  // mở 1 module (dù không làm gì tiếp theo) đã được tính "1 lượt dùng", đồng
  // thời còn gây đếm GẤP ĐÔI cho 3 module (Quá Hạn/Pick/FMS) vốn đã có tracking
  // riêng ở đúng điểm tải dữ liệu thật của chúng. Đã thêm tracking đúng vị trí
  // cho toàn bộ 12 module (ở hàm tải dữ liệu thật của từng module — xem
  // aging_getMasterData/kpifail_getMasterDataLite/loadAllData/tracuu_getAllWards/
  // wiki_getDocumentData_v2/getOrders/getComplaintData/getStationDataBundle/
  // spx_getAdminList/spx_getPendingAccessList/spx_getUsageStats/
  // spx_trackLuongUsage), nên lớp tracking chung ở đây không còn cần thiết.

  return include(moduleName);
}

// Danh sách module lazy-load DÙNG CHUNG cho getModuleHtml() và spx_getModuleVersions().
var SPX_LAZY_MODULE_NAMES_ = [
  'Analytics_Block', 'JS_KPIFail', 'JS_Rider_plan', 'JS_TaiLieu', 'JS_Tracuu',
  'JS_DonCauCuu', 'JS_ViPham', 'JS_Quahan', 'JS_Pick', 'JS_FMS', 'JS_Luong', 'JS_AdminZone'
];

/**
 * spx_getModuleVersions()
 * [PERF 2026-10] Mỗi lần mở trang, trình duyệt tải nền cả 12 module bằng 12 lệnh getModuleHtml
 * (có file 1,1 MB) — chiếm ~11% số lệnh web app trong Executions. Nay client hỏi 1 lệnh này
 * để lấy "dấu vân tay" (MD5 + độ dài) của từng module; trùng với bản đã lưu trong
 * IndexedDB thì dùng luôn, KHÔNG tải lại. Dấu vân tay tính trực tiếp từ nội dung file
 * (đúng thứ getModuleHtml trả về) và KHÔNG cache phía server -> deploy bản mới là client
 * nhận ra ngay ở lần mở trang kế tiếp.
 */
function spx_getModuleVersions() {
  try {
    _requireApproved_();
    var out = {};
    SPX_LAZY_MODULE_NAMES_.forEach(function (n) {
      try {
        var html = HtmlService.createHtmlOutputFromFile(n).getContent();
        var hex = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, html, Utilities.Charset.UTF_8)
          .map(function (b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length < 2 ? '0' + x : x; }).join('');
        out[n] = hex + '.' + html.length;
      } catch (eN) { /* thiếu file -> bỏ qua, client sẽ tải thẳng bằng getModuleHtml */ }
    });
    return JSON.stringify({ success: true, versions: out });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * spx_getHeartbeat(ctxJson)
 * [PERF 2026-10] GỘP các lệnh thăm dò định kỳ (mỗi lệnh trước đây là 1 lượt thực thi riêng,
 * ~46% số lệnh web app trong Executions) vào 1 lượt: ann (thông báo), mod (trạng thái module),
 * aging (phiên bản dữ liệu Quá hạn), kpi (phiên bản KPI Fail), notes (ghi chú KPI Fail),
 * ana (dấu thời điểm dữ liệu trạm — cần ctx.ana = tên trạm), fms (mốc đồng bộ FMS Live).
 * Mỗi phần trả về ĐÚNG chuỗi mà hàm gốc tương ứng trả về -> client không phải đổi cách đọc.
 * Mỗi phần tự bắt lỗi riêng: 1 phần lỗi không làm hỏng các phần còn lại.
 * Các hàm gốc vẫn giữ nguyên (tương thích ngược với tab cũ chưa tải lại).
 */
function spx_getHeartbeat(ctxJson) {
  var ctx = {};
  try { ctx = ctxJson ? JSON.parse(ctxJson) : {}; } catch (e0) { ctx = {}; }
  var want = Array.isArray(ctx.parts) ? ctx.parts : [];
  var out = { success: true, ts: Date.now(), parts: {} };
  var run = function (name, fn) {
    try { out.parts[name] = fn(); }
    catch (e) { out.parts[name] = JSON.stringify({ success: false, error: String((e && e.message) || e) }); }
  };
  var seen = {};
  want.forEach(function (p) {
    if (seen[p]) return; seen[p] = true;
    switch (p) {
      case 'ann':   run('ann',   spx_getSystemAnnouncement); break;
      case 'mod':   run('mod',   spx_getModuleStatusPublic); break;
      case 'aging': run('aging', aging_getDataVersion); break;
      case 'kpi':   run('kpi',   kpifail_getDataVersion); break;
      case 'notes': run('notes', kpifail_getNotes); break;
      case 'fms':   run('fms',   fms_live_getSyncMeta); break;
      case 'ana':   if (ctx.ana) run('ana', function () { return ana_getStationDataStamp(String(ctx.ana)); }); break;
      default: break; // phần lạ -> bỏ qua
    }
  });
  return JSON.stringify(out);
}
/**
 * ============================================================
 * EPIC 1 — LIVE BACKLOG INTEGRATION (JS_FMS)
 * File: FMS_Live_Backend.gs   (NEW FILE — add alongside backend1.gs)
 * ------------------------------------------------------------
 * Toàn bộ hàm trong file này có tiền tố _fmsLive_ / fms_live_ để KHÔNG
 * đụng tới bất kỳ hàm nào trong backend1.gs. File này CHỈ đọc (never
 * write) sheet "Detail orders" và tái sử dụng nguyên vẹn:
 *   - getModuleAccess()      (backend1.gs)  — permission engine
 *   - _normStationKey_()     (backend1.gs)  — chuẩn hoá tên trạm
 *   - CacheService                          — cache hạ tầng chung
 *
 * KHÔNG redesign permission. KHÔNG đổi Manual (onhold_processFMSInMemory
 * trong backend1.gs giữ nguyên 100%, không bị gọi/sửa ở đây).
 *
 * Business rule phân loại 7 category dưới đây được CHỦ Ý viết lại (không
 * import) để cô lập hoàn toàn khỏi Manual — nhưng logic điều kiện giống
 * hệt onhold_processFMSInMemory để Live/Manual/Compare so sánh đúng nghĩa.
 * ============================================================
 */

// ── CẤU HÌNH NGUỒN LIVE ──────────────────────────────────────────────────
var FMS_LIVE_SHEET_ID   = '1k-bara0YYJQp1AAdcpNOIn1V4nkZ_ghx_CCyu3yQlhw';
var FMS_LIVE_SHEET_NAME = 'Detail orders';
var FMS_LIVE_CACHE_TTL  = 5400;   // giây — [FIX — phát hiện qua điều tra thật "Live trì trệ do data lớn"]
// TRƯỚC: 1200s (20 phút) — NGẮN HƠN 1 chu kỳ xây lại đầy đủ (fmsLive_stagedBuildRunner
// chia lô 10 phút/lượt, tới ~50 phút mới xong hết ~197.000 dòng "Detail orders" — số liệu
// đo thật, xem comment tại fms_live_installPrewarmTrigger()). Hậu quả: cứ mỗi chu kỳ có
// ~30 phút cache đã hết hạn NHƯNG chu kỳ mới chưa xây xong — MỌI user mở module trong
// khoảng đó đều rơi vào đường dự phòng _fmsLive_getIndexCached_() gọi thẳng
// _fmsLive_buildRawSnapshot_() (đọc 1 lần toàn bộ sheet, ~23-30s/lượt theo chính comment
// cũ) — ĐÂY LÀ NGUYÊN NHÂN THẬT của cảm giác "trì trệ do data lớn", không phải do thiếu
// tối ưu đọc dữ liệu (hệ thống chia lô đã được xây khá tinh vi từ trước). Nâng lên 5400s
// (90 phút) — dư margin an toàn so với chu kỳ ~50 phút (kể cả khi sheet lớn thêm khiến
// chu kỳ kéo dài hơn ước tính), đóng gần hết khoảng hở mà KHÔNG đụng bất kỳ dòng logic
// chia lô/khoá/phát hiện đổi nguồn dữ liệu nào đã được kiểm chứng kỹ từ trước.
// [FIX 2026-07-15 — HIỆU NĂNG, theo yêu cầu Xuân] TRƯỚC ĐÂY toàn bộ 300+ hub
// được gộp vào 1 cache key duy nhất (FMS_LIVE_CACHE_KEY) — nghĩa là xem 1 hub
// vẫn phải đọc + giải nén + JSON.parse dữ liệu của MỌI hub khác. Giờ tách 2
// tầng: 1 "index" nhẹ (danh sách hub + metadata, không chứa dữ liệu chi tiết)
// + 1 cache RIÊNG cho từng hub (_fmsLive_hubCacheKey_) — xem 1 hub giờ chỉ
// đọc đúng key của hub đó. Xem _fmsLive_getIndexCached_/_fmsLive_getHubsDataCached_.
var FMS_LIVE_INDEX_KEY  = 'fms_live_index_v1';
var FMS_LIVE_CACHE_KEY  = 'fms_live_raw_snapshot_v1'; // [DEPRECATED — giữ lại chỉ để fms_live_clearCache() dọn nốt cache kiểu cũ còn sót từ trước khi đổi kiến trúc]
var FMS_LIVE_MAX_DETAIL_ROWS = 5000; // trần an toàn mỗi category mỗi hub khi trả full detail (Compare)

var fmsLiveCategoryLabels = ["Đơn Mới", "Hẹn Giao", "Delay Khác", "Quá 3 Ca", "Hoàn Hàng", "Tồn 3-5N", "Tồn > 5N", "Cần kiểm tra"];

// ── BẢNG ÁNH XẠ MÃ LÝ DO ONHOLD → NHÓM NGHIỆP VỤ ─────────────────────────
// [FIX 2026-07 v2] Đối chiếu với data mẫu thật (Workbook1.csv mô phỏng từ
// link Live), cột OnHoldReason KHÔNG có tiền tố "R" — là số thuần (vd
// "170", "102"), khác với giả định ban đầu ("R172"). Regex cũ
// /^(R\d+)/i vì vậy KHÔNG BAO GIỜ khớp với dữ liệu Live thật →
// FMS_REASON_CODE_MAP trước đây là dead code. Đã đổi key sang số thuần
// và extract qua _fmsLive_extractBareCode_() (chấp nhận cả hai dạng "R170"
// lẫn "170" để không phụ thuộc định dạng cụ thể của một nguồn dữ liệu).
// Đây là mã lý do ở giai đoạn LAST-MILE (giao hàng) — không trùng dải mã
// với FMS_PICKUP_REASON_CODES (First-Mile/lấy hàng) bên dưới.
//
// [MỞ RỘNG 2026-07 v4 — theo yêu cầu anh Vũ 2026-07-14: "đã có mã đã có
// lý do thì tách ra luôn"] Trước đây CHỦ Ý chỉ map 6-7 mã có tín hiệu rõ
// ràng, còn lại dồn hết vào "Delay Khác". Đã thử mở rộng map bằng SUY ĐOÁN
// nghiệp vụ cho 191/180/160/238 — nhưng anh Vũ phản hồi (2026-07-14):
// "phân loại không phải gắn chung nó với nhau mà cần phải lọc riêng biệt,
// mã code như thế nào thì hiển thị lý do onhold như thế". Tức là: giờ đã
// có đủ TÊN CHÍNH XÁC cho cả 15 mã thì KHÔNG được đoán/gộp mã vào nhóm
// reject/reschedule nữa — chỉ mã nào chính TÊN GỐC đã ghi rõ là
// "Reject..." hoặc "...reschedule" mới thuộc nhóm đó. Các mã còn lại giữ
// NGUYÊN DẠNG RIÊNG của nó (không gắn chung/không đoán ý nghĩa) — hiển thị
// đúng tên gốc qua FMS_LM_REASON_LABELS, và với KPI 7-category (vốn chỉ
// có 3 trục Reject/Reschedule/Khác) thì các mã này ở lại "Delay Khác" như
// một fallback TRUNG THỰC (không biết = không đoán), khác hẳn ý nghĩa
// "Delay Khác" thời trước-2026-07 khi vẫn CHƯA CÓ tên cho các mã đó.
//
// ✅ CHỈ 6 MÃ SAU thuộc nhóm gộp (tên gốc ghi rõ Reject/Reschedule):
var FMS_REASON_CODE_MAP = {
  '172': 'reject',      // Recipient reject
  '176': 'reject',      // Reject - Buyers change their mind
  '174': 'reject',      // Reject - Wrong item
  '173': 'reject',      // Reject - Damaged
  '175': 'reject',      // Reject - Missing item
  '170': 'reschedule',  // Recipient reschedule
  // [MỚI — theo xác nhận trực tiếp của Xuân] "Buyer Never Place" (mã 13) —
  // đồng nghĩa với huỷ/hoàn hàng (người mua chưa từng đặt hàng thật → đơn
  // không bao giờ giao được) — đúng đúng trường hợp comment phía trên đã
  // lường trước ("nếu sau này anh Vũ/Xuân xác nhận... chỉ cần thêm 1 dòng").
  '13': 'reject',       // Buyer Never Place
  // [MỚI — theo yêu cầu trực tiếp "Unable to Deliver vô phần hoàn hàng,
  // không tính vào phần đơn hàng cần giao"] Mã 182 trước đây KHÔNG nằm
  // trong map này nên rơi vào nhánh mặc định "có mã nhưng không thuộc
  // nhóm" -> Delay Khác (2) — tức vẫn bị tính là đơn cần giao. Nay xếp
  // 'reject' như các mã hoàn hàng khác -> category 4 = HOÀN HÀNG, không
  // còn tính vào nhóm cần giao nữa.
  '182': 'reject'       // Unable to Deliver
};
// 9 mã còn lại (185, 169, 184, 191, 180, 160, 244, 187, 238) CỐ TÌNH không
// nằm trong map trên — mỗi mã vẫn hiển thị đúng tên riêng của nó (xem
// FMS_LM_REASON_LABELS), chỉ là KHÔNG bị gộp lẫn vào nhóm reject/reschedule
// nếu tên gốc không nói vậy. Nếu sau này anh Vũ/Xuân xác nhận một mã cụ
// thể (vd 191 "Đơn hàng ngưng giao") thực sự tương đương reject/reschedule
// về nghiệp vụ, chỉ cần thêm 1 dòng vào map trên — không cần sửa gì khác.

// ── [BỔ SUNG 2026-07 v3] Bảng nhãn ĐẦY ĐỦ 15 mã Last-Mile do anh Vũ xác
// nhận (2026-07-14) — dùng để hiển thị tên lý do dễ đọc trên UI thay vì
// mã thô ("170"). Việc PHÂN LOẠI category dựa vào FMS_REASON_CODE_MAP ở
// trên (đã mở rộng v4 để tách các mã đã biết tên ra khỏi "Delay Khác"
// mặc định) + attempts — bảng nhãn này chỉ phục vụ hiển thị, tách riêng
// khỏi logic phân loại để 2 việc không phụ thuộc lẫn nhau.
var FMS_LM_REASON_LABELS = {
  '185': 'Insufficient time',
  '169': 'Recipient unavailable for parcel',
  '170': 'Recipient reschedule',
  '172': 'Recipient reject',
  '176': 'Reject - Buyers change their mind',
  '184': 'Wrongly assigned',
  '191': 'Đơn hàng ngưng giao',
  '174': 'Reject - Wrong item',
  '180': 'Parcel lost',
  '160': 'Incorrect delivery address',
  '244': 'order info change by system',
  '173': 'Reject - Damaged',
  '175': 'Reject - Missing item',
  '187': 'Severe weather',
  '238': 'Recipient wants to receive at locker',
  // [MỚI — theo yêu cầu trực tiếp "tổng hợp OnHold theo reason code", đã xác
  // nhận qua đối chiếu: mã 191 giữ nguyên nhãn cũ "Đơn hàng ngưng giao" (không
  // đổi theo danh sách mới gửi), chỉ thêm 4 mã thật sự chưa có trong bảng]
  '13': 'Buyer Never Place',
  '232': 'Pending COD Collection Status Update',
  '181': 'Parcel damaged, cannot attempt',
  '182': 'Unable to Deliver'
};

// ── Trả về nhãn dễ đọc cho 1 lý do onhold (LM hoặc FM), fallback về chuỗi
// gốc nếu không tra được mã (đề phòng mã mới chưa được thêm vào bảng). ──
// [FIX 2026-07-14 — phát hiện qua đối chiếu UI Live vs Manual] Pattern
// `(rawReason || '')` coi SỐ 0 là falsy trong JS. File CSV mẫu mọi cell đều
// là text ("0") nên không lộ bug, nhưng cột last_on_hold_reason_code trên
// Google Sheet "Detail orders" thật gần như chắc chắn được Sheet tự nhận
// diện là SỐ (0, không phải chuỗi "0") — khiến (0 || '') = '' → toàn bộ đơn
// reason=0 (tức đa số backlog: Đơn Mới + Hẹn Giao) bị hiện "N/A" ở cột "Lý do
// Delay" thay vì nhãn đúng. Đối chiếu Manual: case này Manual hiện "Normal"
// (đơn không mang lý do on-hold nào) — Live giờ khớp theo, thay vì rơi vào
// N/A một cách vô nghĩa. Dùng kiểm tra null/undefined thay vì `|| ''` để 0
// (number) không bị nuốt mất.
function _fmsLive_reasonLabel_(rawReason) {
  var raw = (rawReason === null || rawReason === undefined) ? '' : rawReason.toString().trim();
  var bareCode = _fmsLive_extractBareCode_(raw);
  if (bareCode && FMS_LM_REASON_LABELS.hasOwnProperty(bareCode)) return FMS_LM_REASON_LABELS[bareCode];
  if (bareCode && FMS_PICKUP_REASON_CODES.hasOwnProperty(bareCode)) return FMS_PICKUP_REASON_CODES[bareCode];
  if (raw === '' || raw === '0') return 'Normal'; // khớp đúng nhãn "Normal" bên Manual cho case không on-hold
  return raw || 'N/A';
}

// ── BẢNG MÃ LÝ DO ONHOLD PICKUP (FIRST-MILE) — dải mã 101-13x ───────────
// [BỔ SUNG 2026-07] Đối chiếu Workbook1.csv: các dòng có backlog_stage=FM
// / action="0. Pending Pickup" mang mã 101-134, hoàn toàn KHÁC dải mã LM
// (160-244) ở FMS_REASON_CODE_MAP phía trên — hai không gian mã không
// giao nhau. Các đơn thuộc nhóm này được xử lý ở NHÁNH RIÊNG
// (xem _fmsLive_buildRawSnapshot_), KHÔNG tính vào 7 category LM
// (Đơn Mới/Hẹn Giao/Delay Khác/Quá 3 Ca/Hoàn Hàng/Tồn 3-5N/Tồn>5N) vì bản
// chất nghiệp vụ khác nhau (đơn còn ở giai đoạn lấy hàng, chưa nhập kho).
var FMS_PICKUP_REASON_CODES = {
  '101': 'Order is not ready',
  '102': 'Seller is uncontactable',
  '103': 'PUP is closed',
  '104': 'Incorrect pickup address',
  '105': 'Seller rescheduled pickup (remote)',
  '108': 'Parcel contains prohibited or dangerous items',
  '109': 'Seller intends to drop at Service Point',
  '111': '[Return/Refund] Improper Packaging',
  '112': 'Seller refuse pickup',
  '131': 'Insufficient pickup capacity',
  '132': 'Insufficient pickup time',
  '133': 'Picked up by other driver',
  '134': 'Disaster/traffic accident'
};

// [BỔ SUNG 2026-07-15 v13] Nhóm reject/reschedule cho mã Pickup/FM — cùng
// tinh thần FMS_REASON_CODE_MAP (chỉ gộp mã có TÊN GỐC ghi rõ), không đoán:
var FMS_PICKUP_REASON_GROUP = {
  '112': 'reject',      // Seller refuse pickup
  '108': 'reject',      // Parcel contains prohibited or dangerous items
  '111': 'reject',      // [Return/Refund] Improper Packaging
  '105': 'reschedule'   // Seller rescheduled pickup (remote)
};

// ── Tách mã số thuần từ chuỗi lý do, chấp nhận cả 2 dạng "R170" và "170"
// để không phụ thuộc định dạng của một nguồn dữ liệu cụ thể. ──
function _fmsLive_extractBareCode_(rawReason) {
  var raw = (rawReason === null || rawReason === undefined) ? '' : rawReason.toString().trim();
  var m = raw.match(/^R?(\d+)/i);
  return m ? m[1] : '';
}

/**
 * [FIX 2026-07-15 v13 — ĐỔI HƯỚNG HOÀN TOÀN theo Backlog__3__1_.xlsx]
 * "Detail orders" đã LÀ dữ liệu tồn đọng sẵn (không cần lọc theo status
 * nữa) — trục phân loại thật là `action` (khớp đúng pivot "FM Backlog"/
 * "LM Backlog" công ty đang dùng), refine bằng mã lý do CHỈ tại 2 action
 * (0.Pending Pickup, 7.Pending Delivery — verify trên toàn bộ 194k dòng,
 * action khác gần như không có mã). Bảng mapping đã Xuân duyệt 2026-07-15:
 *
 *   0,1,2,3,4,6 (không mã)              -> Đơn Mới (0)
 *   0.Pending Pickup + mã reschedule    -> Hẹn Giao (1)
 *   0.Pending Pickup + mã reject        -> Hoàn Hàng (4)
 *   0.Pending Pickup + mã khác          -> Delay Khác (2)
 *   7.Pending Delivery + mã reschedule  -> Hẹn Giao (1)
 *   7.Pending Delivery + mã khác/không  -> Delay Khác (2)
 *   8.Pending Return                    -> Hoàn Hàng (4)
 *   10.Pending CS                       -> Quá 3 Ca (3)
 *   11.Delivery_Holding, 12.Return_Holding -> Cần kiểm tra (7)
 *   In Transit                          -> BỎ QUA (null) — Xuân xác nhận
 *                                           tạm bỏ qua 2026-07-15, chưa xếp.
 *   action lạ/không nhận diện được      -> Cần kiểm tra (7), KHÔNG bỏ sót
 *                                           âm thầm (an toàn hơn là rơi
 *                                           nhầm vào 1 category cụ thể).
 *
 * Dùng CHUNG cho cả LM và FM (áp dụng y hệt action nào rơi đúng action đó,
 * action LM-only như 7/8/12 tự nhiên không xuất hiện ở dòng FM và ngược
 * lại) — trả về null nghĩa là BỎ QUA dòng này hoàn toàn (không tính vào
 * bất kỳ category/tổng nào).
 */
function _fmsLive_classifyByAction_(action, rawReason) {
  var a = (action || '').toString().trim();
  if (a === 'In Transit') return null; // tạm bỏ qua theo yêu cầu Xuân 2026-07-15

  var bareCode = _fmsLive_extractBareCode_(rawReason);
  var hasCode = !!bareCode && bareCode !== '0';

  if (a === '0. Pending Pickup') {
    var pickGroup = hasCode ? FMS_PICKUP_REASON_GROUP[bareCode] : null;
    if (pickGroup === 'reschedule') return 1;
    if (pickGroup === 'reject') return 4;
    if (hasCode) return 2; // có mã nhưng không thuộc 2 nhóm trên -> Delay Khác
    return 0; // không mã -> Đơn Mới
  }

  if (a === '7. Pending Delivery') {
    var lmGroup = hasCode ? FMS_REASON_CODE_MAP[bareCode] : null;
    if (lmGroup === 'reschedule') return 1;
    // [XÁC NHẬN LẠI 2026-09 — theo yêu cầu trực tiếp "Buyer Never Place chuyển
    // vào phần hoàn hàng, vẫn tính là đơn tồn tại hub"] Mã 13 (Buyer Never
    // Place) nằm trong FMS_REASON_CODE_MAP với nhóm 'reject', và 'reject' ánh
    // xạ sang category 4 = HOÀN HÀNG ở dòng dưới -> ĐÃ ĐÚNG như yêu cầu, không
    // cần sửa. Đơn vẫn được đếm bình thường vào tổng tồn tại hub (hàm này chỉ
    // phân loại NHÓM, không loại đơn khỏi tổng).
    // LƯU Ý: khác với module BI — ở BI, Buyer Never Place bị loại khỏi phép
    // tính Tồn theo yêu cầu riêng trước đó. Hai nơi CỐ Ý khác nhau, đừng đồng
    // bộ nhầm.
    if (lmGroup === 'reject') return 4;
    return 2; // có mã không thuộc nhóm, hoặc không mã -> Delay Khác
  }

  if (a === '8. Pending Return') return 4;                              // Hoàn Hàng

  // [MỚI — theo yêu cầu trực tiếp] Đơn delay 3 ca nhưng lý do CUỐI CÙNG là
  // "Insufficient time" (mã 185) thì KHÔNG xếp vào Quá 3 Ca, mà đẩy sang
  // Delay Khác.
  // LÝ DO NGHIỆP VỤ (nguyên văn): "bản chất là giao không kịp ca sau phải đi
  // giao, chưa thể cập nhật hoàn hàng được" — tức đơn vẫn đang trong luồng
  // giao bình thường, chỉ là hết giờ ca. Xếp vào Quá 3 Ca sẽ làm nhóm đó phình
  // lên bởi các đơn không thực sự có vấn đề, che mất đơn cần can thiệp thật.
  if (a === '10. Pending CS') {
    if (hasCode && bareCode === '185') return 2;                        // Delay Khác
    return 3;                                                           // Quá 3 Ca
  }
  if (a === '11. Delivery_Holding' || a === '12. Return_Holding') return 7; // Cần kiểm tra
  if (a === '1. Pending Unload' || a === '2. Pending Inbound' ||
      a === '3. Pending Packed' || a === '4. Pending Seal' ||
      a === '6. Pending Linehaul') return 0;                           // Đơn Mới

  return 7; // action lạ, chưa từng thấy trong 194k dòng verify -> an toàn: Cần kiểm tra
}

// ── [BỔ SUNG 2026-07-15 v13] aging_leadtime là bucket có sẵn từ nguồn dữ
// liệu ("0", "1. < 1 hours" ... "12. >21 days") — dùng thẳng thay vì tự
// tính now-inbound_time (vừa đúng hơn định nghĩa công ty, vừa nhanh hơn vì
// khỏi parse ngày cho từng dòng). Mapping sang 2 tag hiện có (Tồn 3-5N /
// Tồn >5N — theo bảng Xuân duyệt 2026-07-15, bucket "7. 2-5 days" gần nhất
// với "3-5N", "8." trở lên là "Tồn >5N"). Trả về null nếu chưa tới ngưỡng
// (không gắn tag) hoặc bucket rỗng/không nhận diện được. ──
function _fmsLive_agingBucketTag_(agingLeadtime) {
  var s = (agingLeadtime || '').toString().trim();
  if (s === '7. 2-5 days') return 5;
  var m = s.match(/^(\d+)\./);
  if (m) {
    var n = parseInt(m[1], 10);
    if (n >= 8 && n <= 12) return 6;
  }
  return null;
}

// ── Helpers JSON an toàn ─────────────────────────────────────────────────
function _fmsLive_parseJson_(str, fallback) {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}
function _fmsLive_findIdx_(headers, name) {
  return headers.findIndex(function(h) { return String(h || '').trim().toLowerCase() === name.toLowerCase(); });
}
function _fmsLive_findIdxAny_(headers, names) {
  for (var i = 0; i < names.length; i++) {
    var idx = _fmsLive_findIdx_(headers, names[i]);
    if (idx !== -1) return idx;
  }
  return -1;
}

// ── Đọc + phân loại "Detail orders" — GIỐNG HỆT quy tắc nghiệp vụ của
// onhold_processFMSInMemory (backend1.gs), chỉ khác nguồn đọc (Sheet thay
// vì CSV) và cách lấy cột Zone/Account (tra theo TÊN cột thay vì vị trí cố
// định, vì sheet Live không đảm bảo cùng thứ tự cột với file export CSV). ──
function _fmsLive_buildRawSnapshot_() {
  var ss = _DS.ss(FMS_LIVE_SHEET_ID); // [BỔ SUNG 2026-07-16] Dùng chung _DS (Data Session) thay vì openById() trực tiếp — khớp helper mới của bản backend rút gọn.
  var sheet = ss.getSheetByName(FMS_LIVE_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) {
    return { success: false, error: 'Không tìm thấy sheet "' + FMS_LIVE_SHEET_NAME + '" hoặc sheet rỗng.' };
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  // [FIX — áp lại đúng kỹ thuật đã kiểm chứng an toàn trong fmsLive_stagedBuildRunner()]
  // Đọc HEADER RIÊNG (1 dòng, rẻ) trước để xác định cột cần dùng, rồi mới đọc dữ liệu
  // theo ĐÚNG khoảng cột hẹp bao trọn 9 field cần — KHÔNG đọc nguyên lastCol (50 cột)
  // như bản cũ trong khi chỉ dùng 9 cột. VẪN CHỈ 1 LỆNH getRange DUY NHẤT (không lặp
  // lại rủi ro đã bị rollback ở [ROLLBACK 2026-07-15 v12] — đó là do đọc 13-15 CỤM cột
  // RIÊNG RẼ, khác hẳn ở đây: chỉ hẹp hơn theo số cột, vẫn 1 lệnh duy nhất).
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); });

  // [FIX 2026-07-14] Sheet "Detail orders" thực tế dùng schema snake_case
  // (đối chiếu Workbook1.csv — 536 dòng mẫu thật lấy từ link Live), KHÔNG
  // phải schema tiếng Anh "Order ID/Status/..." như code cũ giả định — đây
  // là nguyên nhân fms_live_getSnapshot() luôn trả success:false (c.id/
  // c.status = -1) khiến UI kẹt ở "Đang tải dữ liệu Live...".
  // Đã verify từng cột bằng phân bố giá trị thật trên Workbook1.csv:
  //   - status_desc: "LMHub_Received"(409)/"OnHold"(35)/... khớp đúng
  //     _fmsLive_isAtHubLM_() đang check.
  //   [CẬP NHẬT 2026-07-14] status_desc chỉ là mô tả bước xử lý, không phải
  //   trạng thái CUỐI CÙNG thật sự — đã đổi c.status sang ưu tiên đọc
  //   fleet_final_status. Đã đối chiếu full unique values của cột này
  //   (60+ giá trị, gồm cả FMHub_*/Return_*/Exception_Reason_*) và đổi
  //   _fmsLive_isAtHubLM_() sang exact-match "lmhub_received"/"onhold" thay vì
  //   substring, tránh nhận nhầm FMHub_Received/Return_LMHub_Received (cũng
  //   chứa chữ "received" nhưng không phải backlog LM thật).
  //   CÒN CẦN XÁC NHẬN NGHIỆP VỤ: "Delivery_Holding", "Exception_Reason_Added",
  //   "Pending Intercept" có nên tính là backlog LM không — hiện tạm KHÔNG
  //   tính (giữ nguyên phạm vi hẹp đã verify), chờ xác nhận từ Oanh trước khi
  //   mở rộng, vì ảnh hưởng trực tiếp số liệu KPI tồn đọng.
  //   - last_on_hold_reason_code: "170"/"169"/"105"/"102"... khớp đúng
  //     FMS_REASON_CODE_MAP / FMS_PICKUP_REASON_CODES đã có sẵn.
  //   - deliver_attempt: giá trị thật 0-5 (không phải cờ boolean).
  //   - station_name === lm_station_name ở 489/536 dòng; 47 dòng lệch đều
  //     là đơn FM/pending-pickup chưa tới hub LM được gán → đúng ngữ nghĩa
  //     Current Station / Destination Station.
  //   - buyer_ward_old có dữ liệu thật (404/536); station_ward LUÔN RỖNG
  //     trong data mẫu → không dùng được, đổi sang buyer_ward_old.
  //   - last_touch_by luôn có giá trị (email nhân viên xử lý gần nhất) →
  //     dùng thay "Account" (sheet không có cột account riêng).
  // Vẫn giữ tên cột tiếng Anh cũ làm fallback thứ 2 trong findIdxAny —
  // phòng trường hợp sau này sheet đổi lại/đổi tên cột, code không cần
  // sửa lại lần nữa. KHÔNG đụng onhold_processFMSInMemory (Manual, ở
  // backend1.gs) — Manual giữ nguyên 100%.
  // [FIX 2026-07-15 v13 — ĐỔI HƯỚNG THEO Backlog__3__1_.xlsx, xác nhận với
  // Xuân] "Detail orders" ĐÃ LÀ dữ liệu tồn đọng sẵn (194.000/194.001 dòng có
  // đủ backlog_stage + action) — KHÔNG cần lọc theo status/current==dest
  // nữa. Trục phân loại thật là action (khớp 100% cột trong 2 sheet "FM
  // Backlog"/"LM Backlog" — đúng pivot công ty đang dùng), refine bằng mã lý
  // do CHỈ tại 2 action (0.Pending Pickup, 7.Pending Delivery — verify trên
  // toàn bộ 194k dòng, các action khác gần như không có mã). aging_leadtime
  // là bucket có sẵn, dùng thẳng thay vì tự tính now-inbound_time.
  var c = {
    id:      _fmsLive_findIdxAny_(headers, ['shipment_id', 'Order ID']),
    ward:    _fmsLive_findIdxAny_(headers, ['buyer_ward_old', 'Ward Name']),
    reason:  _fmsLive_findIdxAny_(headers, ['last_on_hold_reason_code', 'OnHoldReason']),
    cur:     _fmsLive_findIdxAny_(headers, ['station_name', 'Current Station']),
    stage:   _fmsLive_findIdxAny_(headers, ['backlog_stage']),
    action:  _fmsLive_findIdxAny_(headers, ['action']),
    aging:   _fmsLive_findIdxAny_(headers, ['aging_leadtime']),
    zone:    _fmsLive_findIdxAny_(headers, ['buyer_sort_code', 'Zone ID', 'ZoneId', 'Zone']),
    account: _fmsLive_findIdxAny_(headers, ['last_touch_by', 'Account', 'Account Name', 'Current Account Name'])
  };

  if (c.id === -1 || c.stage === -1 || c.action === -1) {
    return { success: false, error: 'Sheet "Detail orders" thiếu cột shipment_id, backlog_stage, hoặc action.', _headers: headers };
  }

  // [FIX — áp lại đúng kỹ thuật đã kiểm chứng an toàn trong fmsLive_stagedBuildRunner(),
  // xem giải thích đầy đủ tại đó] Thu hẹp khoảng cột về ĐÚNG span bao trọn 9 field cần
  // dùng (chỉ số TUYỆT ĐỐI trong lastCol), rồi remap "c" sang chỉ số TƯƠNG ĐỐI trong
  // khoảng đã hẹp — logic phân loại bên dưới KHÔNG đổi 1 dòng nào, vẫn viết y hệt
  // r[c.cur]/r[c.stage]/... An toàn với field không tồn tại (-1) hay nằm lệch xa nhau
  // (khi đó khoảng tính ra gần bằng lastCol — không lợi nhưng không sai/tệ hơn hiện tại).
  var _colIdxs = Object.keys(c).map(function(k) { return c[k]; }).filter(function(i) { return i !== -1; });
  var _colMin = Math.min.apply(null, _colIdxs);
  var _colMax = Math.max.apply(null, _colIdxs);
  var _colSpanStart = _colMin + 1; // getRange dùng cột 1-based
  var _colSpanCount = _colMax - _colMin + 1;
  var cFull = c; // giữ bản gốc (chỉ số tuyệt đối) để đối chiếu/debug nếu cần, không dùng trong vòng lặp bên dưới
  c = {};
  Object.keys(cFull).forEach(function(k) { c[k] = (cFull[k] === -1) ? -1 : (cFull[k] - _colMin); });

  var rows = (lastRow >= 2) ? sheet.getRange(2, _colSpanStart, lastRow - 1, _colSpanCount).getValues() : [];

  var tz = SPX_TZ;
  var now = new Date();

  var hubData = {};
  var inTransitCount = 0; // đơn "In Transit" — tạm bỏ qua theo yêu cầu Xuân 2026-07-15, chỉ đếm để biết quy mô

  function _fmsLive_newStageBucket_() {
    return { stats: [0,0,0,0,0,0,0,0,0], details: [[],[],[],[],[],[],[],[]], agingCounts: { 5: 0, 6: 0 }, agingDetails: { 5: [], 6: [] } };
  }
  function _fmsLive_ensureHub_(h) {
    if (!hubData[h]) hubData[h] = { LM: _fmsLive_newStageBucket_(), FM: _fmsLive_newStageBucket_() };
    return hubData[h];
  }

  // [FIX 2026-07-15 v13 — ĐỔI HƯỚNG HOÀN TOÀN] "Detail orders" đã LÀ dữ liệu
  // tồn đọng sẵn (xác nhận qua Backlog__3__1_.xlsx: 194.000/194.001 dòng có
  // đủ backlog_stage+action) — KHÔNG lọc theo status/current==destination
  // nữa. LM và FM giờ dùng CHUNG 1 cấu trúc 8-category (hubData[hub].LM /
  // .FM), tách bằng cột backlog_stage — thay cho fmOnHold (cấu trúc riêng,
  // khác hẳn LM) trước đây. Cũng bỏ luôn việc tự tính tuổi tồn từ
  // now-inbound_time — dùng thẳng bucket aging_leadtime có sẵn (nhanh hơn,
  // đúng định nghĩa công ty hơn).
  rows.forEach(function(r) {
    var hub = r[c.cur];
    if (!hub) return;

    var stage = (r[c.stage] || '').toString().trim().toUpperCase();
    if (stage !== 'LM' && stage !== 'FM') return; // dữ liệu thiếu backlog_stage -> bỏ qua, không đoán

    var action = (r[c.action] || '').toString().trim();
    var rawReason = r[c.reason];
    var catIdx = _fmsLive_classifyByAction_(action, rawReason);
    if (catIdx === null) { if (action === 'In Transit') inTransitCount++; return; } // In Transit -> bỏ qua

    var zoneId = (c.zone !== -1 && r[c.zone]) ? r[c.zone].toString().trim() : 'N/A';
    var account = (c.account !== -1 && r[c.account]) ? r[c.account].toString().trim() : 'N/A';
    var agingRaw = (c.aging !== -1 && r[c.aging] !== '' && r[c.aging] !== null && r[c.aging] !== undefined) ? r[c.aging].toString().trim() : '';
    var rowData = [r[c.id], zoneId, r[c.ward], account, _fmsLive_reasonLabel_(rawReason), action, agingRaw];

    var target = _fmsLive_ensureHub_(hub)[stage];
    target.stats[catIdx]++; target.details[catIdx].push(rowData);
    target.stats[8]++;

    // Tuổi tồn: đọc thẳng bucket aging_leadtime có sẵn — số liệu PHỤ, không
    // loại trừ category chính (1 đơn có thể vừa thuộc 1 trong 5 category
    // (0-4/7) vừa "già", 2 số liệu độc lập, không đè/cộng lẫn nhau).
    var agingTag = _fmsLive_agingBucketTag_(agingRaw);
    if (agingTag) { target.agingCounts[agingTag]++; target.agingDetails[agingTag].push(rowData); }
  });

  var hubs = Object.keys(hubData).sort();

  return {
    success: true,
    hubs: hubs,
    data: hubData,
    inTransitCount: inTransitCount,
    generatedAt: now.getTime(),
    generatedAtIso: Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ss")
  };
}

// ── Cache chunked (giống mẫu kpifail_getMasterDataLite) — snapshot RAW,
// CHƯA lọc quyền (lọc quyền luôn thực hiện SAU, ở tầng public function) ──
// [KHÔNG gộp vào CacheMgr — 2026-07] Đã thử gộp nhưng revert: _fmsLive_readChunkedJsonBatch_()
// bên dưới đọc THẲNG key vật lý gốc (prefix+'_meta'...) để tối ưu đọc nhiều hub cùng lúc
// trong 1 lệnh getAll() — nếu 2 hàm này đổi sang ghi qua CacheMgr (thêm tiền tố cm_FMS_LIVE_),
// dữ liệu ghi/đọc sẽ trỏ 2 key vật lý khác nhau, khiến cache theo hub luôn miss. Giữ nguyên
// implementation gốc ở đây — đây là 1 trong số ít chỗ KHÔNG nên gộp vì có phụ thuộc chéo
// vào đúng định dạng key vật lý với 1 cơ chế đọc batch khác (không đơn thuần trùng lặp).
// [FIX 2026-08-03] "INDEX KEY OVERFLOW" — 2 key TỔNG HỢP (FMS_LIVE_INDEX_KEY,
// PICK_LIVE_INDEX_KEY) gộp dữ liệu của TẤT CẢ hub vào 1 JSON duy nhất, ghi qua
// ScriptCache thô (putAll, KHÔNG có giới hạn số chunk an toàn nào — không như
// CacheMgr.setChunked có chặn ở 40 chunk). Log Executions xác nhận
// fms_live_getSnapshot rớt xuống chỉ ~24% cache-hit đúng lúc traffic tăng đột
// biến — cùng lớp lỗi đã xác nhận & vá ở Aging (dữ liệu vượt trần ScriptCache,
// ghi thất bại âm thầm). Chuyển ĐÚNG 2 key này sang lưu Sheet kiểu ping-pong
// (không giới hạn kích thước, đúng pattern đã dùng cho KPI Fail/Aging) — CÁC
// KEY KHÁC (cache riêng từng hub, _fmsLive_hubCacheKey_/_pickLive_hubCacheKey_)
// GIỮ NGUYÊN trên ScriptCache như cũ, vì chưa có bằng chứng lỗi ở đó và payload
// mỗi hub riêng lẻ nhỏ hơn nhiều, rủi ro thấp hơn hẳn.
var FMS_INDEX_PINGPONG_KEYS = { 'fms_live_index_v1': 1, 'pick_live_index_v1': 1 };

function _fmsIndexSnapshotSheet_(ss, keyName, slot) {
  var safeName = 'FMSIdx_' + keyName.replace(/[^a-zA-Z0-9]/g, '_') + '_' + (slot === 'B' ? 'B' : 'A');
  var sheet = ss.getSheetByName(safeName);
  if (!sheet) {
    sheet = ss.insertSheet(safeName);
    sheet.appendRow(['Key', 'ChunkIndex', 'ChunkData']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  return sheet;
}
function _fmsIndexMetaSheet_(ss, keyName) {
  var safeName = 'FMSIdx_' + keyName.replace(/[^a-zA-Z0-9]/g, '_') + '_Meta';
  var sheet = ss.getSheetByName(safeName);
  if (!sheet) {
    sheet = ss.insertSheet(safeName);
    sheet.appendRow(['Key', 'Value']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  return sheet;
}
function _fmsIndexReadPingPong_(keyName) {
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    var metaSheet = _fmsIndexMetaSheet_(ss, keyName);
    var metaMap = _kpifail_getMetaMap_(metaSheet); // hàm dùng chung, không riêng KPI Fail
    if (!metaMap.snapshot_version) return null;
    var activeSlot = metaMap.snapshot_active_slot === 'B' ? 'B' : 'A';
    var dataSheet = _fmsIndexSnapshotSheet_(ss, keyName, activeSlot);
    if (dataSheet.getLastRow() < 2) return null;
    var rows = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 3).getDisplayValues();
    var chunks = [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] !== 'chunk') continue;
      chunks.push({ idx: Number(rows[i][1]) || 0, data: rows[i][2] || '' });
    }
    if (!chunks.length) return null;
    chunks.sort(function(a, b) { return a.idx - b.idx; });
    return chunks.map(function(c) { return c.data; }).join('');
  } catch (e) { return null; }
}
function _fmsIndexWritePingPong_(keyName, jsonStr) {
  try {
    var ss = _DS.ss(ADMIN_DB_ID);
    var metaSheet = _fmsIndexMetaSheet_(ss, keyName);
    var oldMeta = _kpifail_getMetaMap_(metaSheet);
    var oldActiveSlot = oldMeta.snapshot_active_slot === 'B' ? 'B' : 'A';
    var newSlot = oldActiveSlot === 'A' ? 'B' : 'A';
    var dataSheet = _fmsIndexSnapshotSheet_(ss, keyName, newSlot);

    var chunkSize = 45000;
    var rows = [['Key', 'ChunkIndex', 'ChunkData']];
    var idx = 0;
    for (var pos = 0; pos < jsonStr.length; pos += chunkSize) {
      rows.push(['chunk', idx++, jsonStr.slice(pos, pos + chunkSize)]);
    }
    dataSheet.clearContents();
    dataSheet.getRange(1, 1, rows.length, 3).setValues(rows);
    dataSheet.getRange(1, 1, 1, 3).setFontWeight('bold');

    _kpifail_setMetaMap_(metaSheet, {
      snapshot_version: String(Date.now()),
      snapshot_active_slot: newSlot
    });
  } catch (e) {}
}

function _fmsLive_readChunkedJson_(prefix) {
  if (FMS_INDEX_PINGPONG_KEYS[prefix]) return _fmsIndexReadPingPong_(prefix);
  try {
    var sc = CacheService.getScriptCache();
    var metaStr = sc.get(prefix + '_meta');
    if (!metaStr) return null;
    var meta = JSON.parse(metaStr);
    var full = '';
    for (var i = 0; i < meta.chunks; i++) {
      var ch = sc.get(prefix + '_c' + i);
      if (!ch) return null;
      full += ch;
    }
    return full;
  } catch (e) { return null; }
}
function _fmsLive_writeChunkedJson_(prefix, jsonStr, ttl) {
  if (FMS_INDEX_PINGPONG_KEYS[prefix]) { _fmsIndexWritePingPong_(prefix, jsonStr); return; }
  try {
    var sc = CacheService.getScriptCache();
  // [SỬA LỖI THẬT] Ô bộ đệm Apps Script giới hạn 100KB, mà tiếng Việt tốn 2-3 byte/
  // ký tự -> khúc 90.000 ký tự VƯỢT giới hạn, bộ đệm im lặng không lưu được, mỗi
  // lượt tải lại phải dựng từ đầu (nguyên nhân KPI nặng và treo). 45.000 an toàn.
    var CHUNK_SIZE = 45000;
    var chunks = [];
    for (var j = 0; j < jsonStr.length; j += CHUNK_SIZE) chunks.push(jsonStr.slice(j, j + CHUNK_SIZE));
    var pairs = {};
    pairs[prefix + '_meta'] = JSON.stringify({ chunks: chunks.length });
    chunks.forEach(function(ck, idx) { pairs[prefix + '_c' + idx] = ck; });
    sc.putAll(pairs, ttl);
  } catch (e) {}
}

// [BỔ SUNG 2026-07-15 — HIỆU NĂNG] Sinh cache key AN TOÀN + DUY NHẤT cho 1
// hub cụ thể. CHÚ Ý: KHÔNG dùng _normStationKey_() ở đây dù tên rất giống —
// hàm đó cố ý bỏ dấu + bỏ hậu tố (hub/lm/fm/station) để so khớp MỜ (fuzzy)
// giữa các cách viết tên hub khác nhau, nghĩa là 2 hub THẬT KHÁC NHAU có thể
// bị quy về CÙNG 1 khoá — chấp nhận được khi dùng để SO KHỚP, nhưng làm cache
// key thì sẽ khiến 2 hub khác nhau ghi đè dữ liệu của nhau. Sanitizer riêng ở
// đây GIỮ NGUYÊN toàn bộ nội dung (chỉ bỏ dấu + thay ký tự lạ bằng '_'), đảm
// bảo ánh xạ 1-1 với tên hub thật.
function _fmsLive_hubCacheKey_(hubName) {
  var s = (hubName || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return 'fms_live_hub_' + s + '_v1';
}

// [BỔ SUNG 2026-07-15 — HIỆU NĂNG] Đọc NHIỀU blob chunked cùng lúc bằng
// CacheService.getAll() (gộp thành 2 lần gọi mạng: 1 lần lấy hết các "_meta",
// 1 lần lấy hết các chunk cần) thay vì N lần .get() tuần tự — quan trọng khi
// cần gộp dữ liệu nhiều hub (VD "Tất cả Hub" của 1 admin). Trả về map
// { prefix: jsonString | null }.
// [BỔ SUNG 2026-07-15 — HIỆU NĂNG, siết lại 2026-07-15 sau khi phát hiện lỗi
// "Lỗi tải dữ liệu" khi chọn "Tất cả Hub"] Đọc NHIỀU blob chunked cùng lúc.
// CHIA NHỎ mỗi lần gọi getAll() còn tối đa GETALL_BATCH_SIZE key — phòng
// trường hợp getAll() có giới hạn số lượng key/tổng dung lượng payload mỗi
// lần gọi (không có tài liệu chính thức ghi rõ con số, nên chủ động chia
// nhỏ cho an toàn thay vì gửi hàng trăm/nghìn key trong 1 lần gọi). Nếu
// getAll() vẫn lỗi vì lý do gì đó → tự động rơi xuống đọc từng key một
// (.get() tuần tự, chậm hơn nhưng KHÔNG BAO GIỜ làm cả request thất bại chỉ
// vì 1 lần gọi batch bị lỗi).
var FMS_LIVE_GETALL_BATCH_SIZE = 40;

function _fmsLive_getAllSafe_(sc, keys) {
  if (!keys.length) return {};
  var out = {};
  for (var i = 0; i < keys.length; i += FMS_LIVE_GETALL_BATCH_SIZE) {
    var slice = keys.slice(i, i + FMS_LIVE_GETALL_BATCH_SIZE);
    try {
      var got = sc.getAll(slice);
      if (got) Object.keys(got).forEach(function(k) { out[k] = got[k]; });
    } catch (e) {
      // getAll() lỗi (hiếm, VD vượt giới hạn không tài liệu hoá) -> rơi
      // xuống đọc từng key một cho riêng lô này, không làm hỏng cả request.
      slice.forEach(function(k) {
        try { var v = sc.get(k); if (v !== null) out[k] = v; } catch (e2) {}
      });
    }
  }
  return out;
}

function _fmsLive_readChunkedJsonBatch_(prefixes) {
  var result = {};
  if (!prefixes || !prefixes.length) return result;
  var sc = CacheService.getScriptCache();
  var metaKeys = prefixes.map(function(p) { return p + '_meta'; });
  var metas = _fmsLive_getAllSafe_(sc, metaKeys);
  var chunkKeysNeeded = [];
  var chunkCountByPrefix = {};
  prefixes.forEach(function(p) {
    var metaStr = metas[p + '_meta'];
    if (!metaStr) return;
    var meta; try { meta = JSON.parse(metaStr); } catch (e) { return; }
    chunkCountByPrefix[p] = meta.chunks;
    for (var i = 0; i < meta.chunks; i++) chunkKeysNeeded.push(p + '_c' + i);
  });
  var chunkVals = _fmsLive_getAllSafe_(sc, chunkKeysNeeded);
  prefixes.forEach(function(p) {
    var n = chunkCountByPrefix[p];
    if (n === undefined) { result[p] = null; return; }
    var full = '', ok = true;
    for (var i = 0; i < n; i++) {
      var v = chunkVals[p + '_c' + i];
      if (v === undefined || v === null) { ok = false; break; }
      full += v;
    }
    result[p] = ok ? full : null;
  });
  return result;
}

// [FIX 2026-07 — hiệu năng] Trước đây MỌI request cache-miss đều tự chạy
// _fmsLive_buildRawSnapshot_() (quét 200k+ dòng sheet) độc lập — nếu nhiều
// user/tab cùng lúc gặp cache hết hạn (vd auto-refresh 30s đồng loạt), xảy
// ra "thundering herd": nhiều lần quét sheet song song, mỗi lần đều nặng,
// làm chậm dây chuyền chung (kể cả các request KHÔNG liên quan tới FMS Live,
// vì cùng ăn chung quota execution của project). Nay bọc bằng LockService:
// chỉ 1 request được build, các request khác chờ rồi đọc lại cache (đã có
// sau khi người giữ lock xong) thay vì tự build lại từ đầu.
// [FIX 2026-07-15 — HIỆU NĂNG] Biến tạm TRONG PHẠM VI 1 LẦN THỰC THI (mỗi
// request GAS chạy 1 execution context riêng, biến top-level luôn khởi tạo
// lại từ đầu — KHÔNG rò rỉ/lẫn giữa các request khác nhau). Khi vừa build
// mới do cache-miss, giữ tạm bản build trong bộ nhớ để bước lấy dữ liệu hub
// ngay sau đó (cùng 1 request) khỏi phải đọc lại cache vừa ghi.
var _fmsLive_lastFreshBuild_ = null;

/**
 * _fmsLive_getIndexCached_(forceRefresh)
 * Lấy INDEX nhẹ — CHỈ danh sách hub + metadata (generatedAt/destColMissing/
 * inTransitExceptions), KHÔNG chứa dữ liệu chi tiết từng hub. Luôn cần gọi
 * trước để biết hub nào tồn tại + validate quyền, trước khi quyết định cần
 * lấy dữ liệu đầy đủ của (những) hub nào qua _fmsLive_getHubsDataCached_().
 * Cache-miss -> quét lại toàn bộ sheet (không tránh được, vì sheet gộp mọi
 * hub trong 1 tab) NHƯNG chỉ 1 lần cho tất cả hub cùng lúc, rồi ghi riêng
 * từng hub ra cache — các lần đọc SAU đó (kể cả của hub khác) chỉ tốn chi
 * phí đọc cache nhỏ, không phải quét sheet lại.
 */
/**
 * [FIX 2026-07-15 v11 — đổi kiến trúc theo yêu cầu Xuân, KHÔNG dùng Firestore
 * (tránh phát sinh read/write quota) và KHÔNG để request của user tự đi
 * build nữa. TRƯỚC ĐÂY: nếu cache trống (index chưa có), request của user
 * (forceRefresh=false) vẫn tự chạy _fmsLive_buildRawSnapshot_() đồng bộ —
 * đây chính là nguyên nhân user phải CHỜ TRỰC TIẾP vài phút nếu chẳng may
 * request của họ "trúng" đúng lúc cache nguội. GIỜ: forceRefresh=false
 * KHÔNG BAO GIỜ build — cache trống thì trả về "chưa sẵn sàng" ngay lập tức
 * (nhanh), để trigger nền (fms_live_prewarmCache, forceRefresh=true, chạy cố
 * định mỗi 5 phút — xem fms_live_installPrewarmTrigger) tự lo việc build.
 * Kết quả: MỌI request của user luôn nhanh (đọc cache hoặc báo "chưa sẵn
 * sàng" ngay), không phụ thuộc số lượng user hay thời điểm truy cập. Đánh
 * đổi: lần đầu tiên sau khi deploy (trước khi trigger chạy lần đầu) hoặc
 * ngay sau fms_live_clearCache(), user sẽ thấy "chưa sẵn sàng" tối đa ~5
 * phút — chấp nhận được, và có thể rút ngắn bằng cách chạy tay
 * fms_live_prewarmCache() 1 lần từ Apps Script editor ngay sau khi deploy.
 */
function _fmsLive_getIndexCached_(forceRefresh) {
  if (!forceRefresh) {
    var idx = _fmsLive_readIndex_();
    if (idx) return idx;
    // [FIX 2026-08-01] TRƯỚC ĐÂY: cache trống -> báo lỗi cứng ngay, không có
    // đường tự build — đây chính là lý do KHÔNG thể áp khung giờ vắng cho
    // fms_live_prewarmCache (nếu áp, module "chết" hẳn suốt khung giờ đó, đã
    // từng xảy ra thật). Giờ THỬ TỰ BUILD 1 LẦN (có khóa bảo vệ, double-check
    // sau khi giành khóa phòng trường hợp lượt khác vừa build xong) trước khi
    // báo lỗi — cho phép bật lại khung giờ vắng cho trigger nền mà module vẫn
    // luôn phục vụ được, chỉ chậm hơn (build live ~23-30s) thay vì lỗi cứng.
    var gotLockLive = _anaAcquireNamedLock('fms_live_prewarm_lock_v1', 20000);
    if (gotLockLive) {
      try {
        var idxRecheck = _fmsLive_readIndex_();
        if (idxRecheck) return idxRecheck;
        var freshLive = _fmsLive_buildRawSnapshot_();
        if (freshLive && freshLive.success) {
          _fmsLive_lastFreshBuild_ = freshLive;
          try { _fmsLive_writeSnapshotPerHub_(freshLive); } catch (eWr) {}
          return {
            success: true, hubs: freshLive.hubs, destColMissing: freshLive.destColMissing,
            inTransitCount: freshLive.inTransitCount,
            generatedAt: freshLive.generatedAt, generatedAtIso: freshLive.generatedAtIso
          };
        }
      } catch (eLive) {
        // rơi xuống báo lỗi "chưa sẵn sàng" bên dưới — không throw ra ngoài
      } finally {
        _anaReleaseNamedLock('fms_live_prewarm_lock_v1');
      }
    }
    return {
      success: false,
      busy: true,
      notReady: true,
      error: 'Dữ liệu chưa sẵn sàng, đang được cập nhật. Vui lòng thử lại sau vài phút.'
    };
  }

  // forceRefresh=true: CHỈ nên được gọi từ fms_live_prewarmCache() (trigger
  // nền) hoặc thủ công bởi admin — không phải từ đường request thường của
  // user (mọi endpoint công khai trong file này đều gọi forceRefresh=false).
  // [FIX NGHẼN LOCK 2026-07-24] Cùng lý do như pick_live_prewarmCache() — đổi từ
  // LockService.getScriptLock() sang named lock riêng, tránh chặn cả hệ thống mỗi
  // 5 phút trong lúc quét sheet FMS Live.
  var gotLock = _anaAcquireNamedLock('fms_live_prewarm_lock_v1', 20000);

  if (!gotLock) {
    // Hiếm gặp: 2 lần trigger/rebuild thủ công chồng lấn nhau. Đọc lại cache
    // 1 lần nữa (có thể tiến trình kia vừa xong); nếu chưa, bỏ qua lần này
    // — KHÔNG build song song — chu kỳ trigger sau sẽ tự bù.
    var idxAfterWait = _fmsLive_readIndex_();
    if (idxAfterWait) return idxAfterWait;
    return { success: false, busy: true, error: 'Đang có 1 tiến trình cập nhật khác chạy — bỏ qua lần này, đợi chu kỳ sau.' };
  }

  try {
    var fresh = _fmsLive_buildRawSnapshot_();
    if (!fresh || !fresh.success) return fresh;
    _fmsLive_lastFreshBuild_ = fresh;
    try { _fmsLive_writeSnapshotPerHub_(fresh); } catch (e) {}
    return {
      success: true, hubs: fresh.hubs, destColMissing: fresh.destColMissing,
      inTransitCount: fresh.inTransitCount,
      generatedAt: fresh.generatedAt, generatedAtIso: fresh.generatedAtIso
    };
  } finally {
    if (gotLock) _anaReleaseNamedLock('fms_live_prewarm_lock_v1');
  }
}

function _fmsLive_readIndex_() {
  var cached = _fmsLive_readChunkedJson_(FMS_LIVE_INDEX_KEY);
  if (!cached) return null;
  return _fmsLive_parseJson_(cached, null);
}

// Ghi index (nhẹ) + cache riêng từng hub, cùng TTL, ngay sau khi build xong.
// =========================================================================
// [FIX 2026-08-14] "XÂY THEO LÔ DÒNG" cho FMS Live — khác với aging (chia theo
// NGUỒN dữ liệu, vì có 3 sheet tách biệt), fms_live chỉ có ĐÚNG 1 sheet nguồn
// ("Detail orders", xác nhận thật 194.000 dòng) nên chia theo LÔ DÒNG (mỗi lượt
// trigger đọc 1 khoảng dòng, gộp dần) thay vì chia theo nguồn.
//
// KHÁC VỚI lần rollback trước (đọc riêng 13-15 CỘT, nhiều lệnh getRange hẹp
// trong CÙNG 1 lượt chạy — bị bỏ vì chỉ cần 1 lệnh lỗi là hỏng cả build): đây
// là chia theo DÒNG, mỗi lượt VẪN CHỈ 1 lệnh getRange duy nhất (đọc đủ mọi cột
// cần, y hệt bản gốc) — chỉ khác là đọc 1 khoảng dòng thay vì toàn bộ, trải qua
// NHIỀU lượt trigger thay vì 1 lượt. Không lặp lại đúng rủi ro đã bị rollback.
//
// AN TOÀN QUAN TRỌNG: KHÔNG đụng _fmsLive_buildRawSnapshot_() (giữ nguyên
// 100% — vẫn dùng cho đường "user đang chờ, cache trống" trong
// _fmsLive_getIndexCached_(), đường đó cần trả lời NGAY, không thể trải ra
// nhiều lượt trigger). Hàm dưới đây là ĐƯỜNG RIÊNG cho job nền
// (fms_live_prewarmCache), chấp nhận trùng lặp 1 đoạn nhỏ logic phân loại
// dòng (giống _fmsLive_buildRawSnapshot_) để đổi lấy: lỗi trong đường MỚI này
// không thể nào ảnh hưởng tới đường CŨ đã qua thực chiến.
// =========================================================================
var FMS_LIVE_BUILD_CURSOR_KEY = 'fms_live_build_cursor_v1';
var FMS_LIVE_BUILD_CHUNK_ROWS = 40000;
// [FIX 2026-08-15 — ĐÃ THỬ TĂNG LÊN 100.000 RỒI REVERT LẠI] Từng cân nhắc tăng lên
// 100.000 dòng/lô (còn ~2 lô/chu kỳ, chu kỳ đầy đủ chỉ ~20 phút thay vì ~50 phút) để
// FMS Live "tươi" hơn — NHƯNG tính lại tổng thời gian xử lý/NGÀY thì phát hiện: vì
// chu kỳ tự khởi động lại NGAY khi vừa xong (không nghỉ), lô CÀNG LỚN thì càng nhiều
// chu kỳ hoàn thành được/ngày → tổng khối lượng xử lý/ngày TĂNG theo, KHÔNG giảm.
// Cụ thể: 100.000 dòng/lô → ~72 chu kỳ/ngày → ~374 PHÚT/NGÀY — một mình job này đã
// VƯỢT trần 360 phút/ngày của TOÀN HỆ THỐNG (ăn hết cả phần dành cho kpifail, aging,
// và mọi traffic user thật). Đây là đánh đổi CỐ HỮU: tổng số dòng cần xử lý lại từ
// đầu mỗi chu kỳ là CỐ ĐỊNH (194.000 dòng, ~302,7s/lần — số liệu lịch sử thật), nên
// chia lô kiểu nào cũng không giảm được TỔNG khối lượng — chỉ đổi cách phân bổ theo
// thời gian. Muốn "tươi" hơn THẬT SỰ mà không tốn thêm quota, cần xử lý THEO GIA
// TĂNG (chỉ đọc phần thay đổi, không đọc lại toàn bộ mỗi chu kỳ) — nhưng "Detail
// orders" nhiều khả năng bị THAY THẾ TOÀN BỘ định kỳ (không phải chỉ nối thêm dòng),
// nên chưa áp dụng an toàn được cách này. GIỮ NGUYÊN 40.000 (~150 phút/ngày, đã có
// dư địa) làm lựa chọn AN TOÀN — xem thêm phần thảo luận đánh đổi trong hội thoại.

function _fmsLive_newStageBucketStaged_() {
  return { stats: [0,0,0,0,0,0,0,0,0], details: [[],[],[],[],[],[],[],[]], agingCounts: { 5: 0, 6: 0 }, agingDetails: { 5: [], 6: [] } };
}

function _fmsLive_stagingSheet_(ss) {
  var sheet = ss.getSheetByName('FMSLiveBuild_Staging');
  if (!sheet) {
    sheet = ss.insertSheet('FMSLiveBuild_Staging');
    sheet.appendRow(['ChunkIndex', 'ChunkData']);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  return sheet;
}

/** Ghi ĐÈ toàn bộ trạng thái gộp hiện tại (accObj) — mỗi lượt tick ghi lại bản gộp MỚI NHẤT, không giữ lịch sử cũ. */
function _fmsLive_writeStageAcc_(ss, accObj) {
  var sheet = _fmsLive_stagingSheet_(ss);
  var json = JSON.stringify(accObj);
  var chunkSize = 45000;
  var rows = [];
  var idx = 0;
  for (var pos = 0; pos < json.length; pos += chunkSize) rows.push([idx++, json.slice(pos, pos + chunkSize)]);
  if (rows.length === 0) rows.push([0, json]);
  sheet.clearContents();
  sheet.appendRow(['ChunkIndex', 'ChunkData']);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
}

/** Đọc lại trạng thái gộp hiện tại — trả về null nếu chưa có (bắt đầu chu kỳ mới). */
function _fmsLive_readStageAcc_(ss) {
  var sheet = _fmsLive_stagingSheet_(ss);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var chunks = [];
  values.forEach(function(r) { chunks[r[0]] = r[1]; });
  try { return JSON.parse(chunks.join('')); } catch (e) { return null; }
}

/** Gộp kết quả 1 lô dòng vào accumulator hiện có — ĐÃ kiểm chứng bằng mô phỏng (khớp tuyệt đối với xử lý 1 lần, bất kể chia bao nhiêu lô). */
function _fmsLive_mergeChunkIntoAcc_(acc, chunkHubData, chunkInTransit) {
  Object.keys(chunkHubData).forEach(function(hub) {
    if (!acc.hubData[hub]) acc.hubData[hub] = { LM: _fmsLive_newStageBucketStaged_(), FM: _fmsLive_newStageBucketStaged_() };
    ['LM', 'FM'].forEach(function(stage) {
      var accB = acc.hubData[hub][stage], pB = chunkHubData[hub][stage];
      for (var i = 0; i < 9; i++) accB.stats[i] += pB.stats[i];
      for (var i = 0; i < 8; i++) accB.details[i] = accB.details[i].concat(pB.details[i]);
      [5, 6].forEach(function(tag) {
        accB.agingCounts[tag] += pB.agingCounts[tag];
        accB.agingDetails[tag] = accB.agingDetails[tag].concat(pB.agingDetails[tag]);
      });
    });
  });
  acc.inTransitCount += chunkInTransit;
  return acc;
}

/**
 * Job nền chạy XÂY THEO LÔ DÒNG cho FMS Live — gọi thay cho
 * _fmsLive_buildRawSnapshot_() từ fms_live_prewarmCache(). Mỗi lượt gọi CHỈ đọc
 * 1 khoảng FMS_LIVE_BUILD_CHUNK_ROWS dòng rồi dừng — không đọc hết 194.000 dòng
 * trong 1 lần chạy.
 */
function fmsLive_stagedBuildRunner() {
  if (_spxShouldSkipForBudget_()) { _LOG.d('[FMS Live Staged Build] Bỏ qua — ngân sách runtime hôm nay đã cao.'); return; }
  var gotLock = _anaAcquireNamedLock('fms_live_prewarm_lock_v1', 20000, 600000); // dùng CHUNG khoá với _fmsLive_getIndexCached_ để không bao giờ build song song với đường live fallback
  if (!gotLock) { _LOG.d('[FMS Live Staged Build] Bỏ qua — lượt trước hoặc đường live fallback đang giữ khoá.'); return; }
  var _t0 = Date.now();
  try {
    var ss = _DS.ss(FMS_LIVE_SHEET_ID);
    var sheet = ss.getSheetByName(FMS_LIVE_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) { _LOG.d('[FMS Live Staged Build] Sheet "Detail orders" trống hoặc không tồn tại.'); return; }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var ssStaging = _DS.ss(ADMIN_DB_ID);
    var props = PropertiesService.getScriptProperties();
    var cursor = Number(props.getProperty(FMS_LIVE_BUILD_CURSOR_KEY)) || 0; // 0 = bắt đầu chu kỳ mới (chưa đọc dòng nào)

    // [AN TOÀN 2026-08-15] "Detail orders" là dữ liệu TỒN ĐỌNG HIỆN TẠI — nguồn BÊN
    // NGOÀI (không phải chính project này) định kỳ upload lại TOÀN BỘ file mới (xem
    // tên file "Backlog__3__1_.xlsx" trong lịch sử comment) để thay số liệu, KHÔNG
    // phải chỉ nối thêm dòng. Vì chu kỳ build trải qua NHIỀU LƯỢT (tới ~50 phút cho
    // đủ ~194.000 dòng), nếu sheet bị THAY THẾ TOÀN BỘ giữa 2 lượt, vị trí dòng không
    // còn ổn định — dòng X ở lượt 1 và dòng X ở lượt 3 (sau khi có file mới) có thể là
    // 2 đơn khác nhau hoàn toàn → SỐ GỘP SẼ SAI THẬT SỰ (đếm trùng/bỏ sót), không chỉ
    // đơn thuần "cũ hơn". Chốt an toàn: ghi nhận số dòng lúc BẮT ĐẦU chu kỳ (cursor=0),
    // mọi lượt sau đối chiếu lại — lệch quá 15% coi như nguồn đã bị thay, HUỶ SẠCH dữ
    // liệu đang gộp dở và bắt đầu lại từ đầu, KHÔNG ghi ra snapshot bị pha trộn từ 2
    // "thế hệ" dữ liệu khác nhau.
    // [FIX 2026-08-15 — ĐIỀU CHỈNH NGƯỠNG] Ban đầu đặt 2% — mô phỏng lại phát hiện QUÁ
    // CHẶT: 1 tồn đọng 194.000 dòng đang hoạt động biến động tự nhiên (đơn xử lý xong +
    // đơn mới về) hoàn toàn có thể lệch 2-7% trong 40-50 phút của 1 chu kỳ MÀ KHÔNG hề
    // bị thay file — ngưỡng 2% sẽ khiến chu kỳ liên tục bị huỷ-làm-lại, KHÔNG BAO GIỜ
    // hoàn tất được (tự tạo vấn đề mới còn tệ hơn vấn đề đang chống). Nâng lên 15% —
    // đủ rộng để không huỷ oan lúc biến động bình thường, vẫn bắt được trường hợp bị
    // thay file thật (thường lệch rất mạnh, hàng chục % trở lên do "tồn đọng" đổi hẳn
    // theo đợt export). Đã kiểm chứng lại bằng mô phỏng trước khi đổi ngưỡng.
    var FMS_LIVE_GEN_MARKER_KEY = 'fms_live_build_gen_marker_v1';
    if (cursor === 0) {
      props.setProperty(FMS_LIVE_GEN_MARKER_KEY, String(lastRow));
    } else {
      var expectedRowCount = Number(props.getProperty(FMS_LIVE_GEN_MARKER_KEY)) || lastRow;
      var pctDiff = Math.abs(lastRow - expectedRowCount) / Math.max(1, expectedRowCount);
      if (pctDiff > 0.15) {
        _LOG.d('[FMS Live Staged Build] ⚠️ PHÁT HIỆN sheet "Detail orders" đã bị thay đổi giữa chừng chu kỳ ' +
          '(mốc đầu chu kỳ: ' + expectedRowCount + ' dòng, hiện tại: ' + lastRow + ' dòng, lệch ' + (pctDiff*100).toFixed(1) + '%) — ' +
          'HUỶ dữ liệu đang gộp dở, KHÔNG ghi snapshot pha trộn 2 nguồn khác thời điểm. Bắt đầu lại từ đầu ở lượt sau.');
        var stagingSheetAbort = _fmsLive_stagingSheet_(ssStaging);
        stagingSheetAbort.clearContents();
        stagingSheetAbort.appendRow(['ChunkIndex', 'ChunkData']);
        stagingSheetAbort.getRange(1, 1, 1, 2).setFontWeight('bold');
        props.setProperty(FMS_LIVE_BUILD_CURSOR_KEY, '0');
        props.setProperty(FMS_LIVE_GEN_MARKER_KEY, String(lastRow)); // mốc mới cho chu kỳ mới sắp bắt đầu
        return;
      }
    }

    // [Đọc header — luôn đọc lại mỗi lượt, chi phí rất nhỏ (1 dòng), tránh phải lưu/khôi phục map cột giữa các lượt]
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); });
    var c = {
      id:      _fmsLive_findIdxAny_(headers, ['shipment_id', 'Order ID']),
      ward:    _fmsLive_findIdxAny_(headers, ['buyer_ward_old', 'Ward Name']),
      reason:  _fmsLive_findIdxAny_(headers, ['last_on_hold_reason_code', 'OnHoldReason']),
      cur:     _fmsLive_findIdxAny_(headers, ['station_name', 'Current Station']),
      stage:   _fmsLive_findIdxAny_(headers, ['backlog_stage']),
      action:  _fmsLive_findIdxAny_(headers, ['action']),
      aging:   _fmsLive_findIdxAny_(headers, ['aging_leadtime']),
      zone:    _fmsLive_findIdxAny_(headers, ['buyer_sort_code', 'Zone ID', 'ZoneId', 'Zone']),
      account: _fmsLive_findIdxAny_(headers, ['last_touch_by', 'Account', 'Account Name', 'Current Account Name'])
    };
    if (c.id === -1 || c.stage === -1 || c.action === -1) {
      _LOG.d('[FMS Live Staged Build] Sheet thiếu cột bắt buộc — huỷ chu kỳ, reset cursor.');
      props.setProperty(FMS_LIVE_BUILD_CURSOR_KEY, '0');
      return;
    }

    // [FIX 2026-08-15] Đọc HẸP LẠI theo đúng khoảng cột bao trọn 9 field cần dùng,
    // thay vì đọc TOÀN BỘ lastCol — GIẢM DUNG LƯỢNG TRUYỀN QUA MẠNG (chi phí đắt nhất
    // của cả quá trình), KHÔNG lặp lại rủi ro đã bị rollback (đó là do đọc 13-15 CỤM
    // cột RIÊNG RẼ, hẹp — khác hẳn ở đây: VẪN CHỈ 1 LỆNH getRange DUY NHẤT, chỉ hẹp
    // hơn theo số cột). Tự thích ứng theo layout thật — nếu 9 cột nằm rải khắp sheet,
    // khoảng tính ra sẽ gần bằng lastCol (không có lợi nhưng không hề sai/tệ hơn hiện
    // tại); nếu 9 cột nằm gần nhau (thường gặp ở file export theo nhóm trường liên
    // quan), khoảng tính ra sẽ hẹp hơn nhiều, giảm thật sự dung lượng phải đọc.
    // AN TOÀN QUAN TRỌNG: KHÔNG đổi 1 dòng nào trong toàn bộ logic phân loại bên dưới
    // (vẫn viết y hệt r[c.cur], r[c.stage]...) — chỉ THAY BIẾN c gốc (chỉ số TUYỆT ĐỐI
    // trong lastCol) bằng cRel (chỉ số TƯƠNG ĐỐI trong khoảng đã thu hẹp), tính TRƯỚC
    // khi vào vòng lặp. Đã kiểm chứng bằng mô phỏng (kể cả trường hợp field không tồn
    // tại -1, và field nằm lệch xa các field khác) cho ra kết quả giống hệt đọc đầy đủ.
    var _colIdxs = Object.keys(c).map(function(k) { return c[k]; }).filter(function(i) { return i !== -1; });
    var _colMin = Math.min.apply(null, _colIdxs);
    var _colMax = Math.max.apply(null, _colIdxs);
    var _colSpanStart = _colMin + 1; // getRange dùng cột 1-based
    var _colSpanCount = _colMax - _colMin + 1;
    var cFull = c; // giữ lại bản gốc (chỉ số tuyệt đối) — không dùng trong vòng lặp bên dưới, chỉ để đối chiếu/debug nếu cần
    c = {}; // [GHI ĐÈ CÓ CHỦ Ý] toàn bộ code bên dưới dùng "c" như cũ, nay tự động trỏ sang chỉ số tương đối
    Object.keys(cFull).forEach(function(k) { c[k] = (cFull[k] === -1) ? -1 : (cFull[k] - _colMin); });

    var dataStartRow = cursor + 2; // +2: bỏ header (dòng 1) + cursor đang tính từ 0 = dòng dữ liệu đầu tiên là dòng 2
    var rowsToRead = Math.min(FMS_LIVE_BUILD_CHUNK_ROWS, lastRow - dataStartRow + 1);
    var isFinalChunk = (dataStartRow + rowsToRead - 1) >= lastRow;

    var chunkHubData = {};
    var chunkInTransit = 0;
    if (rowsToRead > 0) {
      var rows = sheet.getRange(dataStartRow, _colSpanStart, rowsToRead, _colSpanCount).getValues(); // [FIX 2026-08-15] đọc hẹp theo cột thay vì lastCol — xem giải thích ở trên
      function ensureHub(h) { if (!chunkHubData[h]) chunkHubData[h] = { LM: _fmsLive_newStageBucketStaged_(), FM: _fmsLive_newStageBucketStaged_() }; return chunkHubData[h]; }
      rows.forEach(function (r) { // [KHÔNG ĐỔI logic phân loại — y hệt _fmsLive_buildRawSnapshot_()]
        var hub = r[c.cur];
        if (!hub) return;
        var stage = (r[c.stage] || '').toString().trim().toUpperCase();
        if (stage !== 'LM' && stage !== 'FM') return;
        var action = (r[c.action] || '').toString().trim();
        var rawReason = r[c.reason];
        var catIdx = _fmsLive_classifyByAction_(action, rawReason);
        if (catIdx === null) { if (action === 'In Transit') chunkInTransit++; return; }
        var zoneId = (c.zone !== -1 && r[c.zone]) ? r[c.zone].toString().trim() : 'N/A';
        var account = (c.account !== -1 && r[c.account]) ? r[c.account].toString().trim() : 'N/A';
        var agingRaw = (c.aging !== -1 && r[c.aging] !== '' && r[c.aging] !== null && r[c.aging] !== undefined) ? r[c.aging].toString().trim() : '';
        var rowData = [r[c.id], zoneId, r[c.ward], account, _fmsLive_reasonLabel_(rawReason), action, agingRaw];
        var target = ensureHub(hub)[stage];
        target.stats[catIdx]++; target.details[catIdx].push(rowData);
        target.stats[8]++;
        var agingTag = _fmsLive_agingBucketTag_(agingRaw);
        if (agingTag) { target.agingCounts[agingTag]++; target.agingDetails[agingTag].push(rowData); }
      });
    }

    var acc = _fmsLive_readStageAcc_(ssStaging) || { hubData: {}, inTransitCount: 0 };
    acc = _fmsLive_mergeChunkIntoAcc_(acc, chunkHubData, chunkInTransit);

    if (!isFinalChunk) {
      _fmsLive_writeStageAcc_(ssStaging, acc);
      props.setProperty(FMS_LIVE_BUILD_CURSOR_KEY, String(cursor + rowsToRead));
      _LOG.d('[FMS Live Staged Build] Đã đọc ' + (cursor + rowsToRead) + '/' + (lastRow - 1) + ' dòng — tiếp tục lượt sau.');
    } else {
      var now = new Date();
      var tz = SPX_TZ;
      var fresh = {
        success: true,
        hubs: Object.keys(acc.hubData).sort(),
        data: acc.hubData,
        inTransitCount: acc.inTransitCount,
        generatedAt: now.getTime(),
        generatedAtIso: Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ss")
      };
      _fmsLive_lastFreshBuild_ = fresh;
      _fmsLive_writeSnapshotPerHub_(fresh); // [KHÔNG ĐỔI] hàm ghi cuối cùng gốc, không sửa
      var stagingSheet = _fmsLive_stagingSheet_(ssStaging);
      stagingSheet.clearContents();
      stagingSheet.appendRow(['ChunkIndex', 'ChunkData']);
      stagingSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
      props.setProperty(FMS_LIVE_BUILD_CURSOR_KEY, '0');
      _LOG.d('[FMS Live Staged Build] HOÀN TẤT chu kỳ (' + fresh.hubs.length + ' hub, ' + fresh.inTransitCount + ' In Transit) — bắt đầu chu kỳ mới ở lượt sau.');
    }
  } catch (e) {
    _LOG.d('[FMS Live Staged Build] LỖI: ' + e.message + ' — cursor giữ nguyên, tự thử lại đúng vị trí ở lượt sau.');
  } finally {
    _anaReleaseNamedLock('fms_live_prewarm_lock_v1');
    var _elapsedMin = (Date.now() - _t0) / 60000;
    _spxTrackExecMinutes_(_elapsedMin);
    if (_elapsedMin >= 3) {
      _LOG.d('[FMS Live Staged Build] ⚠️ CẢNH BÁO: 1 lô ' + FMS_LIVE_BUILD_CHUNK_ROWS + ' dòng đã chạy ' + _elapsedMin.toFixed(1) +
        ' phút (>50% trần 6 phút) — cân nhắc giảm FMS_LIVE_BUILD_CHUNK_ROWS.');
    }
  }
}

function _fmsLive_writeSnapshotPerHub_(fresh) {
  // [FIX QUAN TRỌNG — phát hiện qua báo cáo thật "chuyển Manual->Live trả về 0
  // ngay lập tức, sai với khối lượng dữ liệu thật"] TRƯỚC ĐÂY hàm này GHI ĐÈ
  // CACHE VÔ ĐIỀU KIỆN — nếu 1 lượt build gặp lỗi thoáng qua (sheet tạm thời
  // không truy cập được, quyền đọc bị gián đoạn, hoặc BẤT KỲ lý do nào khiến
  // fresh.hubs rỗng dù sheet thật có dữ liệu) thì kết quả RỖNG đó vẫn bị ghi
  // đè lên cache TỐT trước đó — hậu quả: user thấy "0" dù dữ liệu thật rất
  // lớn, và tồn tại NGUYÊN CẢ CHU KỲ TTL (vừa nâng lên 90 phút, khiến lỗi này
  // kéo dài gấp 4.5 lần nếu nó đang xảy ra). 1 hệ thống vận hành logistics
  // toàn quốc thật KHÔNG BAO GIỜ có 0 Hub tồn đọng cùng lúc — coi "0 Hub" là
  // dấu hiệu ANOMALY (build lỗi), KHÔNG PHẢI kết quả thật, và TỪ CHỐI ghi đè —
  // giữ nguyên cache cũ (dù hơi cũ) còn hơn thay bằng dữ liệu rỗng sai.
  if (!fresh || !fresh.hubs || fresh.hubs.length === 0) {
    try { _LOG.d('[FMS Live] TỪ CHỐI ghi cache — kết quả build rỗng bất thường (0 Hub), giữ nguyên cache cũ để tránh hiện sai "0" cho user.'); } catch (eLogGuard) {}
    return;
  }
  var indexPayload = {
    success: true,
    hubs: fresh.hubs,
    destColMissing: fresh.destColMissing,
    inTransitCount: fresh.inTransitCount,
    generatedAt: fresh.generatedAt,
    generatedAtIso: fresh.generatedAtIso
  };
  try { _fmsLive_writeChunkedJson_(FMS_LIVE_INDEX_KEY, JSON.stringify(indexPayload), FMS_LIVE_CACHE_TTL); } catch (e) {}
  try { CacheService.getScriptCache().put(FMS_LIVE_INDEX_KEY + '_ts', String(fresh.generatedAt), FMS_LIVE_CACHE_TTL); } catch (e) {}
  fresh.hubs.forEach(function(h) {
    try { _fmsLive_writeChunkedJson_(_fmsLive_hubCacheKey_(h), JSON.stringify(fresh.data[h]), FMS_LIVE_CACHE_TTL); } catch (e) {}
  });
}

/**
 * _fmsLive_getHubsDataCached_(targetHubs)
 * [FIX 2026-07-15 — HIỆU NĂNG, theo yêu cầu Xuân] Lấy dữ liệu chi tiết CHỈ
 * cho danh sách hub thật sự cần (1 hub cụ thể, hoặc vài hub thuộc quyền của
 * 1 station-role, hoặc toàn bộ nếu admin xem "Tất cả Hub") — KHÔNG còn phải
 * đọc/giải nén dữ liệu của MỌI hub trong hệ thống như cache gộp cũ. Đọc theo
 * batch (CacheService.getAll) để giảm số lần gọi mạng khi targetHubs nhiều
 * hơn 1 hub. Trả về { hubName: hubDataObj, ... } — hub nào không có cache
 * (VD hiện không có backlog) đơn giản là không xuất hiện trong kết quả,
 * KHÔNG phải lỗi.
 */
function _fmsLive_getHubsDataCached_(targetHubs) {
  var data = {};
  if (!targetHubs || !targetHubs.length) return data;

  var remaining = targetHubs;
  // Vừa build fresh trong CHÍNH request này (index vừa cache-miss) -> lấy
  // thẳng từ bộ nhớ cho các hub đã có sẵn, khỏi đọc lại cache vừa ghi.
  if (_fmsLive_lastFreshBuild_) {
    remaining = [];
    targetHubs.forEach(function(h) {
      if (_fmsLive_lastFreshBuild_.data[h]) data[h] = _fmsLive_lastFreshBuild_.data[h];
      else remaining.push(h);
    });
    if (!remaining.length) return data;
  }

  var keys = remaining.map(_fmsLive_hubCacheKey_);
  var batch = _fmsLive_readChunkedJsonBatch_(keys);
  remaining.forEach(function(h, i) {
    var raw = batch[keys[i]];
    if (raw == null) return; // hub không có cache (hết backlog / lệch TTL hiếm gặp) -> bỏ qua, không phải lỗi
    var parsed = _fmsLive_parseJson_(raw, null);
    if (parsed) data[h] = parsed;
  });
  return data;
}

// So khớp hubName (có thể gõ khác dấu/hoa-thường) với danh sách hub thật lấy
// từ index — thay thế _fmsLive_findRawHubKey_() cũ (trước đây so khớp trực
// tiếp trên raw.hubs của blob gộp, giờ index.hubs đóng vai trò tương đương).
function _fmsLive_findRawHubKeyFromList_(hubs, hubName) {
  var norm = _normStationKey_(hubName);
  for (var i = 0; i < hubs.length; i++) {
    if (_normStationKey_(hubs[i]) === norm) return hubs[i];
  }
  return null; // hub hợp lệ nhưng hiện KHÔNG có backlog nào — không phải lỗi
}

/**
 * fms_live_getSyncMeta() — endpoint SIÊU NHẸ, chỉ đọc 1 cache key chứa
 * timestamp (không giải nén/parse toàn bộ snapshot). Dùng để frontend poll
 * dày (vd mỗi 30s) mà không tốn chi phí như fms_live_getSnapshot() đầy đủ.
 * Frontend so sánh lastSync trả về với lastSync đang hiện — khác thì mới
 * quyết định có làm mới dashboard hay không (và chỉ làm mới khi không phá
 * vỡ màn hình user đang xem, xem fmsLiveCheckForUpdates() ở JS_FMS.html).
 * Không cần getModuleAccess() vì không trả dữ liệu gì nhạy cảm, chỉ 1 số.
 */
function fms_live_getSyncMeta() {
  try {
    var ts = CacheService.getScriptCache().get(FMS_LIVE_INDEX_KEY + '_ts');
    return JSON.stringify({ success: true, lastSync: ts ? Number(ts) : null });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * fms_live_prewarmCache() — dùng cho time-driven trigger chạy nền (mỗi 5
 * phút, xem fms_live_installPrewarmTrigger()).
 * [FIX 2026-07-15 v11] Đây giờ là NƠI DUY NHẤT được phép build snapshot Live
 * — mọi endpoint công khai (getSnapshot, getExplorerPage...) chỉ đọc cache,
 * KHÔNG bao giờ tự build nữa (xem _fmsLive_getIndexCached_). Nhờ vậy chi phí
 * quét sheet (nặng, có thể tới vài phút với dữ liệu lớn) hoàn toàn tách khỏi
 * trải nghiệm của user — luôn đọc cache đã ấm (vài chục ms) hoặc nhận "chưa
 * sẵn sàng" ngay lập tức, KHÔNG BAO GIỜ phải tự chờ build trực tiếp.
 * Ghi log khi lỗi để dễ soi qua Executions nếu trigger thất bại nhiều lần.
 */
function fms_live_prewarmCache() {
  // [FIX 2026-08-01] BẬT LẠI khung giờ vắng — trước đây (2026-07-30) phải tắt
  // vì _fmsLive_getIndexCached_(false) báo lỗi cứng khi cache trống, không có
  // build dự phòng (chi tiết lịch sử xem comment cũ bên dưới). Giờ đã thêm
  // build dự phòng (có khóa bảo vệ, double-check) vào chính hàm đó — nếu lỡ có
  // user mở đúng lúc 23h-5h, module vẫn phục vụ được, không còn lỗi cứng nữa.
  if (_spxIsPrewarmQuietHours_()) { try { Logger.log('fms_live_prewarmCache — bỏ qua, khung giờ vắng user (23h-5h).'); } catch(e) {} return; }
  // [LỊCH SỬ 2026-07-30] Lý do trước đây từng phải TẮT khung giờ vắng: theo
  // thiết kế cũ (2026-07-15), request của user KHÔNG BAO GIỜ tự build — chỉ
  // trigger nền build, cache TTL chỉ vừa đủ phủ khoảng cách 2 lần trigger. Bỏ
  // trigger trong 23h-5h khi đó khiến cache hết hạn và KHÔNG BAO GIỜ được làm
  // mới lại cho tới 5h sáng — module lỗi cứng suốt 6 tiếng. Nay đã có build dự
  // phòng nên không còn rủi ro này.
  // [FIX 2026-08-14] Đổi sang gọi fmsLive_stagedBuildRunner() thay vì
  // _fmsLive_getIndexCached_(true) — chia việc đọc 194.000 dòng thành nhiều lô
  // (xem giải thích đầy đủ ở fmsLive_stagedBuildRunner()) thay vì đọc hết trong 1
  // lần chạy. QUAN TRỌNG: hàm đó đã tự có đủ khoá riêng (CÙNG namespace
  // 'fms_live_prewarm_lock_v1' để không bao giờ chạy song song với đường live
  // fallback trong _fmsLive_getIndexCached_) + cầu dao ngân sách + đo thời gian —
  // KHÔNG lặp lại các lớp đó ở đây nữa (bản cũ có) để tránh 2 lỗi: (1) tự khoá
  // chính mình (gọi _anaAcquireNamedLock 2 lần lồng nhau cùng 1 khoá trong CÙNG 1
  // lần thực thi — lần gọi trong thấy khoá "đang bị giữ" bởi chính lần gọi ngoài,
  // tưởng nhầm là tiến trình khác, tự bỏ qua không bao giờ chạy được); (2) đếm
  // ngân sách runtime 2 LẦN cho cùng 1 lượt chạy (đúng lỗi đã bắt được và sửa ở
  // aging_prewarmCache() — xem comment ở đó).
  fmsLive_stagedBuildRunner();
}

/**
 * fms_live_installPrewarmTrigger() — CHẠY THỦ CÔNG 1 LẦN (từ trình soạn
 * thảo Apps Script, chọn hàm này rồi bấm Run) để cài time-driven trigger.
 * Không tự động cài lại — nếu chạy nhiều lần sẽ tạo nhiều trigger trùng,
 * nên hàm dọn trigger cũ (nếu có) trước khi tạo mới, an toàn khi chạy lại.
 */
function fms_live_installPrewarmTrigger() {
  // [CẢNH BÁO — theo yêu cầu trực tiếp "gộp trigger tương đồng"] Trigger 10-phút riêng lẻ này ĐÃ ĐƯỢC GỘP vào spxDispatcher10Min() — chỉ chạy hàm này nếu THẬT SỰ muốn tách nó ra khỏi nhóm gộp trở lại (sẽ tạo lại đúng trigger đã gộp, làm mất tác dụng gộp). Bình thường KHÔNG cần chạy nữa —
  // dùng spxInstallDispatcher10Min() thay thế.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'fms_live_prewarmCache') ScriptApp.deleteTrigger(t);
  });
  // [FIX 2026-07-14 v8] Đổi 1 phút -> 5 phút. Executions log thật cho thấy
  // build mất 36s+ (có thể còn hơn khi sheet lớn dần).
  // [FIX 2026-07-31] Đổi 5 phút -> 10 phút — cùng đợt cân bằng lại tổng quota 360
  // phút/ngày (log Executions xác nhận tổng 5 trigger nền đã vượt ~2.3-2.8 lần
  // quota này ở tần suất 5 phút cũ). TTL đã tăng lên 1200s (20 phút, xem
  // FMS_LIVE_CACHE_TTL) — dư 2x chu kỳ mới, chịu được 1 lượt trigger lỡ nhịp.
  ScriptApp.newTrigger('fms_live_prewarmCache').timeBased().everyMinutes(10).create();
  return 'Đã cài trigger prewarm cache FMS Live (mỗi 10 phút).';
}

// =========================================================================
// [FIX 2026-08-14] "LÀM NÓNG SỚM" trước giờ cao điểm — dựa trên mô phỏng tải đa
// module (2.000 user/1.000 trạm): việc TẠM DỪNG prewarm giờ cao điểm (từng đề
// xuất) đã được kiểm chứng KHÔNG có tác dụng (3 job này chỉ chiếm phần rất nhỏ
// trong tổng tải giờ cao điểm) — và thậm chí có thể PHẢN TÁC DỤNG nếu làm tăng
// tỉ lệ cache nguội đúng lúc tệ nhất. Hướng ĐÚNG theo mô phỏng: đảm bảo cache
// LUÔN ấm ngay trước khi giờ cao điểm bắt đầu — mô phỏng cho thấy giảm tỉ lệ
// cache nguội từ 2% xuống gần 0% giúp giảm ~30% độ trễ tệ nhất (mỗi lượt cache
// nguội tốn 20-30s/lượt, đắt gấp 15-20 lần lượt cache ấm ~1-2s).
//
// Không viết lại logic build — GỌI THẲNG 3 hàm prewarm đã có sẵn (tái dùng
// nguyên vẹn khoá chống chồng lấn + cầu dao ngân sách runtime đã kiểm chứng).
// Nếu trigger 10 phút đều đặn đã tự chạy đúng lúc gần 7h15, lượt gọi thêm này
// sẽ tự nhường (gặp khoá bận, bỏ qua an toàn) — không có rủi ro chạy trùng.
//
// GIỜ MẶC ĐỊNH 7h15 — LÀ GIẢ ĐỊNH của tôi dựa trên khung cao điểm ước tính
// 7h45-8h15 đã dùng để mô phỏng. ĐIỀU CHỈNH LẠI cho khớp giờ cao điểm THẬT của
// bạn (giờ vào ca thực tế) trước khi cài trigger — càng gần nhưng vẫn TRƯỚC giờ
// cao điểm thật càng tốt.
// =========================================================================
function ana_earlyMorningWarmupRunner() {
  _requireAdminIfInteractive_(2);   // [SỬA] job nền không có người đăng nhập
  _LOG.d('[Làm Nóng Sớm] Bắt đầu làm nóng 3 cache trước giờ cao điểm.');
  try { kpifail_prewarmCache(); } catch (e) { _LOG.d('[Làm Nóng Sớm] kpifail lỗi: ' + e.message); }
  try { aging_prewarmCache(); } catch (e) { _LOG.d('[Làm Nóng Sớm] aging lỗi: ' + e.message); }
  try { fms_live_prewarmCache(); } catch (e) { _LOG.d('[Làm Nóng Sớm] fms_live lỗi: ' + e.message); }
  _LOG.d('[Làm Nóng Sớm] Hoàn tất.');
}

/** Cài trigger chạy 1 lần/ngày lúc 7h15 (GIỜ MẶC ĐỊNH — xem ghi chú phía trên, điều chỉnh cho khớp giờ cao điểm thật). Chạy tay 1 lần trong Apps Script Editor để bật. */
function ana_setupEarlyMorningWarmupTrigger() {
  _requireAdmin_(1);
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'ana_earlyMorningWarmupRunner') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ana_earlyMorningWarmupRunner').timeBased().inTimezone(SPX_TZ).atHour(7).nearMinute(15).everyDays(1).create();
  return 'Đã cài trigger làm nóng sớm lúc 7h15 hằng ngày. NHỚ ĐIỀU CHỈNH GIỜ (atHour/nearMinute trong code) nếu giờ cao điểm thật của bạn khác — nên đặt sớm hơn giờ cao điểm thật khoảng 15-30 phút.';
}

/** fms_live_clearCache() — tiện ích dev/admin, xoá cache Live (index + toàn bộ per-hub) */
function fms_live_clearCache() {
  var sc = CacheService.getScriptCache();
  function removeChunked(prefix) {
    try {
      var metaStr = sc.get(prefix + '_meta');
      if (!metaStr) return;
      var meta = JSON.parse(metaStr);
      var keys = [prefix + '_meta'];
      for (var i = 0; i < meta.chunks; i++) keys.push(prefix + '_c' + i);
      sc.removeAll(keys);
    } catch (e) {}
  }
  try {
    var idx = _fmsLive_readIndex_();
    if (idx && idx.hubs) {
      idx.hubs.forEach(function(h) { removeChunked(_fmsLive_hubCacheKey_(h)); });
    }
  } catch (e) {}
  removeChunked(FMS_LIVE_INDEX_KEY);
  removeChunked(FMS_LIVE_CACHE_KEY); // dọn nốt cache kiểu cũ (gộp 1 khối) nếu còn sót từ trước khi đổi kiến trúc
  try { sc.remove(FMS_LIVE_INDEX_KEY + '_ts'); } catch (e) {}
  try { sc.remove(FMS_LIVE_CACHE_KEY + '_ts'); } catch (e) {}
  return JSON.stringify({ success: true });
}

// ── Lọc danh sách hub theo quyền của user hiện tại — CHỈ ở tầng public
// function, dùng chung _normStationKey_() của backend1.gs (single source
// of truth cho toàn hệ thống, không viết lại cách so khớp riêng). ──
// Dùng cho trường hợp hubName='ALL' (gộp mọi hub được phép VÀ đang có dữ
// liệu — hub nào hết backlog thì tự động không đóng góp gì, không sao).
function _fmsLive_allowedHubs_(allHubs, access) {
  if (access.role === 'admin' || !access.hubs || access.hubs.length === 0) return allHubs.slice();
  var allowedNorm = access.hubs.map(function(h) { return _normStationKey_(h); });
  return allHubs.filter(function(h) { return allowedNorm.indexOf(_normStationKey_(h)) !== -1; });
}

// [FIX 2026-07-14 v6 — bug "báo sai lỗi quyền truy cập"] Trước đây khi xem
// 1 HUB CỤ THỂ (không phải 'ALL'), code lọc "allowedHubs = quyền ∩ raw.hubs"
// rồi tìm hubName trong tập giao đó — TRỘN LẪN 2 khái niệm khác nhau:
//   - "Có quyền xem hub X" (cố định theo vai trò/Admin_Roles, không đổi
//     theo dữ liệu Live)
//   - "Hub X đang xuất hiện trong raw.hubs" (raw.hubs CHỈ chứa hub nào
//     ĐANG có ít nhất 1 dòng backlog tại thời điểm build cache — vì
//     hubData tạo LAZY theo từng dòng, xem _fmsLive_ensureHub_)
// Hậu quả: 1 hub ADMIN chắc chắn có quyền, nhưng VỪA HẾT backlog (đơn được
// xử lý xong ngay trước lúc bấm, hoặc cache vừa rebuild với dữ liệu mới
// hơn) → biến mất khỏi raw.hubs → bị báo nhầm "không thuộc quyền truy cập"
// (SAI — đây là tin tốt "hết tồn", không phải lỗi quyền). Tách hẳn 2 việc:
//   1. _fmsLive_hasPermission_() — CHỈ xét quyền, độc lập hoàn toàn với
//      raw.hubs/dữ liệu hiện tại.
//   2. _fmsLive_findRawHubKey_() — tìm xem hub đó CÓ đang có dữ liệu hay
//      không; nếu không có → trả kết quả THÀNH CÔNG với 0 dòng, không phải lỗi.
function _fmsLive_hasPermission_(hubName, access) {
  if (access.role === 'admin' || !access.hubs || access.hubs.length === 0) return true;
  var norm = _normStationKey_(hubName);
  return access.hubs.some(function(h) { return _normStationKey_(h) === norm; });
}

// [FIX 2026-07-15] _fmsLive_findRawHubKey_(raw, hubName) cũ đã bị thay hoàn
// toàn bởi _fmsLive_findRawHubKeyFromList_(hubs, hubName) — xem định nghĩa ở
// gần _fmsLive_getHubsDataCached_() phía trên. Không còn nơi nào gọi hàm cũ.

/**
 * fms_live_getSnapshot(payloadJson)
 * req: { hubName?: string }  (bỏ trống hoặc 'ALL' → gộp mọi hub được phép)
 * → Health / KPI / Exception / Action Center / Timeline DTO cho Live mode.
 * Không bao giờ trả toàn bộ rows — chỉ số liệu tổng hợp + top preview nhỏ.
 * Chi tiết đầy đủ dùng fms_live_getExplorerPage() (có phân trang).
 */
function fms_live_getSnapshot(payloadJson) {
  try {
    var req = _fmsLive_parseJson_(payloadJson, {});
    var hubName = (req.hubName && req.hubName !== 'ALL') ? String(req.hubName).trim() : '';
    // [BỔ SUNG 2026-07-15 v13] op: 'ALL'|'LM'|'FM' — giờ LM/FM dùng CHUNG 1
    // cấu trúc 8-category (xem _fmsLive_buildRawSnapshot_), nên "ALL" là
    // GỘP THẬT (cộng LM+FM), không còn là "chỉ LM" như bản fmOnHold cũ.
    var op = (req.op === 'LM' || req.op === 'FM') ? req.op : 'ALL';

    var access = getModuleAccess();
    if (access.role === 'denied') {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
    }

    var idx = _fmsLive_getIndexCached_(false);
    if (!idx || !idx.success) {
      return JSON.stringify({ success: false, busy: (idx && idx.busy) || false, notReady: (idx && idx.notReady) || false, error: (idx && idx.error) || 'Không đọc được dữ liệu Live.' });
    }

    var allowedHubs = _fmsLive_allowedHubs_(idx.hubs, access);
    if (allowedHubs.length === 0) {
      return JSON.stringify({ success: false, error: 'Không có hub nào thuộc quyền truy cập của bạn trong dữ liệu Live.' });
    }

    var targetHubs = allowedHubs;
    if (hubName) {
      if (!_fmsLive_hasPermission_(hubName, access)) {
        return JSON.stringify({ success: false, error: 'Bạn không có quyền xem hub "' + hubName + '".' });
      }
      var matchedKey = _fmsLive_findRawHubKeyFromList_(idx.hubs, hubName);
      targetHubs = matchedKey ? [matchedKey] : []; // không có key = hub đang rỗng (0 backlog), KHÔNG phải lỗi
    }

    var hubDataMap = _fmsLive_getHubsDataCached_(targetHubs);

    var stats = [0,0,0,0,0,0,0,0,0];
    var agingTotals = { 5: 0, 6: 0 };
    var previewCritical = []; // preview 20 dòng đầu (mọi category delay) để hiện Exception Center ngay
    var reasonCounts = {};
    var dayBuckets = {}; // action -> count (Timeline giờ theo action, KHÔNG còn ngày nhập kho — xem ghi chú dưới)

    // [FIX 2026-07-15 v13] LM/FM giờ CÙNG cấu trúc 8-category -> gộp bằng
    // cách lặp qua 1-2 "bucket" (tuỳ op) rồi cộng y hệt logic cũ, KHÔNG cần
    // 2 đường xử lý riêng cho LM và FM nữa như bản fmOnHold trước đây.
    targetHubs.forEach(function(h) {
      var hd = hubDataMap[h];
      if (!hd) return;
      var buckets = op === 'LM' ? [hd.LM] : (op === 'FM' ? [hd.FM] : [hd.LM, hd.FM]);
      buckets.forEach(function(bucket) {
        if (!bucket) return;
        for (var i = 0; i < 9; i++) stats[i] += (bucket.stats[i] || 0);
        if (bucket.agingCounts) { agingTotals[5] += (bucket.agingCounts[5] || 0); agingTotals[6] += (bucket.agingCounts[6] || 0); }

        [1, 2, 3, 4].forEach(function(catIdx) {
          bucket.details[catIdx].forEach(function(row) {
            if (previewCritical.length < 20) previewCritical.push({ id: row[0], hub: h, category: catIdx, ward: row[2], reason: row[4], extra: row[5], recDate: row[6] });
            var reasonKey = (row[4] || 'N/A').toString();
            reasonCounts[reasonKey] = (reasonCounts[reasonKey] || 0) + 1;
          });
        });
        if (bucket.agingDetails && bucket.agingDetails[6]) {
          bucket.agingDetails[6].forEach(function(row) {
            if (previewCritical.length < 20) previewCritical.push({ id: row[0], hub: h, category: 6, ward: row[2], reason: row[4], extra: row[5], recDate: row[6] });
            var reasonKey = (row[4] || 'N/A').toString();
            reasonCounts[reasonKey] = (reasonCounts[reasonKey] || 0) + 1;
          });
        }

        // [FIX 2026-07-15 v13] Timeline trước đây gom theo "ngày nhập kho"
        // (recTimeIso, cột tự tính từ inbound_time) — cột đó đã bỏ (xem build
        // function). Đổi tạm sang đếm theo `action` (cột thứ 5 trong rowData,
        // xem rowData ở build function) để KHÔNG mất hẳn khối Timeline, dù ý
        // nghĩa đổi từ "xu hướng theo ngày" sang "phân bổ theo bước xử lý".
        // CẦN XUÂN XÁC NHẬN có muốn giữ khối Timeline kiểu này không, hay bỏ
        // hẳn / thay bằng thứ khác — đây là thoả hiệp tạm, không phải quyết
        // định nghiệp vụ.
        bucket.details.forEach(function(catArr) {
          catArr.forEach(function(row) {
            var a = row[5];
            if (a) dayBuckets[a] = (dayBuckets[a] || 0) + 1;
          });
        });
      });
    });

    stats[5] = agingTotals[5];
    stats[6] = agingTotals[6];

    var total = stats[8];
    var henGiao = stats[1], delayKhac = stats[2], quaHan = stats[3], ton5n = stats[6], hoanHang = stats[4], canKiemTra = stats[7];
    var healthScore = total > 0 ? Math.max(0, 100 - Math.round(((quaHan * 2 + ton5n * 2 + hoanHang) / total) * 100)) : 100;
    var healthState = healthScore >= 80 ? 'good' : (healthScore >= 50 ? 'warning' : 'critical');

    var reasonTop = Object.keys(reasonCounts).map(function(k) { return { reason: k, count: reasonCounts[k] }; })
      .sort(function(a, b) { return b.count - a.count; }).slice(0, 8);

    var timeline = Object.keys(dayBuckets).sort().map(function(d) { return { date: d, count: dayBuckets[d] }; });

    var actionCenter = [];
    if (quaHan > 0) actionCenter.push({ severity: 'critical', message: quaHan + ' đơn Quá 3 Ca (Pending CS) cần xử lý ngay để tránh phát sinh khiếu nại.' });
    if (ton5n > 0)  actionCenter.push({ severity: 'critical', message: ton5n + ' đơn tồn kho trên 5 ngày — kiểm tra khả năng giao lại hoặc hoàn hàng.' });
    if (hoanHang > 0) actionCenter.push({ severity: 'warning', message: hoanHang + ' đơn Hoàn Hàng — xác nhận lịch trả về kho tổng.' });
    if (canKiemTra > 0) actionCenter.push({ severity: 'warning', message: canKiemTra + ' đơn ở trạng thái Cần kiểm tra (Delivery_Holding/Return_Holding) — cần soi thủ công từng đơn.' });
    if (actionCenter.length === 0 && total > 0) actionCenter.push({ severity: 'info', message: 'Không có điểm nóng — backlog đang trong ngưỡng an toàn.' });

    return JSON.stringify({
      success: true,
      hubs: allowedHubs,
      selectedHub: hubName || 'ALL',
      op: op,
      categoryLabels: fmsLiveCategoryLabels,
      stats: stats,
      health: { score: healthScore, state: healthState, total: total, quaHan3Ca: quaHan, ton5N: ton5n, hoanHang: hoanHang },
      kpi: fmsLiveCategoryLabels.map(function(label, idx) { return { label: label, count: stats[idx] }; }),
      exceptions: { reasonTop: reasonTop, criticalPreview: previewCritical, totalCritical: henGiao + delayKhac + quaHan + hoanHang + ton5n },
      actionCenter: actionCenter,
      timeline: timeline,
      inTransitCount: idx.inTransitCount || 0,
      lastSync: idx.generatedAt,
      lastSyncIso: idx.generatedAtIso,
      access: { role: access.role, hubs: access.hubs }
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * fms_live_getExplorerPage(payloadJson)
 * req: { hubName, category ('ALL'|0..7), search, page, pageSize,
 *        zone, ward, account, reason, aging, importDate }
 * → Shipment Explorer / Drawer: dữ liệu PHÂN TRANG, không bao giờ trả hết.
 */
function fms_live_getExplorerPage(payloadJson) {
  try {
    var req = _fmsLive_parseJson_(payloadJson, {});
    var hubName = String(req.hubName || '').trim();
    var stage = (req.op === 'FM') ? 'FM' : 'LM'; // [BỔ SUNG 2026-07-15 v13] LM/FM giờ tách bucket riêng, mặc định LM
    var category = (req.category === undefined || req.category === 'ALL') ? 'ALL' : Number(req.category);
    var search = (req.search || '').toString().trim().toLowerCase();
    var pageSize = Math.max(1, Math.min(200, Number(req.pageSize) || 25));
    var page = Math.max(1, Number(req.page) || 1);
    // [FIX 2026-07-15 v13] rowData đổi shape (xem _fmsLive_buildRawSnapshot_):
    // [id, zone, ward, account, reasonLabel, action, agingBucket] — bỏ
    // appointmentDate/recTimeIso (không còn tồn tại), fAging giờ so khớp
    // đúng agingBucket ở vị trí 6 (trước đây là 5). fImportDate BỎ (không
    // còn ngày nhập kho để lọc) — CẦN XUÂN XÁC NHẬN có cần thay bằng lọc
    // theo action không, tạm thời giữ tham số nhận vào nhưng không áp dụng.
    var fZone    = (req.zone || '').toString().trim();
    var fWard    = (req.ward || '').toString().trim();
    var fAccount = (req.account || '').toString().trim();
    var fReason  = (req.reason || '').toString().trim();
    var fAging   = (req.aging || '').toString().trim();
    var fAction  = (req.action || '').toString().trim();

    var access = getModuleAccess();
    if (access.role === 'denied') {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
    }
    if (!hubName) {
      return JSON.stringify({ success: false, error: 'Thiếu hubName.' });
    }

    var idx = _fmsLive_getIndexCached_(false);
    if (!idx || !idx.success) {
      return JSON.stringify({ success: false, busy: (idx && idx.busy) || false, error: (idx && idx.error) || 'Không đọc được dữ liệu Live.' });
    }

    if (!_fmsLive_hasPermission_(hubName, access)) {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền xem hub "' + hubName + '".' });
    }
    var matchHub = _fmsLive_findRawHubKeyFromList_(idx.hubs, hubName);
    var hdFull = matchHub ? (_fmsLive_getHubsDataCached_([matchHub])[matchHub] || null) : null;
    var hd = hdFull ? hdFull[stage] : null; // null = hub hợp lệ nhưng hiện không có backlog stage này (không phải lỗi)
    var rows = [];
    if (hd) {
      if (category === 'ALL') {
        hd.details.forEach(function(catArr, catIdx) {
          catArr.forEach(function(r) { rows.push({ row: r, category: catIdx }); });
        });
      } else if (category === 5 || category === 6) {
        (hd.agingDetails && hd.agingDetails[category] || []).forEach(function(r) { rows.push({ row: r, category: category }); });
      } else if (category >= 0 && category <= 7) {
        hd.details[category].forEach(function(r) { rows.push({ row: r, category: category }); });
      }
    }

    if (search) {
      rows = rows.filter(function(item) {
        var id = (item.row[0] || '').toString().toLowerCase();
        var ward = (item.row[2] || '').toString().toLowerCase();
        return id.indexOf(search) !== -1 || ward.indexOf(search) !== -1;
      });
    }

    if (fZone || fWard || fAccount || fReason || fAging || fAction) {
      rows = rows.filter(function(item) {
        var r = item.row;
        if (fZone    && (r[1] || 'N/A') !== fZone) return false;
        if (fWard    && (r[2] || '') !== fWard) return false;
        if (fAccount && (r[3] || 'N/A') !== fAccount) return false;
        if (fReason  && (r[4] || 'N/A') !== fReason) return false;
        if (fAction  && (r[5] || '') !== fAction) return false;
        if (fAging   && (r[6] || '') !== fAging) return false;
        return true;
      });
    }

    var totalRows = rows.length;
    var totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    if (page > totalPages) page = totalPages;
    var startIdx = (page - 1) * pageSize;
    var pageRows = rows.slice(startIdx, startIdx + pageSize);

    return JSON.stringify({
      success: true,
      hubName: matchHub || hubName,
      op: stage,
      category: category,
      page: page, pageSize: pageSize, totalRows: totalRows, totalPages: totalPages,
      rows: pageRows,
      lastSync: idx.generatedAt
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * fms_live_getExplorerFilterOptions(payloadJson)
 * req: { hubName, category ('ALL'|0..7) }
 * → Trả danh sách giá trị DUY NHẤT của 6 cột lọc (Zone/Phường/Tài khoản/Lý
 * do/Hẹn-Aging/Ngày nhập kho), tính trên TOÀN BỘ category (không chỉ 1
 * trang) — vì Live phân trang server-side nên không thể tự suy option từ
 * DOM như Manual (updateFiltersFMS) vốn có sẵn hết dữ liệu trong bộ nhớ.
 */
function fms_live_getExplorerFilterOptions(payloadJson) {
  try {
    var req = _fmsLive_parseJson_(payloadJson, {});
    var hubName = String(req.hubName || '').trim();
    var stage = (req.op === 'FM') ? 'FM' : 'LM';
    var category = (req.category === undefined || req.category === 'ALL') ? 'ALL' : Number(req.category);

    var access = getModuleAccess();
    if (access.role === 'denied') {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
    }
    if (!hubName) {
      return JSON.stringify({ success: false, error: 'Thiếu hubName.' });
    }

    var idx = _fmsLive_getIndexCached_(false);
    if (!idx || !idx.success) {
      return JSON.stringify({ success: false, busy: (idx && idx.busy) || false, error: (idx && idx.error) || 'Không đọc được dữ liệu Live.' });
    }
    if (!_fmsLive_hasPermission_(hubName, access)) {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền xem hub "' + hubName + '".' });
    }
    var matchHub = _fmsLive_findRawHubKeyFromList_(idx.hubs, hubName);
    var hdFull = matchHub ? (_fmsLive_getHubsDataCached_([matchHub])[matchHub] || null) : null;
    var hd = hdFull ? hdFull[stage] : null;
    var rows = [];
    if (hd) {
      if (category === 'ALL') {
        hd.details.forEach(function(catArr) { catArr.forEach(function(r) { rows.push(r); }); });
      } else if (category === 5 || category === 6) {
        (hd.agingDetails && hd.agingDetails[category] || []).forEach(function(r) { rows.push(r); });
      } else if (category >= 0 && category <= 7) {
        hd.details[category].forEach(function(r) { rows.push(r); });
      }
    }

    // [FIX 2026-07-15 v13] rowData đổi shape: [id,zone,ward,account,reason,
    // action,agingBucket] — bỏ hẳn "importDate" (không còn recTimeIso), thêm
    // "action" (vị trí 5) làm lựa chọn lọc mới; "aging" giờ đọc đúng ở vị
    // trí 6 (bucket thật, trước đây là ngày dùng để tính tay).
    var zoneSet = {}, wardSet = {}, accSet = {}, reasonSet = {}, actionSet = {}, agingSet = {};
    rows.forEach(function(r) {
      zoneSet[r[1] || 'N/A'] = true;
      if (r[2]) wardSet[r[2]] = true;
      accSet[r[3] || 'N/A'] = true;
      reasonSet[r[4] || 'N/A'] = true;
      if (r[5]) actionSet[r[5]] = true;
      if (r[6]) agingSet[r[6]] = true;
    });

    function toSortedArr(obj) { return Object.keys(obj).sort(function(a, b) { return a.localeCompare(b, 'vi'); }); }

    return JSON.stringify({
      success: true,
      zone: toSortedArr(zoneSet),
      ward: toSortedArr(wardSet),
      account: toSortedArr(accSet),
      reason: toSortedArr(reasonSet),
      action: toSortedArr(actionSet),
      aging: toSortedArr(agingSet)
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

// [XOÁ 2026-07-15 v13] fms_live_getFmExplorerPage() đã bỏ — FM giờ dùng
// CHUNG fms_live_getExplorerPage(op:'FM') với LM (cùng cấu trúc 8-category,
// xem _fmsLive_buildRawSnapshot_), không còn cấu trúc hd.fmOnHold riêng
// biệt nữa nên hàm riêng cho FM không còn cần thiết. Frontend cần đổi lời
// gọi fms_live_getFmExplorerPage(...) sang fms_live_getExplorerPage({...,
// op:'FM'}) — xem JS_FMS.html.

/**
 * fms_live_getHubDetailFull(payloadJson)
 * req: { hubName }
 * → Trả TOÀN BỘ 7 category (đã categorize) của MỘT hub, không phân trang.
 * Dùng riêng cho Compare Engine (cần full set để so khớp ID với Manual
 * snapshot) — KHÔNG dùng cho hiển thị bảng thường (dùng Explorer phân trang).
 * Đã categorize nên số dòng thực tế nhỏ hơn nhiều so với 200k+ dòng thô của
 * sheet gốc; vẫn chặn trần FMS_LIVE_MAX_DETAIL_ROWS/category để an toàn.
 */
function fms_live_getHubDetailFull(payloadJson) {
  try {
    var req = _fmsLive_parseJson_(payloadJson, {});
    var hubName = String(req.hubName || '').trim();
    if (!hubName) return JSON.stringify({ success: false, error: 'Thiếu hubName.' });

    var access = getModuleAccess();
    if (access.role === 'denied') {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
    }

    var idx = _fmsLive_getIndexCached_(false);
    if (!idx || !idx.success) {
      return JSON.stringify({ success: false, busy: (idx && idx.busy) || false, error: (idx && idx.error) || 'Không đọc được dữ liệu Live.' });
    }

    // [FIX 2026-07-14 v6] Tách quyền khỏi việc hub hiện có backlog hay không.
    if (!_fmsLive_hasPermission_(hubName, access)) {
      return JSON.stringify({ success: false, error: 'Bạn không có quyền xem hub "' + hubName + '".' });
    }
    var matchHub = _fmsLive_findRawHubKeyFromList_(idx.hubs, hubName);
    // [FIX 2026-07-15 — HIỆU NĂNG] Chỉ đọc cache của đúng hub này.
    var hdFull = matchHub ? (_fmsLive_getHubsDataCached_([matchHub])[matchHub] || null) : null;

    function buildStageOut(hd) {
      if (!hd) hd = { stats: [0,0,0,0,0,0,0,0,0], details: [[],[],[],[],[],[],[],[]], agingCounts: { 5: 0, 6: 0 }, agingDetails: { 5: [], 6: [] } };
      var truncated = false;
      var stats = hd.stats.slice();
      stats[5] = (hd.agingCounts && hd.agingCounts[5]) || 0;
      stats[6] = (hd.agingCounts && hd.agingCounts[6]) || 0;
      var details = hd.details.map(function(catArr, catIdx) {
        var arr = (catIdx === 5 || catIdx === 6) ? ((hd.agingDetails && hd.agingDetails[catIdx]) || []) : catArr;
        if (arr.length > FMS_LIVE_MAX_DETAIL_ROWS) { truncated = true; return arr.slice(0, FMS_LIVE_MAX_DETAIL_ROWS); }
        return arr;
      });
      return { stats: stats, details: details, truncated: truncated };
    }

    // [FIX 2026-07-15 v13] Giờ trả CẢ 2 nhánh LM và FM (cùng cấu trúc thống
    // nhất) — Compare Engine tự quyết định dùng nhánh nào tuỳ Manual đang so
    // sánh gì (Manual hiện chưa phân biệt LM/FM, xem ghi chú ở JS_FMS.html).
    var lmOut = buildStageOut(hdFull ? hdFull.LM : null);
    var fmOut = buildStageOut(hdFull ? hdFull.FM : null);

    return JSON.stringify({
      success: true,
      hubName: matchHub || hubName,
      LM: lmOut,
      FM: fmOut,
      truncated: lmOut.truncated || fmOut.truncated,
      lastSync: idx.generatedAt
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

