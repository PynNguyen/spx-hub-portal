import urllib.request
import subprocess
import os

exact_url = "https://script.google.com/a/macros/spxexpress.com/s/AKfycbz5xLn8WQ9b9eVaMEDeD8ruaOlpL1-ZzprJWUMh8KgcIBUAEU_0JjlvxZlAI75nTw32/exec"

print("--- 1. Kiểm tra URL chuẩn xác ---")
req = urllib.request.Request(exact_url, headers={"User-Agent": "Mozilla/5.0"})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("Trạng thái:", resp.status)
        print("X-Frame-Options:", resp.headers.get("X-Frame-Options"))
except Exception as e:
    print("Thông tin phản hồi:", e)

print("\n--- 2. Tạo giao diện Cổng Portal nhúng toàn màn hình ---")
embed_html = f"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SPX HUB · FLM Assistant (Live Portal)</title>
  <style>
    html, body {{
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }}
    #portal-frame {{
      width: 100vw;
      height: 100vh;
      border: none;
      display: block;
    }}
    .top-bar {{
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 38px;
      background: #1e293b;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-size: 13px;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }}
    .top-bar a {{
      color: #38bdf8;
      text-decoration: none;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
    }}
    .top-bar a:hover {{
      background: rgba(56, 189, 248, 0.2);
    }}
    .frame-container {{
      position: absolute;
      top: 38px;
      left: 0;
      right: 0;
      bottom: 0;
    }}
  </style>
</head>
<body>
  <div class="top-bar">
    <div style="display:flex; align-items:center; gap:10px;">
      <span style="font-weight:700; color:#ee4d2d;">SPX HUB</span>
      <span style="color:#94a3b8;">|</span>
      <span>Cổng điều hành tập trung (Dữ liệu Live 100% từ Google Apps Script)</span>
    </div>
    <div>
      <a href="{exact_url}" target="_blank">↗ Mở tab độc lập</a>
    </div>
  </div>
  <div class="frame-container">
    <iframe id="portal-frame" src="{exact_url}" allow="clipboard-read; clipboard-write; geolocation"></iframe>
  </div>
</body>
</html>
"""

# Lưu vào public/views/index.html
with open('public/views/index.html', 'w', encoding='utf-8') as f:
    f.write(embed_html)
print("✅ Đã cập nhật public/views/index.html thành Cổng Portal Live!")

# Đẩy code lên GitHub để Render deploy
print("\n--- 3. Commit và Đẩy lên Render ---")
subprocess.run(['git', 'add', 'public/views/index.html'])
subprocess.run(['git', 'commit', '-m', 'feat: deploy live GAS Web App embed portal with 100% authentic data'])
res = subprocess.run(['git', 'push', 'origin', 'main'], capture_output=True, text=True)
print("Git push:", res.stdout or res.stderr)
