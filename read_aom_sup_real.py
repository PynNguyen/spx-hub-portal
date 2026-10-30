import urllib.request
import urllib.parse
import subprocess
import json

token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()
headers = {
    "Authorization": f"Bearer {token}",
    "X-Goog-User-Project": "spxshopee-280db"
}

# 1. Thử đọc tab 'AOM SUP' từ Sheet 5 (Rider Plan)
s5_id = "1Tqy2J-679RFeOBSpuAt3U-55w5Kxoeqe8gH5GXHJoxA"
url5 = f"https://sheets.googleapis.com/v4/spreadsheets/{s5_id}/values/AOM%20SUP!A1:H5"
req5 = urllib.request.Request(url5, headers=headers)
try:
    with urllib.request.urlopen(req5, timeout=10) as resp:
        rows = json.loads(resp.read().decode()).get('values', [])
        print("=== DỮ LIỆU TỪ SHEET 5 [AOM SUP] ===")
        for r in rows:
            print(r)
except Exception as e:
    print("Sheet 5 AOM SUP Error:", e)

# 2. Đọc tab 'Hub/SOC infor' từ Sheet 1 qua values:batchGet
s1_id = "1gtn1Z1n0hZp0QXWrWKo8hdBR_Pt9lkJsiJAyxA0uYPY"
range_query = urllib.parse.quote("'Hub/SOC infor'!A1:K5")
url1 = f"https://sheets.googleapis.com/v4/spreadsheets/{s1_id}/values:batchGet?ranges={range_query}"
req1 = urllib.request.Request(url1, headers=headers)
try:
    with urllib.request.urlopen(req1, timeout=10) as resp:
        data = json.loads(resp.read().decode())
        rows = data.get('valueRanges', [{}])[0].get('values', [])
        print("\n=== DỮ LIỆU TỪ SHEET 1 [Hub/SOC infor] (batchGet) ===")
        for r in rows:
            print(r)
except Exception as e:
    print("Sheet 1 Hub/SOC infor Error:", e)
