import urllib.request
import urllib.parse
import subprocess
import json

token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()
headers = {
    "Authorization": f"Bearer {token}",
    "X-Goog-User-Project": "spxshopee-280db"
}

def read_sample(sheet_id, tab_name, num_cols=12):
    # Luôn bọc tab_name trong nháy đơn để tránh lỗi ký tự đặc biệt như / hay []
    safe_range = f"'{tab_name}'!A1:{chr(65+num_cols)}3"
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{urllib.parse.quote(safe_range)}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode()).get('values', [])
            return data
    except Exception as e:
        return f"Error: {e}"

tests = [
    ("1. 379 Hub & AOM/SUP", "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY", "Hub/SOC infor"),
    ("1b. Quản lý AOM/Sup", "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY", "Khu vực quản lý (AOM/Sup)"),
    ("2. KPI Fail LM", "1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0", "LM"),
    ("3. Đơn cần cứu 48h", "18J7Wb_9VOPW-7dr85cgzPUzT0uKH_kFpkbzGBUSECVc", "[DE] ĐƠN CẦN CỨU 48H"),
    ("4. Vi phạm", "1A0G2B7f-Ab_c1vAR4NrMtspnXDS34lzsi0eoWMAc2q0", "complaint raw"),
    ("5. Rider Plan / FC", "1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA", "FC (auto)")
]

for title, s_id, tab in tests:
    print(f"\n=== {title} [{tab}] ===")
    sample = read_sample(s_id, tab, 10)
    if isinstance(sample, list) and len(sample) > 0:
        print("Header (Dòng 1):", sample[0])
        if len(sample) > 1:
            print("Dòng 2:", sample[1])
    else:
        print("Kết quả:", sample)

