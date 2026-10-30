import subprocess
import urllib.request
import urllib.parse
import json

token = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()

# 1. Thử đọc tab LM của Sheet KPI Fail (Chứa 14 đơn vi phạm của Hương Khê)
print("--- 1. ĐỌC SHEET KPI FAIL (Tab LM) ---")
kpi_id = "1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0"
url_kpi = f"https://sheets.googleapis.com/v4/spreadsheets/{kpi_id}/values/LM!A1:F5"

req_kpi = urllib.request.Request(url_kpi, headers={'Authorization': f'Bearer {token}'})
try:
    with urllib.request.urlopen(req_kpi) as resp:
        data = json.loads(resp.read().decode())
        print("✅ Thành công! Dữ liệu mẫu tab LM:")
        for r in data.get('values', []):
            print("  ", r)
except Exception as e:
    print("❌ Lỗi đọc KPI Fail:", e)

# 2. Thử đọc Sheet 379 Hub (Mã hóa safe='' để không bị lỗi dấu gạch chéo /)
print("\n--- 2. ĐỌC SHEET DANH MỤC 379 HUB ---")
org_id = "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY"
range_hub = urllib.parse.quote("'Hub/SOC infor'!A1:F3", safe='')
url_hub = f"https://sheets.googleapis.com/v4/spreadsheets/{org_id}/values/{range_hub}"

req_hub = urllib.request.Request(url_hub, headers={'Authorization': f'Bearer {token}'})
try:
    with urllib.request.urlopen(req_hub) as resp:
        data = json.loads(resp.read().decode())
        print("✅ Thành công! Tiêu đề các cột trong Sheet Hub:")
        for r in data.get('values', []):
            print("  ", r)
except Exception as e:
    print("❌ Lỗi đọc Org Hub:", e)

