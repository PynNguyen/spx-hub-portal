import urllib.request
import subprocess
import json

token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()

# Danh mục 379 Hub & AOM/Sup
org_sheet_id = "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY"
url = f"https://sheets.googleapis.com/v4/spreadsheets/{org_sheet_id}?fields=sheets.properties"

req = urllib.request.Request(url, headers={
    "Authorization": f"Bearer {token}",
    "X-Goog-User-Project": "spxshopee-280db"
})

try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        meta = json.loads(resp.read().decode())
        sheet_titles = [s['properties']['title'] for s in meta.get('sheets', [])]
        print("✅ THÀNH CÔNG RỒI! ĐÃ KẾT NỐI VÀO SHEET 379 HUB & AOM/SUP!")
        print("Các tab trong sheet:", sheet_titles)
except urllib.error.HTTPError as e:
    print(f"Mã lỗi HTTP: {e.code}")
    print("Chi tiết từ Google API:\n", e.read().decode())
