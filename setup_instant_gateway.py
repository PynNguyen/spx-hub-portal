import subprocess

server_patch = """const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const SPX_LIVE_APP_URL = "https://script.google.com/a/macros/spxexpress.com/s/AKfycbz5xLn8WQ9b9eVaMEDeD8ruaOlpL1-ZzprJWUMh8KgcIBUAEU_0JjlvxZlAI75nTw32/exec";

// Cổng điều hướng tập trung: Tự động chuyển tiếp thẳng vào Web App thật của SPX
app.get(['/', '/?*', '/api/rpc/*'], (req, res) => {
  res.redirect(SPX_LIVE_APP_URL);
});

// Trang trung chuyển với giao diện Portal chính thức
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`🚀 [SPX Portal Gateway] Active on port ${PORT} -> Forwarding to Live GAS App`);
});
"""

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(server_patch)

print("✅ Đã cập nhật server.js thành Cổng Gateway chuyển tiếp tức thì!")

# Đẩy lên Render
subprocess.run(['git', 'add', 'server.js'])
subprocess.run(['git', 'commit', '-m', 'feat: instant gateway redirect to live SPX Web App for 100% real data'])
res = subprocess.run(['git', 'push', 'origin', 'main'], capture_output=True, text=True)
print("Git push:", res.stdout or res.stderr)
