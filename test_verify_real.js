
const gas = require('./services/gas_runtime');

function check(st) {
  const raw = gas.call('spx_getOverviewPart', ['kpifail', st]);
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  console.log(`📊 Kết quả trạm [${st}]:`, parsed.data);
}

check('45-DLK Krong Pak 02 Hub');
check('45-DLK Mdrak Hub');
