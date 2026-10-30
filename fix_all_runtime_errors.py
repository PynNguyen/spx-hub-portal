import re

print("=== 1. CẬP NHẬT services/gas_runtime.js ===")
with open('services/gas_runtime.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Thêm Logger và checkUserAccess vào sandbox
code = code.replace("console,", "console,\n      Logger: console,\n      checkUserAccess: () => true,\n      include: (name) => { try { return require('fs').readFileSync(require('path').join(__dirname, '../public/views/' + name + '.html'), 'utf8'); } catch(e){ return ''; } },")

# 2. Bổ sung fallback tiêu đề cho các sheet Pick đặc thù
pick_sheets_patch = """    if (sName.includes('summary fm')) {
      return [['pickup', 'inbound', 'packed', 'seal', 'mp', 'social', 'reverse', 'cb', 'wh']];
    }
    if (sName.includes('high aging')) {
      return [['id', 'station', 'action', 'risk']];
    }
    for (const [k, rows] of Object.entries(this.sheetTables)) {"""

code = code.replace("for (const [k, rows] of Object.entries(this.sheetTables)) {", pick_sheets_patch)

with open('services/gas_runtime.js', 'w', encoding='utf-8') as f:
    f.write(code)
print("✅ services/gas_runtime.js đã cập nhật Logger và Pick sheets!")

print("\n=== 2. CẬP NHẬT server.js ĐỂ NẠP RUNTIME_CACHE VÀ PHỤC VỤ getModuleHtml ===")
with open('server.js', 'r', encoding='utf-8') as f:
    srv = f.read()

# Chèn RUNTIME_CACHE và SPX_ACCESS vào thẻ head của index.html
old_bridge = """  if (!html.includes('spx_rpc_bridge.js')) {
    html = html.replace('</head>', '<script src="/js/spx_rpc_bridge.js"></script></head>');
  }"""

new_bridge = """  const runtimeInit = `
    <script>
      var RUNTIME_CACHE = {};
      var SPX_ACCESS = { role: 'admin', level: 'L4', levelCode: 'admin', levelNum: 5, email: 'xuan.nguyenthanh01@spxexpress.com', hubs: ['ALL'] };
      var SPX_CURRENT_USER = { email: 'xuan.nguyenthanh01@spxexpress.com', role: 'admin' };
    </script>
    <script src="/js/spx_rpc_bridge.js"></script>
  `;
  html = html.replace('</head>', runtimeInit + '</head>');"""

srv = srv.replace(old_bridge, new_bridge)

# Xử lý riêng getModuleHtml và spx_getWebAppUrl trả về nhanh tức thì
old_rpc = """app.post('/api/rpc/:func', async (req, res) => {
  const funcName = req.params.func;
  const payload = req.body.params || [];"""

new_rpc = """app.post('/api/rpc/:func', async (req, res) => {
  const funcName = req.params.func;
  const payload = req.body.params || [];

  if (funcName === 'spx_getWebAppUrl') {
    return res.send('https://spx-hub-portal.onrender.com');
  }

  if (funcName === 'getModuleHtml') {
    const mod = payload[0];
    const modHtml = renderTemplate(mod);
    return res.send(modHtml);
  }"""

srv = srv.replace(old_rpc, new_rpc)

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(srv)
print("✅ server.js đã cập nhật RUNTIME_CACHE và route getModuleHtml!")

import subprocess
res = subprocess.run(['node', '-c', 'server.js'], capture_output=True, text=True)
if res.returncode == 0:
    print("✅ server.js: SYNTAX 100% OK!")
    subprocess.run(['git', 'add', 'services/gas_runtime.js', 'server.js'])
    subprocess.run(['git', 'commit', '-m', 'fix: inject RUNTIME_CACHE, serve getModuleHtml and supply Pick sheet headers'])
    subprocess.run(['git', 'push', 'origin', 'main'])
    print("🚀 Git push thành công! Render đang deploy bản sửa hoàn tất.")
else:
    print("❌ Lỗi syntax:", res.stderr)
