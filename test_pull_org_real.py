import urllib.request
import subprocess
import json

# Token thật từ quyền Google của anh/chị
token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()

# Sheet 1: Danh mục 379 Hub & AOM / SUP thật
org_sheet_id = "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY"
url = f"https://sheets.googleapis.com/v4/spreadsheets/{org_sheet_id}?fields=sheets.properties"

req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        meta = json.loads(resp.read().decode())
        sheet_titles = [s['properties']['title'] for s in meta.get('sheets', [])]
        print("✅ KẾT NỐI THÀNH CÔNG TỚI SHEET 379 HUB & AOM/SUP!")
        print("Các tab trong sheet:", sheet_titles)

        # Đọc thử 5 dòng đầu tab đầu tiên
        first_tab = sheet_titles[0]
        val_url = f"https://sheets.googleapis.com/v4/spreadsheets/{org_sheet_id}/values/{urllib.parse.quote(first_tab)}!A1:G5"
        val_req = urllib.request.Request(val_url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(val_req, timeout=10) as v_resp:
            vals = json.loads(v_resp.read().decode()).get('values', [])
            print(f"\n5 dòng dữ liệu THẬT đầu tiên từ tab [{first_tab}]:")
            for r in vals:
                print(r)
except Exception as e:
    print("Lỗi đọc sheet:", e)
