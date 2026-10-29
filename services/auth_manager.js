/**
 * ============================================================
 * SPX HUB AUTHENTICATION & ACCESS CONTROL MANAGER
 * Quản lý xác thực Google Workspace (@spxexpress.com)
 * Phân quyền đa cấp bậc: Admin (L1), ROM (L2), AOM (L2), SUP (L3), Lead (L4), Staff (L5)
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

// Nạp danh sách 379 Hub chuẩn quốc gia từ dữ liệu tổ chức (format XX-YYY Name Hub)
let DEFAULT_STATIONS = [];
try {
  const hubsPath = path.join(__dirname, '..', 'data', 'standard_hubs.json');
  if (fs.existsSync(hubsPath)) {
    DEFAULT_STATIONS = JSON.parse(fs.readFileSync(hubsPath, 'utf8'));
  }
} catch (eHub) {
  console.warn('[AuthManager] Không đọc được standard_hubs.json, fallback', eHub.message);
}

if (!DEFAULT_STATIONS || !DEFAULT_STATIONS.length) {
  DEFAULT_STATIONS = [
    '31-NAN Anh Son 02 Hub',
    '31-NAN Anh Son Hub',
    '31-NAN Con Cuong Hub',
    '36-DNG Cam Le Hub',
    '45-DLK Krong Pak 02 Hub'
  ];
}

const ROLE_LEVEL_MAP = {
  admin: { levelNum: 1, levelCode: 'admin', levelLabel: 'Admin (L1)' },
  rom:   { levelNum: 2, levelCode: 'rom',   levelLabel: 'L1 - ROM' },
  aom:   { levelNum: 2, levelCode: 'aom',   levelLabel: 'L2 - AOM' },
  sup:   { levelNum: 3, levelCode: 'sup',   levelLabel: 'L3 - SUP' },
  lead:  { levelNum: 4, levelCode: 'lead',  levelLabel: 'L4 - Lead' },
  staff: { levelNum: 5, levelCode: 'staff', levelLabel: 'L5 - Staff' }
};

// Danh bạ tài khoản Google Workspace và phân quyền nội bộ
const USERS_DIRECTORY = {
  'xuan.nguyenthanh01@spxexpress.com': {
    email: 'xuan.nguyenthanh01@spxexpress.com',
    name: 'Admin Xuân',
    role: 'admin',
    level: 1,
    levelNum: 1,
    levelCode: 'admin',
    levelLabel: 'Admin (L1)',
    isRootAdmin: true,
    hubs: ['ALL', ...DEFAULT_STATIONS],
    defaultHub: '45-DLK Krong Pak 02 Hub'
  },
  'lead.krongpak02@spxexpress.com': {
    email: 'lead.krongpak02@spxexpress.com',
    name: 'Lead Krông Pắc 02',
    role: 'lead',
    level: 4,
    levelNum: 4,
    levelCode: 'lead',
    levelLabel: 'L4 - Lead',
    isRootAdmin: false,
    hubs: ['45-DLK Krong Pak 02 Hub'],
    defaultHub: '45-DLK Krong Pak 02 Hub'
  },
  'lead.bmt@spxexpress.com': {
    email: 'lead.bmt@spxexpress.com',
    name: 'Lead Buôn Ma Thuột',
    role: 'lead',
    level: 4,
    levelNum: 4,
    levelCode: 'lead',
    levelLabel: 'L4 - Lead',
    isRootAdmin: false,
    hubs: ['45-DLK Buon Ma Thuot Hub'],
    defaultHub: '45-DLK Buon Ma Thuot Hub'
  },
  'sup.daklak@spxexpress.com': {
    email: 'sup.daklak@spxexpress.com',
    name: 'SUP Đắk Lắk',
    role: 'sup',
    level: 3,
    levelNum: 3,
    levelCode: 'sup',
    levelLabel: 'L3 - SUP',
    isRootAdmin: false,
    hubs: ['45-DLK Krong Pak 02 Hub', '45-DLK Buon Ma Thuot Hub', '45-DLK Ea Kar Hub'],
    defaultHub: '45-DLK Krong Pak 02 Hub'
  },
  'aom.taynguyen@spxexpress.com': {
    email: 'aom.taynguyen@spxexpress.com',
    name: 'AOM Tây Nguyên',
    role: 'aom',
    level: 2,
    levelNum: 2,
    levelCode: 'aom',
    levelLabel: 'L2 - AOM',
    isRootAdmin: false,
    hubs: ['ALL', ...DEFAULT_STATIONS],
    defaultHub: '45-DLK Krong Pak 02 Hub'
  }
};

class AuthManager {
  /**
   * Xác thực và cấp quyền tài khoản Google Workspace
   */
  authenticate(email) {
    if (!email || typeof email !== 'string') {
      return { success: false, message: 'Email không hợp lệ' };
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Bắt buộc domain @spxexpress.com
    if (!cleanEmail.endsWith('@spxexpress.com')) {
      return {
        success: false,
        message: 'Chỉ tài khoản Google Workspace chính thức (@spxexpress.com) mới được phép đăng nhập!'
      };
    }

    // 2. Tra cứu trong danh bạ nội bộ
    let user = USERS_DIRECTORY[cleanEmail];

    if (!user) {
      const isRoot = (cleanEmail === 'xuan.nguyenthanh01@spxexpress.com' || cleanEmail.startsWith('admin.'));
      let role = 'staff';
      if (isRoot) role = 'admin';
      else if (cleanEmail.startsWith('rom.')) role = 'rom';
      else if (cleanEmail.startsWith('aom.')) role = 'aom';
      else if (cleanEmail.startsWith('sup.')) role = 'sup';
      else if (cleanEmail.startsWith('lead.')) role = 'lead';

      const lvlInfo = ROLE_LEVEL_MAP[role] || ROLE_LEVEL_MAP.staff;

      user = {
        email: cleanEmail,
        name: cleanEmail.split('@')[0].toUpperCase(),
        role: role,
        level: lvlInfo.levelNum,
        levelNum: lvlInfo.levelNum,
        levelCode: lvlInfo.levelCode,
        levelLabel: lvlInfo.levelLabel,
        isRootAdmin: isRoot,
        hubs: isRoot ? ['ALL', ...DEFAULT_STATIONS] : ['45-DLK Krong Pak 02 Hub'],
        defaultHub: '45-DLK Krong Pak 02 Hub'
      };
    }

    return {
      success: true,
      user
    };
  }

  getUser(email) {
    if (!email) return USERS_DIRECTORY['xuan.nguyenthanh01@spxexpress.com'];
    const cleanEmail = email.trim().toLowerCase();
    return USERS_DIRECTORY[cleanEmail] || this.authenticate(cleanEmail).user;
  }

  generateBootstrapData(user) {
    const isRootAdmin = (user.role === 'admin' || user.isRootAdmin);
    const hubs = isRootAdmin ? ['ALL', ...DEFAULT_STATIONS] : (user.hubs || ['45-DLK Krong Pak 02 Hub']);

    return {
      email: user.email,
      name: user.name,
      moduleAccess: {
        role: user.role,
        level: user.level || user.levelNum || 1,
        levelNum: user.levelNum || user.level || 1,
        levelCode: user.levelCode || user.role,
        levelLabel: user.levelLabel || (user.role === 'admin' ? 'Admin (L1)' : user.role.toUpperCase()),
        email: user.email,
        hubs: hubs,
        defaultHub: user.defaultHub || '45-DLK Krong Pak 02 Hub',
        isRootAdmin: isRootAdmin
      },
      analyticsPerm: {
        allowed: isRootAdmin || user.role === 'aom' || user.role === 'sup',
        stations: hubs
      },
      luongAccess: (isRootAdmin || user.role === 'lead') ? 'granted' : 'denied',
      hubOrgDir: {
        byHub: {},
        supNames: ['Sup Tây Nguyên', 'Sup Đắk Lắk'],
        aomNames: ['AOM Tây Nguyên']
      }
    };
  }
}

module.exports = new AuthManager();
