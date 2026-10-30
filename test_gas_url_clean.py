import urllib.request

# URL chính xác từ ảnh của bạn:
url = "https://script.google.com/a/macros/spxexpress.com/s/AKfycbz5xLn8WQ9b9eVaMEDeD8ruaOlpl1-ZzprJWUMh8KgclBUAEU_0JjlvxZIAI75nTw32/exec"

req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("Status:", resp.status)
        print("Final URL:", resp.geturl())
        print("Headers X-Frame-Options:", resp.headers.get("X-Frame-Options"))
except Exception as e:
    print("Kết quả:", e)
