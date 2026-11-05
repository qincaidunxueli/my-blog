const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function pad(n) { return String(n).padStart(2, '0'); }
const now = new Date();
const msg = `更新文章 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

// 把 Obsidian 生成的相对图片路径改成站点绝对路径：../images/x.png  ->  /images/x.png
function fixImagePaths() {
  const postsDir = path.join(root, 'source', '_posts');
  let fixed = [];
  for (const f of fs.readdirSync(postsDir)) {
    if (!f.endsWith('.md')) continue;
    const p = path.join(postsDir, f);
    const src = fs.readFileSync(p, 'utf8');
    const out = src
      .replace(/\]\(\.\.\/images\//g, '](/images/')
      .replace(/\]\(images\//g, '](/images/');
    if (out !== src) {
      fs.writeFileSync(p, out, 'utf8');
      fixed.push(f);
    }
  }
  if (fixed.length) console.log('  已修正图片路径：' + fixed.join('、'));
}

try {
  fixImagePaths();

  const status = run('git status --porcelain');
  if (!status.trim()) {
    console.log('');
    console.log('  没有检测到修改。是不是文章没保存？');
    console.log('  先在编辑器里按 Ctrl+S 保存，再双击这个。');
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
