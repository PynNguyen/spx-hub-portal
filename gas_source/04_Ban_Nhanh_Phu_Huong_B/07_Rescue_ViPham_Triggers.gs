// =========================================================================
// [GỘP THEO YÊU CẦU — thay vì để 2 file .gs riêng dễ thiếu đồng bộ khi Deploy]
// ===== BẮT ĐẦU: MODULE ĐƠN CẦN CẦU CỨU (backend_đơn_cầu_cứu.gs gốc) =====
// Đã gỡ doGet() riêng + đổi tên PERMISSION_SPREADSHEET_ID/ADMIN_EMAILS thành
// RESCUE_* để không trùng với module Vi phạm gộp ngay bên dưới.
// =========================================================================

/**
 * ĐƠN CẦN CỨU 48H — BACKEND (Code.gs)
 * -----------------------------------
 * Đọc trực tiếp dữ liệu từ Google Sheet (KHÔNG cache) và trả JSON về cho
 * frontend (Index.html) qua google.script.run. Có thêm hệ thống ĐĂNG KÝ
 * NHẬN MAIL HÀNG NGÀY: người dùng bật công tắc trên giao diện → mỗi ngày
 * vào một giờ cố định, hệ thống tự gửi mail báo cáo (toàn bộ đơn họ đang
 * quản lý) tới đúng email đã được cấp quyền của họ.
 *
 * CÁCH DÙNG:
 * 1. Tạo project Apps Script mới (hoặc gắn vào chính Google Sheet nguồn).
 * 2. Dán nội dung file này vào Code.gs, dán Index.html vào file "Index".
 * 3. Sửa SPREADSHEET_ID / SHEET_GID nếu cần trỏ sang sheet khác.
 * 4. Deploy > New deployment > Web app.
 *    - Execute as: User accessing the web app  (BẮT BUỘC, để phân quyền
 *      theo đúng email người mở trang)
 *    - Who has access: Anyone within [tổ chức của bạn]
 * 5. Chạy TAY hàm setupDailyMailTrigger() một lần trong trình soạn thảo
 *    Apps Script (chọn hàm ở dropdown trên cùng > Run) để bật lịch gửi mail
 *    hàng ngày lúc 07:00. Không làm bước này thì công tắc "Nhận mail" trên
 *    giao diện vẫn lưu được lựa chọn, nhưng KHÔNG có mail nào được gửi.
 */

/**
 * ===== NGƯỜI GỬI MAIL (SENDER) =====
 * Mặc định Apps Script gửi mail bằng MailApp — LUÔN LUÔN gửi dưới danh
 * nghĩa đúng tài khoản Google đang chạy trigger (tức tài khoản đã bấm
 * setupDailyMailTrigger() một lần), không có cách nào đổi khác nếu dùng
 * MailApp. Muốn gửi bằng một địa chỉ khác (VD: spxhub.report@spxexpress.com
 * thay vì email cá nhân), có 2 cách:
 *
 * CÁCH 1 — Gmail "Send mail as" alias (đơn giản nhất, khuyến nghị):
 *   1. Đăng nhập Gmail của tài khoản SẼ CHẠY trigger (tài khoản đã/sẽ bấm
 *      setupDailyMailTrigger()).
 *   2. Vào Settings (⚙) > See all settings > tab "Accounts and Import" >
 *      mục "Send mail as" > Add another email address.
 *   3. Nhập địa chỉ muốn dùng làm người gửi (VD: spxhub.report@spxexpress.com)
 *      — địa chỉ này phải là 1 hộp thư/alias mà tài khoản đó CÓ QUYỀN gửi
 *      thay (thường do quản trị viên Google Workspace cấp, hoặc là alias
 *      nhóm/nhân viên khác đã "cho phép" gửi hộ qua bước xác minh của Google).
 *   4. Xác minh xong (Google có thể gửi mã xác minh, hoặc tự động nếu cùng
 *      tổ chức Workspace và admin đã bật "cho phép gửi thay mà không cần
 *      xác minh" trong Admin Console > Gmail > User settings).
 *   5. Điền địa chỉ đó vào MAIL_SENDER_ALIAS bên dưới. Từ lần gửi tiếp theo,
 *      mail sẽ hiện người gửi là địa chỉ này (dùng GmailApp thay vì MailApp).
 *   Nếu để trống MAIL_SENDER_ALIAS, hệ thống tự dùng lại MailApp như cũ
 *      (gửi bằng đúng tài khoản đang chạy trigger) — không lỗi gì cả.
 *
 * CÁCH 2 — Domain-wide delegation qua Gmail API (mạnh hơn nhưng phức tạp):
 *   Dùng khi muốn gửi từ MỘT HỘP THƯ RIÊNG hoàn toàn tách biệt (không ai
 *   cần đăng nhập tài khoản đó), cần quản trị viên Google Workspace cấp
 *   quyền domain-wide delegation cho 1 Service Account trong Admin Console
 *   > Security > API controls. Việc này nằm ngoài phạm vi 1 file Apps
 *   Script đơn giản — báo tôi nếu bạn cần triển khai theo hướng này.
 */
const MAIL_SENDER_ALIAS = ''; // VD: 'spxhub.report@spxexpress.com' — để trống nếu chưa thiết lập alias
const MAIL_SENDER_NAME = 'SPX HUB — Đơn Cần Cứu 48H';

// Dán URL Web App (.../exec) vào đây để mail có nút "Mở hệ thống" bấm thẳng vào app — để trống nếu chưa muốn dùng.
const WEBAPP_URL = '';

/**
 * Gửi mail, tự chọn GmailApp (nếu đã cấu hình MAIL_SENDER_ALIAS) hoặc
 * MailApp (mặc định) — cô lập logic chọn người gửi ra 1 chỗ duy nhất.
 */
function sendMailUnified_(opts) {
  if (MAIL_SENDER_ALIAS) {
    try {
      GmailApp.sendEmail(opts.to, opts.subject, 'Vui lòng xem email dạng HTML để đọc đầy đủ báo cáo.', {
        htmlBody: opts.htmlBody,
        attachments: opts.attachments || [],
        from: MAIL_SENDER_ALIAS,
        name: MAIL_SENDER_NAME
      });
      return;
    } catch (e) {
      // Alias chưa được xác minh trong "Send mail as", hoặc tài khoản chạy
      // trigger không có quyền gửi thay — fallback về MailApp để mail vẫn
      // được gửi (không mất báo cáo), đồng thời ghi log để biết mà sửa.
      Logger.log('CANH BAO: gui bang MAIL_SENDER_ALIAS ("' + MAIL_SENDER_ALIAS + '") that bai, da fallback ve MailApp. Loi: ' + e.message);
    }
  }
  MailApp.sendEmail({
    to: opts.to,
    subject: opts.subject,
    htmlBody: opts.htmlBody,
    attachments: opts.attachments || [],
    name: MAIL_SENDER_NAME
  });
}

// ════════════════════════════════════════════════════════════════════════
// NGUỒN DỮ LIỆU MODULE "ĐƠN CẦN CẦU CỨU"
// [ĐỔI NGUỒN 23/09/2026 — theo yêu cầu] Chuyển từ file cũ
//   1iWmbwFai3x6oedthwP7nhTZV_R0lUGW5cR7ZUOmKwDE (gid 1024732922)
// sang file mới bên dưới. Module KHÔNG dùng bộ nhớ đệm cho dữ liệu này (đã rà:
// 9 nơi gọi fetchOrderRows_() đều đọc thẳng) nên đổi 2 hằng số là có hiệu lực ngay.
//
// ĐỔI NGUỒN LẦN SAU: chỉ sửa ĐÚNG 2 dòng dưới đây, không phải sửa chỗ nào khác.
//   · ID  lấy từ link:  https://docs.google.com/spreadsheets/d/<ID>/edit...
//   · gid lấy từ link:  ...#gid=<gid>   (gid = 0 là tab đầu tiên của file)
// Sau khi đổi, chạy spx_diagRescueSource() để xác nhận file mới đọc được và có
// đủ cột bắt buộc — tránh phát hiện sai nguồn khi người dùng đã dùng thật.
// ════════════════════════════════════════════════════════════════════════
const SPREADSHEET_ID = '18J7Wb_9VOPW-7dr85cgzPUzT0uKH_kFpkbzGBUSECVc';

const SHEET_GID = 0;   // tab đầu tiên của file mới

const NEEDED_COLS = ['tracking_no', 'region', 'station_name', 'driver_id', 'driver_name', 'export_date'];

/**
 * ===== PHÂN QUYỀN THEO TRẠM (AOM > SUP > HUB / Nơi làm việc) =====
 * (không đổi so với bản trước — xem chi tiết trong getCurrentUserAccess_)
 */
const RESCUE_PERMISSION_SPREADSHEET_ID = '1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA';
const SHEET_NAME_AOM_SUP = 'AOM SUP';
const SHEET_NAME_STAFF = 'DS Nhân viên';

/**
 * ===== TÀI KHOẢN ADMIN (xem toàn bộ dữ liệu, không giới hạn theo trạm) =====
 * Điền email công ty của các tài khoản admin vào đây (chữ thường, không dấu
 * cách thừa). Các email này sẽ luôn thấy TẤT CẢ đơn ở mọi trạm/vùng, bỏ qua
 * hoàn toàn phân quyền AOM/SUP/STAFF ở 2 tab bên dưới.
 */
const RESCUE_ADMIN_EMAILS = [
  'xuan.nguyenthanh01@spxexpress.com',
  // thêm các email admin khác nếu có, mỗi email một dòng, cách nhau dấu phẩy
];

/**
 * ===== ĐĂNG KÝ NHẬN MAIL HÀNG NGÀY =====
 * Danh sách người đăng ký được lưu ở MỘT FILE SHEET RIÊNG (không nằm chung
 * với sheet phân quyền nữa), để việc ghi log mail không phụ thuộc quyền
 * Editor trên sheet phân quyền của người khác.
 */
const MAIL_LOG_SPREADSHEET_ID = '145-rfoh-hLPPa5o8Uoy1SFl04ryh9N4x5Roi2ByxwPY';
const MAIL_SHEET_NAME = 'Mail Subscribers';
const MAIL_SEND_HOUR = 7; // giờ gửi mail hàng ngày (0-23, theo timezone của script)
const MAIL_TOP_STATIONS_LIMIT = 15; // số trạm hiển thị trong bảng tổng hợp theo trạm trong mail
const MAIL_TOP_URGENT_LIMIT = 12;   // số đơn khẩn cấp nhất hiển thị chi tiết trong mail
// Toàn bộ dữ liệu đầy đủ (mọi trạm, mọi đơn) luôn nằm trong file CSV đính kèm — không giới hạn.

/**
 * ===== TRẠNG THÁI "ĐÃ XỬ LÝ" — lưu chung trong file MAIL_LOG_SPREADSHEET_ID
 * (cùng file với danh sách đăng ký mail, khác tab), để đồng bộ cho CẢ TEAM
 * thay vì chỉ lưu riêng trên trình duyệt từng người.
 * Tự động dọn dẹp: mỗi lần getOrders() chạy (tối đa 1 lần / RESOLVED_CLEANUP_MIN_INTERVAL_MS),
 * dòng nào có tracking_no không còn xuất hiện trong dữ liệu đơn hiện tại (đã bị xóa/không
 * còn nằm trong luồng "Cần cứu 48h" trên Sheet nguồn) sẽ tự bị xóa khỏi tab này.
 */
const RESOLVED_SHEET_NAME = 'Trang thai xu ly';
const RESOLVED_CLEANUP_MIN_INTERVAL_MS = 10 * 60 * 1000; // 10 phút / lần dọn, tránh ghi Sheet quá dày

/**
 * ===== LỊCH SỬ SỐ LIỆU THEO NGÀY (để tính xu hướng "so với hôm qua") =====
 * Lưu tổng hợp theo TỪNG TRẠM mỗi ngày (không lưu từng đơn) — vừa đủ để bất
 * kỳ ai (admin xem toàn hệ thống hay AOM/SUP chỉ xem vài trạm) đều tính được
 * đúng số liệu "hôm qua" cho ĐÚNG phạm vi trạm họ đang quản lý, bằng cách cộng
 * dồn theo danh sách trạm được phép xem — thay vì chỉ lưu 1 tổng số toàn hệ
 * thống (sẽ sai lệch với người chỉ quản lý vài trạm).
 * Được ghi 1 LẦN/NGÀY, "ăn theo" trigger gửi mail hàng ngày lúc 07:00 —
 * không cần tạo thêm trigger riêng.
 */
const HISTORY_SHEET_NAME = 'Lich su theo ngay';

/**
 * Điểm vào khi mở Web App — trả về trang Index.html.
 */
// [ĐÃ GỠ doGet() RIÊNG — module này giờ nhúng vào SPA chính qua LAZY_MODULES,
// dùng CHUNG duy nhất doGet() của backend.gs chính, không tự phục vụ trang riêng nữa]

/* =========================================================================
 * ĐỌC DỮ LIỆU ĐƠN — TÁCH RIÊNG PHẦN "ĐỌC SHEET" VÀ "LỌC THEO QUYỀN"
 * để cả getOrders() (gọi từ giao diện) lẫn sendDailyMailReports() (gọi từ
 * trigger, không có "người đang xem trang") đều dùng chung 1 nguồn logic,
 * tránh lệch dữ liệu giữa 2 đường.
 * ========================================================================= */

/**
 * Đọc toàn bộ dữ liệu đơn hiện có trên Sheet (chưa lọc theo quyền).
 * Trả về { rows, sheet, ss }.
 */
/**
 * spx_diagRescueSource() — CHẠY THỦ CÔNG (chọn hàm rồi bấm Run).
 * [MỚI — kèm đợt đổi nguồn 23/09/2026] Xác nhận file/tab mới đọc được, có đủ cột
 * bắt buộc và có dữ liệu thật — TRƯỚC khi người dùng gặp lỗi. Thiếu 1 cột là cả
 * module hỏng âm thầm (đơn không hiện, hoặc hiện thiếu trạm).
 */
function spx_diagRescueSource() {
  var out = { fileId: SPREADSHEET_ID, gid: SHEET_GID };
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    out.tenFile = ss.getName();
    var sheet = getSheetByGid_(ss, SHEET_GID);
    if (!sheet) {
      out.loi = 'Không tìm thấy tab có gid=' + SHEET_GID;
      out.cacTabCoSan = ss.getSheets().map(function (s) { return s.getName() + ' (gid ' + s.getSheetId() + ')'; });
      Logger.log(JSON.stringify(out, null, 2)); return JSON.stringify(out, null, 2);
    }
    out.tenTab = sheet.getName();
    out.soDong = sheet.getLastRow();
    var values = sheet.getDataRange().getValues();
    var hIdx = -1, cols = [];
    for (var i = 0; i < Math.min(values.length, 25); i++) {
      var row = values[i].map(function (c) { return String(c).trim().toLowerCase(); });
      if (row.indexOf('tracking_no') !== -1) { hIdx = i; cols = row; break; }
    }
    if (hIdx === -1) { out.loi = 'Không thấy dòng tiêu đề chứa "tracking_no" trong 25 dòng đầu.'; }
    else {
      out.dongTieuDe = hIdx + 1;
      // [SỬA LỖI CỦA CHÍNH HÀM CHẨN ĐOÁN NÀY] Trước đây so tên cột KHỚP TUYỆT ĐỐI,
      // trong khi fetchOrderRows_() dùng KHỚP TIỀN TỐ. Kết quả: file mới có cột
      // 'export_date +2' đọc được bình thường (192 đơn) nhưng hàm chẩn đoán vẫn báo
      // "THIẾU CỘT export_date — module sẽ hỏng" -> báo động giả, dẫn người đọc đi
      // sửa thứ không hỏng. Nay dùng ĐÚNG cách khớp của hàm thật.
      out.cotThieu = NEEDED_COLS.filter(function (c) {
        if (cols.indexOf(c) !== -1) return false;
        for (var ci = 0; ci < cols.length; ci++) { if (cols[ci].indexOf(c) === 0) return false; }
        return true;
      });
      out.cotKhopGanDung = NEEDED_COLS.map(function (c) {
        if (cols.indexOf(c) !== -1) return null;
        for (var ci = 0; ci < cols.length; ci++) { if (cols[ci].indexOf(c) === 0) return c + ' -> "' + cols[ci] + '"'; }
        return null;
      }).filter(Boolean);
      out.soDonThuc = Math.max(0, values.length - hIdx - 1);
      try {
        var f = fetchOrderRows_();
        out.docThuQuaHamThat = { soDong: (f && f.rows) ? f.rows.length : 0 };
        if (f && f.rows && f.rows.length) {
          var r0 = f.rows[0];
          out.docThuQuaHamThat.donDauTien = { tracking: r0.tracking_no || r0.trackingNo || '', tram: r0.station_name || '' };
        }
      } catch (eF) { out.docThuQuaHamThat = { loi: eF.message }; }
    }
    // Bằng chứng mạnh nhất là ĐỌC THẬT có ra dữ liệu hay không — ưu tiên nó hơn
    // việc so tên cột, tránh kết luận mâu thuẫn với chính số liệu ngay phía trên.
    var _docDuoc = out.docThuQuaHamThat && out.docThuQuaHamThat.soDong > 0;
    out.ketLuan = out.loi ? ('LỖI: ' + out.loi)
                : _docDuoc ? ('Nguồn mới OK — đọc được ' + out.docThuQuaHamThat.soDong + ' đơn từ tab "' + out.tenTab + '"' +
                              ((out.cotKhopGanDung && out.cotKhopGanDung.length) ? ' (cột khớp gần đúng: ' + out.cotKhopGanDung.join('; ') + ')' : '') + '.')
                : (out.cotThieu && out.cotThieu.length) ? ('THIẾU CỘT: ' + out.cotThieu.join(', ') + ' — module sẽ hỏng, cần sửa nguồn hoặc NEEDED_COLS.')
                : 'Đọc được tab nhưng KHÔNG có đơn nào — kiểm tra lại tab/gid.';
  } catch (e) { out.ketLuan = 'LỖI mở file: ' + e.message; }
  Logger.log(JSON.stringify(out, null, 2));
  return JSON.stringify(out, null, 2);
}

function fetchOrderRows_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getSheetByGid_(ss, SHEET_GID);
  if (!sheet) {
    throw new Error('Không tìm thấy sheet với gid=' + SHEET_GID + '. Kiểm tra lại hằng số SHEET_GID trong Code.gs.');
  }

  const values = sheet.getDataRange().getValues();

  let headerRowIdx = -1;
  let colMap = {};
  for (let i = 0; i < Math.min(values.length, 25); i++) {
    const row = values[i].map(function (c) { return String(c).trim().toLowerCase(); });
    if (row.indexOf('tracking_no') !== -1) {
      headerRowIdx = i;
      row.forEach(function (c, idx) { colMap[c] = idx; });
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error('Không tìm thấy dòng tiêu đề chứa "tracking_no" trong sheet "' + sheet.getName() + '".');
  }

  const resolvedMap = {};
  for (let k = 0; k < NEEDED_COLS.length; k++) {
    const needle = NEEDED_COLS[k];
    if (needle in colMap) { resolvedMap[needle] = colMap[needle]; continue; }
    let found = -1;
    for (const header in colMap) {
      if (header.indexOf(needle) === 0) { found = colMap[header]; break; }
    }
    if (found === -1) {
      throw new Error('Thiếu cột bắt buộc "' + needle + '" trên sheet. Cần đủ: ' + NEEDED_COLS.join(', ') + '. Tiêu đề thực tế đọc được: ' + Object.keys(colMap).join(' | '));
    }
    resolvedMap[needle] = found;
  }
  colMap = resolvedMap;

  const rows = [];
  let totalBeforeAccessFilter = 0;
  for (let i = headerRowIdx + 1; i < values.length; i++) {
    const row = values[i];
    const tn = row[colMap['tracking_no']];
    if (!tn) continue;
    totalBeforeAccessFilter++;

    rows.push({
      tracking_no: String(row[colMap['tracking_no']] || '').trim(),
      region: String(row[colMap['region']] || '').trim(),
      station_name: String(row[colMap['station_name']] || '').trim(),
      // [SỬA — nguồn mới 18J7Wb ghi driver_id dạng SỐ THỰC: "154511.0"]
      // Để nguyên sẽ hiện "154511.0" trên giao diện và không khớp khi đối chiếu với
      // driver_id ở các module khác (chuỗi "154511"). Cắt đuôi ".0" khi là số nguyên.
      driver_id: String(row[colMap['driver_id']] || '').trim().replace(/^(\d+)\.0+$/, '$1'),
      driver_name: String(row[colMap['driver_name']] || '').trim(),
      export_date: normalizeDate_(row[colMap['export_date']])
    });
  }

  return { rows: rows, sheet: sheet, ss: ss, totalBeforeAccessFilter: totalBeforeAccessFilter };
}

/** Lọc mảng rows theo tập station key (đã chuẩn hóa) mà 1 người được quyền xem. */
function filterRowsForStations_(rows, stationKeySet) {
  return rows.filter(function (r) { return stationKeySet.has(normStationKey_(r.station_name)); });
}

/**
 * Được gọi từ frontend qua google.script.run.getOrders().
 */
function getOrders() {
  const access = getCurrentUserAccess_();
  // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"]

  if (!access.email) {
    throw new Error('Không xác định được tài khoản đang đăng nhập. Khi Deploy Web App, chọn "Execute as: User accessing the web app" và đăng nhập bằng tài khoản công ty (@spxexpress.com) trước khi mở link.');
  }
  if (access.role === 'UNAUTHORIZED') {
    throw new Error('Tài khoản ' + access.email + ' chưa được cấp quyền xem trạm nào. Kiểm tra lại email này trong sheet phân quyền, tab "' + SHEET_NAME_AOM_SUP + '" (cột AOM_Email / Sup_Email) hoặc tab "' + SHEET_NAME_STAFF + '" (cột Email), rồi liên hệ quản trị viên nếu cần bổ sung.');
  }

  const fetched = fetchOrderRows_();
  const rows = access.unrestricted ? fetched.rows : filterRowsForStations_(fetched.rows, access.stations);
  const stationsOriginal = access.unrestricted
    ? uniqueSorted_(rows.map(function (r) { return r.station_name; }).filter(Boolean))
    : access.stationsOriginal;

  // Trạng thái đăng ký nhận mail KHÔNG BAO GIỜ được phép làm hỏng việc trả dữ
  // liệu đơn — cô lập bằng try/catch. Ví dụ lỗi hay gặp: tab "Mail Subscribers"
  // chưa tồn tại và tài khoản đang xem chỉ có quyền Viewer trên sheet phân
  // quyền (không đủ quyền để tự tạo tab) → nếu không try/catch, cả getOrders()
  // sẽ fail theo dù phần đọc đơn hàng ở trên vẫn thành công.
  // [TỐI ƯU — ĐÃ NGỪNG] Tính năng gửi mail báo cáo Đơn Cần Cứu đã bỏ hoàn toàn (frontend bỏ qua payload.mail).
  // Ngắt lệnh mở file MAIL_LOG_SPREADSHEET_ID để đọc tab "Mail Subscribers" -> tiết kiệm quota Sheets và tăng tốc mở trang.
  const mailStatus = { subscribed: false, email: access.email || '', lastSentAt: '', eligible: false };

  // Trạng thái "Đã xử lý" — cũng KHÔNG được phép làm hỏng getOrders() nếu lỗi (cô lập bằng try/catch),
  // vì đây là tính năng phụ trợ, không phải luồng đọc đơn chính.
  let resolvedList = [];
  try {
    resolvedList = getResolvedOrdersAndCleanup_(fetched.rows);
  } catch (resErr) {
    Logger.log('CANH BAO (khong chan getOrders) - loi doc trang thai da xu ly: ' + resErr.message);
  }

  // Xu hướng so với hôm qua — KHÔNG được phép làm hỏng getOrders() nếu lỗi
  // (cô lập bằng try/catch), vì đây chỉ là dữ liệu bổ trợ hiển thị.
  let trend = null;
  try {
    const yesterday = getYesterdaySnapshot_(access, new Date());
    if (yesterday) {
      let red = 0, orange = 0, green = 0;
      const nowForTrend = new Date();
      rows.forEach(function (r) {
        const lvl = computeUrgencyLevel_(r.export_date, nowForTrend);
        if (lvl === 'red') red++; else if (lvl === 'orange') orange++; else green++;
      });
      trend = {
        hasData: true,
        todayRed: red, todayTotal: rows.length,
        yesterdayRed: yesterday.red, yesterdayTotal: yesterday.total
      };
    }
  } catch (trendErr) {
    Logger.log('CANH BAO (khong chan getOrders) - loi doc xu huong lich su: ' + trendErr.message);
  }

  const payload = {
    rows: rows,
    fetchedAt: new Date().toISOString(),
    sheetName: fetched.sheet.getName(),
    spreadsheetName: fetched.ss.getName(),
    totalBeforeAccessFilter: fetched.totalBeforeAccessFilter,
    access: {
      role: access.role,
      email: access.email,
      displayName: access.displayName,
      position: access.position || '',
      stationCount: stationsOriginal.length,
      stations: stationsOriginal
    },
    mail: mailStatus,
    resolved: resolvedList,
    trend: trend
  };

  // Ép qua JSON.parse(JSON.stringify(...)) để đảm bảo payload trả về là dữ
  // liệu THUẦN (Date -> chuỗi ISO, loại bỏ mọi kiểu đặc biệt) — tránh lỗi
  // ngầm của cầu nối google.script.run khi tuần tự hóa Date lồng sâu trong
  // object lớn, vốn có thể khiến client nhận về undefined dù server không
  // hề báo lỗi gì.
  return JSON.parse(JSON.stringify(payload));
}

/* =========================================================================
 * [ĐÃ NGỪNG] TÍNH NĂNG GỬI MAIL BÁO CÁO HÀNG NGÀY ĐƠN CẦN CỨU
 * Frontend (JS_DonCauCuu.html) đã bỏ hoàn toàn tính năng đăng ký nhận mail.
 * Các hàm dưới đây giữ lại stub tương thích và cơ chế tự xoá trigger (self-cleaning).
 * ========================================================================= */

function getMailSubscriptionStatus() {
  return { subscribed: false, email: '', lastSentAt: '', eligible: false, deprecated: true };
}
function getMailSubscriptionStatus_(access) {
  return { subscribed: false, email: (access && access.email) || '', lastSentAt: '', eligible: false, deprecated: true };
}

function setMailSubscription(enabled) {
  return { subscribed: false, email: '', deprecated: true };
}

/**
 * [ĐÃ NGỪNG HOÀN TOÀN] Nếu trên Cloud vẫn còn trigger 7h sáng gọi hàm này,
 * hàm sẽ tự động xoá trigger của chính nó (self-cleaning) để không còn thức dậy vô ích.
 */
function sendDailyMailReports() {
  Logger.log('[DEPRECATED] sendDailyMailReports đã ngừng sử dụng. Tự động xoá trigger nếu còn tồn tại...');
  try { deleteMailTriggers_(); } catch (e) {}
  return { sent: 0, skipped: 0, failed: 0, deprecated: true };
}

/* =========================================================================
 * LỊCH SỬ SỐ LIỆU THEO NGÀY — phục vụ so sánh xu hướng trên Tổng quan
 * ========================================================================= */

/** Lấy (hoặc tạo mới) tab lưu lịch sử số liệu theo ngày/trạm. */
function getHistorySheet_() {
  const pss = SpreadsheetApp.openById(MAIL_LOG_SPREADSHEET_ID);
  let sheet = pss.getSheetByName(HISTORY_SHEET_NAME);
  if (!sheet) {
    sheet = pss.insertSheet(HISTORY_SHEET_NAME);
    sheet.getRange(1, 1, 1, 6).setValues([[
      'Ngay (yyyy-MM-dd)', 'Tram', 'Tong', 'Khan cap', 'Gap', 'Con thoi gian'
    ]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Ghi snapshot tổng hợp THEO TRẠM cho "hôm nay" (dựa theo thời điểm `now`).
 * Nếu hôm nay đã có snapshot rồi (gọi lại nhiều lần trong cùng 1 ngày, ví dụ
 * chạy tay debugSendDailyMailNow_() để test) thì XÓA các dòng cũ của hôm nay
 * trước rồi ghi lại — tránh cộng dồn trùng lặp.
 */
function recordDailySnapshot_(liveRows, now) {
  const tz = SPX_TZ;
  const todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const sheet = getHistorySheet_();

  // Cùng nguyên tắc hiệu năng như getResolvedOrdersAndCleanup_: dọn các dòng
  // trùng ngày hôm nay (nếu chạy lại nhiều lần trong ngày) bằng 1 lần đọc +
  // 1 lần ghi lại toàn bộ, thay vì deleteRow() lặp từng dòng — tránh hàm chạy
  // theo trigger hàng ngày bị treo lâu nếu có nhiều dòng trùng cần dọn.
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    const kept = existing.filter(function (r) { return String(r[0]) !== todayStr; });
    if (kept.length !== existing.length) {
      sheet.getRange(2, 1, lastRow - 1, 6).clearContent();
      if (kept.length > 0) sheet.getRange(2, 1, kept.length, 6).setValues(kept);
    }
  }

  const byStation = {};
  liveRows.forEach(function (r) {
    const key = r.station_name || '(Không rõ trạm)';
    if (!byStation[key]) byStation[key] = { total: 0, red: 0, orange: 0, green: 0 };
    const lvl = computeUrgencyLevel_(r.export_date, now);
    byStation[key].total++;
    byStation[key][lvl]++;
  });

  const outRows = Object.keys(byStation).map(function (station) {
    const s = byStation[station];
    return [todayStr, station, s.total, s.red, s.orange, s.green];
  });
  if (outRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, outRows.length, 6).setValues(outRows);
  }
}

/**
 * Đọc snapshot của MỘT NGÀY CỤ THỂ (mặc định hôm qua), cộng dồn theo đúng
 * phạm vi trạm được phép xem (accessStations = null nghĩa là không giới hạn
 * / xem toàn hệ thống). Trả về null nếu ngày đó chưa có dữ liệu (ví dụ vừa
 * mới bật tính năng này, chưa đủ 1 ngày để so sánh).
 */
function getHistorySnapshotForDate_(dateStr, accessStationsSet) {
  const sheet = getHistorySheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  let total = 0, red = 0, orange = 0, green = 0, found = false;
  data.forEach(function (r) {
    if (String(r[0]) !== dateStr) return;
    const station = r[1];
    if (accessStationsSet && !accessStationsSet.has(station)) return;
    found = true;
    total += Number(r[2]) || 0;
    red += Number(r[3]) || 0;
    orange += Number(r[4]) || 0;
    green += Number(r[5]) || 0;
  });
  if (!found) return null;
  return { total: total, red: red, orange: orange, green: green };
}

/** Snapshot của "hôm qua" tính theo thời điểm `now`, đúng phạm vi trạm `access`. */
function getYesterdaySnapshot_(access, now) {
  const tz = SPX_TZ;
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  const yesterdayStr = Utilities.formatDate(yesterday, tz, 'yyyy-MM-dd');
  const stationsSet = access.unrestricted ? null : access.stations;
  return getHistorySnapshotForDate_(yesterdayStr, stationsSet);
}

/* =========================================================================
 * TRẠNG THÁI "ĐÃ XỬ LÝ" — đồng bộ chung cho cả team qua Sheet
 * (tab "Trang thai xu ly" trong file MAIL_LOG_SPREADSHEET_ID)
 * ========================================================================= */

/** Lấy (hoặc tạo mới) tab lưu trạng thái "Đã xử lý". */
function getResolvedSheet_() {
  const pss = SpreadsheetApp.openById(MAIL_LOG_SPREADSHEET_ID);
  let sheet = pss.getSheetByName(RESOLVED_SHEET_NAME);
  if (!sheet) {
    try {
      sheet = pss.insertSheet(RESOLVED_SHEET_NAME);
      sheet.getRange(1, 1, 1, 6).setValues([[
        'Tracking No', 'Da xu ly (TRUE/FALSE)', 'Tram', 'Danh dau boi (Email)', 'Ten nguoi danh dau', 'Thoi gian cap nhat'
      ]]);
      sheet.setFrozenRows(1);
    } catch (e) {
      throw new Error('Không tạo được tab "' + RESOLVED_SHEET_NAME + '" trên file log (MAIL_LOG_SPREADSHEET_ID) — tài khoản đang chạy không có quyền Chỉnh sửa (Editor) trên file đó. Nhờ chủ sở hữu file tạo sẵn tab tên đúng "' + RESOLVED_SHEET_NAME + '" một lần, hoặc cấp quyền Editor cho tài khoản admin chạy script. Lỗi gốc: ' + e.message);
    }
  }
  return sheet;
}

/** Đọc toàn bộ tab thành map: tracking_no (đã trim) -> {rowIndex, resolved}. */
function readResolvedMap_(sheet) {
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    const tn = String(data[i][0] || '').trim();
    if (!tn) continue;
    const resolved = data[i][1] === true || String(data[i][1]).trim().toUpperCase() === 'TRUE';
    map[tn] = { rowIndex: i + 2, resolved: resolved };
  }
  return map;
}

/**
 * Được gọi từ frontend qua google.script.run.getResolvedOrders() khi cần làm
 * mới độc lập, ngoài giá trị đã kèm sẵn trong getOrders().
 */
function getResolvedOrders() {
  const sheet = getResolvedSheet_();
  const map = readResolvedMap_(sheet);
  return Object.keys(map).filter(function (tn) { return map[tn].resolved; });
}

/**
 * Đọc danh sách "đã xử lý" hiện tại, ĐỒNG THỜI tự dọn các dòng có tracking_no
 * không còn nằm trong dữ liệu đơn hiện tại (liveRows = TOÀN BỘ đơn trên Sheet
 * nguồn, chưa lọc theo quyền — vì 1 dòng có thể "biến mất" khỏi tầm nhìn của
 * người này nhưng vẫn còn hiển thị với AOM/SUP khác quản lý đúng trạm đó).
 * Việc dọn dẹp được giới hạn tối đa 1 lần / RESOLVED_CLEANUP_MIN_INTERVAL_MS
 * (lưu mốc thời gian qua PropertiesService) để không phải ghi/xóa Sheet trên
 * mỗi lượt getOrders() của mọi người dùng.
 */
function getResolvedOrdersAndCleanup_(liveRows) {
  const sheet = getResolvedSheet_();

  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_RESOLVED_CLEANUP') || 0);
  const now = Date.now();
  if (now - last < RESOLVED_CLEANUP_MIN_INTERVAL_MS) {
    const map = readResolvedMap_(sheet);
    return Object.keys(map).filter(function (tn) { return map[tn].resolved; });
  }

  // Chỉ khoá khi THỰC SỰ cần dọn dẹp (không phải mọi lượt getOrders()), và
  // dùng cùng 1 khoá với setResolvedStatusBulk để 2 thao tác không bao giờ
  // chạy chồng lên nhau — tránh rowIndex bị lệch giữa chừng khi 1 bên đang
  // xoá dòng còn bên kia đang ghi theo rowIndex đã đọc từ trước.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      props.setProperty('LAST_RESOLVED_CLEANUP', String(now));
      return [];
    }

    // QUAN TRỌNG VỀ HIỆU NĂNG: trước đây xoá từng dòng lẻ bằng deleteRow() bên
    // trong vòng lặp — mỗi lệnh là 1 lượt gọi Sheets API riêng, nên khi có
    // NHIỀU dòng "mồ côi" cần dọn cùng lúc (thường gặp nhất ở đúng tình huống
    // "trạm không còn đơn nào" — toàn bộ log đã xử lý cũ của trạm đó bỗng
    // thành mồ côi trong 1 lần dọn), việc gọi deleteRow() lặp lại hàng chục/
    // hàng trăm lần khiến cả getOrders() bị treo rất lâu (đúng triệu chứng
    // "load mãi không trả về gì"), có lúc còn giữ khoá (LockService) khiến
    // NHỮNG NGƯỜI DÙNG KHÁC gọi getOrders() cùng lúc cũng bị treo theo.
    // Sửa: đọc toàn bộ 1 lần, lọc trong bộ nhớ, rồi ghi lại TOÀN BỘ bằng đúng
    // 1 lệnh clearContents() + 1 lệnh setValues() — luôn chỉ 2 lượt gọi Sheets
    // API bất kể dọn bao nhiêu dòng.
    const fullData = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    const liveSet = {};
    liveRows.forEach(function (r) { if (r.tracking_no) liveSet[r.tracking_no] = true; });

    const keptRows = [];
    const cleanedResolved = [];
    let removedCount = 0;
    fullData.forEach(function (row) {
      const tn = String(row[0] || '').trim();
      if (!tn) return; // bỏ dòng trống nếu có
      if (!liveSet[tn]) { removedCount++; return; } // mồ côi -> loại khỏi bản ghi lại
      keptRows.push(row);
      const isResolved = row[1] === true || String(row[1]).trim().toUpperCase() === 'TRUE';
      if (isResolved) cleanedResolved.push(tn);
    });

    if (removedCount > 0) {
      sheet.getRange(2, 1, lastRow - 1, 6).clearContent();
      if (keptRows.length > 0) {
        sheet.getRange(2, 1, keptRows.length, 6).setValues(keptRows);
      }
      Logger.log('cleanupResolvedOrders_: da don ' + removedCount + ' dong khong con trong luong du lieu (1 lan ghi, khong lap deleteRow).');
    }
    props.setProperty('LAST_RESOLVED_CLEANUP', String(now));

    return cleanedResolved;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Được gọi từ frontend qua google.script.run.setResolvedStatus(trackingNo, true/false)
 * khi đánh dấu / bỏ đánh dấu MỘT đơn.
 */
function setResolvedStatus(trackingNo, resolved) {
  return setResolvedStatusBulk([{ tracking_no: trackingNo }], resolved);
}

/**
 * Được gọi từ frontend qua google.script.run.setResolvedStatusBulk(items, true/false)
 * khi đánh dấu / bỏ đánh dấu NHIỀU đơn cùng lúc (thao tác hàng loạt).
 * items: mảng string (tracking_no) hoặc mảng object { tracking_no, station_name }.
 *
 * QUAN TRỌNG VỀ HIỆU NĂNG: toàn bộ thay đổi được gộp vào ĐÚNG 1 lệnh ghi Sheet
 * (setValues trên 1 vùng liên tục), thay vì ghi từng dòng riêng lẻ trong vòng
 * lặp — vì giao diện cho phép "Chọn tất cả" rồi đánh dấu hàng loạt (có thể
 * hàng trăm đơn cùng lúc), ghi từng dòng sẽ rất chậm và dễ vượt thời gian
 * chờ của google.script.run (biểu hiện y hệt lỗi "server trả về rỗng").
 *
 * Đồng thời dùng LockService để tránh 2 người bấm đánh dấu cùng lúc ghi đè
 * dòng của nhau (race condition khi cả 2 cùng append dòng mới cho tab).
 */
function setResolvedStatusBulk(items, resolved) {
  const access = getCurrentUserAccess_();
  if (!access.email) throw new Error('Không xác định được tài khoản đang đăng nhập.');
  if (access.role === 'UNAUTHORIZED') throw new Error('Tài khoản chưa được cấp quyền xem trạm nào, không thể đánh dấu xử lý.');
  if (!items || !items.length) return { updated: 0 };

  let norm = items.map(function (it) {
    return typeof it === 'string' ? { tracking_no: it, station_name: '' } : { tracking_no: it.tracking_no, station_name: it.station_name || '' };
  }).filter(function (it) { return it.tracking_no; });
  if (!norm.length) return { updated: 0 };

  // [FIX BẢO MẬT NGHIÊM TRỌNG NHẤT ĐÃ TÌM THẤY — phát hiện qua rà soát IDOR chủ
  // động] TRƯỚC ĐÂY hàm này CHỈ kiểm tra "đã đăng nhập + có quyền xem TRẠM NÀO
  // ĐÓ" (không phải UNAUTHORIZED hoàn toàn) — KHÔNG kiểm tra tracking_no/trạm cụ
  // thể đang đánh dấu có thuộc quyền người gọi hay không. Vì đây là module ĐƠN
  // CẦN CẦU CỨU (khẩn cấp), hậu quả không chỉ là rò rỉ dữ liệu — 1 nhân viên
  // KHÔNG liên quan có thể đánh dấu "đã xử lý" cho đơn khẩn cấp của trạm khác,
  // khiến đơn đó ÂM THẦM BIẾN MẤT khỏi danh sách cần xử lý của đúng trạm cần
  // biết — rủi ro vận hành thật, không chỉ bảo mật. Client KHÔNG BAO GIỜ gửi
  // station_name (đã xác nhận qua đọc JS_DonCauCuu.html — chỉ gửi trackingNo),
  // nên phải TỰ TRA CỨU station thật từ tracking_no. Gọi fetchOrderRows_() ĐÚNG
  // 1 LẦN (không lặp theo từng item) để giữ nhanh khi đánh dấu hàng loạt hàng
  // trăm đơn. Item không tra được station (hiếm) vẫn cho qua (không chặn cứng
  // use case chưa lường hết) nhưng ghi log rõ để truy vết được.
  if (access.role !== 'admin' && access.role !== 'ADMIN') {
    try {
      var _fetched = fetchOrderRows_();
      var _stationByTracking = Object.create(null);
      (_fetched.rows || []).forEach(function (r) {
        if (r.tracking_no) _stationByTracking[r.tracking_no] = r.station_name;
      });
      var _rejected = [];
      norm = norm.filter(function (it) {
        var _realStation = _stationByTracking[it.tracking_no];
        if (_realStation === undefined) {
          Logger.log('[setResolvedStatusBulk CẢNH BÁO] Không tra được trạm cho đơn ' + it.tracking_no + ' — cho phép đánh dấu (không chặn), user=' + access.email);
          return true; // không xác định được -> không chặn (fail-open có ghi log, không phá vỡ use case chưa lường hết)
        }
        var _allowed = access.stations.has(normStationKey_(_realStation));
        if (!_allowed) _rejected.push(it.tracking_no);
        return _allowed;
      });
      if (_rejected.length) {
        Logger.log('[setResolvedStatusBulk] Đã chặn ' + _rejected.length + ' đơn không thuộc quyền của ' + access.email + ': ' + _rejected.join(', '));
      }
      if (!norm.length) return { updated: 0, blocked: _rejected.length, msg: 'Không có đơn nào thuộc quyền của bạn trong danh sách gửi lên.' };
    } catch (ePermCheck) {
      Logger.log('[setResolvedStatusBulk] Lỗi kiểm tra quyền theo trạm (không chặn cứng): ' + ePermCheck.message);
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // chờ tối đa 20s nếu có người khác đang ghi cùng lúc
  try {
    const sheet = getResolvedSheet_();
    const map = readResolvedMap_(sheet);
    const now = new Date();
    const lastRow = sheet.getLastRow();

    // Đọc 1 lần TOÀN BỘ vùng cần sửa (cột 2, 4-6) của các dòng đã tồn tại,
    // sửa trong bộ nhớ, rồi ghi lại bằng 1 lệnh setValues duy nhất cho mỗi
    // cột liên tục — thay vì 1 lệnh ghi / dòng.
    const existingRowIndexes = [];
    const appends = [];
    let updated = 0;

    norm.forEach(function (it) {
      const tn = String(it.tracking_no).trim();
      const existing = map[tn];
      if (existing) {
        existingRowIndexes.push(existing.rowIndex);
      } else if (resolved) {
        appends.push([tn, true, it.station_name, access.email, access.displayName || '', now]);
      }
      updated++;
    });

    if (existingRowIndexes.length > 0) {
      // Cột 2 (Đã xử lý) và cột 4-6 (Đánh dấu bởi / Tên / Thời gian) không liền
      // nhau (cách cột 3 "Trạm"). Đọc/ghi đè lên TOÀN BỘ vùng dữ liệu 1 lần
      // (chỉ 2 lệnh đọc + 2 lệnh ghi bất kể cập nhật bao nhiêu dòng rời rạc)
      // thay vì lặp ghi từng dòng — đây là điểm mấu chốt giúp thao tác hàng
      // loạt (chọn cả trăm đơn) không bị chậm/timeout.
      const fullLastRow = sheet.getLastRow();
      const dataRows = fullLastRow - 1; // trừ header
      if (dataRows > 0) {
        const colB = sheet.getRange(2, 2, dataRows, 1).getValues();   // cột "Đã xử lý"
        const colDEF = sheet.getRange(2, 4, dataRows, 3).getValues(); // cột D-F
        existingRowIndexes.forEach(function (rowIdx) {
          const i = rowIdx - 2;
          colB[i][0] = !!resolved;
          colDEF[i] = [access.email, access.displayName || '', now];
        });
        sheet.getRange(2, 2, dataRows, 1).setValues(colB);
        sheet.getRange(2, 4, dataRows, 3).setValues(colDEF);
      }
    }

    if (appends.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, 6).setValues(appends);
    }

    return { updated: updated };
  } finally {
    lock.releaseLock();
  }
}

function computeUrgencyLevel_(exportDateStr, now) {
  return computeUrgencyDetail_(exportDateStr, now).level;
}

function computeUrgencyDetail_(exportDateStr, now) {
  const d = new Date(exportDateStr + 'T23:59:59');
  const hours = (d - now) / 3600000;
  let level;
  if (hours < 0) level = 'red';
  else if (hours <= 12) level = 'red';
  else if (hours <= 24) level = 'orange';
  else level = 'green';
  return { level: level, hours: hours };
}

function formatUrgencyHours_(hours) {
  if (hours < 0) return 'Quá hạn ' + Math.abs(hours).toFixed(1) + 'h';
  return 'Còn ' + hours.toFixed(1) + 'h';
}

function sendReportMailTo_(access, rows, now) {
  const tz = SPX_TZ;
  const dateLabel = Utilities.formatDate(now, tz, 'dd/MM/yyyy');
  const timeLabel = Utilities.formatDate(now, tz, 'HH:mm');

  let red = 0, orange = 0, green = 0;
  const detailed = rows.map(function (r) {
    const d = computeUrgencyDetail_(r.export_date, now);
    if (d.level === 'red') red++; else if (d.level === 'orange') orange++; else green++;
    return { row: r, level: d.level, hours: d.hours };
  });

  const subject = '[SPX HUB] Báo cáo Đơn Cần Cứu 48H — ' + (access.stationsOriginal.length > 1 ? access.stationsOriginal.length + ' trạm' : access.stationsOriginal[0] || '') + ' — ' + dateLabel
    + (red > 0 ? ' — ' + red + ' đơn khẩn cấp' : '');

  const htmlBody = buildMailHtml_(access, detailed, { red: red, orange: orange, green: green }, dateLabel, timeLabel);
  const csvContent = buildCsv_(rows, now);
  const csvBlob = Utilities.newBlob(csvContent, 'text/csv;charset=utf-8', 'don_can_cuu_48h_' + Utilities.formatDate(now, tz, 'yyyyMMdd') + '.csv');

  sendMailUnified_({
    to: access.email,
    subject: subject,
    htmlBody: htmlBody,
    attachments: [csvBlob]
  });
}

/**
 * Gom danh sách đơn (đã kèm level/hours) theo station_name, tính tổng + đếm theo mức khẩn cấp.
 * Trả về mảng đã sắp xếp: trạm nhiều đơn khẩn cấp (red) nhất lên đầu, tiếp theo là tổng số đơn.
 */
/**
 * Gom theo trạm, có tách riêng "quá hạn" (đã trễ, hours<0) khỏi "khẩn cấp"
 * (còn ≤12h nhưng CHƯA trễ) — vì 2 tình huống này cần hành động khác nhau
 * hẳn (quá hạn = xử lý cứu vãn ngay, khẩn cấp = còn kịp nếu ưu tiên ngay).
 */
function summarizeByStation_(detailed) {
  const map = {};
  detailed.forEach(function (d) {
    const key = d.row.station_name || '(Không rõ trạm)';
    if (!map[key]) map[key] = { station: key, total: 0, overdue: 0, red: 0, orange: 0, green: 0 };
    map[key].total++;
    map[key][d.level]++;
    if (d.hours < 0) map[key].overdue++;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue;
    if (b.red !== a.red) return b.red - a.red;
    if (b.orange !== a.orange) return b.orange - a.orange;
    return b.total - a.total;
  });
}

/**
 * Đề xuất hành động theo mức nặng nhất hiện có của 1 trạm/1 đơn — để người
 * nhận mail biết NGAY cần làm gì, thay vì chỉ nhìn số liệu rồi tự suy luận.
 */
function actionForSegment_(overdue, red, orange) {
  if (overdue > 0) return { label: '🔴 Gọi tài xế / xử lý cứu vãn ngay', color: '#B01827', bg: '#FDEAEC', border: '#E0313F' };
  if (red > 0) return { label: '🟠 Ưu tiên xử lý trong vài giờ tới', color: '#9A4400', bg: '#FFF1E0', border: '#DE8B1D' };
  if (orange > 0) return { label: '🟡 Lên kế hoạch giao lại trong ca', color: '#7A5B00', bg: '#FEF7E0', border: '#F0B84A' };
  return { label: '🟢 Chưa cần hành động, theo dõi bình thường', color: '#0F7A4F', bg: '#E6F8EF', border: '#1FAE71' };
}

function buildMailHtml_(access, detailed, counts, dateLabel, timeLabel) {
  const esc = escapeHtmlServer_;

  const stationSummary = summarizeByStation_(detailed);
  const stationShown = stationSummary.slice(0, MAIL_TOP_STATIONS_LIMIT);
  const stationMoreCount = stationSummary.length - stationShown.length;
  const overdueStationCount = stationSummary.filter(function (s) { return s.overdue > 0; }).length;
  const totalOverdue = stationSummary.reduce(function (sum, s) { return sum + s.overdue; }, 0);

  const stationRowsHtml = stationShown.map(function (s) {
    const act = actionForSegment_(s.overdue, s.red, s.orange);
    return '<tr style="border-left:3px solid ' + act.border + ';">' +
      '<td style="padding:9px 12px;border-bottom:1px solid #EDEFEE;font-size:12.5px;font-weight:700;color:#0F241D;">' + esc(s.station) + '</td>' +
      '<td style="padding:9px 8px;border-bottom:1px solid #EDEFEE;font-size:12.5px;text-align:center;color:#4F6960;">' + s.total + '</td>' +
      '<td style="padding:9px 8px;border-bottom:1px solid #EDEFEE;font-size:12.5px;text-align:center;color:#B01827;font-weight:800;">' + (s.overdue || '–') + '</td>' +
      '<td style="padding:9px 8px;border-bottom:1px solid #EDEFEE;font-size:12.5px;text-align:center;color:#E0313F;font-weight:700;">' + (s.red || '–') + '</td>' +
      '<td style="padding:9px 8px;border-bottom:1px solid #EDEFEE;font-size:12.5px;text-align:center;color:#9A6400;font-weight:700;">' + (s.orange || '–') + '</td>' +
      '<td style="padding:9px 8px;border-bottom:1px solid #EDEFEE;font-size:12.5px;text-align:center;color:#1FAE71;">' + (s.green || '–') + '</td>' +
      '<td style="padding:9px 12px;border-bottom:1px solid #EDEFEE;font-size:11.5px;white-space:nowrap;"><span style="display:inline-block;padding:3px 9px;border-radius:6px;background:' + act.bg + ';color:' + act.color + ';font-weight:700;">' + act.label + '</span></td>' +
      '</tr>';
  }).join('');

  // ---- Top đơn cần xử lý gấp nhất — kèm hành động cụ thể cho từng đơn ----
  const topUrgent = detailed.slice().sort(function (a, b) { return a.hours - b.hours; }).slice(0, MAIL_TOP_URGENT_LIMIT);
  const urgentRowsHtml = topUrgent.map(function (d) {
    const r = d.row;
    const act = actionForSegment_(d.hours < 0 ? 1 : 0, d.level === 'red' ? 1 : 0, d.level === 'orange' ? 1 : 0);
    const color = d.level === 'red' ? '#E0313F' : (d.level === 'orange' ? '#9A6400' : '#1FAE71');
    return '<tr>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #EDEFEE;font-family:monospace;font-size:11.5px;color:#0F241D;">' + esc(r.tracking_no) + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #EDEFEE;font-size:12px;color:#0F241D;">' + esc(r.station_name) + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #EDEFEE;font-size:12px;color:#4F6960;">' + esc(r.driver_name) + ' (' + esc(r.driver_id) + ')</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #EDEFEE;font-size:12px;color:' + color + ';font-weight:700;white-space:nowrap;">' + formatUrgencyHours_(d.hours) + '</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #EDEFEE;font-size:11px;white-space:nowrap;color:' + act.color + ';font-weight:600;">' + act.label.replace(/^[^ ]+ /, '') + '</td>' +
      '</tr>';
  }).join('');

  const totalRows = counts.red + counts.orange + counts.green;

  // ---- Băng hành động tổng quan — 1 câu định hướng ngay đầu mail, không phải tự suy luận từ số liệu ----
  let bannerText, bannerBg, bannerBorder, bannerColor;
  if (totalOverdue > 0) {
    bannerText = '🔴 Có <b>' + totalOverdue + ' đơn đã quá hạn</b> tại <b>' + overdueStationCount + ' trạm</b> — cần liên hệ tài xế / xử lý cứu vãn ngay trong hôm nay, ưu tiên các trạm ở đầu bảng bên dưới.';
    bannerBg = '#FDEAEC'; bannerBorder = '#E0313F'; bannerColor = '#8A1420';
  } else if (counts.red > 0) {
    bannerText = '🟠 Chưa có đơn quá hạn, nhưng có <b>' + counts.red + ' đơn khẩn cấp</b> (còn dưới 12h) cần ưu tiên xử lý trong vài giờ tới để tránh trễ hạn.';
    bannerBg = '#FFF1E0'; bannerBorder = '#DE8B1D'; bannerColor = '#7A3B00';
  } else if (counts.orange > 0) {
    bannerText = '🟡 Tình hình ổn định — có <b>' + counts.orange + ' đơn gấp</b> (12–24h), nên lên lịch giao lại trong ca hôm nay.';
    bannerBg = '#FEF7E0'; bannerBorder = '#F0B84A'; bannerColor = '#6B4F00';
  } else {
    bannerText = '🟢 Không có đơn khẩn cấp hay quá hạn nào — toàn bộ đơn đang trong tầm kiểm soát, chỉ cần theo dõi bình thường.';
    bannerBg = '#E6F8EF'; bannerBorder = '#1FAE71'; bannerColor = '#0F5C39';
  }

  const ctaButtonHtml = WEBAPP_URL ? (
    '<div style="text-align:center;margin:20px 0 4px;">' +
    '<a href="' + esc(WEBAPP_URL) + '" style="display:inline-block;background:#EE4D2D;color:#fff;font-weight:700;font-size:13px;padding:11px 26px;border-radius:999px;text-decoration:none;">Mở hệ thống Đơn Cần Cứu 48H →</a>' +
    '</div>'
  ) : '';

  return '' +
    '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#EAF3EE;padding:18px;">' +
    '<div style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 0 rgba(15,60,45,.04);">' +

    '<div style="background:#0F2E27;padding:22px 26px;">' +
    '<div style="color:#F0B84A;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;">SPX HUB SYSTEM</div>' +
    '<div style="color:#fff;font-size:21px;font-weight:800;margin-top:6px;">Đơn Cần Cứu 48H — Báo cáo hàng ngày</div>' +
    '<div style="color:#A9C7BC;font-size:12px;margin-top:6px;">' + esc(access.displayName || access.email) + ' &middot; ' + esc(access.role) + ' &middot; ' + dateLabel + ' ' + timeLabel + '</div>' +
    '</div>' +

    '<div style="padding:22px 26px;">' +

    '<div style="background:' + bannerBg + ';border-left:4px solid ' + bannerBorder + ';border-radius:10px;padding:13px 16px;margin-bottom:20px;font-size:13px;color:' + bannerColor + ';line-height:1.55;">' + bannerText + '</div>' +

    '<table style="width:100%;border-collapse:separate;border-spacing:7px 0;margin:0 0 16px;">' +
    '<tr>' +
    '<td style="text-align:center;padding:14px 8px;background:#F3F6F4;border-radius:12px;"><div style="font-size:24px;font-weight:800;color:#0F241D;">' + totalRows + '</div><div style="font-size:10.5px;color:#5F7268;font-weight:700;letter-spacing:.03em;margin-top:3px;">TỔNG SỐ ĐƠN</div></td>' +
    '<td style="text-align:center;padding:14px 8px;background:#FDEAEC;border-radius:12px;"><div style="font-size:24px;font-weight:800;color:#E0313F;">' + counts.red + '</div><div style="font-size:10.5px;color:#5F7268;font-weight:700;letter-spacing:.03em;margin-top:3px;">KHẨN CẤP</div></td>' +
    '<td style="text-align:center;padding:14px 8px;background:#FEF7E0;border-radius:12px;"><div style="font-size:24px;font-weight:800;color:#9A6400;">' + counts.orange + '</div><div style="font-size:10.5px;color:#5F7268;font-weight:700;letter-spacing:.03em;margin-top:3px;">GẤP</div></td>' +
    '<td style="text-align:center;padding:14px 8px;background:#E6F8EF;border-radius:12px;"><div style="font-size:24px;font-weight:800;color:#1FAE71;">' + counts.green + '</div><div style="font-size:10.5px;color:#5F7268;font-weight:700;letter-spacing:.03em;margin-top:3px;">CÒN THỜI GIAN</div></td>' +
    '</tr>' +
    '</table>' +

    '<div style="font-size:13px;color:#151923;margin-bottom:16px;">Quản lý <b>' + access.stationsOriginal.length + '</b> trạm' + (access.stationsOriginal.length <= 6 ? ': ' + esc(access.stationsOriginal.join(', ')) : '') + '</div>' +

    (stationShown.length ? (
      '<div style="font-size:13.5px;font-weight:800;color:#0F241D;margin-bottom:8px;">📍 Tổng hợp theo trạm — kèm đề xuất hành động' + (stationSummary.length > 1 ? ' (top ' + stationShown.length + '/' + stationSummary.length + ' trạm căng nhất)' : '') + '</div>' +
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;margin-bottom:6px;min-width:520px;">' +
      '<thead><tr style="background:#F3F6F4;">' +
      '<th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Trạm</th>' +
      '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Tổng</th>' +
      '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Quá hạn</th>' +
      '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Khẩn cấp</th>' +
      '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Gấp</th>' +
      '<th style="padding:8px;text-align:center;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Còn HT</th>' +
      '<th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Đề xuất</th>' +
      '</tr></thead><tbody>' + stationRowsHtml + '</tbody></table></div>' +
      (stationMoreCount > 0 ? '<div style="font-size:11.5px;color:#5F7268;margin-bottom:20px;">…và ' + stationMoreCount + ' trạm khác — xem đầy đủ trong file CSV đính kèm.</div>' : '<div style="margin-bottom:20px;"></div>')
    ) : '') +

    (urgentRowsHtml ? (
      '<div style="font-size:13.5px;font-weight:800;color:#0F241D;margin-bottom:8px;">🔥 Top ' + topUrgent.length + ' đơn cần xử lý gấp nhất</div>' +
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:520px;">' +
      '<thead><tr style="background:#F3F6F4;">' +
      '<th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Mã vận đơn</th>' +
      '<th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Trạm</th>' +
      '<th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Tài xế</th>' +
      '<th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Tình trạng</th>' +
      '<th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#5F7268;letter-spacing:.04em;">Hành động</th>' +
      '</tr></thead><tbody>' + urgentRowsHtml + '</tbody></table></div>'
    ) : '') +

    ctaButtonHtml +

    '<div style="font-size:12px;color:#151923;background:#F3F6F4;border-radius:10px;padding:11px 15px;margin-top:20px;">📎 Toàn bộ <b>' + totalRows + ' đơn</b> chi tiết (đủ mọi trạm) có trong file CSV đính kèm — mở bằng Excel/Google Sheets để lọc, sắp xếp theo ý bạn.</div>' +

    '<div style="font-size:11px;color:#93A69C;margin-top:18px;border-top:1px dashed #E3ECE6;padding-top:10px;">Mail này được gửi tự động hàng ngày vì bạn đã bật "Nhận báo cáo mail hàng ngày" trên trang Đơn Cần Cứu 48H. Vào lại trang để tắt nếu không muốn nhận nữa.</div>' +

    '</div></div></div>';
}

function buildCsv_(rows, now) {
  const headers = ['tracking_no', 'region', 'station_name', 'driver_id', 'driver_name', 'export_date', 'urgency_status'];
  const lines = [headers.join(',')];
  rows.forEach(function (r) {
    const lvl = computeUrgencyLevel_(r.export_date, now);
    const label = lvl === 'red' ? 'Khẩn cấp/Quá hạn' : (lvl === 'orange' ? 'Gấp' : 'Còn thời gian');
    const row = [r.tracking_no, r.region, r.station_name, r.driver_id, r.driver_name, r.export_date, label]
      .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    lines.push(row);
  });
  return '\uFEFF' + lines.join('\n');
}

function escapeHtmlServer_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * Chạy TAY 1 LẦN trong Apps Script Editor để bật lịch gửi mail hàng ngày.
 * An toàn khi chạy lại nhiều lần: sẽ xóa trigger cũ trước khi tạo trigger mới,
 * tránh bị gửi trùng (nhiều trigger cùng gọi 1 hàm).
 */
/**
 * [ĐÃ NGỪNG] setupDailyMailTrigger() — Hàm này nay chỉ dọn dẹp trigger cũ (nếu có),
 * KHÔNG tạo trigger mới nữa.
 */
function setupDailyMailTrigger() {
  var msg = deleteMailTriggers_();
  Logger.log('Tính năng sendDailyMailReports đã ngừng sử dụng. ' + msg);
  return 'Tính năng sendDailyMailReports đã ngừng sử dụng. ' + msg;
}

function deleteMailTriggers_() {
  var count = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyMailReports') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  return 'Đã xoá ' + count + ' trigger sendDailyMailReports cũ (nếu có).';
}

function debugSendDailyMailNow_() {
  Logger.log('Tính năng sendDailyMailReports đã ngừng sử dụng.');
  return { deprecated: true };
}

/**
 * Chạy tay để ghi snapshot lịch sử NGAY (không cần đợi trigger 07:00 hoặc chờ
 * sendDailyMailReports chạy). Hữu ích khi mới bật tính năng xu hướng, hoặc
 * muốn test cột "so với hôm qua" ngay trong ngày mà không phải đợi ngày mai:
 * chạy hàm này hôm nay, rồi hôm sau mở lại trang là thấy có dữ liệu so sánh.
 */
function debugRecordSnapshotNow_() {
  const fetched = fetchOrderRows_();
  recordDailySnapshot_(fetched.rows, new Date());
  Logger.log('Da ghi snapshot lich su cho ngay hom nay (' + Utilities.formatDate(new Date(), SPX_TZ, 'yyyy-MM-dd') + ').');
}

/* =========================================================================
 * PHÂN QUYỀN — giữ nguyên logic gốc
 * ========================================================================= */

// ═══════════════════════════════════════════════════════════════════════════
// [MỚI] CHUẨN HOÁ PHÂN QUYỀN THEO USER — nguồn dữ liệu tổ chức chính thức
// Nguồn: "Central Region - Information - SA" (CHỈ ĐỌC, không được ghi).
//   · Sheet FTE                       -> Email + Nơi làm việc (hub) + Vị trí
//   · Sheet Khu vực quản lý (AOMSup)  -> Hub -> Sup_Email -> AOM_Email + parent hub
// Ánh xạ vị trí (theo xác nhận trực tiếp):
//   Supervisor -> SUP | Team Lead & Operations Team Lead -> LEAD | Staff -> STAFF
// Hub đã gỡ: lọc theo cột status, chỉ nhận "1. Live".
// Trường hợp "Nơi làm việc" không khớp hub nào (VD "VN > Warehouse Da Nang"):
// tra tiếp bảng ánh xạ TAY do admin nhập ở sheet mình CÓ QUYỀN GHI
// (SHEET_NAME_HUB_ALIAS trong RESCUE_PERMISSION_SPREADSHEET_ID) — KHÔNG sửa
// file nguồn vì chỉ có quyền xem.
const ORG_SOURCE_SPREADSHEET_ID = '1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY';
const ORG_SHEET_FTE             = 'FTE';
const ORG_SHEET_AOMSUP           = 'Khu vực quản lý (AOM/Sup)';
// [SỬA — theo phản hồi trực tiếp: tên sheet thật thiếu dấu "/"] getSheetByName()
// khớp CHÍNH XÁC từng ký tự — sai 1 dấu là tra thất bại HOÀN TOÀN VÀ ÂM THẦM
// (rơi về nhánh phân quyền cũ, không có lỗi nào hiện ra để biết mà sửa). Tên cũ
// (không có "/") được giữ lại làm dự phòng — nếu sheet còn đổi tên lần nữa,
// _spxGetAomSupSheet_() bên dưới thử cả 2 tên trước khi báo lỗi rõ ràng.
const ORG_SHEET_AOMSUP_ALIASES   = ['Khu vực quản lý (AOM/Sup)', 'Khu vực quản lý (AOMSup)'];
/**
 * _spxGetAomSupSheet_(ss)
 * Dò theo danh sách tên đã biết — tránh lặp lại lỗi "đổi tên sheet -> tra thất
 * bại âm thầm, không ai biết mà sửa" đã xảy ra thật.
 */
function _spxGetAomSupSheet_(ss) {
  for (var i = 0; i < ORG_SHEET_AOMSUP_ALIASES.length; i++) {
    var sh = ss.getSheetByName(ORG_SHEET_AOMSUP_ALIASES[i]);
    if (sh) return sh;
  }
  return null;
}
// [SỬA — theo chỉ định] File nguồn CHỈ ĐỌC; mọi thứ cần ghi (ánh xạ tay, trạm
// cấp thêm) lưu vào bảng tính RIÊNG mà hệ thống CÓ quyền ghi bên dưới.
const ORG_WRITABLE_SPREADSHEET_ID = '145-rfoh-hLPPa5o8Uoy1SFl04ryh9N4x5Roi2ByxwPY';
// [SỬA — phát hiện qua ảnh chụp tab sheet thật, cùng loại lỗi đã xảy ra với
// ORG_SHEET_AOMSUP] Sheet đã bị đổi tên thành "Hub/SOC infor" (thêm dấu "/"),
// trong khi code hard-code "HubSOC infor" — getSheetByName() khớp CHÍNH XÁC
// từng ký tự nên tra thất bại HOÀN TOÀN, im lặng (rơi về hubDetail rỗng, cache
// giữ kết quả rỗng/cũ cả giờ). Áp dụng ĐÚNG cơ chế dò-theo-danh-sách-tên đã
// dùng cho ORG_SHEET_AOMSUP — thử lần lượt các tên đã biết, tên mới ưu tiên
// trước, tên cũ giữ lại dự phòng nếu sheet đổi tên ngược lại lần nữa.
const ORG_SHEET_HUBSOC          = 'Hub/SOC infor';
const ORG_SHEET_HUBSOC_ALIASES  = ['Hub/SOC infor', 'HubSOC infor'];
/**
 * _spxGetHubSocSheet_(ss)
 * Dò theo danh sách tên đã biết — cùng nguyên tắc _spxGetAomSupSheet_() ở trên.
 */
function _spxGetHubSocSheet_(ss) {
  for (var i = 0; i < ORG_SHEET_HUBSOC_ALIASES.length; i++) {
    var sh = ss.getSheetByName(ORG_SHEET_HUBSOC_ALIASES[i]);
    if (sh) return sh;
  }
  return null;
}
const SHEET_NAME_HUB_ALIAS      = 'Hub Alias (Admin)'; // bảng ánh xạ tay — sheet CÓ quyền ghi
const ORG_MAP_CACHE_KEY         = 'spx_org_access_map_v1';
const ORG_HUBINFO_CACHE_KEY     = 'spx_hubinfo_map_v1';
const ORG_MAP_TTL_S             = 3600; // 1 giờ — cùng nguyên tắc _aging_getOrgMapCached_()

function _orgNormHub_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * _spxBuildOrgAccessMap_()
 * Dựng bảng email -> {role, position, hubName, stations[]} từ nguồn chính thức.
 * Có cache 1 giờ (cấu trúc tổ chức hiếm đổi trong ngày) — cùng cách đã dùng cho
 * _aging_getOrgMapCached_(), không thêm lượt đọc sheet mỗi request.
 */
function _spxBuildOrgAccessMap_() {
  var cached = CacheMgr.getChunked('ACCESS', ORG_MAP_CACHE_KEY);
  if (cached && cached.byEmail) return cached;

  var ss = SpreadsheetApp.openById(ORG_SOURCE_SPREADSHEET_ID);

  // ── 1. Cây tổ chức: hub -> sup/aom, và hub -> parent hub ──
  var kmSheet = _spxGetAomSupSheet_(ss);
  if (!kmSheet) return { byEmail: {}, error: 'Thiếu sheet ' + ORG_SHEET_AOMSUP_ALIASES.join(' / ') };
  var kmVals = kmSheet.getDataRange().getValues();
  var kmHead = kmVals[0].map(function (h) { return String(h || '').trim(); });
  var ci = {};
  ['Hub', 'Sup_Email', 'AOM_Email', 'parent hub', 'status'].forEach(function (n) { ci[n] = kmHead.indexOf(n); });
  if (ci.Hub < 0 || ci.Sup_Email < 0 || ci.AOM_Email < 0) {
    return { byEmail: {}, error: 'Sheet ' + ORG_SHEET_AOMSUP + ' thiếu cột bắt buộc' };
  }

  var hubInfo = {};      // hubKey -> {name, sup, aom, parent}
  var supHubs = {};      // supEmail -> [hubName]
  var aomHubs = {};      // aomEmail -> [hubName]
  var parentChildren = {}; // parentKey -> [hubName]  (để Lead/Staff hub con thấy hub cha & ngược lại)
  for (var r = 1; r < kmVals.length; r++) {
    var row = kmVals[r];
    var hubName = String(row[ci.Hub] || '').trim();
    if (!hubName) continue;
    // Bỏ hub đã gỡ khỏi hệ thống — chỉ nhận trạng thái Live.
    if (ci.status >= 0) {
      var st = String(row[ci.status] || '').trim();
      if (st && st.indexOf('1.') !== 0) continue;
    }
    var sup = String(row[ci.Sup_Email] || '').trim().toLowerCase();
    var aom = String(row[ci.AOM_Email] || '').trim().toLowerCase();
    var parent = (ci['parent hub'] >= 0) ? String(row[ci['parent hub']] || '').trim() : '';
    var key = _orgNormHub_(hubName);
    hubInfo[key] = { name: hubName, sup: sup, aom: aom, parent: parent };
    if (sup) { if (!supHubs[sup]) supHubs[sup] = []; supHubs[sup].push(hubName); }
    if (aom) { if (!aomHubs[aom]) aomHubs[aom] = []; aomHubs[aom].push(hubName); }
    if (parent) {
      var pk = _orgNormHub_(parent);
      if (!parentChildren[pk]) parentChildren[pk] = [];
      if (pk !== key) parentChildren[pk].push(hubName);
    }
  }

  // ── 2. Bảng ánh xạ TAY do admin nhập (sheet mình có quyền ghi) ──
  var alias = {};
  try {
    var pss = SpreadsheetApp.openById(ORG_WRITABLE_SPREADSHEET_ID);
    var aSheet = pss.getSheetByName(SHEET_NAME_HUB_ALIAS);
    if (aSheet && aSheet.getLastRow() > 1) {
      var aVals = aSheet.getRange(2, 1, aSheet.getLastRow() - 1, 2).getValues();
      aVals.forEach(function (a) {
        var from = _orgNormHub_(a[0]), to = String(a[1] || '').trim();
        if (from && to) alias[from] = to;
      });
    }
  } catch (e) { /* chưa tạo sheet ánh xạ -> bỏ qua, không chặn phân quyền */ }

  // ── 3. Nhân sự: email -> vị trí + hub ──
  var fteSheet = ss.getSheetByName(ORG_SHEET_FTE);
  if (!fteSheet) return { byEmail: {}, error: 'Thiếu sheet ' + ORG_SHEET_FTE };
  var fVals = fteSheet.getDataRange().getValues();
  var fHead = fVals[0].map(function (h) { return String(h || '').trim(); });
  var fi = {};
  ['Email', 'Nơi làm việc', 'Vị trí', 'Họ tên'].forEach(function (n) { fi[n] = fHead.indexOf(n); });
  if (fi.Email < 0 || fi['Nơi làm việc'] < 0 || fi['Vị trí'] < 0) {
    return { byEmail: {}, error: 'Sheet ' + ORG_SHEET_FTE + ' thiếu cột bắt buộc' };
  }

  var POS_ROLE = { 'supervisor': 'SUP', 'team lead': 'LEAD', 'operations team lead': 'LEAD', 'staff': 'STAFF' };
  var byEmail = {}, unmatched = [];
  for (var i = 1; i < fVals.length; i++) {
    var fr = fVals[i];
    var em = String(fr[fi.Email] || '').trim().toLowerCase();
    if (!em) continue;
    var pos = String(fr[fi['Vị trí']] || '').trim();
    var role = POS_ROLE[pos.toLowerCase()] || 'STAFF';
    var place = String(fr[fi['Nơi làm việc']] || '').trim();
    var pk2 = _orgNormHub_(place);
    if (alias[pk2]) pk2 = _orgNormHub_(alias[pk2]); // ưu tiên ánh xạ tay của admin

    var stations = [];
    if (role === 'SUP' && supHubs[em]) {
      stations = supHubs[em].slice();
    } else if (hubInfo[pk2]) {
      // Lead/Staff: hub của mình + hub cha + các hub con cùng cụm (theo parent hub)
      stations.push(hubInfo[pk2].name);
      var par = hubInfo[pk2].parent ? _orgNormHub_(hubInfo[pk2].parent) : '';
      if (par && par !== pk2 && hubInfo[par]) stations.push(hubInfo[par].name);
      var groupKey = (par && hubInfo[par]) ? par : pk2;
      (parentChildren[groupKey] || []).forEach(function (h) { stations.push(h); });
    } else if (place) {
      unmatched.push({ email: em, place: place });
    }
    var uniq = [], seenS = {};
    stations.forEach(function (h) { var k2 = _orgNormHub_(h); if (h && !seenS[k2]) { seenS[k2] = 1; uniq.push(h); } });
    byEmail[em] = {
      role: role, position: pos,
      displayName: (fi['Họ tên'] >= 0 ? String(fr[fi['Họ tên']] || '').trim() : ''),
      hubName: place, stations: uniq
    };
  }

  // AOM lấy từ chính cây tổ chức (AOM không nằm trong FTE)
  Object.keys(aomHubs).forEach(function (ae) {
    if (byEmail[ae]) return;
    byEmail[ae] = { role: 'AOM', position: 'AOM', displayName: '', hubName: '', stations: aomHubs[ae].slice() };
  });
  // SUP có trong cây nhưng chưa có ở FTE -> vẫn cấp quyền theo cây
  Object.keys(supHubs).forEach(function (se) {
    if (byEmail[se]) return;
    byEmail[se] = { role: 'SUP', position: 'Supervisor', displayName: '', hubName: '', stations: supHubs[se].slice() };
  });

  // Cộng thêm trạm do Admin cấp tay (bù chỗ file nguồn còn thiếu).
  var _extra = _spxGetExtraStations_();
  Object.keys(_extra).forEach(function (em2) {
    if (!byEmail[em2]) byEmail[em2] = { role: 'STAFF', position: 'Staff (Admin cấp)', displayName: '', hubName: '', stations: [] };
    var seen2 = {};
    byEmail[em2].stations.forEach(function (h) { seen2[_orgNormHub_(h)] = 1; });
    _extra[em2].forEach(function (h) { if (!seen2[_orgNormHub_(h)]) { seen2[_orgNormHub_(h)] = 1; byEmail[em2].stations.push(h); } });
  });

  var result = { byEmail: byEmail, unmatched: unmatched, builtAt: new Date().toISOString() };
  try { CacheMgr.setChunked('ACCESS', ORG_MAP_CACHE_KEY, result, ORG_MAP_TTL_S); } catch (e) {}
  return result;
}

// ── [MỚI] Cấp THÊM trạm cho 1 user cụ thể (bù chỗ dữ liệu nguồn còn thiếu) ──
// Khác với Hub Alias (sửa tên "Nơi làm việc" sai/không khớp), bảng này CỘNG THÊM
// trạm cho đúng 1 email — dùng khi tổ chức thực tế giao thêm trạm mà file nguồn
// chưa cập nhật. Ghi vào sheet mình CÓ quyền ghi, KHÔNG đụng file nguồn (chỉ đọc).
const SHEET_NAME_EXTRA_STATIONS = 'Trạm bổ sung (Admin)';

function _spxGetExtraStations_() {
  var out = {};
  try {
    var pss = SpreadsheetApp.openById(ORG_WRITABLE_SPREADSHEET_ID);
    var sh = pss.getSheetByName(SHEET_NAME_EXTRA_STATIONS);
    if (!sh || sh.getLastRow() < 2) return out;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    vals.forEach(function (r) {
      var em = String(r[0] || '').trim().toLowerCase();
      var hub = String(r[1] || '').trim();
      var active = String(r[2] == null ? '1' : r[2]).trim();
      if (!em || !hub || active === '0') return; // cột 3 = 0 -> đã thu hồi, bỏ qua
      if (!out[em]) out[em] = [];
      out[em].push(hub);
    });
  } catch (e) { /* chưa có sheet -> không có trạm bổ sung nào */ }
  return out;
}

/**
 * spx_listAllUserAccess() — Admin xem TOÀN BỘ user kèm danh sách trạm họ quản lý.
 * Trả về đủ để đối chiếu thiếu/đủ/thừa mà KHÔNG phải tra thủ công trên file gốc:
 * mỗi user có nơi làm việc gốc, các trạm suy ra từ cây tổ chức, và trạm Admin cấp thêm.
 */
function spx_listAllUserAccess() {
  var me = getCurrentUserAccess_();
  // [SỬA — theo yêu cầu trực tiếp "loại bỏ Trạm quản lý khỏi admin cấp 2"]
  // Trước đây chỉ kiểm tra role === 'ADMIN' (mọi cấp đều qua) — nay chỉ cấp
  // 1 mới được, đúng cùng ranh giới với _requireAdmin_(1) dùng cho các hàm
  // admin-only khác trong file này.
  if (!me || me.role !== 'ADMIN' || Number(me.level) !== 1) return JSON.stringify({ success: false, error: 'Chỉ Admin cấp 1 được xem.' });
  var m = _spxBuildOrgAccessMap_();
  if (m && m.error) return JSON.stringify({ success: false, error: 'Không đọc được dữ liệu tổ chức: ' + m.error });
  var extra = _spxGetExtraStations_();
  var rows = [];
  Object.keys(m.byEmail || {}).forEach(function (em) {
    var u = m.byEmail[em];
    var ex = extra[em] || [];
    var exKey = {};
    ex.forEach(function (h) { exKey[_orgNormHub_(h)] = 1; });
    // tách rõ: trạm nào từ dữ liệu tổ chức, trạm nào do Admin cấp
    var fromSrc = (u.stations || []).filter(function (h) { return !exKey[_orgNormHub_(h)]; });
    rows.push({
      email: em,
      name: u.displayName || '',
      position: u.position || '',
      role: u.role || '',
      workplace: u.hubName || '',
      stations: fromSrc,
      extra: ex,
      total: (u.stations || []).length
    });
  });
  rows.sort(function (a, b) {
    var r = String(a.role).localeCompare(String(b.role));
    return r !== 0 ? r : String(a.email).localeCompare(String(b.email));
  });
  return JSON.stringify({
    success: true, rows: rows, count: rows.length,
    unmatchedCount: (m.unmatched || []).length, builtAt: m.builtAt
  });
}

/**
 * _spxGetHubInfoMap_() — thông tin chi tiết từng trạm (sheet HubSOC infor).
 * Dùng để khi tra 1 user, Admin xem được luôn trạm đó ở đâu, ai phụ trách —
 * không phải mở file nguồn tra tay. Cache chung nhịp với bảng tổ chức.
 */
function _spxGetHubInfoMap_(forceRefresh) {
  var ck = ORG_HUBINFO_CACHE_KEY;
  if (!forceRefresh) {
    var cached = CacheMgr.getChunked('ACCESS', ck);
    if (cached && cached.byHub) return cached;
  }
  var out = {};
  // [MỚI — chẩn đoán] Trước đây khi đọc lỗi/không khớp, hàm âm thầm trả về
  // rỗng — Admin thấy bảng chi tiết trống mà không biết vì sao (thiếu sheet?
  // đổi tên cột? đổi vị trí dòng tiêu đề?). Nay ghi lại từng bước để lộ ra
  // NGUYÊN NHÂN THẬT thay vì chỉ thấy "không có dữ liệu".
  var diag = { sheetFound: false, headerRowFound: false, headerRowIndex: -1, missingColumns: [], rowsLoaded: 0, error: '' };
  try {
    var ss = SpreadsheetApp.openById(ORG_SOURCE_SPREADSHEET_ID);
    var sh = _spxGetHubSocSheet_(ss);
    diag.sheetFound = !!sh;
    if (sh && sh.getLastRow() > 1) {
      var vals = sh.getDataRange().getValues();
      // Dòng tiêu đề không chắc ở dòng 1 -> dò dòng đầu tiên có cột "Hub Name".
      var hRow = -1, head = null;
      for (var r = 0; r < Math.min(vals.length, 10); r++) {
        var row = vals[r].map(function (x) { return String(x || '').trim(); });
        if (row.indexOf('Hub Name') >= 0) { hRow = r; head = row; break; }
      }
      diag.headerRowFound = hRow >= 0;
      diag.headerRowIndex = hRow;
      if (hRow >= 0) {
        var colNames = ['Hub Name', 'Province', 'City', 'Địa chỉ', 'Hubcode', 'Status', 'Sup', 'PIC', 'Position', 'Type', 'Hub mẹ (đối với MBH)', 'Ngày go-live', 'Tọa độ', 'AOM & Sup PIC (OLAP)'];
        var ix = {};
        colNames.forEach(function (n2) {
          ix[n2] = head.indexOf(n2);
          if (ix[n2] < 0) diag.missingColumns.push(n2);
        });
        // [MỚI — rà soát chủ động "đã tận dụng hết dữ liệu HubSOC infor chưa?"]
        // 3 cột này CÓ SẴN, phủ đủ 100% hub (đã kiểm dữ liệu thật), nhưng trước
        // đây hoàn toàn không đọc. Cột "Unnamed: 15/17" trong sheet gốc không có
        // tiêu đề rõ ràng — CỐ Ý bỏ qua, không đoán tên để tránh gán nhãn sai.
        for (var i = hRow + 1; i < vals.length; i++) {
          var nm = String(vals[i][ix['Hub Name']] || '').trim();
          if (!nm) continue;
          // [FIX DỮ LIỆU THẬT] Cột Tọa độ có vài dòng dính thêm ký tự tab (\t)
          // cuối chuỗi — trim() không đủ vì tab nằm giữa chỗ replace, xử lý riêng.
          var coord = ix['Tọa độ'] >= 0 ? String(vals[i][ix['Tọa độ']] || '').replace(/[\t\r\n]+/g, '').trim() : '';
          out[_orgNormHub_(nm)] = {
            name: nm,
            province: ix.Province >= 0 ? String(vals[i][ix.Province] || '').trim() : '',
            city: ix.City >= 0 ? String(vals[i][ix.City] || '').trim() : '',
            address: ix['Địa chỉ'] >= 0 ? String(vals[i][ix['Địa chỉ']] || '').trim() : '',
            hubcode: ix.Hubcode >= 0 ? String(vals[i][ix.Hubcode] || '').trim() : '',
            status: ix.Status >= 0 ? String(vals[i][ix.Status] || '').trim() : '',
            sup: ix.Sup >= 0 ? String(vals[i][ix.Sup] || '').trim() : '',
            pic: ix.PIC >= 0 ? String(vals[i][ix.PIC] || '').trim() : '',
            position: ix.Position >= 0 ? String(vals[i][ix.Position] || '').trim() : '',
            type: ix.Type >= 0 ? String(vals[i][ix.Type] || '').trim() : '',
            parent: ix['Hub mẹ (đối với MBH)'] >= 0 ? String(vals[i][ix['Hub mẹ (đối với MBH)']] || '').trim() : '',
            goLive: ix['Ngày go-live'] >= 0 ? _pickLiveCellOut_(vals[i][ix['Ngày go-live']]) : '',
            coord: coord,
            aomSupPic: ix['AOM & Sup PIC (OLAP)'] >= 0 ? String(vals[i][ix['AOM & Sup PIC (OLAP)']] || '').trim() : ''
          };
        }
      }
    }
    diag.rowsLoaded = Object.keys(out).length;
  } catch (e) { diag.error = String((e && e.message) || e); /* thiếu sheet/không đọc được -> vẫn trả về rỗng, không chặn phân quyền */ }
  var res = { byHub: out, diag: diag };
  // [SỬA] KHÔNG lưu cache khi đọc lỗi hoặc không có hub nào (trước đây giữ rỗng 1 GIỜ sau một lần Sheets lỗi thoáng qua).
  if (!diag.error && Object.keys(out).length > 0) { try { CacheMgr.setChunked('ACCESS', ck, res, ORG_MAP_TTL_S); } catch (e) {} }
  return res;
}

/**
 * _spxHaversineKm_(lat1, lon1, lat2, lon2)
 * [MỚI] Khoảng cách đường chim bay giữa 2 toạ độ, đơn vị km. Công thức Haversine
 * chuẩn — TÍNH SẴN BẰNG CODE, không để AI tự suy luận từ toạ độ thô (mô hình
 * ngôn ngữ không đáng tin khi làm toán địa lý chính xác từ 2 cặp số).
 */
function _spxHaversineKm_(lat1, lon1, lat2, lon2) {
  var R = 6371; // bán kính Trái Đất, km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * _spxParseCoord_(coordStr)
 * Tách chuỗi "lat, lon" (dạng cột Tọa độ trong HubSOC infor, đã trim tab/xuống
 * dòng ở _spxGetHubInfoMap_) thành {lat, lon} số thực, hoặc null nếu không hợp lệ.
 */
function _spxParseCoord_(coordStr) {
  if (!coordStr) return null;
  var m = String(coordStr).match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!m) return null;
  var lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat: lat, lon: lon };
}

/**
 * spx_getStationWeather(stationName)
 * [MỚI — theo yêu cầu trực tiếp "tự động cập nhật thời tiết theo toạ độ trạm
 * đã có"] Gọi Open-Meteo (API thời tiết MIỄN PHÍ, KHÔNG cần đăng ký key,
 * không giới hạn gắt — khác hẳn Firestore, không phải lo hạn mức) theo đúng
 * toạ độ trạm đã có sẵn trong Hub/SOC infor (tái dùng _spxGetHubInfoMap_() +
 * _spxParseCoord_() đã có, không đọc thêm nguồn nào mới). Trả về ĐÚNG 1
 * trong các giá trị <option value="..."> đã có sẵn ở dropdown "Tình hình
 * thời tiết" (Analytics_Block.html) — để frontend chỉ cần set .value, không
 * cần map lại lần nữa. Cache 30 phút/trạm (thời tiết không đổi liên tục cỡ
 * phút, tránh gọi API dư thừa mỗi lần mở báo cáo).
 */
function spx_getStationWeather(stationName, forceRefresh) {
  try {
    _requireApproved_();
    var name = String(stationName || '').trim();
    if (!name) return JSON.stringify({ success: false, error: 'Thiếu tên trạm.' });

    var cacheKey = 'spx_weather_' + _orgNormHub_(name);
    var cache = CacheService.getScriptCache();
    if (!forceRefresh) {
      var cached = cache.get(cacheKey);
      if (cached) return cached;
    }

    var info = _spxGetHubInfoMap_().byHub[_orgNormHub_(name)];
    var coord = info ? _spxParseCoord_(info.coord) : null;
    if (!coord) {
      return JSON.stringify({ success: false, error: 'Trạm chưa có toạ độ trong Hub/SOC infor.' });
    }

    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + coord.lat + '&longitude=' + coord.lon +
      '&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FBangkok';
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 300) {
      return JSON.stringify({ success: false, error: 'Open-Meteo lỗi: HTTP ' + resp.getResponseCode() });
    }
    var data = JSON.parse(resp.getContentText());
    var cur = data.current || {};
    var code = Number(cur.weather_code);
    var temp = Number(cur.temperature_2m);
    var wind = Number(cur.wind_speed_10m); // km/h

    var value = _spxMapWeatherCodeToOption_(code, temp, wind);
    var result = JSON.stringify({ success: true, value: value, temp: temp, code: code });
    try { cache.put(cacheKey, result, 1800); } catch (eCache) {} // 30 phút
    return result;
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * _spxMapWeatherCodeToOption_(code, temp, wind)
 * Quy đổi mã thời tiết chuẩn WMO (Open-Meteo trả về) + nhiệt độ/gió sang ĐÚNG
 * 1 trong các value đã có sẵn ở dropdown "Tình hình thời tiết". Đây là quy
 * đổi TƯƠNG ĐỐI (gần đúng, không thể khớp hoàn hảo 100% với cảm nhận thực
 * tế tại hiện trường) — user vẫn tự đổi tay được nếu thấy không đúng, không
 * ép buộc.
 */
function _spxMapWeatherCodeToOption_(code, temp, wind) {
  // Sương mù
  if (code === 45 || code === 48) return 'Sương mù';
  // Mưa/dông theo mức độ nặng dần
  if (code === 95 || code === 96 || code === 99) return 'Mưa to, sấm sét';
  if (code === 65 || code === 82) return 'Mưa to, sấm sét';
  if (code === 63 || code === 81) return 'Mưa dầm kéo dài';
  if ([51, 53, 55, 56, 57, 61, 80].indexOf(code) >= 0) return 'Mưa nhỏ, đường trơn';
  // Tuyết (hiếm khi xảy ra ở VN, dự phòng cho hoàn chỉnh) — quy về "Trời lạnh"
  if ([71, 73, 75, 77, 85, 86].indexOf(code) >= 0) return 'Trời lạnh';
  // Gió lớn (không mưa) — ngưỡng ~40km/h trở lên coi là gió mạnh đáng chú ý
  if (!isNaN(wind) && wind >= 40) return 'Gió lớn';
  // Mây/quang mây — phân theo nhiệt độ cho hợp thực tế
  if (code === 2 || code === 3) return 'Nhiều mây, âm u';
  if (!isNaN(temp)) {
    if (temp >= 34) return 'Nắng gắt, oi bức';
    if (temp <= 20) return 'Trời lạnh';
  }
  if (code === 0 || code === 1) return 'Nắng đẹp';
  return 'Mát mẻ, thuận lợi'; // fallback trung tính nếu mã lạ/không xác định được
}

/**
 * _spxGetNearbyHubs_(hubName, maxKm, maxCount)
 * [MỚI] Trả về tối đa maxCount trạm GẦN NHẤT theo đường chim bay (trong bán
 * kính maxKm) quanh hubName, đã SẮP XẾP theo khoảng cách tăng dần. Tính từ
 * TOÀN BỘ 379 hub có toạ độ (không giới hạn theo quyền — đây chỉ là dữ kiện
 * ĐỊA LÝ, không phải số liệu vận hành, xem ghi chú phân quyền ở nơi gọi hàm
 * này). Cache riêng 1 giờ — cùng nhịp ORG_MAP_TTL_S, tránh tính lại toàn bộ
 * ~379×379 cặp mỗi câu hỏi AI.
 */
function _spxGetNearbyHubs_(hubName, maxKm, maxCount) {
  var info = _spxGetHubInfoMap_().byHub || {};
  var meKey = _orgNormHub_(hubName);
  var me = info[meKey];
  var meCoord = me ? _spxParseCoord_(me.coord) : null;
  if (!meCoord) return [];
  var out = [];
  Object.keys(info).forEach(function (k) {
    if (k === meKey) return;
    var c = _spxParseCoord_(info[k].coord);
    if (!c) return;
    var km = _spxHaversineKm_(meCoord.lat, meCoord.lon, c.lat, c.lon);
    if (km <= maxKm) out.push({ ten: info[k].name, km: Math.round(km * 10) / 10 });
  });
  out.sort(function (a, b) { return a.km - b.km; });
  return out.slice(0, maxCount);
}

/**
 * spx_refreshHubInfoCache() — Admin bấm tay để xoá cache trạm ngay, không phải
 * đợi 1 giờ tự hết hạn. Dùng khi vừa sửa dữ liệu ở HubSOC infor / Khu vực quản
 * lý và muốn thấy ngay, hoặc khi nghi ngờ đang xem dữ liệu cũ.
 */
function spx_refreshHubInfoCache() {
  var me = getCurrentUserAccess_();
  if (!me || me.role !== 'ADMIN' || Number(me.level) !== 1) return JSON.stringify({ success: false, error: 'Chỉ Admin cấp 1 được làm mới.' });
  try { CacheMgr.invalidateChunked('ACCESS', ORG_MAP_CACHE_KEY); } catch (e) {}
  try { CacheMgr.invalidateChunked('ACCESS', ORG_HUBINFO_CACHE_KEY); } catch (e) {}
  return JSON.stringify({ success: true });
}

/** spx_getUserAccessDetail(email) — Admin xem user đang có quyền gì, từ nguồn nào. */
function spx_getUserAccessDetail(targetEmail) {
  var me = getCurrentUserAccess_();
  // [SỬA — theo yêu cầu trực tiếp "loại bỏ Trạm quản lý khỏi admin cấp 2"]
  // Trước đây chỉ kiểm tra role === 'ADMIN' (mọi cấp đều qua) — nay chỉ cấp
  // 1 mới được, đúng cùng ranh giới với _requireAdmin_(1) dùng cho các hàm
  // admin-only khác trong file này.
  if (!me || me.role !== 'ADMIN' || Number(me.level) !== 1) return JSON.stringify({ success: false, error: 'Chỉ Admin cấp 1 được xem.' });
  var em = String(targetEmail || '').trim().toLowerCase();
  if (!em) return JSON.stringify({ success: false, error: 'Thiếu email.' });
  var m = _spxBuildOrgAccessMap_();
  // [SỬA] Trước đây nếu dựng bảng tổ chức lỗi (thiếu sheet/mất quyền đọc file
  // nguồn) thì hàm này vẫn trả found=false, giao diện hiện "không có dữ liệu" —
  // gây hiểu nhầm là user không tồn tại, trong khi thật ra là lỗi đọc nguồn.
  // Nay báo LÊN nguyên nhân thật để Admin biết đường xử lý.
  if (m && m.error) return JSON.stringify({ success: false, error: 'Không đọc được dữ liệu tổ chức: ' + m.error });
  var base = (m.byEmail && m.byEmail[em]) ? m.byEmail[em] : null;
  var extra = _spxGetExtraStations_()[em] || [];
  return JSON.stringify({
    success: true, email: em,
    totalUsersInSource: Object.keys(m.byEmail || {}).length, // để phân biệt "nguồn rỗng" với "user không có"
    found: !!base,
    role: base ? base.role : null,
    position: base ? base.position : null,
    hubName: base ? base.hubName : null,
    fromSource: base ? base.stations : [],
    extra: extra,
    // [MỚI] Thông tin chi tiết từng trạm (địa chỉ, mã, tỉnh, người phụ trách)
    // lấy từ sheet HubSOC infor — xem ngay tại đây, khỏi mở file nguồn tra tay.
    hubDetail: (function () {
      var info = _spxGetHubInfoMap_().byHub || {};
      var all = (base ? base.stations : []).concat(extra), seen = {}, list = [];
      var anyUnmatched = false;
      all.forEach(function (h) {
        var k = _orgNormHub_(h);
        if (seen[k]) return; seen[k] = 1;
        if (!info[k]) anyUnmatched = true;
        list.push({ key: k, raw: h });
      });
      // [MỚI — TỰ PHỤC HỒI] Cache trạm (1 giờ) có thể "kẹt" ở dữ liệu cũ nếu
      // ai đó vừa sửa trực tiếp sheet HubSOC infor (thêm/đổi tên trạm) mà
      // không qua thao tác Admin nào trong hệ thống (cấp/thu hồi/ánh xạ) —
      // những thao tác đó mới tự xoá cache, sửa tay trên sheet thì không.
      // Kết quả: tên trạm khớp 100% ngoài sheet thật nhưng vẫn hiện "-" vì
      // đọc trúng lúc cache còn giữ bản trước khi trạm đó có/đổi tên. Thay vì
      // bắt Admin tự bấm "Làm mới cache trạm" mỗi lần gặp, tự làm mới NGAY
      // MỘT LẦN và thử khớp lại trước khi chịu thua — cùng nguyên tắc self-heal
      // đã áp dụng cho Inbound Lock (mục 1.9 nhật ký dự án).
      if (anyUnmatched) {
        info = _spxGetHubInfoMap_(true).byHub || info;
      }
      return list.map(function (item) {
        var found = info[item.key];
        if (found) return found;
        return {
          name: item.raw, province: '', city: '', address: '', hubcode: '', status: '', sup: '', pic: '',
          position: '', type: '', parent: '', goLive: '', coord: '', aomSupPic: '',
          _unmatched: true, _suggest: _spxSuggestHubMatches_(item.key, info, 3)
        };
      });
    })(),
    // [MỚI — chẩn đoán] Lộ ra nguyên nhân thật nếu bảng chi tiết trống/thiếu
    // dữ liệu, thay vì Admin chỉ thấy im lặng không hiểu vì sao.
    hubInfoDiag: _spxGetHubInfoMap_().diag || null
  });
}

/**
 * _spxSuggestHubMatches_(normalizedKey, infoMap, maxCount)
 * [MỚI — chẩn đoán] Khi tên trạm không khớp trực tiếp với sheet HubSOC infor,
 * gợi ý tối đa maxCount tên GẦN GIỐNG NHẤT trong sheet đó — so khớp theo số từ
 * trùng nhau (không cần thư viện fuzzy-match ngoài, đủ dùng cho việc dò lỗi
 * chính tả/thiếu chữ/thừa chữ giữa 2 nguồn dữ liệu).
 */
function _spxSuggestHubMatches_(normalizedKey, infoMap, maxCount) {
  var myTokens = normalizedKey.split(' ').filter(Boolean);
  if (!myTokens.length) return [];
  var scored = [];
  Object.keys(infoMap).forEach(function (k) {
    var otherTokens = k.split(' ').filter(Boolean);
    var overlap = 0;
    myTokens.forEach(function (t) { if (otherTokens.indexOf(t) >= 0) overlap++; });
    // Cũng tính điểm nếu 1 chuỗi chứa trọn chuỗi kia (khác biệt kiểu thêm/bớt hậu tố).
    var contains = (k.indexOf(normalizedKey) >= 0 || normalizedKey.indexOf(k) >= 0) ? 2 : 0;
    var score = overlap + contains;
    if (score > 0) scored.push({ name: infoMap[k].name, score: score });
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, maxCount).map(function (s) { return s.name; });
}

/** spx_addExtraStation(email, hub) — Admin cấp thêm 1 trạm cho user. */
function spx_addExtraStation(targetEmail, hubName) {
  var me = getCurrentUserAccess_();
  // [SỬA — theo yêu cầu trực tiếp "loại bỏ Trạm quản lý khỏi admin cấp 2"]
  // Trước đây chỉ kiểm tra role === 'ADMIN' (mọi cấp đều qua) — nay chỉ cấp
  // 1 mới được, đúng cùng ranh giới với _requireAdmin_(1) dùng cho các hàm
  // admin-only khác trong file này.
  if (!me || me.role !== 'ADMIN' || Number(me.level) !== 1) return JSON.stringify({ success: false, error: 'Chỉ Admin cấp 1 được sửa.' });
  var em = String(targetEmail || '').trim().toLowerCase();
  var hub = String(hubName || '').trim();
  if (!em || !hub) return JSON.stringify({ success: false, error: 'Thiếu email hoặc tên trạm.' });
  var pss = SpreadsheetApp.openById(ORG_WRITABLE_SPREADSHEET_ID);
  var sh = pss.getSheetByName(SHEET_NAME_EXTRA_STATIONS);
  if (!sh) {
    sh = pss.insertSheet(SHEET_NAME_EXTRA_STATIONS);
    sh.appendRow(['Email', 'Trạm bổ sung', 'Còn hiệu lực (1/0)', 'Người cấp', 'Thời điểm', 'Ghi chú']);
  }
  sh.appendRow([em, hub, 1, me.email, new Date(), '']);
  try { CacheMgr.invalidateChunked('ACCESS', ORG_MAP_CACHE_KEY); } catch (e) {}
  // [FIX LỖI THẬT — "đã tra được nhưng dữ liệu HubSOC infor toàn dấu -"]
  // Cache thông tin trạm (ORG_HUBINFO_CACHE_KEY) TRƯỚC ĐÂY không bị xoá ở BẤT
  // KỲ ĐÂU trong toàn bộ file — chỉ tự hết hạn sau 1 giờ (ORG_MAP_TTL_S). Nếu
  // admin tra cứu đúng lúc cache còn giữ kết quả rỗng từ trước khi hàm đọc
  // HubSOC infor hoàn thiện, họ sẽ thấy dữ liệu rỗng suốt cả giờ dù dữ liệu
  // nguồn đã đúng. Nay xoá kèm mỗi khi xoá cache tổ chức — 2 cache này cùng
  // đọc từ 1 nguồn nên hợp lý để luôn làm mới cùng nhau.
  try { CacheMgr.invalidateChunked('ACCESS', ORG_HUBINFO_CACHE_KEY); } catch (e) {}
  return JSON.stringify({ success: true });
}

/** spx_revokeExtraStation(email, hub) — thu hồi trạm đã cấp thêm (đặt cột hiệu lực = 0, GIỮ lịch sử). */
function spx_revokeExtraStation(targetEmail, hubName) {
  var me = getCurrentUserAccess_();
  // [SỬA — theo yêu cầu trực tiếp "loại bỏ Trạm quản lý khỏi admin cấp 2"]
  // Trước đây chỉ kiểm tra role === 'ADMIN' (mọi cấp đều qua) — nay chỉ cấp
  // 1 mới được, đúng cùng ranh giới với _requireAdmin_(1) dùng cho các hàm
  // admin-only khác trong file này.
  if (!me || me.role !== 'ADMIN' || Number(me.level) !== 1) return JSON.stringify({ success: false, error: 'Chỉ Admin cấp 1 được sửa.' });
  var em = String(targetEmail || '').trim().toLowerCase();
  var hub = String(hubName || '').trim().toLowerCase();
  var pss = SpreadsheetApp.openById(ORG_WRITABLE_SPREADSHEET_ID);
  var sh = pss.getSheetByName(SHEET_NAME_EXTRA_STATIONS);
  if (!sh || sh.getLastRow() < 2) return JSON.stringify({ success: false, error: 'Chưa có dữ liệu.' });
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim().toLowerCase() === em &&
        String(vals[i][1] || '').trim().toLowerCase() === hub &&
        String(vals[i][2]).trim() !== '0') {
      sh.getRange(i + 2, 3).setValue(0); n++;
    }
  }
  try { CacheMgr.invalidateChunked('ACCESS', ORG_MAP_CACHE_KEY); } catch (e) {}
  // [FIX LỖI THẬT — "đã tra được nhưng dữ liệu HubSOC infor toàn dấu -"]
  // Cache thông tin trạm (ORG_HUBINFO_CACHE_KEY) TRƯỚC ĐÂY không bị xoá ở BẤT
  // KỲ ĐÂU trong toàn bộ file — chỉ tự hết hạn sau 1 giờ (ORG_MAP_TTL_S). Nếu
  // admin tra cứu đúng lúc cache còn giữ kết quả rỗng từ trước khi hàm đọc
  // HubSOC infor hoàn thiện, họ sẽ thấy dữ liệu rỗng suốt cả giờ dù dữ liệu
  // nguồn đã đúng. Nay xoá kèm mỗi khi xoá cache tổ chức — 2 cache này cùng
  // đọc từ 1 nguồn nên hợp lý để luôn làm mới cùng nhau.
  try { CacheMgr.invalidateChunked('ACCESS', ORG_HUBINFO_CACHE_KEY); } catch (e) {}
  return JSON.stringify({ success: true, revoked: n });
}

/** spx_getAllHubNames() — danh sách trạm để Admin chọn khi cấp thêm. */
function spx_getAllHubNames() {
  var me = getCurrentUserAccess_();
  // [SỬA — theo yêu cầu trực tiếp "loại bỏ Trạm quản lý khỏi admin cấp 2"]
  // Trước đây chỉ kiểm tra role === 'ADMIN' (mọi cấp đều qua) — nay chỉ cấp
  // 1 mới được, đúng cùng ranh giới với _requireAdmin_(1) dùng cho các hàm
  // admin-only khác trong file này.
  if (!me || me.role !== 'ADMIN' || Number(me.level) !== 1) return JSON.stringify({ success: false, error: 'Chỉ Admin cấp 1 được xem.' });
  var m = _spxBuildOrgAccessMap_();
  var set = {}, out = [];
  Object.keys(m.byEmail || {}).forEach(function (e) {
    (m.byEmail[e].stations || []).forEach(function (h) { if (!set[h]) { set[h] = 1; out.push(h); } });
  });
  return JSON.stringify({ success: true, hubs: out.sort() });
}

/** spx_getUnmatchedWorkplaces() — cho màn hình Admin: liệt kê "Nơi làm việc" chưa ánh xạ được hub. */
function spx_getUnmatchedWorkplaces() {
  var access = getCurrentUserAccess_();
  // [SỬA — theo yêu cầu trực tiếp "loại bỏ Trạm quản lý khỏi admin cấp 2"]
  // Trước đây chỉ kiểm tra role === 'ADMIN' (mọi cấp đều qua) — nay chỉ cấp
  // 1 mới được, đúng cùng ranh giới với _requireAdmin_(1) dùng cho các hàm
  // admin-only khác trong file này.
  if (!access || access.role !== 'ADMIN' || Number(access.level) !== 1) return JSON.stringify({ success: false, error: 'Chỉ Admin cấp 1 được xem.' });
  var m = _spxBuildOrgAccessMap_();
  var seen = {}, out = [];
  (m.unmatched || []).forEach(function (u) {
    var k = _orgNormHub_(u.place);
    if (!seen[k]) { seen[k] = 1; out.push({ place: u.place, count: 1, sample: u.email }); }
    else { out.forEach(function (o) { if (_orgNormHub_(o.place) === k) o.count++; }); }
  });
  return JSON.stringify({ success: true, items: out, builtAt: m.builtAt });
}

/** spx_saveHubAlias(fromPlace, toHub) — Admin lưu ánh xạ tay vào sheet CÓ quyền ghi. */
function spx_saveHubAlias(fromPlace, toHub) {
  var access = getCurrentUserAccess_();
  // [SỬA — theo yêu cầu trực tiếp "loại bỏ Trạm quản lý khỏi admin cấp 2"]
  // Trước đây chỉ kiểm tra role === 'ADMIN' (mọi cấp đều qua) — nay chỉ cấp
  // 1 mới được, đúng cùng ranh giới với _requireAdmin_(1) dùng cho các hàm
  // admin-only khác trong file này.
  if (!access || access.role !== 'ADMIN' || Number(access.level) !== 1) return JSON.stringify({ success: false, error: 'Chỉ Admin cấp 1 được sửa.' });
  if (!fromPlace || !toHub) return JSON.stringify({ success: false, error: 'Thiếu dữ liệu.' });
  var pss = SpreadsheetApp.openById(ORG_WRITABLE_SPREADSHEET_ID);
  var sh = pss.getSheetByName(SHEET_NAME_HUB_ALIAS);
  if (!sh) {
    sh = pss.insertSheet(SHEET_NAME_HUB_ALIAS);
    sh.appendRow(['Nơi làm việc (trong FTE)', 'Hub thật tương ứng', 'Người sửa', 'Thời điểm']);
  }
  sh.appendRow([String(fromPlace).trim(), String(toHub).trim(), access.email, new Date()]);
  try { CacheMgr.invalidateChunked('ACCESS', ORG_MAP_CACHE_KEY); } catch (e) {}
  // [FIX LỖI THẬT — "đã tra được nhưng dữ liệu HubSOC infor toàn dấu -"]
  // Cache thông tin trạm (ORG_HUBINFO_CACHE_KEY) TRƯỚC ĐÂY không bị xoá ở BẤT
  // KỲ ĐÂU trong toàn bộ file — chỉ tự hết hạn sau 1 giờ (ORG_MAP_TTL_S). Nếu
  // admin tra cứu đúng lúc cache còn giữ kết quả rỗng từ trước khi hàm đọc
  // HubSOC infor hoàn thiện, họ sẽ thấy dữ liệu rỗng suốt cả giờ dù dữ liệu
  // nguồn đã đúng. Nay xoá kèm mỗi khi xoá cache tổ chức — 2 cache này cùng
  // đọc từ 1 nguồn nên hợp lý để luôn làm mới cùng nhau.
  try { CacheMgr.invalidateChunked('ACCESS', ORG_HUBINFO_CACHE_KEY); } catch (e) {}
  return JSON.stringify({ success: true });
}

function getCurrentUserAccess_(testEmail) {
  const email = testEmail ? normEmail_(testEmail) : getCallerEmail_();
  const unauthorized = { role: 'UNAUTHORIZED', email: email, displayName: '', position: '', stations: new Set(), stationsOriginal: [], unrestricted: false };
  if (!email) return unauthorized;

  const adminEmails = RESCUE_ADMIN_EMAILS.map(normEmail_);
  if (adminEmails.indexOf(email) !== -1) {
    return {
      role: 'ADMIN',
      // [FIX LỖI THẬT — "Admin cấp 1 nhưng báo Chỉ Admin cấp 1 được xem"]
      // Đường FAILSAFE này (theo đúng comment gốc: "LUÔN LUÔN được coi là
      // admin cấp 1") trước đây KHÔNG trả field `level` — khi các hàm mới
      // thêm sau này kiểm tra Number(me.level) !== 1, undefined -> NaN ->
      // luôn bị chặn dù đúng là cấp 1 cao nhất. Thêm level: 1 để khớp đúng
      // ý nghĩa đã ghi trong comment gốc của RESCUE_ADMIN_EMAILS.
      level: 1,
      email: email,
      displayName: email,
      position: 'Quản trị viên',
      stations: new Set(),      // không dùng để lọc — xem getOrders() / filterRowsForStations_
      stationsOriginal: [],
      unrestricted: true         // cờ báo: bỏ qua mọi filter theo trạm
    };
  }

  // [MỚI — CHUẨN HOÁ PHÂN QUYỀN] Ưu tiên nguồn tổ chức CHÍNH THỨC (FTE +
  // Khu vực quản lý). Vị trí trong FTE quyết định cấp quyền; hub lấy theo
  // đúng cây tổ chức, đã tính cả quan hệ hub cha/con. KHÔNG xoá logic cũ:
  // nếu email chưa có trong nguồn mới (hoặc nguồn lỗi), tự động rơi xuống
  // đường cũ bên dưới — không ai bị mất quyền trong lúc chuyển đổi.
  try {
    var _orgMap = _spxBuildOrgAccessMap_();
    var _me = _orgMap && _orgMap.byEmail ? _orgMap.byEmail[email] : null;
    if (_me && _me.stations && _me.stations.length) {
      var _set = new Set();
      _me.stations.forEach(function (h) { var k = normStationKey_(h); if (k) _set.add(k); });
      return {
        role: _me.role, email: email,
        displayName: _me.displayName || email,
        position: _me.position || _me.role,
        stations: _set,
        stationsOriginal: _me.stations.slice().sort(),
        unrestricted: false,
        fromOrgSource: true // đánh dấu để dễ soi khi cần đối chiếu nguồn
      };
    }
  } catch (eOrg) { /* nguồn mới lỗi -> dùng đường cũ, không chặn đăng nhập */ }

  const pss = SpreadsheetApp.openById(RESCUE_PERMISSION_SPREADSHEET_ID);

  const aomSupSheet = pss.getSheetByName(SHEET_NAME_AOM_SUP);
  if (aomSupSheet) {
    const data = aomSupSheet.getDataRange().getValues();
    if (data.length > 1) {
      const idx = buildHeaderIndex_(data[0]);
      const cAom = findCol_(idx, ['AOM']);
      const cAomEmail = findCol_(idx, ['AOM_Email', 'AOM Email']);
      const cSupName = findCol_(idx, ['Sup_Name', 'Sup Name']);
      const cSupEmail = findCol_(idx, ['Sup_Email', 'Sup Email']);
      const cHub = findCol_(idx, ['Hub']);
      if (cAomEmail == null || cSupEmail == null || cHub == null) {
        throw new Error('Sheet phân quyền "' + SHEET_NAME_AOM_SUP + '" thiếu cột bắt buộc (AOM_Email / Sup_Email / Hub). Cột thực tế đọc được: ' + Object.keys(idx).join(' | '));
      }

      const aomStations = new Set(), aomStationsOriginal = [];
      const supStations = new Set(), supStationsOriginal = [];
      let aomDisplayName = '', supDisplayName = '';

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const hub = String(row[cHub] || '').trim();
        if (!hub) continue;
        const hubKey = normStationKey_(hub);

        const aomEmail = normEmail_(row[cAomEmail]);
        if (aomEmail && aomEmail === email) {
          if (!aomStations.has(hubKey)) { aomStations.add(hubKey); aomStationsOriginal.push(hub); }
          aomDisplayName = (cAom != null ? String(row[cAom] || '').trim() : '') || aomDisplayName;
        }

        const supEmail = normEmail_(row[cSupEmail]);
        if (supEmail && supEmail === email) {
          if (!supStations.has(hubKey)) { supStations.add(hubKey); supStationsOriginal.push(hub); }
          supDisplayName = (cSupName != null ? String(row[cSupName] || '').trim() : '') || supDisplayName;
        }
      }

      if (aomStations.size > 0) {
        return { role: 'AOM', email: email, displayName: aomDisplayName || email, position: 'AOM', stations: aomStations, stationsOriginal: aomStationsOriginal.sort() };
      }
      if (supStations.size > 0) {
        return { role: 'SUP', email: email, displayName: supDisplayName || email, position: 'SUP', stations: supStations, stationsOriginal: supStationsOriginal.sort() };
      }
    }
  }

  const staffSheet = pss.getSheetByName(SHEET_NAME_STAFF);
  if (staffSheet) {
    const data = staffSheet.getDataRange().getValues();
    if (data.length > 1) {
      const idx = buildHeaderIndex_(data[0]);
      const cName = findCol_(idx, ['Họ tên', 'Ho ten']);
      const cHub = findCol_(idx, ['Nơi làm việc', 'Noi lam viec']);
      const cQuit = findCol_(idx, ['Ngày nghỉ việc', 'Ngay nghi viec']);
      const cPos = findCol_(idx, ['Vị trí', 'Vi tri']);
      const cEmail = findCol_(idx, ['Email']);
      if (cHub == null || cEmail == null) {
        throw new Error('Sheet phân quyền "' + SHEET_NAME_STAFF + '" thiếu cột bắt buộc (Nơi làm việc / Email). Cột thực tế đọc được: ' + Object.keys(idx).join(' | '));
      }

      let matchHub = '', matchName = '', matchPos = '', matchIsActive = false;
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowEmail = normEmail_(row[cEmail]);
        if (!rowEmail || rowEmail !== email) continue;
        const hub = String(row[cHub] || '').trim();
        if (!hub) continue;
        const isActive = cQuit != null ? !row[cQuit] : true;

        if (!matchHub || (isActive && !matchIsActive)) {
          matchHub = hub;
          matchName = cName != null ? String(row[cName] || '').trim() : '';
          matchPos = cPos != null ? String(row[cPos] || '').trim() : '';
          matchIsActive = isActive;
        }
      }

      if (matchHub) {
        const key = normStationKey_(matchHub);
        return { role: 'STAFF', email: email, displayName: matchName || email, position: matchPos, stations: new Set([key]), stationsOriginal: [matchHub] };
      }
    }
  }

  return unauthorized;
}

function getCallerEmail_() {
  try {
    let email = Session.getActiveUser().getEmail();
    if (!email) email = Session.getEffectiveUser().getEmail();
    return normEmail_(email);
  } catch (e) {
    return '';
  }
}

function normEmail_(v) { return String(v || '').trim().toLowerCase(); }

/** Trả về mảng đã loại trùng lặp và sắp xếp theo alphabet (dùng cho danh sách trạm của Admin). */
function uniqueSorted_(arr) {
  const seen = {};
  const out = [];
  arr.forEach(function (v) {
    const key = String(v);
    if (!seen[key]) { seen[key] = true; out.push(v); }
  });
  return out.sort();
}

function stripDiacritics_(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function normStationKey_(s) {
  return stripDiacritics_(String(s || '').trim().replace(/\s+/g, ' ')).toUpperCase();
}

function normHeaderKey_(s) {
  return stripDiacritics_(String(s || '').trim()).toLowerCase().replace(/[_\s]+/g, ' ');
}

function buildHeaderIndex_(headerRow) {
  const idx = { __norm: {} };
  headerRow.forEach(function (h, i) {
    const raw = String(h).trim();
    idx[raw] = i;
    idx.__norm[normHeaderKey_(raw)] = i;
  });
  return idx;
}

function findCol_(idx, candidateNames) {
  for (const name of candidateNames) { if (name in idx) return idx[name]; }
  for (const name of candidateNames) {
    const key = normHeaderKey_(name);
    if (key in idx.__norm) return idx.__norm[key];
  }
  return null;
}

function getSheetByGid_(ss, gid) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) { if (sheets[i].getSheetId() === gid) return sheets[i]; }
  return null;
}

function normalizeDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, SPX_TZ, 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, SPX_TZ, 'yyyy-MM-dd');
  }
  return s.slice(0, 10);
}

/* =========================================================================
 * HÀM DEBUG — chạy tay trong Apps Script Editor, không được frontend gọi
 * ========================================================================= */

function debugCountStationRows() {
  const stationToCheck = '45-DLK Krong Pak 02 Hub';
  const fetched = fetchOrderRows_();
  const targetKey = normStationKey_(stationToCheck);
  const matches = fetched.rows.filter(function (r) { return normStationKey_(r.station_name) === targetKey; });
  Logger.log('Tong so dong co tracking_no tren sheet: ' + fetched.rows.length);
  Logger.log('So dong khop tram "' + stationToCheck + '": ' + matches.length);
  matches.forEach(function (r) { Logger.log('tn=' + r.tracking_no + ' | station="' + r.station_name + '"'); });
}

/**
 * Mô phỏng ĐẦY ĐỦ luồng getOrders() thật (đọc quyền → đọc đơn → lọc → mail),
 * nhưng dùng testEmail giả lập thay vì Session.getActiveUser() — để chạy
 * tay trong editor mà vẫn phản ánh đúng những gì web app thật sẽ chạy,
 * kèm log thời gian từng bước và bắt lỗi có stack trace đầy đủ.
 */
function debugFullGetOrders() {
  const testEmail = 'xuan.nguyenthanh01@spxexpress.com'; // <-- đổi email cần test ở đây
  const t0 = Date.now();
  try {
    const access = getCurrentUserAccess_(testEmail);
    Logger.log('[1] getCurrentUserAccess_ OK (' + (Date.now()-t0) + 'ms) — role=' + access.role + ' unrestricted=' + !!access.unrestricted + ' soTram=' + access.stations.size);

    if (access.role === 'UNAUTHORIZED') { Logger.log('DUNG LAI: UNAUTHORIZED, khong doc tiep don hang.'); return; }

    const t1 = Date.now();
    const fetched = fetchOrderRows_();
    Logger.log('[2] fetchOrderRows_ OK (' + (Date.now()-t1) + 'ms) — tong dong: ' + fetched.rows.length);

    const t2 = Date.now();
    const rows = access.unrestricted ? fetched.rows : filterRowsForStations_(fetched.rows, access.stations);
    Logger.log('[3] loc theo quyen OK (' + (Date.now()-t2) + 'ms) — con lai: ' + rows.length);

    const t3 = Date.now();
    let mailStatus = { subscribed: false, email: access.email, lastSentAt: '', eligible: false };
    Logger.log('[4] getMailSubscriptionStatus_ SKIPPED (da ngung) (' + (Date.now()-t3) + 'ms)');

    const t4 = Date.now();
    const payload = {
      rows: rows,
      fetchedAt: new Date().toISOString(),
      sheetName: fetched.sheet.getName(),
      spreadsheetName: fetched.ss.getName(),
      access: { role: access.role, email: access.email, stationCount: rows.length ? 1 : 0 },
      mail: mailStatus || null
    };
    const json = JSON.stringify(payload);
    Logger.log('[5] JSON.stringify OK (' + (Date.now()-t4) + 'ms) — kich thuoc payload: ' + json.length + ' ky tu');
    Logger.log('TONG THOI GIAN: ' + (Date.now()-t0) + 'ms');
    Logger.log('=> Neu thay het cac buoc [1]-[5] deu OK va thoi gian hop ly (<30s), backend hoan toan on. Loi that su nam o phia trinh duyet (client) khi goi google.script.run — kiem tra Console (F12) cua trinh duyet luc mo web app that.');
  } catch (e) {
    Logger.log('LOI THAT SU (kem stack): ' + e.message + '\n' + e.stack);
  }
}

/**
 * Test riêng phần MAIL (tách khỏi getOrders) — chạy tay để biết chính xác
 * tài khoản đang chạy có tạo/đọc được tab "Mail Subscribers" hay không.
 */
function debugMailSheetAccess_() {
  try {
    const sheet = getMailSheet_();
    Logger.log('OK: da mo/tao duoc tab "' + MAIL_SHEET_NAME + '", so dong hien co: ' + sheet.getLastRow());
  } catch (e) {
    Logger.log('LOI: ' + e.message);
  }
}

function debugCheckAccess() {
  const testEmail = 'xuan.nguyenthanh01@spxexpress.com';
  const access = getCurrentUserAccess_(testEmail);
  Logger.log('email = ' + access.email);
  Logger.log('role = ' + access.role);
  Logger.log('displayName = ' + access.displayName);
  Logger.log('so tram duoc xem = ' + access.stations.size);
  Logger.log('danh sach tram:\n' + access.stationsOriginal.join('\n'));
}

function debugStationNameSync_() {
  const fetched = fetchOrderRows_();
  const dataStations = new Set(fetched.rows.map(function (r) { return r.station_name; }).filter(Boolean));

  const pss = SpreadsheetApp.openById(RESCUE_PERMISSION_SPREADSHEET_ID);
  const permStations = new Set();

  const aomSupSheet = pss.getSheetByName(SHEET_NAME_AOM_SUP);
  if (aomSupSheet) {
    const d = aomSupSheet.getDataRange().getValues();
    const idx = buildHeaderIndex_(d[0]);
    const cHub = findCol_(idx, ['Hub']);
    if (cHub != null) { for (let i = 1; i < d.length; i++) { const hub = String(d[i][cHub] || '').trim(); if (hub) permStations.add(hub); } }
  }
  const staffSheet = pss.getSheetByName(SHEET_NAME_STAFF);
  if (staffSheet) {
    const d = staffSheet.getDataRange().getValues();
    const idx = buildHeaderIndex_(d[0]);
    const cHub = findCol_(idx, ['Nơi làm việc', 'Noi lam viec']);
    if (cHub != null) { for (let i = 1; i < d.length; i++) { const hub = String(d[i][cHub] || '').trim(); if (hub) permStations.add(hub); } }
  }

  const dataKeys = new Map(); dataStations.forEach(function (s) { dataKeys.set(normStationKey_(s), s); });
  const permKeys = new Map(); permStations.forEach(function (s) { permKeys.set(normStationKey_(s), s); });

  const onlyInData = []; dataKeys.forEach(function (orig, key) { if (!permKeys.has(key)) onlyInData.push(orig); });
  const onlyInPerm = []; permKeys.forEach(function (orig, key) { if (!dataKeys.has(key)) onlyInPerm.push(orig); });

  Logger.log('Tong so tram distinct trong sheet DON: ' + dataStations.size);
  Logger.log('Tong so tram distinct trong sheet PHAN QUYEN: ' + permStations.size);
  Logger.log('=== Tram co trong SHEET DON nhung KHONG khop sheet phan quyen (' + onlyInData.length + ') ===');
  Logger.log(onlyInData.sort().join('\n'));
  Logger.log('=== Tram co trong sheet PHAN QUYEN nhung KHONG khop sheet don (' + onlyInPerm.length + ') ===');
  Logger.log(onlyInPerm.sort().join('\n'));
}

// =========================================================================
// ===== KẾT THÚC MODULE ĐƠN CẦN CẦU CỨU =====
// ===== BẮT ĐẦU: MODULE VI PHẠM (backend_vi_phạm.gs gốc) =====
// Đã gỡ doGet() riêng + đổi tên PERMISSION_SPREADSHEET_ID/ADMIN_EMAILS thành
// VIOLATION_* để không trùng với module Đơn cần cầu cứu ở trên.
// =========================================================================

/**
 * ==========================================
 * CẤU HÌNH HỆ THỐNG PHÂN QUYỀN & DATA
 * ==========================================
 */
var DATA_SPREADSHEET_ID = '1A0G2B7f-Ab_c1vAR4NrMtspnXDS34lzsi0eoWMAc2q0';       // File chứa sheet 'complaint raw'
var VIOLATION_PERMISSION_SPREADSHEET_ID = '1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA'; // File chứa sheet phân quyền

// Danh sách Email Admin cứng (Nếu muốn cấu hình nhanh không cần qua Sheet)
var VIOLATION_ADMIN_EMAILS = [
  'admin@domain.com',
  'xuan.nguyenthanh01@spxexpress.com'
];
/**
 * Hàm khởi tạo Web App
 */
// [ĐÃ GỠ doGet() RIÊNG — module này giờ nhúng vào SPA chính qua LAZY_MODULES,
// dùng CHUNG duy nhất doGet() của backend.gs chính, không tự phục vụ trang riêng nữa]

/**
 * Helper: Xử lý chuỗi an toàn - Chống triệt để lỗi (reading 'indexOf')
 */
function safeString(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * Helper: Kiểm tra sự tồn tại trong mảng an toàn
 */
function safeIncludes(arr, target) {
  if (!Array.isArray(arr)) return false;
  var targetStr = safeString(target).toLowerCase();
  for (var i = 0; i < arr.length; i++) {
    if (safeString(arr[i]).toLowerCase() === targetStr) {
      return true;
    }
  }
  return false;
}

/**
 * Helper: Tìm vị trí trong mảng tiêu đề an toàn
 */
function safeHeaderIndex(headersArr, headerName) {
  if (!Array.isArray(headersArr)) return -1;
  var searchName = safeString(headerName).toLowerCase();
  for (var i = 0; i < headersArr.length; i++) {
    if (safeString(headersArr[i]).toLowerCase() === searchName) {
      return i;
    }
  }
  return -1;
}

/**
 * 1. Hàm kiểm tra thông tin phân quyền của tài khoản đang đăng nhập
 * Phân quyền 4 cấp: Admin -> AOM -> SUP -> FTE
 */
/**
 * [SỬA — chẩn đoán "Tổng quan tải rất lâu": Vi phạm chiếm 27,8 giây]
 * getUserAccess() trước đây MỞ file quyền và đọc 3 sheet ở MỖI lần gọi, không
 * có bộ nhớ đệm nào. Nay lưu kết quả 5 phút theo email. Quyền rất ít khi đổi
 * trong ngày; thay đổi quyền sẽ có hiệu lực chậm nhất sau 5 phút.
 * Không lưu kết quả lỗi/khách để lỗi tạm thời không bị "đóng băng" 5 phút.
 */
function getUserAccess() {
  var _gaEmail = '';
  try { _gaEmail = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim(); } catch (e) {}
  var _gaKey = _gaEmail ? ('vp_access_v1_' + _gaEmail.replace(/[^a-z0-9]/g, '_')) : '';
  if (_gaKey) {
    try {
      var _gaHit = CacheService.getScriptCache().get(_gaKey);
      if (_gaHit) return JSON.parse(_gaHit);
    } catch (e) {}
  }
  var _gaRes = _getUserAccessUncached_();
  if (_gaKey && _gaRes && _gaRes.role && _gaRes.role !== 'Error' && _gaRes.role !== 'Guest') {
    try { CacheService.getScriptCache().put(_gaKey, JSON.stringify(_gaRes), 300); } catch (e) {}
  }
  return _gaRes;
}

function _getUserAccessUncached_() {
  try {
    var rawEmail = Session.getActiveUser().getEmail();
    var email = safeString(rawEmail).toLowerCase();
    
    if (!email) {
      return { role: 'Guest', allowedHubs: [], viewAll: false, email: 'Guest', displayName: 'Khách' };
    }

    var ss = SpreadsheetApp.openById(VIOLATION_PERMISSION_SPREADSHEET_ID);

    // -------------------------------------------------------------
    // CẤP 0: KIỂM TRA QUYỀN ADMIN (QUẢN TRỊ VIÊN HỆ THỐNG)
    // -------------------------------------------------------------
    
    // Cách 0A: Kiểm tra trong mảng VIOLATION_ADMIN_EMAILS khai báo sẵn
    if (safeIncludes(VIOLATION_ADMIN_EMAILS, email)) {
      return {
        email: email,
        role: 'Admin',
        displayName: 'Quản trị viên',
        allowedHubs: [],
        viewAll: true
      };
    }

    // Cách 0B: Kiểm tra trong Sheet 'Admin' hoặc 'DS Admin' (nếu bạn có tạo sheet này)
    var sheetAdmin = ss.getSheetByName('Admin') || ss.getSheetByName('DS Admin');
    if (sheetAdmin) {
      var dataAdmin = sheetAdmin.getDataRange().getValues();
      if (dataAdmin && dataAdmin.length >= 2) {
        var headersAdmin = dataAdmin[0];
        var adminEmailIdx = findHeaderIdx(headersAdmin, ['Email', 'Mail', 'Username', 'Email Admin']);
        var adminNameIdx = findHeaderIdx(headersAdmin, ['Họ tên', 'Tên', 'Name', 'Display Name']);

        if (adminEmailIdx !== -1) {
          for (var a = 1; a < dataAdmin.length; a++) {
            var aRow = dataAdmin[a];
            if (!aRow) continue;

            var rAdminEmail = safeString(aRow[adminEmailIdx]).toLowerCase();
            if (rAdminEmail === email) {
              var adminDisplayName = adminNameIdx !== -1 && aRow[adminNameIdx] ? safeString(aRow[adminNameIdx]) : 'Quản trị viên';
              return {
                email: email,
                role: 'Admin',
                displayName: adminDisplayName,
                allowedHubs: [],
                viewAll: true
              };
            }
          }
        }
      }
    }

    var allowedHubs = [];
    var isAOM = false;
    var isSUP = false;
    var isFTE = false;
    var aomName = '';
    var supName = '';
    var fteName = '';

    // -------------------------------------------------------------
    // CẤP 1 & 2: KIỂM TRA QUYỀN AOM / SUP TRONG SHEET 'AOM SUP'
    // -------------------------------------------------------------
    var sheetAOM = ss.getSheetByName('AOM SUP');
    if (sheetAOM) {
      var dataAOM = sheetAOM.getDataRange().getValues();
      if (dataAOM && dataAOM.length >= 2) {
        var headersAOM = dataAOM[0];
        var aomIdx = safeHeaderIndex(headersAOM, 'AOM');
        var aomEmailIdx = safeHeaderIndex(headersAOM, 'AOM_Email');
        var supNameIdx = safeHeaderIndex(headersAOM, 'Sup_Name');
        var supEmailIdx = safeHeaderIndex(headersAOM, 'Sup_Email');
        var hubIdx = safeHeaderIndex(headersAOM, 'Hub');

        if (aomEmailIdx !== -1 && supEmailIdx !== -1 && hubIdx !== -1) {
          for (var i = 1; i < dataAOM.length; i++) {
            var row = dataAOM[i];
            if (!row) continue;

            var rAomEmail = safeString(row[aomEmailIdx]).toLowerCase();
            var rSupEmail = safeString(row[supEmailIdx]).toLowerCase();
            var rHub = safeString(row[hubIdx]);

            if (!rHub) continue;

            if (rAomEmail === email) {
              isAOM = true;
              if (aomIdx !== -1 && row[aomIdx]) aomName = safeString(row[aomIdx]);
              if (!safeIncludes(allowedHubs, rHub)) allowedHubs.push(rHub);
            }
            
            if (rSupEmail === email) {
              isSUP = true;
              if (supNameIdx !== -1 && row[supNameIdx]) supName = safeString(row[supNameIdx]);
              if (!safeIncludes(allowedHubs, rHub)) allowedHubs.push(rHub);
            }
          }
        }
      }
    }

    // -------------------------------------------------------------
    // CẤP 3: KIỂM TRA QUYỀN FTE (NHÂN VIÊN) TRONG SHEET 'DS Nhân viên'
    // -------------------------------------------------------------
    if (!isAOM && !isSUP) {
      var sheetFTE = ss.getSheetByName('DS Nhân viên');
      if (sheetFTE) {
        var dataFTE = sheetFTE.getDataRange().getValues();
        if (dataFTE && dataFTE.length >= 2) {
          var headersFTE = dataFTE[0];
          
          var fteEmailIdx = findHeaderIdx(headersFTE, ['Email', 'Mail', 'Email_NV', 'Email nhân viên', 'Username']);
          var stationIdx = findHeaderIdx(headersFTE, ['Nơi làm việc', 'Station', 'Trạm', 'Hub', 'Kho', 'Bưu cục']);
          var nameIdx = findHeaderIdx(headersFTE, ['Họ tên', 'Họ và tên', 'Tên nhân viên', 'Name', 'họ tên']);

          if (fteEmailIdx !== -1 && stationIdx !== -1) {
            for (var j = 1; j < dataFTE.length; j++) {
              var fRow = dataFTE[j];
              if (!fRow) continue;

              var rFteEmail = safeString(fRow[fteEmailIdx]).toLowerCase();
              var rStation = safeString(fRow[stationIdx]);

              if (rFteEmail && rFteEmail.indexOf('@') === -1 && email.indexOf('@') !== -1) {
                var domain = email.split('@')[1];
                rFteEmail = rFteEmail + '@' + domain;
              }

              if (rFteEmail === email && rStation) {
                isFTE = true;
                if (nameIdx !== -1 && fRow[nameIdx]) fteName = safeString(fRow[nameIdx]);
                if (!safeIncludes(allowedHubs, rStation)) {
                  allowedHubs.push(rStation);
                }
              }
            }
          }
        }
      }
    }

    // Thiết lập Vai trò & Tên hiển thị cuối cùng
    var role = 'Staff';
    var displayName = 'Nhân viên';
    var viewAll = false;

    if (isAOM) {
      role = 'AOM';
      displayName = aomName || 'Quản lý AOM';
    } else if (isSUP) {
      role = 'SUP';
      displayName = supName || 'Giám sát SUP';
    } else if (isFTE) {
      role = 'FTE';
      displayName = fteName || 'Nhân viên trạm';
    } else {
      // Mặc định các tài khoản không nằm trong bất kỳ danh sách nào ở trên sẽ là Admin (Xem toàn quốc)
      viewAll = true; 
      role = 'Admin';
      displayName = 'Quản trị viên';
    }

    return {
      email: email,
      role: role,
      displayName: displayName,
      allowedHubs: allowedHubs,
      viewAll: viewAll
    };

  } catch (e) {
    return { role: 'Error', error: 'Lỗi phân quyền hệ thống: ' + e.toString(), email: 'Unknown' };
  }
}

/**
 * Hàm tìm vị trí cột linh hoạt dựa trên danh sách tiêu đề khớp
 */
function findHeaderIdx(headers, aliases) {
  if (!Array.isArray(headers) || !Array.isArray(aliases)) return -1;
  for (var i = 0; i < headers.length; i++) {
    var h = safeString(headers[i]).toLowerCase();
    for (var j = 0; j < aliases.length; j++) {
      if (h === safeString(aliases[j]).toLowerCase()) return i;
    }
  }
  return -1;
}

/**
 * ==========================================
 * CACHE LỚP DỮ LIỆU THÔ (CHƯA LỌC PHÂN QUYỀN)
 * ==========================================
 * Mục đích: Tránh việc MỖI request (mỗi user, mỗi lần load trang) đều phải
 * đọc lại toàn bộ sheet 'complaint raw' (17.000+ dòng) rồi build lại object.
 * Cache dữ liệu THÔ (chưa lọc theo hub) trong ScriptCache, dùng chung cho mọi user,
 * việc lọc theo quyền (allowedHubs) vẫn luôn thực hiện lại mỗi request để đảm bảo
 * không lộ dữ liệu sai quyền.
 * TTL ngắn (mặc định 3 phút) để cân bằng giữa tốc độ tải và độ mới dữ liệu.
 * Nút "Đồng bộ lại" trên UI gọi forceRefresh=true để luôn lấy dữ liệu mới nhất.
 */
var COMPLAINT_CACHE_PREFIX = 'complaint_raw_v3_'; // v3: bỏ dòng trùng hoàn toàn (v2: thêm case_create_time)
// [SỬA — chẩn đoán Tổng quan chậm] 3 phút -> 10 phút. Mỗi lần hết hạn phải đọc
// lại toàn bộ sheet 'complaint raw' (~20.000 dòng, đo được ~27 giây).
var COMPLAINT_CACHE_TTL_SECONDS = 600; // 10 phút
// [SỬA] Giới hạn 100KB tính theo BYTE, không phải ký tự. Tiếng Việt có dấu
// chiếm 2-3 byte/ký tự: đo mẫu thật khúc 90.000 ký tự = 96.638 byte, SÁT NÚT
// 102.400. Giảm còn 45.000 để luôn dư biên an toàn.
var COMPLAINT_CACHE_CHUNK_SIZE = 45000;

/**
 * 2. Hàm lấy và lọc dữ liệu Khiếu nại từ backend (Đã qua bộ lọc phân quyền & Bổ sung ticket_no, data_source)
 * @param {boolean} forceRefresh - Nếu true, bỏ qua cache và đọc trực tiếp từ Sheet.
 */
function getComplaintData(forceRefresh) {
  try {
    var access = getUserAccess();
    // [MỚI — theo quyết định trực tiếp "chỉ tính khi thực sự tải dữ liệu"]
    if (access.role === 'Error') {
      return { error: access.error };
    }

    var rows = getAllComplaintRowsRaw_(!!forceRefresh);
    if (rows && rows.error) {
      return rows; // Lỗi đọc Sheet (không tìm thấy sheet, dữ liệu trống...)
    }

    // Admin / viewAll: trả toàn bộ, không cần lọc lại
    if (access.viewAll) {
      return rows;
    }

    // Lọc theo phân quyền hub của user hiện tại
    var filtered = [];
    for (var i = 0; i < rows.length; i++) {
      if (safeIncludes(access.allowedHubs, rows[i].station_name)) {
        filtered.push(rows[i]);
      }
    }
    return filtered;
  } catch (e) {
    return { error: 'Lỗi Backend khi lấy dữ liệu: ' + e.toString() };
  }
}

/**
 * Đọc toàn bộ dữ liệu 'complaint raw' (CHƯA lọc phân quyền), có cache.
 */
// [BẢO MẬT] Đổi tên có hậu tố "_" — theo quy ước Apps Script, hàm kết thúc
// bằng dấu gạch dưới KHÔNG thể gọi từ client qua google.script.run. Trước đây
// hàm này trả về TOÀN BỘ dữ liệu vi phạm của MỌI trạm mà không lọc quyền, và
// bất kỳ user đã đăng nhập nào cũng gọi thẳng được -> rò rỉ dữ liệu liên trạm.
// Đã kiểm: chỉ getComplaintData() (đã lọc quyền) gọi, frontend KHÔNG dùng.
function getAllComplaintRowsRaw_(forceRefresh) {
  var cache = CacheService.getScriptCache();

  if (!forceRefresh) {
    var cached = readComplaintCache(cache);
    if (cached !== null && !_spxComplaintRawStale_(cache)) return cached;
  }
  var _stampBeforeRead = _spxSrcStamp_(DATA_SPREADSHEET_ID);   // lấy mốc TRƯỚC khi đọc để không bỏ sót thay đổi xảy ra giữa chừng

  var ss = SpreadsheetApp.openById(DATA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName('complaint raw');

  if (!sheet) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var sName = safeString(sheets[i].getName()).toLowerCase();
      if (sName.indexOf('complaint') !== -1) {
        sheet = sheets[i];
        break;
      }
    }
  }

  if (!sheet) {
    return { error: 'Không tìm thấy sheet chứa từ khóa "complaint" trên cơ sở dữ liệu.' };
  }

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { error: 'Dữ liệu trống hoặc chỉ có tiêu đề cột.' };
  }

  var headers = data[0];
  var colMap = {};
  for (var col = 0; col < headers.length; col++) {
    colMap[safeString(headers[col])] = col;
  }

  // Thiết lập trước chỉ số cột của các trường dữ liệu
  var keys = {
    case_create_date: findColIdx(colMap, ['case_create_date', 'Ngày tạo', 'Created Date']),
    case_create_time: findColIdx(colMap, ['case_create_time', 'Giờ tạo', 'Created Time']),
    case_id: findColIdx(colMap, ['case_id', 'Mã vụ việc', 'Case ID']),
    aom: findColIdx(colMap, ['aom', 'AOM', 'Quản lý']),
    station_name: findColIdx(colMap, ['station_name', 'Tên bưu cục', 'Station Name', 'station']),
    level1_case_category_name: findColIdx(colMap, ['level1_case_category_name', 'Phân loại Cấp 1', 'Level 1']),
    level2_case_category_name: findColIdx(colMap, ['level2_case_category_name', 'Phân loại Cấp 2', 'Level 2']),
    level3_case_category_name: findColIdx(colMap, ['level3_case_category_name', 'Phân loại Cấp 3', 'Level 3']),
    mapping_reason: findColIdx(colMap, ['mapping_reason', 'Lý do chi tiết', 'Reason']),
    order_shipping_id: findColIdx(colMap, ['order_shipping_id', 'Mã vận đơn', 'Shipping ID', 'order_id']),
    driver_id: findColIdx(colMap, ['driver_id', 'Mã tài xế', 'Driver ID', 'driver_id']),
    driver_name: findColIdx(colMap, ['driver_name', 'Tên tài xế', 'Driver Name', 'driver_name']),
    month: findColIdx(colMap, ['month', 'Month']),
    week: findColIdx(colMap, ['week', 'Week']),
    order_type: findColIdx(colMap, ['order_type', 'Order Type']),
    payment_method: findColIdx(colMap, ['payment_method', 'Payment Method']),
    is_actual_drop_off: findColIdx(colMap, ['is_actual_drop_off']),
    map_channel: findColIdx(colMap, ['map_channel']),
    last_onhold_reason: findColIdx(colMap, ['last_onhold_reason', 'Lý do hoãn cuối', 'Lý do hoãn']),
    // --- HAI CỘT MỚI BỔ SUNG ---
    ticket_no: findColIdx(colMap, ['ticket_no', 'Mã ticket', 'Ticket No', 'Ticket', 'ticket_id']),
    data_source: findColIdx(colMap, ['data_source', 'Nguồn dữ liệu', 'Data Source', 'Source', 'Nguồn'])
  };

  var rows = [];
  var _seenRows = {}, _dupRows = 0;
  for (var i = 1; i < data.length; i++) {
    var rowData = data[i];
    if (!rowData) continue;

    var obj = {};
    obj.case_create_date = formatGasDate(getDirectVal(rowData, keys.case_create_date));
    obj.case_create_time = formatGasDateTime(getDirectVal(rowData, keys.case_create_time));
    obj.case_id = getDirectVal(rowData, keys.case_id);
    obj.aom = getDirectVal(rowData, keys.aom);
    obj.station_name = safeString(getDirectVal(rowData, keys.station_name));
    obj.level1_case_category_name = getDirectVal(rowData, keys.level1_case_category_name);
    obj.level2_case_category_name = getDirectVal(rowData, keys.level2_case_category_name);
    obj.level3_case_category_name = getDirectVal(rowData, keys.level3_case_category_name);
    obj.mapping_reason = getDirectVal(rowData, keys.mapping_reason);
    obj.order_shipping_id = getDirectVal(rowData, keys.order_shipping_id);
    obj.driver_id = getDirectVal(rowData, keys.driver_id);
    obj.driver_name = getDirectVal(rowData, keys.driver_name);
    obj.month = getDirectVal(rowData, keys.month);
    obj.week = getDirectVal(rowData, keys.week);
    obj.order_type = getDirectVal(rowData, keys.order_type);
    obj.payment_method = getDirectVal(rowData, keys.payment_method);
    obj.is_actual_drop_off = getDirectVal(rowData, keys.is_actual_drop_off);
    obj.map_channel = getDirectVal(rowData, keys.map_channel);
    obj.last_onhold_reason = getDirectVal(rowData, keys.last_onhold_reason);
    // --- HAI CỘT MỚI BỔ SUNG ---
    obj.ticket_no = getDirectVal(rowData, keys.ticket_no);
    obj.data_source = getDirectVal(rowData, keys.data_source);

    // [MỚI] Bỏ dòng TRÙNG HOÀN TOÀN (mọi trường giống hệt): file nguồn có 272 dòng như vậy (576 dòng lặp riêng ngày
    // 25/06, nghi dán 2 lần) làm đếm vi phạm dư. Chỉ bỏ khi GIỐNG HỆT MỌI TRƯỜNG — cùng case_id nhưng khác ticket_no
    // hay data_source là các dòng hợp lệ khác nhau nên được giữ.
    var _dk = '';
    for (var _f in obj) { _dk += String(obj[_f] == null ? '' : obj[_f]) + '\u0001'; }
    if (_seenRows[_dk]) { _dupRows++; continue; }
    _seenRows[_dk] = 1;
    rows.push(obj);
  }

  // Lưu vào cache để các request tiếp theo (trong TTL) không cần đọc lại Sheet
  try {
    writeComplaintCache(cache, rows);
    try { cache.put(COMPLAINT_CACHE_PREFIX + 'stamp', String(_stampBeforeRead), COMPLAINT_CACHE_TTL_SECONDS); } catch (eSt) {}
  } catch (e) {
    // Ghi cache lỗi (vượt quota, v.v.) không được phép làm hỏng luồng chính
  }

  return rows;
}

/**
 * [MỚI 2026-10-24] Cache dữ liệu thô vi phạm còn hạn nhưng FILE NGUỒN đã được sửa -> coi là cũ, đọc lại.
 * Chỉ xét khi cache đã tồn tại >= 60 giây (file bị sửa liên tục không làm đọc lại 20.000 dòng mỗi lượt).
 * Không biết mốc cũ/không đọc được mốc mới -> giữ hành vi cũ (theo TTL).
 */
function _spxComplaintRawStale_(cache) {
  try {
    var metaStr = cache.get(COMPLAINT_CACHE_PREFIX + 'meta');
    var meta = metaStr ? JSON.parse(metaStr) : null;
    var ts = meta ? Number(meta.ts) || 0 : 0;
    if (!ts || (Date.now() - ts) < 60000) return false;
    var saved = cache.get(COMPLAINT_CACHE_PREFIX + 'stamp');
    if (!saved) return false;
    var cur = _spxSrcStamp_(DATA_SPREADSHEET_ID);
    return cur !== '0' && saved !== cur;
  } catch (e) { return false; }
}

/**
 * Đọc dữ liệu đã cache (dạng chunk), trả về null nếu cache miss hoặc không toàn vẹn.
 */
function readComplaintCache(cache) {
  try {
    var meta = cache.get(COMPLAINT_CACHE_PREFIX + 'meta');
    if (!meta) return null;

    var metaObj = JSON.parse(meta);
    var chunkCount = metaObj.chunks;
    if (!chunkCount || chunkCount <= 0) return null;

    var keysArr = [];
    for (var i = 0; i < chunkCount; i++) keysArr.push(COMPLAINT_CACHE_PREFIX + 'c' + i);

    var chunksMap = cache.getAll(keysArr);
    var full = '';
    for (var j = 0; j < chunkCount; j++) {
      var part = chunksMap[COMPLAINT_CACHE_PREFIX + 'c' + j];
      if (part === undefined || part === null) return null; // thiếu chunk -> cache miss an toàn
      full += part;
    }
    return JSON.parse(full);
  } catch (e) {
    return null; // Bất kỳ lỗi nào khi đọc cache -> coi như cache miss, không chặn luồng chính
  }
}

/**
 * Ghi dữ liệu vào cache dạng chunk (mỗi entry CacheService giới hạn ~100KB).
 */
function writeComplaintCache(cache, rows) {
  var json = JSON.stringify(rows);
  var chunks = [];
  for (var i = 0; i < json.length; i += COMPLAINT_CACHE_CHUNK_SIZE) {
    chunks.push(json.substring(i, i + COMPLAINT_CACHE_CHUNK_SIZE));
  }

  var payload = {};
  for (var c = 0; c < chunks.length; c++) {
    payload[COMPLAINT_CACHE_PREFIX + 'c' + c] = chunks[c];
  }
  cache.putAll(payload, COMPLAINT_CACHE_TTL_SECONDS);
  cache.put(COMPLAINT_CACHE_PREFIX + 'meta', JSON.stringify({ chunks: chunks.length, ts: new Date().getTime() }), COMPLAINT_CACHE_TTL_SECONDS);
}


/**
 * ==========================================
 * CÁC HÀM BỔ TRỢ ĐỂ TỐI ƯU HIỆU NĂNG
 * ==========================================
 */

function findColIdx(colMap, aliasList) {
  if (!colMap || !Array.isArray(aliasList)) return -1;
  for (var i = 0; i < aliasList.length; i++) {
    var idx = colMap[aliasList[i]];
    if (idx !== undefined && idx !== null) return idx;
  }
  return -1;
}

function getDirectVal(rowData, idx) {
  if (idx === -1 || !rowData || rowData[idx] === undefined || rowData[idx] === null) return '';
  return rowData[idx];
}

// [MỚI] Ngày + giờ ('yyyy-MM-dd HH:mm:ss') — để giao diện xếp ĐÚNG thứ tự trong cùng một ngày.
function formatGasDateTime(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, SPX_TZ, "yyyy-MM-dd HH:mm:ss");
  }
  return safeString(v);
}

function formatGasDate(dateVal) {
  if (!dateVal) return '';
  if (dateVal instanceof Date) {
    return Utilities.formatDate(dateVal, SPX_TZ, "yyyy-MM-dd");
  }
  return safeString(dateVal);
}

// [ĐÃ XOÁ — getRawData(), xác nhận qua grep toàn bộ dự án + đối chiếu danh sách
// 12 Trigger thật đang cài đặt (Apps Script Editor > Triggers) — không có tên
// nào trùng, không phải trigger handler, không còn ai gọi]
// ===== KẾT THÚC MODULE VI PHẠM =====