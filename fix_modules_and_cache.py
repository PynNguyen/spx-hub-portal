import subprocess
import os

print("=== 1. TEST GỌI getModuleHtml VÀ spx_getWebAppUrl NỘI BỘ ===")
test_js = """
const gas = require('./services/gas_runtime');
try {
  console.log('Test spx_getWebAppUrl:', gas.call('spx_getWebAppUrl'));
} catch (e) {
  console.log('Lỗi spx_getWebAppUrl:', e.message);
}
try {
  console.log('Test getModuleHtml:', gas.call('getModuleHtml', ['JS_KPIFail']));
} catch (e) {
  console.log('Lỗi getModuleHtml:', e.message);
}
"""
with open('test_rpc_err.js', 'w') as f:
    f.write(test_js)

res = subprocess.run(['node', 'test_rpc_err.js'], capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print("Stderr:", res.stderr)
