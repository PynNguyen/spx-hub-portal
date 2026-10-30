
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
