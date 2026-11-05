const fs = require('fs');
const path = require('path');
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

let base = `${y}-${m}-${d}-${hh}${mm}`;
let file = path.join(postsDir, `${base}.md`);
let i = 2;
while (fs.existsSync(file)) {
  base = `${y}-${m}-${d}-${hh}${mm}-${i}`;
  file = path.join(postsDir, `${base}.md`);
  i++;
}

const tpl = `---
title: 在这里写标题
date: ${stamp}
tags:
  - 随笔
categories:
  - 生活
description: 这里写一句话摘要，会显示在首页文章标题下面
---

正文从这里开始写。

写完保存（Ctrl+S），然后关掉这个窗口，双击「发布文章」就行。

<!-- more -->

这一行上面的内容会作为首页摘要显示，下面的内容要点进文章才能看到。

## 小标题这样写

普通段落直接写。想加粗就前后各两个星号：**这样**。

想放图片：把图片拖进 source/_posts 下和这个文件同名的文件夹里，
然后写 ![](文件夹名/图片名.png)
`;

fs.mkdirSync(postsDir, { recursive: true });
fs.writeFileSync(file, tpl, 'utf8');

console.log('');
console.log('  已新建文章：');
console.log('  ' + file);
console.log('');
console.log('  正在用 VS Code 打开，改完保存即可。');
console.log('');

const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code';
try {
  const child = spawn(codeCmd, [file], { detached: true, stdio: 'ignore', shell: true });
  child.unref();
} catch (e) {
  // 打不开就退回系统默认程序
  try {
    spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' });
  } catch (_) {}
}
