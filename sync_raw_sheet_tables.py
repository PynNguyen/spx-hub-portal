import urllib.request
import urllib.parse
import subprocess
import json
import os

token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()
headers = {
    "Authorization": f"Bearer {token}",
    "X-Goog-User-Project": "spxshopee-280db"
}

def fetch_raw(sheet_id, range_a1):
    safe_range = urllib.parse.quote(range_a1)
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values:batchGet?ranges={safe_range}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            ranges = data.get('valueRanges', [])
            if ranges and 'values' in ranges[0]:
                return ranges[0]['values']
            return []
    except Exception as e:
        print(f"  Lỗi {range_a1}: {e}")
        return []

print("=== BẮT ĐẦU TẢI RAW BẢNG TỪ GOOGLE SHEETS THẬT ===")
tables = {}

# Sheet 2: KPI Fail (FM, LM, SOP)
s2_id = "1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0"
for t in ['FM', 'LM', 'SOP']:
    print(f"-> Tải tab [{t}]...")
    tables[t] = fetch_raw(s2_id, f"'{t}'!A1:R2500")
    print(f"   Đã nạp {len(tables[t])} dòng, Tiêu đề: {tables[t][0] if tables[t] else []}")

# Sheet 5: AOM SUP & FC
s5_id = "1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA"
print("-> Tải tab [AOM SUP]...")
tables['AOM SUP'] = fetch_raw(s5_id, "'AOM SUP'!A1:H500")
print("-> Tải tab [FC (auto)]...")
tables['FC (auto)'] = fetch_raw(s5_id, "'FC (auto)'!A1:AE500")

# Sheet 4: complaint raw
s4_id = "1A0G2B7f-Ab_c1vAR4NrMtspnXDS34lzsi0eoWMAc2q0"
print("-> Tải tab [complaint raw]...")
tables['complaint raw'] = fetch_raw(s4_id, "'complaint raw'!A1:N1500")

# Sheet 3: Đơn cần cứu 48h
s3_id = "18J7Wb_9VOPW-7dr85cgzPUzT0uKH_kFpkbzGBUSECVc"
print("-> Tải tab [Đơn cần cứu 48h]...")
tables['rescue'] = fetch_raw(s3_id, "'[DE] ĐƠN CẦN CỨU 48H'!A2:G500")

with open('data/sheet_tables.json', 'w', encoding='utf-8') as f:
    json.dump(tables, f, ensure_ascii=False)

print(f"\n✅ ĐÃ LƯU BẢNG RAW CHUẨN XÁC VÀO data/sheet_tables.json!")

# Cập nhật getSheetValues trong services/gas_runtime.js
runtime_path = 'services/gas_runtime.js'
with open(runtime_path, 'r', encoding='utf-8') as f:
    rt_code = f.read()

# Thay thế hàm getSheetValues
old_func_pattern = """  getSheetValues(name, wsData) {
    const sName = String(name || '').toLowerCase();
    if (sName.includes('aom') || sName.includes('sup')) {
      const rows = [['STT', 'Provinces', 'AOM', 'AOM_Email', 'Sup_Name', 'Sup_Email', 'Hub']];
      if (wsData.hubOrgMap) {
        let i = 1;
        for (const [k, v] of Object.entries(wsData.hubOrgMap)) {
          rows.push([String(i++), v.province || '', v.aom || '', v.aomEmail || '', v.sup || '', v.supEmail || '', k]);
        }
      }
      return rows;
    }
    if (sName.includes('lm') || sName.includes('fm') || sName.includes('kpi')) {
      const rows = [['ctime_date', 'Station Name', 'Shipment ID', 'Arrived Time', 'First Attempt Time', 'LM ETA', 'Type']];
      if (wsData.kpiOrders) {
        for (const o of wsData.kpiOrders) {
          rows.push([o.date, o.station, o.orderId, o.arrivedTime, '', o.eta, o.type || o.category]);
        }
      }
      return rows;
    }
    return [['Header1', 'Header2'], ['Value1', 'Value2']];
  }"""

new_func = """  getSheetValues(name) {
    if (!this.sheetTables) {
      try {
        const p = path.join(__dirname, '../data/sheet_tables.json');
        this.sheetTables = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
      } catch (e) { this.sheetTables = {}; }
    }
    const clean = String(name || '').trim();
    for (const [k, rows] of Object.entries(this.sheetTables)) {
      if (k.toLowerCase() === clean.toLowerCase() || clean.toLowerCase().includes(k.toLowerCase())) {
        return rows;
      }
    }
    return [['Col1'], ['Val1']];
  }"""

rt_code = rt_code.replace(old_func_pattern, new_func)
rt_code = rt_code.replace("this.getSheetValues(sheetName, wsData)", "this.getSheetValues(sheetName)")

with open(runtime_path, 'w', encoding='utf-8') as f:
    f.write(rt_code)

print("✅ Đã nối dữ liệu thật nguyên bản vào SpreadsheetApp trong services/gas_runtime.js!")
