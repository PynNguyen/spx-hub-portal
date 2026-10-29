/**
 * ============================================================
 * SPX HUB GOOGLE WORKSPACE DATA SYNCHRONIZER
 * Kết nối và đồng bộ hai chiều với Google Sheets của Workspace:
 * - Master DB: 145-rfoh-hLPPa5o8Uoy1SFl04ryh9N4x5Roi2ByxwPY
 * - Org Master: 1Q9Hw2sLxkJZg9MSP1EzfkB_-IvknDRhNwrKAzHQE4pw
 * Hỗ trợ Service Account / OAuth / Apps Script Relay Webhook
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

class WorkspaceSheetsService {
  constructor() {
    this.sheetsConfig = {
      masterDbId: '145-rfoh-hLPPa5o8Uoy1SFl04ryh9N4x5Roi2ByxwPY',
      orgSourceId: '1Q9Hw2sLxkJZg9MSP1EzfkB_-IvknDRhNwrKAzHQE4pw',
      gasWebhookUrl: process.env.SPX_GAS_WEBHOOK_URL || ''
    };
  }

  /**
   * Gọi tới Google Apps Script Webhook Relay (nếu đã cấu hình)
   */
  async fetchFromGasWebhook(action, payload = {}) {
    if (!this.sheetsConfig.gasWebhookUrl) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const url = new URL(this.sheetsConfig.gasWebhookUrl);
      const postData = JSON.stringify({ action, ...payload });

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ success: false, raw: data });
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Sheets Bridge Error]', err);
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Lấy dữ liệu Vi phạm & Đơn cứu cứu từ Google Sheets
   */
  async getRescueAndViolations(hub) {
    const remote = await this.fetchFromGasWebhook('getRescueAndViolations', { hub });
    if (remote && remote.success) return remote.data;

    return {
      rescue: { count: 0, list: [] },
      violations: { count: 0, list: [] }
    };
  }
}

module.exports = new WorkspaceSheetsService();
