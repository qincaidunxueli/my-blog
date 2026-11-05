const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function pad(n) { return String(n).padStart(2, '0'); }
const now = new Date();
const msg = `更新文章 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

try {
  const status = run('git status --porcelain');
  if (!status.trim()) {
    console.log('');
    console.log('  没有检测到修改。是不是文章没保存？');
    console.log('  先去 VS Code 里按 Ctrl+S 保存，再双击这个。');
    console.log('');
    process.exit(0);
  }

  console.log('');
  console.log('  正在发布...');
  run('git add -A');
  run(`git commit -m "${msg}"`);
  const out = run('git push');
  console.log('  已上传到 GitHub。');
  console.log('');
  console.log('  等 1~2 分钟，手机上刷新博客就能看到了。');
  console.log('');
} catch (err) {
  console.log('');
  console.log('  出错了，把下面这段发给帮你搭站的人：');
  console.log('');
  console.log(String(err.message).slice(0, 1200));
  console.log('');
}
