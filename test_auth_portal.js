
const fs = require('fs');
eval(fs.readFileSync('server.js', 'utf8').replace(/app\.listen[\s\S]*/, ''));
const gas = require('./services/gas_runtime');

const html = renderTemplate('index');
console.log('1. Kích thước trang index.html gốc hoàn chỉnh:', html.length.toLocaleString(), 'bytes');
const res = gas.call('spx_getOverviewPart', ['kpifail', '45-DLK Mdrak Hub']);
console.log('2. Dữ liệu tính toán từ .gs gốc cho Mdrak Hub:', res.data);
