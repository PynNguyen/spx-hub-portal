import urllib.request
import json
import subprocess
import time

# 1. Khởi động server nội bộ tạm thời trên port 3333 để test
print("--- 1. Kiểm tra syntax các file ---")
for f in ['server.js', 'services/rpc_dispatcher.js', 'services/sheets_service.js']:
    res = subprocess.run(['node', '-c', f], capture_output=True, text=True)
    if res.returncode == 0:
        print(f"  [OK] {f}")
    else:
        print(f"  [SYNTAX ERROR] {f}:\n{res.stderr}")

# 2. Xem cấu hình Auth và Google Sheets trong services/sheets_service.js
print("\n--- 2. Xem cơ chế Auth trong sheets_service.js ---")
with open('services/sheets_service.js', 'r') as f:
    lines = f.readlines()
    for i, line in enumerate(lines[:60]):
        if any(k in line for k in ['auth', 'token', 'key', 'credential', 'oauth', 'jwt', 'Scope']):
            print(f"  L{i+1}: {line.strip()}")

# 3. Test RPC Dispatcher trực tiếp bằng Node script
print("\n--- 3. Chạy thử 1 hàm RPC trực tiếp qua Node ---")
test_rpc_js = """
const rpc = require('./services/rpc_dispatcher');
(async () => {
  try {
    console.log('Testing spx_getSystemConfig...');
    const cfg = await rpc.dispatch('spx_getSystemConfig', []);
    console.log('spx_getSystemConfig OK:', typeof cfg);

    console.log('Testing spx_getOverviewPart (kpi)...');
    const ov = await rpc.dispatch('spx_getOverviewPart', ['kpi', '31-NAN Anh Son 02 Hub']);
    console.log('spx_getOverviewPart OK:', JSON.stringify(ov).slice(0, 100));
  } catch (err) {
    console.error('RPC DISPATCH ERROR:', err);
  }
})();
"""
with open('temp_test_rpc.js', 'w') as f:
    f.write(test_rpc_js)

res = subprocess.run(['node', 'temp_test_rpc.js'], capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print("STDERR:\n", res.stderr)

