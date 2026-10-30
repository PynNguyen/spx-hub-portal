
const engine = require('./services/spx_core_engine');

console.log('1. Test trạm 45-DLK Mdrak Hub:');
console.log('   KPI Fail:', engine.getOverview('45-DLK Mdrak Hub').kpifail);

console.log('2. Test trạm 45-DLK Krong Pak 02 Hub:');
console.log('   KPI Fail:', engine.getOverview('45-DLK Krong Pak 02 Hub').kpifail);

console.log('3. Số trạm đọc từ database thật:', engine.getStations().length);
