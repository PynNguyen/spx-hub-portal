const express = require('express');
const path = require('path');
const engine = require('./services/spx_core_engine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 1. APIs dữ liệu chuẩn
app.get('/api/stations', (req, res) => {
  res.json(engine.getStations());
});

app.get('/api/overview/:station', (req, res) => {
  res.json(engine.getOverview(req.params.station));
});

app.get('/api/kpifail/:station', (req, res) => {
  res.json(engine.getKpiFailOrders(req.params.station));
});

app.get('/api/pick/:station', (req, res) => {
  res.json(engine.getPickOrders(req.params.station));
});

// Giữ lại tương thích RPC cũ nếu frontend có gọi
app.all('/api/rpc/:fn', (req, res) => {
  const fn = req.params.fn;
  const args = Array.isArray(req.body) ? req.body : [];
  const st = args[1] || '45-DLK Mdrak Hub';

  if (fn === 'spx_getOverviewPart') {
    const ov = engine.getOverview(st);
    const part = args[0] || 'kpifail';
    return res.json({ success: true, part, data: ov[part] || ov.kpifail });
  }
  if (fn === 'spx_getWebAppUrl') return res.json('https://spx-hub-portal.onrender.com');
  if (fn === 'spx_getHeartbeat') return res.json({ status: 'OK' });

  return res.json({ success: true, data: [] });
});

// 2. Phục vụ Master SPA
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/views/login.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Modern SPX Portal running at http://localhost:${PORT}`);
});
