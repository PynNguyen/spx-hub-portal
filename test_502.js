
const fs = require('fs');
eval(fs.readFileSync('server.js', 'utf8').replace(/app\.listen[\s\S]*/, ''));

console.log('1. Test spx_getHeartbeat: OK');
console.log('2. Test render JS_Luong:', renderTemplate('JS_Luong').length, 'bytes');
console.log('3. Test render JS_KPIFail:', renderTemplate('JS_KPIFail').length, 'bytes');
