/**
 * ============================================================
 * FlmKpi_Backend.gs  — [MỚI 2026-10] Lớp dữ liệu cho "Fail KPI Order" (REQ-001)
 * ------------------------------------------------------------
 * NGUỒN (4 Google Sheet tổng hợp theo Hub-ngày, mỗi file có sheet `raw` = lịch sử,
 * `auto` = nguồn tự động mới nhất, `infor` = bảng tổ chức Hub → Tỉnh → AOM → SUP):
 *   FM  : Ontime Firstmile 26   → % FM Ontime   = #FM Ontime / #FM Total
 *   LM  : Ontime Lastmile 26    → % LM Ontime   = #LM Ontime / #LM Total
 *   SOP : Pickup SOP 26         → Wrong SOP     = #Wrong PU / (#Correct PU + #Wrong PU)
 *   SUC : success 2026          → % Giao thành công = #Deli Vol / #Assigned Vol ; Shipment volume = #Assigned Vol
 *
 * QUY TẮC GHÉP NGUỒN (đã kiểm chứng trên dữ liệu thật):
 *   - `auto` được ưu tiên cho mọi Hub-ngày mà nó có; `raw` chỉ bù cho Hub-ngày `auto` không có
 *     (lịch sử trước ngày bắt đầu của `auto`, hoặc Hub thiếu). Lý do: `raw` có nhiều dòng trùng
 *     (cùng Hub-ngày, giá trị cập nhật dần) và nhiều ngày thấp hơn `auto`.
 *   - Trong `raw`, nhiều dòng cùng Hub-ngày → DÒNG SAU CÙNG thắng (lượt cập nhật mới nhất).
 *   - Mẫu số = 0 hoặc rỗng → không tính (KHÔNG coi là 0%).
 *   - Tổ chức (AOM/SUP/Tỉnh) lấy từ sheet `infor` hiện hành; Hub chưa có trong `infor` dùng AOM/SUP
 *     đọc được ở dòng `raw` gần nhất; vẫn thiếu → "Chưa phân AOM/SUP".
 *
 * LUỒNG: trigger (spxDispatcher30Min) gọi flm_kpi_refreshIfDue_() → chỉ đọc "vân tay" nhẹ của
 * 4 nguồn, CHỈ dựng lại khi nguồn đổi (hoặc quá 20 giờ) → ghi snapshot (sheet ping-pong A/B +
 * cache chia khúc). User gọi flm_getKpiBundle() chỉ đọc snapshot đã có, lọc theo quyền.
 * ============================================================
 */

var FLM_KPI_SOURCES = {
  FM:  { id: '165jUNnhGyDJSKH-7PdhNgdVodH1hAQUormcQCdk3Od4', label: 'Ontime Firstmile 26' },
  LM:  { id: '1YpXUejggfaZn5_hTptJyoWxLt9Za_feR2Sw0vYV_YXQ', label: 'Ontime Lastmile 26' },
  SOP: { id: '1Iw0G40JOJ4BaPQa2Z48CqYlFabhUbdSDurd6eW3KPxw', label: 'Pickup SOP 26' },
  SUC: { id: '17ncpByVUzvRWx1IPjcO7kSq0GdsCWfGFaXEam0RwtHQ', label: 'success 2026' }
};
var FLM_KPI_ORG_SOURCE = 'LM';          // file chứa sheet `infor` dùng làm bảng tổ chức
var FLM_KPI_ORG_SHEET  = 'infor';
var FLM_KPI_TARGETS    = { fm: 0.99, lm: 0.99, sopMax: 0.005 };   // mục tiêu: FM/LM đúng hạn 99%, Sai SOP ≤ 0,5% — đổi tại đây

// Vị trí 8 số trong mỗi mảng Hub-kỳ: [fmN, fmD, lmN, lmD, sopW, sopD, sucN, sucD]
var FLM_KPI_SLOTS = 8;
var FLM_KPI_WINDOW = { days: 31, weeks: 14, months: 12 };

var FLM_KPI_SNAP_SHEET = 'FLM_KPI_Snapshot';
var FLM_KPI_PROP_SLOT  = 'flm_kpi_snap_slot';
var FLM_KPI_PROP_META  = 'flm_kpi_snap_meta';
var FLM_KPI_PROP_ERR   = 'flm_kpi_last_err';
var FLM_KPI_CACHE_NS   = 'ANALYTICS';
var FLM_KPI_CACHE_KEY  = 'flm_kpi_snap_v1';
var FLM_KPI_CACHE_TTL  = 600;
var FLM_KPI_REBUILD_MAX_AGE_MS = 20 * 3600 * 1000;
var FLM_KPI_CELL_CHUNK = 45000;
var FLM_KPI_MAX_JSON   = 4000000;

// Tiêu đề cột (đã chuẩn hoá thường, bỏ khoảng trắng thừa) — dò theo TÊN để chịu được việc đổi vị trí cột.
var FLM_KPI_SPEC = {
  FM:  { raw:  { date: ['date'], hub: ['station_name', 'station name'], n: ['#fm_ontime'], d: ['#fm_total'], prov: ['province'], aom: ['aom'], sup: ['sup'] },
         auto: { date: ['date'], hub: ['station name'], n: ['#fm ontime'], d: ['#fm total'] } },
  LM:  { raw:  { date: ['date'], hub: ['station name', 'station_name'], n: ['#lm ontime'], d: ['#lm total'], prov: ['pro', 'province'], aom: ['aom'], sup: ['sup'] },
         auto: { date: ['date'], hub: ['station name'], n: ['#lm ontime'], d: ['#lm total'] } },
  SOP: { raw:  { date: ['date'], hub: ['station name', 'station_name'], c: ['#correct pu'], d: ['#total'], prov: ['pro', 'province'], aom: ['aom'], sup: ['sup'] },
         auto: { date: ['date'], hub: ['station name'], c: ['#correct pu'], w: ['#wrong pu'] } },
  SUC: { raw:  { date: ['delivering_date', 'date'], hub: ['station_name', 'station name'], n: ['delivered'], d: ['assign'], prov: ['province', 'pro'], aom: ['aom'], sup: ['sup'] },
         auto: { date: ['date'], hub: ['station name'], n: ['#deli vol'], d: ['#assigned vol'] } }
};

// ───────────────────────── tiện ích thuần (không gọi dịch vụ Google) ─────────────────────────
function _flmKpi_norm_(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
function _flmKpi_hubKey_(s) { return _flmKpi_norm_(s); }
function _flmKpi_num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null || v === '') return null;
  var n = Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}
function _flmKpi_round_(x) { return Math.round(x * 10) / 10; }

/** Chuẩn hoá ô ngày (Date / chuỗi ISO, dd/MM/yyyy / serial) → 'yyyy-MM-dd' theo múi giờ dự án. */
function _flmKpi_dateStr_(v) {
  var d = null;
  if (v instanceof Date) { d = v; }
  else if (typeof v === 'string' && v.trim()) {
    var s = v.trim(), m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    else {
      m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
      if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    }
  } else if (typeof v === 'number' && v > 30000 && v < 80000) {
    d = new Date(new Date(1899, 11, 30).getTime() + Math.round(v * 86400000));
  }
  if (!d || isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, SPX_TZ, 'yyyy-MM-dd');
}

/** Tìm chỉ số cột theo danh sách tên ứng viên; trả -1 nếu không có. */
function _flmKpi_col_(hdrNorm, cands) {
  for (var i = 0; i < cands.length; i++) {
    var ix = hdrNorm.indexOf(cands[i]);
    if (ix >= 0) return ix;
  }
  return -1;
}

/** Ngày dương lịch (chuỗi) cộng/trừ n ngày — không phụ thuộc múi giờ máy. */
function _flmKpi_addDays_(ds, n) {
  var p = ds.split('-'), t = Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) + n * 86400000;
  var d = new Date(t);
  var mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
}
/** Khoá tuần ISO 'YYYY-Www' (thứ Hai là ngày đầu tuần) — khớp cột `week` trong nguồn. */
function _flmKpi_isoWeek_(ds) {
  var p = ds.split('-'), d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  var dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var wk = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + '-W' + (wk < 10 ? '0' : '') + wk;
}
function _flmKpi_monthKey_(ds) { return ds.substr(5, 2) + '-' + ds.substr(0, 4); }   // 'MM-YYYY' khớp cột `month`

// ───────────────────────── đọc 1 nguồn ─────────────────────────
/**
 * Đọc sheet `raw` + `auto` của 1 nguồn → map Hub-ngày.
 * @return { map: {'hubKey|yyyy-MM-dd': [a,b]}, hubName: {hubKey: tên gốc}, org: {hubKey:{p,a,s}},
 *           autoStart, rawRows, autoRows, dupDropped, autoOverride }
 *   a,b theo metric: FM/LM/SUC → [tử, mẫu]; SOP → [sai, tổng]
 */
function _flmKpi_parseSource_(key, rawValues, autoValues) {
  var spec = FLM_KPI_SPEC[key];
  var out = { map: {}, hubName: {}, org: {}, autoStart: null, rawRows: 0, autoRows: 0, dupDropped: 0, autoOverride: 0 };

  function idxOf(values, sp, required) {
    if (!values || !values.length) return null;
    var hdr = values[0].map(_flmKpi_norm_), ix = {}, miss = [];
    Object.keys(sp).forEach(function (f) {
      ix[f] = _flmKpi_col_(hdr, sp[f]);
      if (ix[f] < 0 && required.indexOf(f) >= 0) miss.push(f + ' (' + sp[f].join('|') + ')');
    });
    if (miss.length) throw new Error('Nguồn ' + key + ': không thấy cột ' + miss.join(', ') + '. Tiêu đề hiện có: ' + values[0].join(' | '));
    return ix;
  }

  // 1) raw — dòng sau cùng thắng
  var rawMap = {};
  var ri = idxOf(rawValues, spec.raw, key === 'SOP' ? ['date', 'hub', 'c', 'd'] : ['date', 'hub', 'n', 'd']);
  if (ri) {
    for (var i = 1; i < rawValues.length; i++) {
      var r = rawValues[i];
      var ds = _flmKpi_dateStr_(r[ri.date]); var hub = r[ri.hub] == null ? '' : String(r[ri.hub]).trim();
      if (!ds || !hub) continue;
      var hk = _flmKpi_hubKey_(hub), k = hk + '|' + ds, a, b;
      if (key === 'SOP') {
        var c = _flmKpi_num_(r[ri.c]), t = _flmKpi_num_(r[ri.d]);
        if (c == null || t == null) continue;
        a = Math.max(0, t - c); b = t;
      } else {
        a = _flmKpi_num_(r[ri.n]); b = _flmKpi_num_(r[ri.d]);
        if (a == null || b == null) continue;
      }
      out.rawRows++;
      if (rawMap[k]) out.dupDropped++;
      rawMap[k] = [a, b];
      if (!out.hubName[hk]) out.hubName[hk] = hub;
      var oa = ri.aom >= 0 ? String(r[ri.aom] == null ? '' : r[ri.aom]).trim() : '';
      if (oa) out.org[hk] = { p: ri.prov >= 0 ? String(r[ri.prov] == null ? '' : r[ri.prov]).trim() : '', a: oa, s: ri.sup >= 0 ? String(r[ri.sup] == null ? '' : r[ri.sup]).trim() : '' };
    }
  }

  // 2) auto — ưu tiên
  var autoMap = {};
  var ai = idxOf(autoValues, spec.auto, key === 'SOP' ? ['date', 'hub', 'c', 'w'] : ['date', 'hub', 'n', 'd']);
  if (ai) {
    for (var j = 1; j < autoValues.length; j++) {
      var q = autoValues[j];
      var ds2 = _flmKpi_dateStr_(q[ai.date]); var hub2 = q[ai.hub] == null ? '' : String(q[ai.hub]).trim();
      if (!ds2 || !hub2) continue;
      var hk2 = _flmKpi_hubKey_(hub2), k2 = hk2 + '|' + ds2, a2, b2;
      if (key === 'SOP') {
        var c2 = _flmKpi_num_(q[ai.c]), w2 = _flmKpi_num_(q[ai.w]);
        if (c2 == null || w2 == null) continue;
        a2 = w2; b2 = c2 + w2;
      } else {
        a2 = _flmKpi_num_(q[ai.n]); b2 = _flmKpi_num_(q[ai.d]);
        if (a2 == null || b2 == null) continue;
      }
      out.autoRows++;
      autoMap[k2] = [a2, b2];
      if (!out.hubName[hk2]) out.hubName[hk2] = hub2;
      if (out.autoStart == null || ds2 < out.autoStart) out.autoStart = ds2;
    }
  }

  // 3) hợp nhất: raw trước, auto đè lên
  var map = {};
  Object.keys(rawMap).forEach(function (k) { map[k] = rawMap[k]; });
  Object.keys(autoMap).forEach(function (k) { if (map[k]) out.autoOverride++; map[k] = autoMap[k]; });
  out.map = map;
  return out;
}

/** Ngày mới nhất mà số Hub báo cáo đạt ≥ 40% trung vị của 14 ngày gần nhất (tránh ngày cuối mới về một phần). */
function _flmKpi_lastFullDate_(map) {
  var perDate = {};
  Object.keys(map).forEach(function (k) {
    var ds = k.substr(k.lastIndexOf('|') + 1);
    if (map[k][1] > 0) perDate[ds] = (perDate[ds] || 0) + 1;
  });
  var dates = Object.keys(perDate).sort();
  if (!dates.length) return null;
  var recent = dates.slice(-14).map(function (d) { return perDate[d]; }).sort(function (x, y) { return x - y; });
  var med = recent[Math.floor(recent.length / 2)];
  for (var i = dates.length - 1; i >= 0; i--) if (perDate[dates[i]] >= 0.4 * med) return dates[i];
  return dates[dates.length - 1];
}

/**
 * Dựng snapshot từ dữ liệu 4 nguồn đã đọc (hàm THUẦN — kiểm thử được ngoài Apps Script).
 * @param sources { FM:{raw,auto}, LM:{raw,auto}, SOP:{raw,auto}, SUC:{raw,auto} } (mảng 2 chiều gồm dòng tiêu đề)
 * @param orgValues mảng 2 chiều của sheet `infor` (có tiêu đề)
 */
function _flmKpi_buildFromValues_(sources, orgValues, nowMs) {
  var parsed = {}, slotOf = { FM: 0, LM: 2, SOP: 4, SUC: 6 };
  var stats = {};
  Object.keys(FLM_KPI_SOURCES).forEach(function (key) {
    parsed[key] = _flmKpi_parseSource_(key, sources[key].raw, sources[key].auto);
    stats[key] = {
      rawRows: parsed[key].rawRows, autoRows: parsed[key].autoRows, dupDropped: parsed[key].dupDropped,
      autoStart: parsed[key].autoStart, autoOverride: parsed[key].autoOverride,
      lastDate: _flmKpi_lastFullDate_(parsed[key].map)
    };
  });

  // asOf = ngày đầy đủ mới nhất trong các nguồn
  var asOf = null;
  Object.keys(stats).forEach(function (k) { if (stats[k].lastDate && (!asOf || stats[k].lastDate > asOf)) asOf = stats[k].lastDate; });
  if (!asOf) throw new Error('Không đọc được ngày dữ liệu nào từ 4 nguồn KPI.');

  // bảng tổ chức
  var org = {}, orgDup = 0;
  if (orgValues && orgValues.length) {
    var oh = orgValues[0].map(_flmKpi_norm_);
    var ci = { p: _flmKpi_col_(oh, ['provinces', 'province']), a: _flmKpi_col_(oh, ['aom']), s: _flmKpi_col_(oh, ['sup_name', 'sup']), h: _flmKpi_col_(oh, ['hub']) };
    if (ci.h < 0 || ci.a < 0) throw new Error("Sheet 'infor': thiếu cột Hub/AOM. Tiêu đề hiện có: " + orgValues[0].join(' | '));
    for (var i = 1; i < orgValues.length; i++) {
      var r = orgValues[i], hub = r[ci.h] == null ? '' : String(r[ci.h]).trim();
      if (!hub || !/hub|soc/i.test(hub)) continue;
      var hk = _flmKpi_hubKey_(hub);
      if (org[hk]) { orgDup++; continue; }     // dòng đầu tiên của Hub thắng
      org[hk] = { p: ci.p >= 0 ? String(r[ci.p] == null ? '' : r[ci.p]).trim() : '', a: String(r[ci.a] == null ? '' : r[ci.a]).trim(), s: ci.s >= 0 ? String(r[ci.s] == null ? '' : r[ci.s]).trim() : '' };
    }
  }

  // cửa sổ thời gian
  var days = [];
  for (var d = FLM_KPI_WINDOW.days - 1; d >= 0; d--) days.push(_flmKpi_addDays_(asOf, -d));
  var dayIdx = {}; days.forEach(function (x, ix) { dayIdx[x] = ix; });
  var weeks = [], wSeen = {};
  for (var d2 = (FLM_KPI_WINDOW.weeks + 1) * 7; d2 >= 0; d2--) { var wk = _flmKpi_isoWeek_(_flmKpi_addDays_(asOf, -d2)); if (!wSeen[wk]) { wSeen[wk] = 1; weeks.push(wk); } }
  weeks = weeks.slice(-FLM_KPI_WINDOW.weeks);
  var wIdx = {}; weeks.forEach(function (x, ix) { wIdx[x] = ix; });
  var months = [], mSeen = {};
  for (var d3 = 400; d3 >= 0; d3--) { var mk = _flmKpi_monthKey_(_flmKpi_addDays_(asOf, -d3)); if (!mSeen[mk]) { mSeen[mk] = 1; months.push(mk); } }
  months = months.slice(-FLM_KPI_WINDOW.months);
  var mIdx = {}; months.forEach(function (x, ix) { mIdx[x] = ix; });

  // tổng hợp theo Hub × kỳ
  var hubs = {};   // hubKey → { name, d:[], w:[], m:[] }
  function ensure(hk, nameHint) {
    var h = hubs[hk];
    if (!h) {
      h = hubs[hk] = { name: nameHint, d: [], w: [], m: [] };
      for (var a = 0; a < days.length; a++) h.d.push(null);
      for (var b = 0; b < weeks.length; b++) h.w.push(null);
      for (var c = 0; c < months.length; c++) h.m.push(null);
    }
    return h;
  }
  function add(arr, idx, slot, a, b) {
    var cell = arr[idx];
    if (!cell) { cell = arr[idx] = [0, 0, 0, 0, 0, 0, 0, 0]; }
    cell[slot] += a; cell[slot + 1] += b;
  }
  Object.keys(parsed).forEach(function (key) {
    var map = parsed[key].map, slot = slotOf[key];
    Object.keys(map).forEach(function (k) {
      var cut = k.lastIndexOf('|'), hk = k.substr(0, cut), ds = k.substr(cut + 1);
      var mi = mIdx[_flmKpi_monthKey_(ds)];
      if (mi === undefined) return;                       // ngoài cửa sổ 12 tháng
      var v = map[k];
      var h = ensure(hk, parsed[key].hubName[hk] || hk);
      add(h.m, mi, slot, v[0], v[1]);
      var wi = wIdx[_flmKpi_isoWeek_(ds)]; if (wi !== undefined) add(h.w, wi, slot, v[0], v[1]);
      var di = dayIdx[ds]; if (di !== undefined) add(h.d, di, slot, v[0], v[1]);
    });
  });

  // gắn tổ chức + làm tròn
  var orphan = 0, outHubs = [];
  Object.keys(hubs).sort().forEach(function (hk) {
    var h = hubs[hk], o = org[hk];
    if (!o) {
      for (var key in parsed) { if (parsed[key].org[hk]) { o = parsed[key].org[hk]; break; } }
    }
    if (!o || !o.a) { orphan++; o = { p: (o && o.p) || '', a: 'Chưa phân AOM', s: (o && o.s) || 'Chưa phân SUP' }; }
    var fix = function (arr) { return arr.map(function (c) { return c ? c.map(_flmKpi_round_) : null; }); };
    outHubs.push([h.name, o.p || '—', o.a || 'Chưa phân AOM', o.s || 'Chưa phân SUP', fix(h.d), fix(h.w), fix(h.m)]);
  });

  return {
    v: 1, builtAt: nowMs, asOf: asOf, targets: FLM_KPI_TARGETS, slots: ['fmN', 'fmD', 'lmN', 'lmD', 'sopW', 'sopD', 'sucN', 'sucD'],
    periods: { d: days, w: weeks, m: months },
    sources: stats, org: { hubs: Object.keys(org).length, dupHub: orgDup, orphanHubs: orphan },
    hubs: outHubs    // [name, province, aom, sup, d[], w[], m[]]
  };
}

// ───────────────────────── đọc Google Sheet thật ─────────────────────────
function _flmKpi_readSheetValues_(ss, name, maxCols) {
  var sh = ss.getSheetByName(name);
  if (!sh) return null;
  var lr = sh.getLastRow(), lc = Math.min(sh.getLastColumn(), maxCols || 12);
  if (lr < 1 || lc < 1) return null;
  return sh.getRange(1, 1, lr, lc).getValues();
}

function _flmKpi_fingerprint_() {
  var parts = [];
  Object.keys(FLM_KPI_SOURCES).forEach(function (key) {
    var ss = SpreadsheetApp.openById(FLM_KPI_SOURCES[key].id);
    var ra = ss.getSheetByName('raw'), au = ss.getSheetByName('auto');
    var rr = ra ? ra.getLastRow() : 0, ar = au ? au.getLastRow() : 0;
    var lastAuto = '';
    if (au && ar > 1) { try { lastAuto = String(_flmKpi_dateStr_(au.getRange(ar, 1).getValue()) || ''); } catch (e) {} }
    parts.push(key + ':' + rr + ':' + ar + ':' + lastAuto);
  });
  return parts.join('|');
}

/**
 * mode 'fast' : chỉ đọc sheet `auto` (~17 nghìn dòng/nguồn) + `infor` → có dữ liệu ngay (từ 01/09/2026), snapshot đánh dấu partial.
 * mode 'full' : đọc thêm sheet `raw` (~100 nghìn dòng/nguồn) để có lịch sử tuần/tháng cũ.
 */
function _flmKpi_buildLive_(mode) {
  var fast = (mode === 'fast'), sources = {}, orgValues = null, t0 = Date.now();
  Object.keys(FLM_KPI_SOURCES).forEach(function (key) {
    var ss = SpreadsheetApp.openById(FLM_KPI_SOURCES[key].id);
    sources[key] = { raw: fast ? null : _flmKpi_readSheetValues_(ss, 'raw', 10), auto: _flmKpi_readSheetValues_(ss, 'auto', 9) };
    if (key === FLM_KPI_ORG_SOURCE) orgValues = _flmKpi_readSheetValues_(ss, FLM_KPI_ORG_SHEET, 10);
  });
  var snap = _flmKpi_buildFromValues_(sources, orgValues, Date.now());
  snap.partial = fast; snap.mode = fast ? 'fast' : 'full'; snap.buildMs = Date.now() - t0;
  return snap;
}
function _flmKpi_recordErr_(stage, e) {
  try { PropertiesService.getScriptProperties().setProperty(FLM_KPI_PROP_ERR, JSON.stringify({ t: Date.now(), stage: stage, msg: String((e && e.message) || e).slice(0, 300) })); } catch (x) {}
}
function _flmKpi_clearErr_() { try { PropertiesService.getScriptProperties().deleteProperty(FLM_KPI_PROP_ERR); } catch (x) {} }
function _flmKpi_lastErr_() { try { var r = PropertiesService.getScriptProperties().getProperty(FLM_KPI_PROP_ERR); return r ? JSON.parse(r) : null; } catch (x) { return null; } }

// ───────────────────────── lưu / đọc snapshot ─────────────────────────
function _flmKpi_snapSheet_(slot) {
  var ss = _DS.ss(ADMIN_DB_ID), name = FLM_KPI_SNAP_SHEET + '_' + slot;
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); try { sh.hideSheet(); } catch (e) {} }
  return sh;
}
function _flmKpi_writeSnapshot_(snap) {
  var json = JSON.stringify(snap);
  if (json.length > FLM_KPI_MAX_JSON) throw new Error('Snapshot KPI quá lớn (' + json.length + ' ký tự) — kiểm tra lại nguồn.');
  var props = PropertiesService.getScriptProperties();
  var cur = props.getProperty(FLM_KPI_PROP_SLOT) === 'B' ? 'B' : 'A', next = cur === 'A' ? 'B' : 'A';
  var sh = _flmKpi_snapSheet_(next);
  var chunks = [];
  for (var i = 0; i < json.length; i += FLM_KPI_CELL_CHUNK) chunks.push([json.substr(i, FLM_KPI_CELL_CHUNK)]);
  sh.clearContents();
  if (sh.getMaxRows() < chunks.length) sh.insertRowsAfter(sh.getMaxRows(), chunks.length - sh.getMaxRows());
  sh.getRange(1, 1, chunks.length, 1).setNumberFormat('@').setValues(chunks);
  SpreadsheetApp.flush();
  var meta = { slot: next, chunks: chunks.length, builtAt: snap.builtAt, asOf: snap.asOf, fp: snap._fp || '', size: json.length, partial: !!snap.partial };
  props.setProperty(FLM_KPI_PROP_META, JSON.stringify(meta));
  props.setProperty(FLM_KPI_PROP_SLOT, next);        // đổi con trỏ SAU CÙNG: người đọc không bao giờ thấy bản ghi dở
  try { CacheMgr.setChunked(FLM_KPI_CACHE_NS, FLM_KPI_CACHE_KEY, snap, FLM_KPI_CACHE_TTL); } catch (e) {}
  return meta;
}
function _flmKpi_readMeta_() {
  try { var raw = PropertiesService.getScriptProperties().getProperty(FLM_KPI_PROP_META); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
var _flmKpi_memo_ = null;
function _flmKpi_getSnapshot_() {
  if (_flmKpi_memo_) return _flmKpi_memo_;
  var hit = CacheMgr.getChunked(FLM_KPI_CACHE_NS, FLM_KPI_CACHE_KEY);
  if (hit && hit.hubs) { _flmKpi_memo_ = hit; return hit; }
  var meta = _flmKpi_readMeta_();
  if (!meta) return null;
  var sh = _flmKpi_snapSheet_(meta.slot);
  var vals = sh.getRange(1, 1, meta.chunks, 1).getValues();
  var json = vals.map(function (r) { return String(r[0]); }).join('');
  var snap = JSON.parse(json);
  try { CacheMgr.setChunked(FLM_KPI_CACHE_NS, FLM_KPI_CACHE_KEY, snap, FLM_KPI_CACHE_TTL); } catch (e) {}
  _flmKpi_memo_ = snap;
  return snap;
}

/**
 * flm_kpi_refreshIfDue_(force, opts) — gọi từ spxDispatcher30Min. Rẻ khi nguồn không đổi (chỉ mở 4 file đọc số dòng cuối).
 * Chưa có snapshot nào → dựng NHANH (chỉ sheet auto) rồi mới dựng ĐẦY ĐỦ (thêm lịch sử raw): lỡ bước đầy đủ chậm/lỗi,
 * người dùng vẫn có dữ liệu từ bước nhanh. Snapshot partial luôn được dựng đầy đủ ở lượt kế tiếp.
 * opts.fastOnly : chỉ dựng nhanh nếu chưa có snapshot (đường người dùng gọi lần đầu) · opts.waitMs : thời gian chờ khoá.
 */
function flm_kpi_refreshIfDue_(force, opts) {
  opts = opts || {};
  var meta = _flmKpi_readMeta_(), fp = '';
  try { fp = _flmKpi_fingerprint_(); } catch (eFp) { fp = ''; }
  var age = meta ? (Date.now() - meta.builtAt) : Infinity;
  var need = force || !meta || meta.partial || !fp || fp !== meta.fp || age >= FLM_KPI_REBUILD_MAX_AGE_MS;
  if (!need) return 'skip: nguồn không đổi';
  if (opts.fastOnly && meta) return 'skip: đã có snapshot';
  if (!_anaAcquireNamedLock('flm_kpi_build_lock_v1', opts.waitMs || 60000, 480000)) return 'skip: đang có lượt dựng khác';
  var stage = 'fast';
  try {
    var cur = _flmKpi_readMeta_();
    if (cur && opts.fastOnly) return 'skip: lượt khác vừa dựng xong';
    if (cur && !force && !cur.partial && fp && fp === cur.fp) return 'skip: lượt khác vừa dựng xong';
    var t0 = Date.now(), note = '';
    if (!cur) {
      var f = _flmKpi_buildLive_('fast'); f._fp = fp;
      var fm = _flmKpi_writeSnapshot_(f); _flmKpi_memo_ = null;
      note = 'nhanh ' + f.hubs.length + ' Hub (asOf ' + f.asOf + ', ' + Math.round((Date.now() - t0) / 1000) + 's) · ';
      if (opts.fastOnly) return 'ok(fast): ' + note;
    }
    stage = 'full';
    try {
      var t1 = Date.now(), snap = _flmKpi_buildLive_('full'); snap._fp = fp;
      var m = _flmKpi_writeSnapshot_(snap); _flmKpi_memo_ = null; _flmKpi_clearErr_();
      return 'ok: ' + note + 'đầy đủ ' + snap.hubs.length + ' Hub, asOf ' + snap.asOf + ', ' + Math.round((Date.now() - t1) / 1000) + 's, ' + m.size + ' ký tự';
    } catch (eFull) {
      _flmKpi_recordErr_(stage, eFull);
      if (_flmKpi_readMeta_()) return 'partial: giữ snapshot hiện có — dựng đầy đủ lỗi: ' + eFull.message;
      throw eFull;
    }
  } catch (e) { _flmKpi_recordErr_(stage, e); throw e; }
  finally { _anaReleaseNamedLock('flm_kpi_build_lock_v1'); }
}
/** Chạy tay khi cần dựng lại ngay (Apps Script Editor). Hàm công khai nên CHỈ admin gọi được. */
function flm_kpi_forceRebuild() { _requireAdmin_(2); return flm_kpi_refreshIfDue_(true); }

/** Chẩn đoán cho admin: trạng thái snapshot + số liệu chất lượng nguồn. */
function flm_kpi_status() {
  try {
    _requireAdmin_(2);
    var meta = _flmKpi_readMeta_(), snap = meta ? _flmKpi_getSnapshot_() : null;
    return JSON.stringify({ success: true, meta: meta, lastError: _flmKpi_lastErr_(), partial: !!(snap && snap.partial), sources: snap && snap.sources, org: snap && snap.org, asOf: snap && snap.asOf });
  } catch (e) { return JSON.stringify({ success: false, error: e.message }); }
}

/** Phiên bản snapshot (mốc builtAt) — nhẹ, kpifail_getDataVersion() đính kèm để client biết có số mới. */
function flm_kpi_version_() {
  var m = _flmKpi_readMeta_();
  return m ? m.builtAt : 0;
}

/**
 * [MỚI 2026-10-24] Xếp 1 job dựng nền (trigger chạy 1 lần sau ~5 giây) khi chưa có snapshot. Chống trùng: đã xếp trong 10 phút
 * hoặc đã có trigger chờ thì không tạo thêm. Trả true nếu đã có job đang/sắp chạy.
 */
function _flmKpi_queueBuild_() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('flm_kpi_build_queued_at') || 0);
  if (last && (Date.now() - last) < 10 * 60 * 1000) return true;
  var has = ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'flm_kpi_buildOnce_'; });
  if (!has) ScriptApp.newTrigger('flm_kpi_buildOnce_').timeBased().after(5 * 1000).create();
  props.setProperty('flm_kpi_build_queued_at', String(Date.now()));
  return true;
}

/** Job dựng nền 1 lần (tự xoá trigger của chính nó). Dựng NHANH (chỉ sheet auto); phần lịch sử do dispatcher 30 phút bổ sung. */
function flm_kpi_buildOnce_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'flm_kpi_buildOnce_') ScriptApp.deleteTrigger(tr); });
  } catch (eD) {}
  try {
    return flm_kpi_refreshIfDue_(true, { fastOnly: true });
  } finally {
    try { PropertiesService.getScriptProperties().deleteProperty('flm_kpi_build_queued_at'); } catch (eP) {}
  }
}

/**
 * flm_getKpiBundle() — API cho giao diện "Fail KPI Order".
 * Trả về snapshot đã LỌC THEO QUYỀN: admin thấy tất cả Hub; AOM/SUP/Lead chỉ thấy Hub trong access.hubs.
 */
function flm_getKpiBundle() {
  try {
    _requireApproved_();
    var access = getModuleAccess();
    if (!access || access.role === 'denied') return JSON.stringify({ success: false, error: 'Bạn không có quyền truy cập module này.' });
    try { spx_trackModuleOpen('JS_KPIFail'); } catch (eT) {}

    var snap = _flmKpi_getSnapshot_();
    if (!snap) {
      // [SỬA 2026-10-24] Log Executions: lượt gọi đầu sau deploy mất 569 giây, 3 lượt sau ~66 giây MỖI LƯỢT (mỗi lượt giữ 1 chỗ
      // chạy đồng thời suốt thời gian đó). KHÔNG dựng trong lượt gọi của người dùng nữa: xếp 1 job dựng nền (trigger 1 lần) rồi
      // trả building:true ngay — giao diện đã có sẵn vòng thử lại (15 giây x 12 lần). Không tạo được trigger -> quay về cách cũ.
      var _queued = false;
      try { _queued = _flmKpi_queueBuild_(); } catch (eQ) { _queued = false; }
      if (_queued) {
        var _le0 = _flmKpi_lastErr_();
        return JSON.stringify({ success: false, building: true, error: 'Dữ liệu KPI đang được chuẩn bị, vui lòng đợi.', detail: _le0 ? ('lần dựng gần nhất lỗi (' + _le0.stage + '): ' + _le0.msg) : '' });
      }
      // Lần đầu (chưa từng có snapshot): chỉ dựng NHANH (sheet auto) đồng bộ để người dùng có dữ liệu ngay; phần lịch sử do trigger bổ sung.
      var res = '';
      try { res = flm_kpi_refreshIfDue_(true, { fastOnly: true, waitMs: 25000 }); }
      catch (eB) { return JSON.stringify({ success: false, error: 'Dựng dữ liệu KPI lần đầu thất bại: ' + eB.message }); }
      snap = _flmKpi_getSnapshot_();
      if (!snap) {
        var le = _flmKpi_lastErr_();
        return JSON.stringify({ success: false, building: true, error: 'Dữ liệu KPI đang được chuẩn bị, vui lòng đợi.', detail: le ? ('lần dựng gần nhất lỗi (' + le.stage + '): ' + le.msg) : String(res || '') });
      }
    }

    var hubs = snap.hubs, scoped = false;
    if (access.role !== 'admin') {
      var allow = {};
      (access.hubs || []).forEach(function (h) { allow[_kpifail_normHubBase_(h)] = true; allow[_kpifail_normHubUI_(h)] = true; });
      hubs = snap.hubs.filter(function (h) { return allow[_kpifail_normHubBase_(h[0])] || allow[_kpifail_normHubUI_(h[0])]; });
      scoped = true;
    }
    return JSON.stringify({
      success: true, builtAt: snap.builtAt, asOf: snap.asOf, partial: !!snap.partial, targets: FLM_KPI_TARGETS /* luôn lấy cấu hình HIỆN HÀNH, không dùng giá trị đã lưu trong snapshot cũ */, periods: snap.periods, slots: snap.slots,
      sources: snap.sources, orgInfo: snap.org, hubs: hubs, scoped: scoped,
      access: { role: access.role, levelCode: access.levelCode, levelNum: access.levelNum, email: access.email, hubs: access.hubs || [] }
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}

/**
 * flm_getFailOrdersByDay(payloadJson) — "bấm vào một ngày → toàn bộ đơn fail của ngày đó" ở MỌI cấp (ROM/AOM/SUP/Hub).
 * payload: { date:'yyyy-MM-dd', category:'ALL'|'FM'|'LM'|'SOP', hubs:[tên Hub trong phạm vi đang xem], search, page, pageSize, all }
 * Dùng đúng nguồn đơn fail hiện có (kpifail_getMasterDataLite) nên giữ nguyên phân quyền theo Hub của người gọi;
 * Hub ngoài quyền không bao giờ được trả về dù client gửi tên. all:true → tối đa 5.000 dòng (cho xuất CSV).
 */
function flm_getFailOrdersByDay(payloadJson) {
  try {
    _requireApproved_();
    var req = {}; try { req = JSON.parse(payloadJson || '{}'); } catch (e0) { req = {}; }
    var date = String(req.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ success: false, error: 'Ngày không hợp lệ.' });
    var cat = (req.category === 'FM' || req.category === 'LM' || req.category === 'SOP') ? req.category : 'ALL';
    var search = String(req.search || '').trim().toLowerCase();
    var pageSize = req.all ? 5000 : Math.max(1, Math.min(200, Number(req.pageSize) || 50)), page = Math.max(1, Number(req.page) || 1);
    var lite = JSON.parse(kpifail_getMasterDataLite('', 45));            // đã lọc theo quyền của người gọi
    if (!lite || !lite.success) return JSON.stringify({ success: false, error: (lite && lite.error) || 'Không lấy được dữ liệu đơn fail.' });
    var set = null;
    if (req.hubs && req.hubs.length) { set = {}; req.hubs.forEach(function (h) { set[_kpifail_normHubBase_(h)] = true; set[_kpifail_normHubUI_(h)] = true; }); }
    var counts = { FM: 0, LM: 0, SOP: 0 }, rows = [];
    (lite.records || []).forEach(function (r) {
      if (!r || r.date !== date) return;
      if (set && !(set[_kpifail_normHubBase_(r.hub)] || set[_kpifail_normHubUI_(r.hub)])) return;
      if (search && String(r.id || '').toLowerCase().indexOf(search) < 0 && String(r.hub || '').toLowerCase().indexOf(search) < 0) return;
      if (counts[r.category] !== undefined) counts[r.category]++;
      if (cat === 'ALL' || r.category === cat) rows.push({ id: r.id, date: r.date, hub: r.hub, category: r.category, type: r.type, reason: r.reason, delayHours: r.delayHours, riderId: (r.raw && r.raw.riderId) || '' });
    });
    var order = { FM: 0, LM: 1, SOP: 2 };
    rows.sort(function (a, b) { return (order[a.category] - order[b.category]) || String(a.hub).localeCompare(String(b.hub)) || String(a.id).localeCompare(String(b.id)); });
    var total = rows.length, pages = Math.max(1, Math.ceil(total / pageSize));
    if (page > pages) page = pages;
    return JSON.stringify({ success: true, date: date, category: cat, total: total, counts: counts, page: page, pages: pages, rows: rows.slice((page - 1) * pageSize, page * pageSize) });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message });
  }
}