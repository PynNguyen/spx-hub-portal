import urllib.request

url = "https://script.google.com/a/macros/spxexpress.com/s/AKfycbz5xLn8WQ9b9eVaMEDeD8ruaOlpL1-ZzprJWUMh8KgcIBUAEU_0JjlvxZlAI75nTw32/exec"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode('utf-8', errors='ignore')
        print(f"Độ dài HTML: {len(body)} bytes")
        print("Trích đoạn 300 ký tự đầu:")
        print(body[:300])
except Exception as e:
    print("Lỗi:", e)
