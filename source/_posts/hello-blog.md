---
title: 你好，博客
date: 2026-11-05 20:00:00
tags:
  - 随笔
categories:
  - 开始
description: 这个博客是怎么搭起来的，以及以后怎么往里写东西。
---

这是第一篇文章。博客用 Hexo 8 + NexT 8 搭成，纯静态，托管在云端，不需要服务器。

## 怎么写一篇新文章

在项目目录下执行：

```bash
npx hexo new post "文章标题"
```

它会在 `source/_posts/` 下生成一个 Markdown 文件，用任何编辑器打开写就行。改完执行：

```bash
npx hexo server
```

打开 `http://localhost:4000` 就能看到效果，边写边刷新。

## 发布

因为有 GitHub Actions 自动构建，实际上你只要把改动提交上去，线上几分钟后就会更新：

```bash
git add .
git commit -m "新文章"
git push
```

<!-- more -->

## 图片放哪

项目开了「文章资源文件夹」，执行 `hexo new post` 时会自动生成一个同名文件夹，把图片丢进去，然后在文章里这样引用：

```markdown
![图片说明](hello-blog/图片.png)
```

这样图片会跟着文章一起打包，不会出现图床挂了、老文章图片全裂的情况。

## 摘要

在正文里插入一行 `<!-- more -->`，它上面的内容会作为首页摘要显示，下面的内容要点「阅读全文」才看得到。
