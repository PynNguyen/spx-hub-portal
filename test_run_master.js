
const rpc = require('./services/rpc_dispatcher');
(async () => {
  console.log('\n[TEST 1] Thử lấy KPI Bundle:');
  const bundleRaw = await rpc.dispatch('flm_getKpiBundle', []);
  const bundle = JSON.parse(bundleRaw);
  console.log('  Tổng số Hub trong hệ thống:', bundle.hubs.length);

  // Tìm thử Anh Sơn 02
  const as = bundle.hubs.find(h => h[0].includes('Anh Son 02'));
  if (as) console.log('  -> Hub: ' + as[0] + ' | AOM: ' + as[2] + ' | SUP: ' + as[3] + ' | Sản lượng MTD: ' + as[6][0][1]);

  // Tìm thử Quế Phong
  const qp = bundle.hubs.find(h => h[0].includes('Que Phong'));
  if (qp) console.log('  -> Hub: ' + qp[0] + ' | AOM: ' + qp[2] + ' | SUP: ' + qp[3] + ' | Sản lượng MTD: ' + qp[6][0][1]);

  // Tìm thử Krông Pắc 02
  const kp = bundle.hubs.find(h => h[0].includes('Krong Pak 02'));
  if (kp) console.log('  -> Hub: ' + kp[0] + ' | AOM: ' + kp[2] + ' | SUP: ' + kp[3] + ' | Sản lượng MTD: ' + kp[6][0][1]);

  console.log('\n[TEST 2] Thử lấy Thẻ Tổng quan (spx_getOverviewPart):');
  const ovAs = await rpc.dispatch('spx_getOverviewPart', ['kpifail', '31-NAN Anh Son 02 Hub']);
  console.log('  Anh Sơn 02 kpifail:', ovAs);
  const ovKp = await rpc.dispatch('spx_getOverviewPart', ['kpifail', '45-DLK Krong Pak 02 Hub']);
  console.log('  Krông Pắc 02 kpifail:', ovKp);

  console.log('\n[TEST 3] Thử lấy Danh sách Đơn trễ (kpifail_getMasterDataLite):');
  const orders = await rpc.dispatch('kpifail_getMasterDataLite', ['31-NAN Anh Son 02 Hub']);
  console.log('  Số đơn trả về:', orders.data ? orders.data.length : 0);
})();
