const gas = require('./services/gas_runtime');

console.log('\n[TEST 1] Gọi hàm gốc: spx_getSystemConfig()');
const cfg = gas.call('spx_getSystemConfig');
console.log('  Kết quả:', typeof cfg === 'string' ? cfg.slice(0, 100) : cfg);

console.log('\n[TEST 2] Gọi hàm gốc: spx_getOverviewPart("kpifail", "45-DLK Krong Pak 02 Hub")');
const ovKp = gas.call('spx_getOverviewPart', ['kpifail', '45-DLK Krong Pak 02 Hub']);
console.log('  Krông Pắc 02 Overview gốc:', typeof ovKp === 'string' ? ovKp.slice(0, 150) : ovKp);

console.log('\n[TEST 3] Gọi hàm gốc: spx_getOverviewPart("kpifail", "45-DLK Mdrak Hub")');
const ovMd = gas.call('spx_getOverviewPart', ['kpifail', '45-DLK Mdrak Hub']);
console.log('  Mdrak Overview gốc:', typeof ovMd === 'string' ? ovMd.slice(0, 150) : ovMd);
