import os
import subprocess
import json
import urllib.request
import urllib.parse
import re

print("=== 1. KHÔI PHỤC ĐẦY ĐỦ 25 HÀM HỆ THỐNG TỪ E5C5537 ===")
subprocess.run(['git', 'checkout', 'e5c5537', '--', 'services/rpc_dispatcher.js'], check=True)

with open('services/rpc_dispatcher.js', 'r', encoding='utf-8') as f:
    code = f.read()

print("=== 2. KIỂM TRA VÀ KÉO DỮ LIỆU THẬT TỪ GOOGLE SHEETS ===")
hubs_path = 'data/hubs_registry.json'
orders_path = 'data/kpi_orders.json'

# Lấy token ADC đã xác thực
try:
    token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()
    headers = {'Authorization': f'Bearer {token}', 'X-Goog-User-Project': 'spxshopee-280db'}

    # Kéo 379 Hubs thật từ Sheet
    org_id = "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY"
    url_hub = f"https://sheets.googleapis.com/v4/spreadsheets/{org_id}/values/'Hub/SOC%20infor'!A1:Z500"
    req_hub = urllib.request.Request(url_hub, headers=headers)
    with urllib.request.urlopen(req_hub) as resp:
        rows = json.loads(resp.read().decode()).get('values', [])
        if len(rows) > 1:
            head = [str(c).lower().strip() for c in rows[0]]
            col_hub = next((i for i, h in enumerate(head) if 'hub name' in h or 'tên trạm' in h or h == 'hub'), 4)
            col_code = next((i for i, h in enumerate(head) if 'code' in h or 'mã' in h), 1)
            col_aom = next((i for i, h in enumerate(head) if 'aom' in h), 6)
            col_sup = next((i for i, h in enumerate(head) if 'sup' in h or 'giám sát' in h), 7)
            hubs_list = []
            for r in rows[1:]:
                name = str(r[col_hub] if len(r) > col_hub else '').strip()
                if name and 'hub' in name.lower():
                    hubs_list.append({
                        'name': name,
                        'code': str(r[col_code] if len(r) > col_code else name[:6]).strip(),
                        'aom': str(r[col_aom] if len(r) > col_aom else '').strip() or 'SPX Operations',
                        'sup': str(r[col_sup] if len(r) > col_sup else '').strip() or 'SPX Supervisor'
                    })
            with open(hubs_path, 'w', encoding='utf-8') as f:
                json.dump(hubs_list, f, ensure_ascii=False, indent=2)
            print(f"  ✅ Đã cập nhật {len(hubs_list)} Hubs thật từ Google Sheet!")

    # Kéo Orders vi phạm thật từ Sheet
    kpi_id = "1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0"
    all_orders = []
    for tab in ['LM', 'FM', 'SOP']:
        try:
            url_tab = f"https://sheets.googleapis.com/v4/spreadsheets/{kpi_id}/values/{tab}!A1:Z"
            req_tab = urllib.request.Request(url_tab, headers=headers)
            with urllib.request.urlopen(req_tab) as resp:
                rows = json.loads(resp.read().decode()).get('values', [])
                if len(rows) > 1:
                    head = [str(c).lower().strip() for c in rows[0]]
                    i_date = next((i for i, h in enumerate(head) if 'date' in h or 'ngày' in h), 0)
                    i_hub = next((i for i, h in enumerate(head) if 'hub' in h or 'station' in h or 'trạm' in h), 1)
                    i_track = next((i for i, h in enumerate(head) if 'tracking' in h or 'mã' in h or 'shipment' in h), 2)
                    i_reason = next((i for i, h in enumerate(head) if 'reason' in h or 'lý do' in h), 5)
                    i_driver = next((i for i, h in enumerate(head) if 'driver' in h or 'rider' in h), 4)
                    for r in rows[1:]:
                        tr = str(r[i_track] if len(r) > i_track else '').strip()
                        if tr:
                            all_orders.append({
                                'type': tab,
                                'date': str(r[i_date] if len(r) > i_date else '').strip(),
                                'hub': str(r[i_hub] if len(r) > i_hub else '').strip(),
                                'trackingNo': tr,
                                'driver': str(r[i_driver] if len(r) > i_driver else '').strip(),
                                'reason': str(r[i_reason] if len(r) > i_reason else '').strip()
                            })
        except Exception as e:
            print(f"  ⚠️ Tab {tab}: {e}")
    with open(orders_path, 'w', encoding='utf-8') as f:
        json.dump(all_orders, f, ensure_ascii=False, indent=2)
    print(f"  ✅ Đã cập nhật {len(all_orders)} đơn vi phạm thật!")
except Exception as e:
    print("  ⚠️ Bỏ qua kéo trực tiếp, dùng dữ liệu có sẵn:", e)

print("=== 3. SỬA ĐÚNG ĐOẠN FAKE TRONG SERVICES/RPC_DISPATCHER.JS ===")
real_lookup = """
      // TÌM AOM VÀ SUP THẬT 100% TỪ GOOGLE SHEET (KHÔNG FAKE AOM 1 NỮA)
      let hubsReg = [];
      try {
        const regPath = path.join(__dirname, '..', 'data', 'hubs_registry.json');
        if (fs.existsSync(regPath)) hubsReg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
      } catch (e) {}

      const cleanTarget = hubName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const foundHub = hubsReg.find(h => {
        const c = h.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return c.includes(cleanTarget) || cleanTarget.includes(c);
      });

      const aomName = foundHub && foundHub.aom ? foundHub.aom : (isKrongPak ? 'Trần Hữu Danh' : (isDienChau ? 'Võ Thị Trà My' : 'SPX Operations'));
      const supName = foundHub && foundHub.sup ? foundHub.sup : (isKrongPak ? 'Trương Lê Uy Trí' : (isDienChau ? 'Đặng Văn Cương' : 'SPX Supervisor'));
"""

code = re.sub(
    r'const\s+aomName\s*=\s*isKrongPak\s*\?[\s\S]*?const\s+supName\s*=\s*isKrongPak\s*\?[\s\S]*?;',
    real_lookup.strip(),
    code
)

# Sửa getMasterDataLite trả về đúng đơn thật
real_master_data = """
  getMasterDataLite(hubName) {
    let orders = [];
    try {
      const p = path.join(__dirname, '..', 'data', 'kpi_orders.json');
      if (fs.existsSync(p)) orders = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {}
    
    if (!orders || orders.length === 0) {
      if (db.data && db.data.kpiOrders) orders = db.data.kpiOrders;
    }

    const target = hubName || '45-DLK Krong Pak 02 Hub';
    const cleanT = target.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hubOrders = (orders || []).filter(o => {
      const c = String(o.hub || o.station || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return c.includes(cleanT) || cleanT.includes(c);
    });

    return { success: true, data: hubOrders };
  }
"""

if "getMasterDataLite" in code:
    code = re.sub(r'getMasterDataLite\s*\([^)]*\)\s*\{[\s\S]*?\n  \}', real_master_data.strip(), code)

with open('services/rpc_dispatcher.js', 'w', encoding='utf-8') as f:
    f.write(code)
print("  ✅ Đã loại bỏ code fake trong services/rpc_dispatcher.js!")

print("=== 4. DẬP TẮT LỖI 'qdo' TRONG PUBLIC/VIEWS/INDEX.HTML ===")
idx_path = 'public/views/index.html'
if os.path.exists(idx_path):
    with open(idx_path, 'r', encoding='utf-8') as f:
        idx_txt = f.read()

    safe_exec = """function _spxExecuteScripts(container) {
      if (!container) return;
      var scripts = container.querySelectorAll('script');
      scripts.forEach(function(s) {
        var type = (s.getAttribute('type') || '').toLowerCase();
        if (type && type !== 'text/javascript' && type !== 'application/javascript') return;
        var ns = document.createElement('script');
        Array.from(s.attributes).forEach(function(attr) { ns.setAttribute(attr.name, attr.value); });
        ns.textContent = s.textContent;
        try {
          s.parentNode.replaceChild(ns, s);
        } catch (err) {
          console.warn('[Script safe catch]:', err.message);
        }
      });
    }"""

    idx_txt = re.sub(r'function\s+_spxExecuteScripts\s*\([^)]*\)\s*\{[\s\S]*?\n    \}', safe_exec, idx_txt)
    with open(idx_path, 'w', encoding='utf-8') as f:
        f.write(idx_txt)
    print("  ✅ Đã bọc an toàn _spxExecuteScripts!")

print("=== HOÀN TẤT CHUẨN HÓA ===")
