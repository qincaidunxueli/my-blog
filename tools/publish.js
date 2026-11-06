const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function pad(n) { return String(n).padStart(2, '0'); }
const now = new Date();
const msg = `更新文章 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

// 递归列出 _posts 下所有 .md（支持分类文件夹）
function walkMd(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// 把 Obsidian 生成的相对图片路径改成站点绝对路径：../../images/x.png -> /images/x.png
function fixImagePaths() {
  const postsDir = path.join(root, 'source', '_posts');
  let fixed = [];
  for (const p of walkMd(postsDir)) {
    const src = fs.readFileSync(p, 'utf8');
    const out = src
      .replace(/\]\((?:[.][.]\/)+images\//g, '](/images/')
      .replace(/\]\(images\//g, '](/images/');
    if (out !== src) {
      fs.writeFileSync(p, out, 'utf8');
      fixed.push(path.relative(postsDir, p));
    }
  }
  if (fixed.length) console.log('  已修正图片路径：' + fixed.join('、'));
}

// 文件名是日期时，按文章标题重命名，这样 Obsidian 里看到的名字就是标题
function renameToTitle() {
  const postsDir = path.join(root, 'source', '_posts');
  const renamed = [];
  for (const p of walkMd(postsDir)) {
    const dir = path.dirname(p);
    const base = path.basename(p, '.md');
    if (!/^\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?$/.test(base)) continue;

    const src = fs.readFileSync(p, 'utf8');
    const m = src.match(/^---[\s\S]*?\ntitle:\s*(.+?)\s*\n/);
    if (!m) continue;
    const title = m[1].replace(/^["']|["']$/g, '').trim();
    if (!title || title === '在这里写标题') continue;

    let slug = title
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    if (!slug) continue;

    let target = path.join(dir, slug + '.md');
    if (fs.existsSync(target)) continue; // 已有同名文件就不动，避免覆盖
    fs.renameSync(p, target);
    renamed.push(`${path.relative(postsDir, p)} → ${slug}`);
  }
  if (renamed.length) console.log('  已按标题重命名：' + renamed.join('、'));
}

try {
  fixImagePaths();
  renameToTitle();

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
  if (process.env.PUBLISH_DRY === '1') {
    console.log('  （试运行模式，不提交）');
    console.log('');
    process.exit(0);
  }
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
