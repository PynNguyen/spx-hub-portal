
const fs = require('fs');
const path = require('path');

function check() {
  const viewsDir = './public/views';
  let c = fs.readFileSync(path.join(viewsDir, 'index.html'), 'utf8');
  c = c.replace(/<\?!=\s*include\(['"]([^'"]+)['"]\)\s*\?>/g, (m, p) => {
    try {
      let sub = p.endsWith('.html') ? p : p + '.html';
      return fs.readFileSync(path.join(viewsDir, sub), 'utf8');
    } catch(e) { return ''; }
  });
  
  const lines = c.split('\n');
  console.log('Soi dòng 55-68 sau khi render:');
  for (let i = 54; i < Math.min(lines.length, 68); i++) {
    console.log((i+1) + ': ' + lines[i]);
  }
}
check();
