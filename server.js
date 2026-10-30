const express = require('express');
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
