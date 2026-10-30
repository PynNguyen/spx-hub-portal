import urllib.request
import urllib.parse
import subprocess
import json

token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()
headers = {
    "Authorization": f"Bearer {token}",
    "X-Goog-User-Project": "spxshopee-280db"
}

sheets = {
    "1. 379 Hub & AOM/SUP": "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY",
    "2. KPI Fail (FM/LM/SOP)": "1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0",
    "3. Đơn cần cứu 48h": "18J7Wb_9VOPW-7dr85cgzPUzT0uKH_kFpkbzGBUSECVc",
    "4. Vi phạm / Khiếu nại": "1A0G2B7f-Ab_c1vAR4NrMtspnXDS34lzsi0eoWMAc2q0",
    "5. Rider Plan / FC": "1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA"
}

print("="*70)
print("KIỂM TRA TRUY CẬP 5 GOOGLE SHEETS THẬT:")
print("="*70)

for name, s_id in sheets.items():
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{s_id}?fields=sheets.properties"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            meta = json.loads(resp.read().decode())
            tabs = [s['properties']['title'] for s in meta.get('sheets', [])]
            print(f"✅ {name}: KẾT NỐI TỐT! Các tab: {tabs[:6]}")
    except Exception as e:
        print(f"❌ {name}: LỖI: {e}")

# Đọc thử 3 dòng đầu của tab 'Hub/SOC infor'
print("\n" + "="*70)
print("XEM CỘT VÀ DỮ LIỆU MẪU CỦA TAB [Hub/SOC infor]:")
print("="*70)
try:
    range_name = urllib.parse.quote("Hub/SOC infor!A1:N4")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY/values/{range_name}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        rows = json.loads(resp.read().decode()).get('values', [])
        for i, row in enumerate(rows):
            print(f"Dòng {i+1}: {row[:10]}")
except Exception as e:
    print("Lỗi đọc Hub/SOC infor:", e)
