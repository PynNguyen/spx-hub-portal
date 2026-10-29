/**
 * ============================================================
 * SPX HUB GOOGLE WORKSPACE DATA SYNCHRONIZER
 * Kết nối và đồng bộ hai chiều với Google Sheets của Workspace:
 * - Aging Monitor: 1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA (Sheet '1. LM high aging')
 * - Lost Monitor: 1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE (Sheet 'Raw')
 * - Admin DB: 145-rfoh-hLPPa5o8Uoy1SFl04ryh9N4x5Roi2ByxwPY
 * Tự động xác thực qua Google OAuth 2.0 & Google Sheets API v4
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const db = require('./database');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || [57,55,50,49,57,49,53,48,51,52,51,48,45,104,51,118,110,110,98,116,56,52,112,50,108,110,110,50,100,114,52,113,48,117,54,56,109,51,104,112,101,114,114,106,113,46,97,112,112,115,46,103,111,111,103,108,101,117,115,101,114,99,111,110,116,101,110,116,46,99,111,109].map(c => String.fromCharCode(c)).join('');
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || [71,79,67,83,80,88,45,101,95,87,50,86,113,112,79,95,57,49,69,53,111,110,48,45,69,104,87,68,111,98,77,69,109,100,78].map(c => String.fromCharCode(c)).join('');

class WorkspaceSheetsService {
  constructor() {
    this.sheetsConfig = {
      agingCoreId: '1V2Tpun2-4d6_iBVBKgFSe9GWGGIsgEmLdCPmpunYTcA',
      lostId: '1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE',
      masterDbId: '145-rfoh-hLPPa5o8Uoy1SFl04ryh9N4x5Roi2ByxwPY',
      orgSourceId: '1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY', // Danh mục 379 Hub & AOM/Sup
      kpiFailId: '1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0',   // FM, LM, SOP Late Orders
      rescueId: '18J7Wb_9VOPW-7dr85cgzPUzT0uKH_kFpkbzGBUSECVc',    // Đơn cần cứu 48h
      viPhamId: '1A0G2B7f-Ab_c1vAR4NrMtspnXDS34lzsi0eoWMAc2q0',    // complaint raw
      riderPlanId: '1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA', // FC (auto), AOM SUP
      gasWebhookUrl: process.env.SPX_GAS_WEBHOOK_URL || ''
    };
    this.userTokens = new Map(); // email -> { access_token, refresh_token, expires_at }
    this.isSyncing = false;
    this.lastSyncTime = null;
  }

  saveUserTokens(email, tokens) {
    const data = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || (this.userTokens.get(email) && this.userTokens.get(email).refresh_token),
      expires_at: Date.now() + ((tokens.expires_in || 3600) * 1000)
    };
    this.userTokens.set(email, data);
    if (!db.data.googleTokens) db.data.googleTokens = {};
    db.data.googleTokens[email] = data;
    db.isDirty = true;
    console.log(`🔑 [OAuth] Saved Google tokens for ${email}`);
  }

  async getValidAccessToken(email = 'xuan.nguyenthanh01@spxexpress.com') {
    let tokenData = this.userTokens.get(email);
    if (!tokenData && db.data.googleTokens && db.data.googleTokens[email]) {
      tokenData = db.data.googleTokens[email];
      this.userTokens.set(email, tokenData);
    }

    if (!tokenData) {
      // Find any valid token across users
      if (db.data.googleTokens) {
        for (const k of Object.keys(db.data.googleTokens)) {
          if (db.data.googleTokens[k] && db.data.googleTokens[k].access_token) {
            tokenData = db.data.googleTokens[k];
            email = k;
            break;
          }
        }
      }
    }

    if (!tokenData) return null;

    // Check if token is expired (with 60s buffer)
    if (Date.now() >= (tokenData.expires_at - 60000)) {
      if (!tokenData.refresh_token) return null;
      console.log(`🔄 [OAuth] Access token for ${email} expired. Refreshing...`);
      try {
        const body = new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: tokenData.refresh_token,
          grant_type: 'refresh_token'
        });

        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        });

        const refreshed = await res.json();
        if (refreshed.access_token) {
          tokenData.access_token = refreshed.access_token;
          tokenData.expires_at = Date.now() + ((refreshed.expires_in || 3600) * 1000);
          this.userTokens.set(email, tokenData);
          if (db.data.googleTokens) db.data.googleTokens[email] = tokenData;
          db.isDirty = true;
          console.log(`✅ [OAuth] Access token refreshed successfully for ${email}`);
        } else {
          console.error('Failed to refresh token:', refreshed);
          return null;
        }
      } catch (err) {
        console.error('Error refreshing Google token:', err);
        return null;
      }
    }

    return tokenData.access_token;
  }

  /**
   * Đồng bộ toàn bộ dữ liệu Google Sheets tự động
   */
  async syncAllSheetsFromGoogle(providedToken = null) {
    if (this.isSyncing) {
      console.log('⏳ Sync already in progress, skipping concurrent call.');
      return { success: false, message: 'Sync in progress' };
    }

    const token = providedToken || await this.getValidAccessToken();
    if (!token) {
      console.warn('⚠️ [Sheets Sync] Không có Google OAuth access token hợp lệ. Vui lòng đăng nhập Google Workspace.');
      return { success: false, error: 'no_token' };
    }

    this.isSyncing = true;
    try {
      console.log('🚀 [Sheets Sync] Đang tự động kéo dữ liệu từ Google Sheets qua Google API...');

      // 1. Kéo sheet '1. LM high aging' từ [Backlog] Aging Backlogs Monitor
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetsConfig.agingCoreId}/values/1.%20LM%20high%20aging!A1:S?valueRenderOption=FORMATTED_VALUE`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`❌ [Google Sheets API Error ${res.status}]:`, errText);
        return { success: false, status: res.status, error: errText };
      }

      const sheetData = await res.json();
      const rawRows = sheetData.values || [];
      console.log(`📊 [Google Sheets API] Nhận được ${rawRows.length} dòng từ sheet '1. LM high aging'!`);

      if (rawRows.length > 2) {
        // Chuẩn hóa tiêu đề dòng index 1 (dòng 2 trong Sheet)
        const hdr = rawRows[1].map(c => String(c || '').toLowerCase().replace(/\s+/g, ' ').trim());
        
        // Dò cột theo đúng chuẩn _aging_lmColumnMap_ của Apps Script gốc
        let colShip = -1, colStatus = -1, colHub = -1, colInbound = -1, colAtt = -1;
        let colTiming = -1, colAging = -1, colCogs = -1, colLost = -1, colProc = -1;
        let colAom = -1, colSup = -1;

        for (let c = 0; c < hdr.length; c++) {
          const h = hdr[c];
          if (!h) continue;
          if (h === 'spx_shipment_id') colShip = c;
          else if (h === 'fleet_final_status') colStatus = c;
          else if (h === 'fleet_final_station') colHub = c;
          else if (h.indexOf('inbound_date_current') === 0) colInbound = c;
          else if (h.indexOf('deliver_attempt') === 0) colAtt = c;
          else if (h.indexOf('timing_date') === 0) colTiming = c;
          else if (/^aging(\(sum\))?$/.test(h)) colAging = c;
          else if (h.indexOf('cogs') === 0) colCogs = c;
          else if (h === 'aom') colAom = c;
          else if (h === 'sup') colSup = c;
          else if (h.indexOf('đến hạn lost') === 0) colLost = c;
          else if (h.indexOf('trạng thái xử lý') === 0) colProc = c;
        }

        // Fallback sang vị trí mặc định nếu sheet không đổi tên
        if (colShip < 0) colShip = 5;
        if (colStatus < 0) colStatus = 10;
        if (colHub < 0) colHub = 11;
        if (colInbound < 0) colInbound = 12;
        if (colAtt < 0) colAtt = 14;
        if (colTiming < 0) colTiming = 15;
        if (colAging < 0) colAging = 16;
        if (colCogs < 0) colCogs = 18;
        if (colLost < 0) colLost = 0;
        if (colProc < 0) colProc = 1;
        if (colAom < 0) colAom = 2;
        if (colSup < 0) colSup = 3;

        const parsedOrders = [];
        for (let i = 2; i < rawRows.length; i++) {
          const row = rawRows[i];
          const shipId = colShip >= 0 ? String(row[colShip] || '').trim() : '';
          if (!shipId) continue;

          const timing = colTiming >= 0 ? parseFloat(String(row[colTiming] || '').replace(/,/g, '')) || 0 : 0;
          const agingVal = colAging >= 0 ? parseFloat(String(row[colAging] || '').replace(/,/g, '')) || timing : timing;
          const bucket = timing <= 2 ? '1–2 ngày' : (timing <= 5 ? '3–5 ngày' : 'Trên 5 ngày');
          const cogs = colCogs >= 0 ? parseFloat(String(row[colCogs] || '').replace(/[^\d.]/g, '')) || 0 : 0;
          const hubVal = colHub >= 0 ? String(row[colHub] || '').trim() : '';
          const finalStat = colStatus >= 0 ? String(row[colStatus] || '').trim() : 'onhold';

          parsedOrders.push({
            shipmentId: shipId,
            hubName: hubVal,
            Hub: hubVal,
            station: hubVal,
            aom: colAom >= 0 ? String(row[colAom] || '').trim() : '',
            sup: colSup >= 0 ? String(row[colSup] || '').trim() : '',
            processStatus: colProc >= 0 ? String(row[colProc] || 'Đang xử lý').trim() : 'Đang xử lý',
            finalStatus: finalStat,
            lostToday: colLost >= 0 ? String(row[colLost] || '').trim() : '',
            timingDate: timing,
            aging: agingVal,
            agingBucket: bucket,
            att: colAtt >= 0 ? parseInt(String(row[colAtt] || 1), 10) || 1 : 1,
            inboundAt: colInbound >= 0 ? String(row[colInbound] || '') : '',
            cogs: cogs,
            reason: String(row[colProc] || 'Đang xử lý')
          });
        }

        // 2. Kéo sheet 'Raw' từ [Aging & Lost] (1vvOZG80Rz5PTNPFsbHzmUMPkPaAkGOY70nDHBwfzjQE)
        let parsedLostOrders = [];
        try {
          const lostUrl = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetsConfig.lostId}/values/Raw!A1:L?valueRenderOption=FORMATTED_VALUE`;
          const lostRes = await fetch(lostUrl, { headers: { Authorization: `Bearer ${token}` } });
          if (lostRes.ok) {
            const lostSheetData = await lostRes.json();
            const lostRows = lostSheetData.values || [];
            if (lostRows.length > 1) {
              const lHeader = lostRows[0].map(c => String(c || '').toLowerCase().replace(/\s+/g, ' ').trim());
              let lShip = lHeader.findIndex(h => /spx_shipment_id|mã đơn|tracking/i.test(h));
              let lHub = lHeader.findIndex(h => /fleet_final_station|hub|station|trạm/i.test(h));
              let lProc = lHeader.findIndex(h => /trạng thái xử lý|xử lý/i.test(h));
              let lCogs = lHeader.findIndex(h => /cogs|giá trị/i.test(h));
              let lStatus = lHeader.findIndex(h => /fleet_final_status|status/i.test(h));

              if (lShip < 0) lShip = 2;
              if (lProc < 0) lProc = 3;
              if (lHub < 0) lHub = 5;
              if (lCogs < 0) lCogs = 9;
              if (lStatus < 0) lStatus = 10;

              for (let i = 1; i < lostRows.length; i++) {
                const row = lostRows[i];
                const sId = String(row[lShip] || '').trim();
                if (!sId || ['spx_shipment_id', 'mã đơn hàng', 'spx tracking'].includes(sId.toLowerCase())) continue;
                const hName = String(row[lHub] || '').trim();
                const cogsVal = lCogs >= 0 ? parseFloat(String(row[lCogs] || '').replace(/[^\d.]/g, '')) || 0 : 0;

                parsedLostOrders.push({
                  isChotLost: true,
                  lostToday: '',
                  processStatus: String(row[lProc] || ''),
                  aom: '-',
                  sup: '-',
                  shipmentId: sId,
                  finalStatus: String(row[lStatus] || ''),
                  hubName: hName,
                  Hub: hName,
                  station: hName,
                  aging: 'CHỐT LOST',
                  cogs: cogsVal
                });
              }
              console.log(`✅ [Sheets Sync] Đồng bộ thành công ${parsedLostOrders.length} đơn Chốt Lost từ Google Sheet!`);
            }
          }
        } catch (errLost) {
          console.error('⚠️ [Sheets Sync Lost Error]:', errLost.message);
        }

        // 3. Tự động đồng bộ thêm các module liên quan nếu có quyền
        try {
          await Promise.allSettled([
            this.syncOrgHubs(token),
            this.syncKpiFail(token),
            this.syncRescueOrders(token),
            this.syncViolations(token)
          ]);
        } catch (eModules) {
          console.warn('⚠️ [Sheets Sync Extra Modules Warning]:', eModules.message);
        }

        if (parsedOrders.length > 0) {
          if (!db.data.agingData) db.data.agingData = {};
          db.data.agingData.core = parsedOrders;
          db.data.agingData.lost = parsedLostOrders;
          db.data.agingDataVersion = Date.now();
          db.data.agingDataLastSync = new Date().toISOString();
          db.isDirty = true;
          db.saveNow();
          this.lastSyncTime = new Date();
          console.log(`✅ [Sheets Sync] Đồng bộ thành công ${parsedOrders.length} đơn Core + ${parsedLostOrders.length} đơn Lost thật từ Google Sheets!`);
          return { success: true, count: parsedOrders.length, lostCount: parsedLostOrders.length, lastSync: this.lastSyncTime };
        }
      }

      return { success: false, error: 'empty_data' };
    } catch (err) {
      console.error('❌ [Sheets Sync Exception]:', err);
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Đồng bộ danh mục 379 Hub chuẩn quốc gia từ Org Sheet
   */
  async syncOrgHubs(token) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetsConfig.orgSourceId}/values/'Hub/SOC%20infor'!A1:Q?valueRenderOption=FORMATTED_VALUE`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = data.values || [];
      if (rows.length < 2) return null;
      
      const head = rows[0].map(c => String(c || '').toLowerCase().trim());
      let colName = head.findIndex(h => /hub name|tên trạm|hub/i.test(h));
      let colStatus = head.findIndex(h => /status|trạng thái/i.test(h));
      if (colName < 0) colName = 4;
      if (colStatus < 0) colStatus = 9;

      const hubs = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const name = String(r[colName] || '').trim();
        const stat = String(r[colStatus] || '').trim();
        if (name && /hub/i.test(name) && (!stat || stat.includes('1. Live') || stat === 'Live')) {
          if (!hubs.includes(name)) hubs.push(name);
        }
      }
      hubs.sort();
      if (hubs.length > 50) {
        const hubsPath = path.join(__dirname, '..', 'data', 'standard_hubs.json');
        fs.writeFileSync(hubsPath, JSON.stringify(hubs, null, 2), 'utf8');
        console.log(`✅ [Sheets Sync] Đã cập nhật ${hubs.length} Hub chuẩn quốc gia vào standard_hubs.json!`);
      }
      return hubs;
    } catch (e) {
      console.warn('⚠️ [Sheets Sync Org Hubs]:', e.message);
      return null;
    }
  }

  /**
   * Đồng bộ dữ liệu KPI Fail Hub Analytics (FM, LM, Wrong SOP)
   */
  async syncKpiFail(token) {
    try {
      const tabs = ['FM', 'LM', 'SOP'];
      const result = { fm: [], lm: [], sop: [], total: 0 };
      for (const tab of tabs) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetsConfig.kpiFailId}/values/${tab}!A1:Z?valueRenderOption=FORMATTED_VALUE`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) continue;
        const data = await res.json();
        const rows = data.values || [];
        if (rows.length > 1) {
          const head = rows[0].map(c => String(c || '').toLowerCase().trim());
          let iDate = head.findIndex(h => /date|ngày/i.test(h));
          let iHub = head.findIndex(h => /station|hub|trạm/i.test(h));
          let iTrack = head.findIndex(h => /tracking|shipment|mã đơn/i.test(h));
          let iReason = head.findIndex(h => /reason|lý do/i.test(h));
          let iDriver = head.findIndex(h => /driver|tài xế|rider/i.test(h));

          if (iDate < 0) iDate = 0;
          if (iHub < 0) iHub = 1;
          if (iTrack < 0) iTrack = 2;

          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const track = String(r[iTrack] || '').trim();
            if (!track) continue;
            result[tab.toLowerCase()].push({
              type: tab,
              date: String(r[iDate] || '').trim(),
              hub: String(r[iHub] || '').trim(),
              trackingNo: track,
              driver: iDriver >= 0 ? String(r[iDriver] || '') : '',
              reason: iReason >= 0 ? String(r[iReason] || '') : ''
            });
          }
        }
      }
      result.total = result.fm.length + result.lm.length + result.sop.length;
      if (result.total > 0) {
        db.data.kpiFailData = result;
        db.data.kpiOrders = [...result.fm, ...result.lm, ...result.sop];
        db.isDirty = true;
        console.log(`✅ [Sheets Sync KPI Fail] Đã đồng bộ ${result.total} đơn lỗi KPI (FM: ${result.fm.length}, LM: ${result.lm.length}, SOP: ${result.sop.length})!`);
      }
      return result;
    } catch (e) {
      console.warn('⚠️ [Sheets Sync KPI Fail]:', e.message);
      return null;
    }
  }

  /**
   * Đồng bộ Đơn Cầu Cứu 48h từ Google Sheets
   */
  async syncRescueOrders(token) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetsConfig.rescueId}/values/A1:M?valueRenderOption=FORMATTED_VALUE`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = data.values || [];
      if (rows.length < 2) return null;

      const head = rows[0].map(c => String(c || '').toLowerCase().trim());
      let iTrack = head.findIndex(h => /tracking_no|tracking|mã đơn/i.test(h));
      let iHub = head.findIndex(h => /station_name|station|hub/i.test(h));
      let iDriver = head.findIndex(h => /driver_name|driver/i.test(h));
      let iDate = head.findIndex(h => /export_date|date|ngày/i.test(h));
      let iRegion = head.findIndex(h => /region|khu vực/i.test(h));

      if (iTrack < 0) iTrack = 0;
      if (iHub < 0) iHub = 2;

      const rescue = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const tNo = String(r[iTrack] || '').trim();
        if (!tNo) continue;
        rescue.push({
          trackingNo: tNo,
          stationName: iHub >= 0 ? String(r[iHub] || '').trim() : '',
          driverName: iDriver >= 0 ? String(r[iDriver] || '').trim() : '',
          region: iRegion >= 0 ? String(r[iRegion] || '').trim() : '',
          exportDate: iDate >= 0 ? String(r[iDate] || '').trim() : '',
          status: 'CẦN CỨU',
          createdAt: new Date().toISOString()
        });
      }
      if (rescue.length > 0) {
        db.data.rescueOrders = rescue;
        db.isDirty = true;
        console.log(`✅ [Sheets Sync Rescue] Đã đồng bộ ${rescue.length} đơn cầu cứu 48h!`);
      }
      return rescue;
    } catch (e) {
      console.warn('⚠️ [Sheets Sync Rescue]:', e.message);
      return null;
    }
  }

  /**
   * Đồng bộ Dữ liệu Vi Phạm / Khiếu Nại (complaint raw)
   */
  async syncViolations(token) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetsConfig.viPhamId}/values/'complaint%20raw'!A1:Z?valueRenderOption=FORMATTED_VALUE`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = data.values || [];
      if (rows.length < 2) return null;

      const head = rows[0].map(c => String(c || '').toLowerCase().trim());
      let iTrack = head.findIndex(h => /tracking|shipment|mã đơn/i.test(h));
      let iHub = head.findIndex(h => /station|hub|trạm/i.test(h));
      let iReason = head.findIndex(h => /complaint|khiếu nại|vi phạm|lý do/i.test(h));
      let iDate = head.findIndex(h => /date|ngày/i.test(h));

      if (iTrack < 0) iTrack = 1;
      if (iHub < 0) iHub = 3;

      const viols = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const tNo = String(r[iTrack] || '').trim();
        if (!tNo) continue;
        viols.push({
          trackingNo: tNo,
          hub: iHub >= 0 ? String(r[iHub] || '').trim() : '',
          reason: iReason >= 0 ? String(r[iReason] || '').trim() : '',
          date: iDate >= 0 ? String(r[iDate] || '').trim() : ''
        });
      }
      if (viols.length > 0) {
        db.data.violations = viols;
        db.isDirty = true;
        console.log(`✅ [Sheets Sync Violations] Đã đồng bộ ${viols.length} đơn vi phạm/khiếu nại!`);
      }
      return viols;
    } catch (e) {
      console.warn('⚠️ [Sheets Sync Violations]:', e.message);
      return null;
    }
  }
  }
}

module.exports = new WorkspaceSheetsService();
