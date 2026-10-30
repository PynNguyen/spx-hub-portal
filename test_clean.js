
const fs = require('fs');
eval(fs.readFileSync('server.js', 'utf8').replace(/app\.listen[\s\S]*/, ''));
const html = renderTemplate('index');
const lines = html.split('\n');
console.log('Soi các dòng 30 đến 45 sau khi render:');
for (let i = 29; i < Math.min(45, lines.length); i++) {
  console.log((i+1) + ': ' + lines[i]);
}

const match = html.match(/<\?[\s\S]*?\?>/g);
console.log('Số lượng thẻ <? còn sót lại:', match ? match.length : 0);
