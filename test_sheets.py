import subprocess
import urllib.request
import urllib.parse
import json

try:
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
    sheet_id = "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY"
    range_name = "'Hub/SOC infor'!A1:F3"
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{urllib.parse.quote(range_name)}"
    
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode())
        print("🎉 KẾT QUẢ ĐỌC GOOGLE SHEETS THÀNH CÔNG:")
        print(json.dumps(res, ensure_ascii=False, indent=2))
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code, e.read().decode())
except Exception as e:
    print("Lỗi khác:", e)
