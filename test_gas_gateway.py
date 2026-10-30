import urllib.request
import urllib.parse
import json
import subprocess

gas_url = "https://script.google.com/a/macros/spxexpress.com/s/AKfycbz5xLn8WQ9b9eVaMEDeD8ruaOIpl1-ZzprJWUMh8KgclBUAEU_0JjlvxZIAI75nTw32/exec"

print("="*60)
print("1. TEST GỌI GAS WEB APP BẰNG GET:")
try:
    req = urllib.request.Request(gas_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        print(f"Status: {resp.status}")
        print(f"Final URL: {resp.geturl()}")
        body = resp.read().decode('utf-8', errors='ignore')
        print(f"Body length: {len(body)} bytes")
        print(f"Snippet: {body[:250]}...")
except Exception as e:
    print(f"GET Lỗi: {e}")

print("\n" + "="*60)
print("2. TEST GỌI GAS WEB APP BẰNG POST (JSON RPC):")
try:
    payload = json.dumps({"func": "spx_getSystemConfig", "params": []}).encode('utf-8')
    req = urllib.request.Request(gas_url, data=payload, headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        print(f"Status: {resp.status}")
        print(f"Final URL: {resp.geturl()}")
        body = resp.read().decode('utf-8', errors='ignore')
        print(f"Body length: {len(body)} bytes")
        print(f"Snippet: {body[:250]}...")
except Exception as e:
    print(f"POST Lỗi: {e}")

print("\n" + "="*60)
print("3. TEST GỌI VỚI BEARER TOKEN (ADC):")
try:
    token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token']).decode().strip()
    req = urllib.request.Request(gas_url, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "Mozilla/5.0"
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        print(f"Status: {resp.status}")
        print(f"Final URL: {resp.geturl()}")
        body = resp.read().decode('utf-8', errors='ignore')
        print(f"Body length: {len(body)} bytes")
        print(f"Snippet: {body[:250]}...")
except Exception as e:
    print(f"Auth Lỗi: {e}")
