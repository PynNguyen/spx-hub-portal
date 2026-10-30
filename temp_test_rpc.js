
const rpc = require('./services/rpc_dispatcher');
(async () => {
  try {
    console.log('Testing spx_getSystemConfig...');
    const cfg = await rpc.dispatch('spx_getSystemConfig', []);
    console.log('spx_getSystemConfig OK:', typeof cfg);

    console.log('Testing spx_getOverviewPart (kpi)...');
    const ov = await rpc.dispatch('spx_getOverviewPart', ['kpi', '31-NAN Anh Son 02 Hub']);
    console.log('spx_getOverviewPart OK:', JSON.stringify(ov).slice(0, 100));
  } catch (err) {
    console.error('RPC DISPATCH ERROR:', err);
  }
})();
