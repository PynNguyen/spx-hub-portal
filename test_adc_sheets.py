import subprocess
import urllib.request
import urllib.parse
import json

# Lấy token từ Application Default Credentials vừa cấp quyền
token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()

# 1. Thử kéo dữ liệu thật tab LM (Sheet KPI Fail)
print("--- 1. ĐỌC DỮ LIỆU THẬT TAB LM (Sheet KPI Fail) ---")
kpi_id = "1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0"
url_kpi = f"https://sheets.googleapis.com/v4/spreadsheets/{kpi_id}/values/LM!A1:F5"
req = urllib.request.Request(url_kpi, headers={'Authorization': f'Bearer {token}'})

try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        print("🎉 THÀNH CÔNG! Dữ liệu thật tab LM:")
        for r in data.get('values', []):
            print("  ", r)
except Exception as e:
    print("❌ Lỗi KPI Fail:", e)

# 2. Thử kéo dữ liệu danh mục 379 Trạm & AOM/SUP
print("\n--- 2. ĐỌC DỮ LIỆU THẬT SHEET 379 TRẠM (AOM/SUP) ---")
org_id = "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY"
range_hub = urllib.parse.quote("'Hub/SOC infor'!A1:F5", safe='')
url_hub = f"https://sheets.googleapis.com/v4/spreadsheets/{org_id}/values/{range_hub}"
req2 = urllib.request.Request(url_hub, headers={'Authorization': f'Bearer {token}'})

try:
    with urllib.request.urlopen(req2) as resp:
        data2 = json.loads(resp.read().decode())
        print("🎉 THÀNH CÔNG! Dữ liệu thật danh mục 379 Trạm:")
        for r in data2.get('values', []):
            print("  ", r)
except Exception as e:
    print("❌ Lỗi Org Hub:", e)

