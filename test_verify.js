
const gas = require('./services/gas_runtime');
const fs = require('fs');

console.log('1. Test spx_getWebAppUrl:', gas.call('spx_getWebAppUrl'));

const modules = ['JS_KPIFail', 'JS_Pick', 'JS_FMS', 'JS_Quahan', 'JS_RiderPlan', 'JS_ViPham', 'JS_Rescue', 'JS_Admin', 'JS_BI', 'JS_TraCuu', 'JS_TaiLieu', 'JS_Luong'];
modules.forEach(m => {
  const p = 'public/views/' + m + '.html';
  if (fs.existsSync(p)) {
    console.log(`✅ Module ${m}: Sẵn sàng (${fs.statSync(p).size} bytes)`);
  } else {
    console.log(`❌ Module ${m}: Thiếu file!`);
  }
});

const md = gas.call('spx_getOverviewPart', ['kpifail', '45-DLK Krong Pak 02 Hub']);
console.log('2. Test tính toán Krông Pắc 02:', md.data);
