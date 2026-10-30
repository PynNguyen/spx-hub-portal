import subprocess
import urllib.request
import json

print("=== 1. TÌM VỊ TRÍ HARDCODE MOCK DATA ===")
res = subprocess.run(["grep", "-rnE", "Trần Hữu Danh|AOM 1|44570|44,570", "services/", "data/"], capture_output=True, text=True)
print(res.stdout if res.stdout else "Không tìm thấy trong services/ và data/")

print("\n=== 2. KIỂM TRA PHƯƠNG THỨC flm_getKpiBundle TRONG rpc_dispatcher.js ===")
with open("services/rpc_dispatcher.js", "r") as f:
    content = f.read()
    idx = content.find("flm_getKpiBundle")
    if idx != -1:
        print(content[idx:idx+1200])
    else:
        print("Không tìm thấy flm_getKpiBundle trong rpc_dispatcher.js")

print("\n=== 3. KIỂM TRA QUYỀN ĐỌC CỦA GOOGLE SHEET (KHÔNG CẦN AUTH) ===")
# Test xem sheet có được public 'bất kỳ ai có liên kết' không
sheet_id = "1pcQJB_-ZxGQQwg20GreeLhMovocfs6u1sIqrjQHsJQ0"
test_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:json&sheet=LM"
try:
    req = urllib.request.Request(test_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = resp.read().decode('utf-8', errors='ignore')
        if "google.visualization.Query.setResponse" in body:
            print(">>> TIN VUI: Sheet cho phép đọc trực tiếp qua GViz API (KHÔNG CẦN AUTH PHỨC TẠP)!")
            print(f"Dữ liệu mẫu: {body[:150]}...")
        else:
            print("Sheet yêu cầu đăng nhập Google:", body[:100])
except Exception as e:
    print("Không thể đọc public:", e)
