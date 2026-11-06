const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const postsDir = path.join(root, 'source', '_posts');

function pad(n) { return String(n).padStart(2, '0'); }

const now = new Date();
const y = now.getFullYear();
const m = pad(now.getMonth() + 1);
const d = pad(now.getDate());
const hh = pad(now.getHours());
const mm = pad(now.getMinutes());
const stamp = `${y}-${m}-${d} ${hh}:${mm}:00`;

// 把用户输入的分类路径清洗成安全文件夹名
function parseFolder(input) {
  return String(input || '')
    .split('/')
    .map((s) => s.trim().replace(/[\\:*?"<>|]/g, '').replace(/^\.+/, ''))
    .filter(Boolean);
}

function create(folderInput) {
  const parts = parseFolder(folderInput);
  const dir = path.join(postsDir, ...parts);
  fs.mkdirSync(dir, { recursive: true });

  let base = `${y}-${m}-${d}-${hh}${mm}`;
  let file = path.join(dir, `${base}.md`);
  let i = 2;
  while (fs.existsSync(file)) {
    base = `${y}-${m}-${d}-${hh}${mm}-${i}`;
    file = path.join(dir, `${base}.md`);
    i++;
  }

  const categoryNote = parts.length
    ? `分类由文件夹决定 → ${parts.join(' > ')}（不用在下面写 categories）`
    : '这篇直接建在 _posts 根目录，所以要手动写 categories 才会归类';

  const tpl = `---
title: 在这里写标题
date: ${stamp}
tags:
  - 随笔
description: 这里写一句话摘要，会显示在首页文章标题下面
---

${categoryNote}

正文从这里开始写。

写完保存（Ctrl+S），然后关掉这个窗口，双击「发布文章」就行。

<!-- more -->

这一行上面的内容会作为首页摘要显示，下面的内容要点进文章才能看到。

## 小标题这样写

普通段落直接写。想加粗就前后各两个星号：**这样**。

## 放图片

图片丢进 source/images 文件夹，然后写 ![](/images/图片名.png)。
`;

  fs.writeFileSync(file, tpl, 'utf8');

  console.log('');
  console.log('  已新建文章：');
  console.log('  ' + file);
  if (parts.length) {
    console.log('');
    console.log('  归类：' + parts.join(' > ') + '（文件夹名就是分类名）');
  }
  console.log('');
  console.log('  正在用 VS Code 打开，改完保存即可。');
  console.log('');

  const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';
  try {
    const child = spawn(codeCmd, [file], { detached: true, stdio: 'ignore', shell: true });
    child.unref();
  } catch (e) {
    try {
      spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' });
    } catch (_) {}
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('分类文件夹（如 技术/基础漏洞，直接回车 = 下次再说）：', (answer) => {
  rl.close();
  create(answer);
});
