---
title: 从零搭一个国内能打开的 Hexo 博客：全流程与七个坑
date: 2026-11-06 09:35:00
tags:
  - Hexo
  - 建站
  - Cloudflare
categories:
  - 技术
description: 域名、托管、主题、部署、被墙、写作流，一次讲完整。包含实测数据和踩过的七个坑。
---

这个博客是从零搭起来的：Hexo 8 + NexT 8，托管在 Cloudflare Workers，域名在国内可直接访问。

整个过程踩了不少坑，有些是教程里过时的说法，有些是只能自己撞一次才知道的。这篇把完整流程和结论记下来，方便以后重装时照着抄，也给同样在折腾的人省几个小时。

<!-- more -->

## 一、技术选型：为什么是 Hexo

静态博客的核心逻辑很简单：本地把 Markdown 渲染成 HTML，把 HTML 扔到某个能托管文件的地方。没有数据库、没有后台、没有服务器要维护，也就不存在被拖库、被打、被挂马这些事。

选 Hexo 而不是 WordPress 的理由只有三条：

- **零运维**。WordPress 要 PHP + MySQL + 一台常开的服务器，个人博客完全用不上
- **写作体验纯粹**。写的都是 `.md` 文件，放在 Obsidian、VS Code 里都能写，随时可以用 Git 备份
- **改造成本低**。想改样式就改 CSS，想加功能就装插件，不会陷入「主题里全是别人写的 PHP」

主题选 NexT，因为它的移动端处理是同类里最成熟的，而且社区大、踩过的坑都有人写过。

## 二、环境与初始化

需要三样东西：Node.js（18 以上）、npm、Git。

```bash
node -v          # v22.x
npm -v           # 10.x
git --version    # 2.x
```

如果 npm 装包慢，先换镜像：

```bash
npm config set registry https://registry.npmmirror.com
```

初始化：

```bash
npx hexo-cli init blog
cd blog
npm install
```

装主题和常用插件：

```bash
npm i hexo-theme-next
npm i hexo-generator-searchdb hexo-generator-sitemap hexo-generator-feed
npm i hexo-autonofollow hexo-deployer-git
npm i hexo-word-counter
```

> **坑 1**：网上大量教程写的是 `hexo-wordcount`。NexT 8 新版要求的是 `hexo-word-counter`，装错了侧栏和页脚的字数统计会静默消失，不报错。

启动本地预览：

```bash
npx hexo server     # http://localhost:4000
```

## 三、主题配置：三处关键设置

NexT 的配置不要直接改 `node_modules`，正确做法是把默认配置复制到站点根目录：

```bash
cp node_modules/hexo-theme-next/_config.yml _config.next.yml
```

之后所有改动都在 `_config.next.yml` 里，升级主题不会丢。

### 1. 配色方案（scheme）

NexT 内置四套布局，改动这一行影响全局观感：

```yaml
scheme: Gemini    # 双栏，侧栏在左，窄屏自动折叠单栏
#scheme: Muse    # 单栏，最朴素
#scheme: Mist    # 单栏，紧凑
#scheme: Pisces  # 双栏，留白最多
```

选 Gemini 是因为它在 500px 以下会自动把侧栏收进抽屉，手机上不用额外调。

### 2. 关掉入场动效（重要）

```yaml
motion:
  enable: false
```

**这是最容易踩的坑，没有之一。** NexT 的入场动画依赖 `animate.css`，而它默认从国外 CDN 加载。一旦这个 CDN 在国内被墙或超时：

- 页面结构完整加载了
- 但正文的 `opacity` 停在 `0`
- 结果就是**整页白屏**，只有背景色

我第一次预览就遇到了，排查了半小时才想到是动效的问题。

### 3. 移动端留白

```yaml
mobile_layout_economy: true
```

关掉这个的话，手机上的左右边距会贴着屏幕边，正文看起来非常挤。开了之后按窄屏重新计算 padding，实测 390px 宽度下左右各留 20px，读起来正常。

## 四、头像与站点图标

三个尺寸就够了，放 `source/images/`：

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `avatar.png` | 400×400 | 侧边栏头像 |
| `favicon.png` | 64×64 | 浏览器标签页 |
| `apple-touch-icon.png` | 180×180 | 手机「添加到主屏幕」 |

想省事用 Node 的 `sharp` 一次裁好（原图非正方形时按中心裁切）：

```js
const sharp = require('sharp');
await sharp('原图.jpg')
  .resize(400, 400, { fit: 'cover', position: 'centre' })
  .png()
  .toFile('source/images/avatar.png');
```

配置里指向它们：

```yaml
avatar:
  url: /images/avatar.png
  rounded: true

favicon:
  small: /images/favicon.png
  medium: /images/favicon.png
  apple_touch_icon: /images/apple-touch-icon.png
```

## 五、部署：GitHub + Cloudflare Workers

代码放 GitHub，构建和托管交给 Cloudflare。推一次代码，一分钟左右自动上线，全程不用管服务器。

### 仓库与 SSH

不用存密码，用密钥：

```bash
ssh-keygen -t ed25519 -C "你的邮箱" -f ~/.ssh/id_ed25519_github
cat ~/.ssh/id_ed25519_github.pub
```

把输出的公钥贴到 GitHub → Settings → SSH and GPG keys。然后：

```bash
git init -b main
git remote add origin git@github.com:用户名/仓库名.git
git push -u origin main
```

测试是否通：`ssh -T git@github.com`，看到 `Hi 用户名!` 就成了。

### Cloudflare 侧配置

新版仪表盘把 Pages 合并进了 Workers，入口只有 **Create application**，所以部署走 Worker + 静态资源。项目根目录加一个 `wrangler.jsonc`：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "你的项目名",
  "compatibility_date": "2026-01-01",
  "assets": {
    "directory": "./public",
    "not_found_handling": "404-page"
  }
}
```

构建配置：

| 字段 | 值 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Preview command | 留空 |

`package.json` 里确保有：

```json
"scripts": {
  "build": "hexo generate"
}
```

> **坑 2**：`Enable Preview builds` 建议关掉。它会给每个分支生成临时域名，白占每月构建额度——尤其仓库里有 Dependabot 自动建的依赖升级分支时，纯属浪费。

## 六、被墙：`workers.dev` 根本打不开

部署成功后拿到地址 `项目名.账号子域.workers.dev`，本地能开。但用手机一测：**完全打不开**；电脑不开代理也打不开。

一开始以为是配置问题，查了一圈才确认：

> `*.workers.dev` 从 **2024 年 6 月 10 日**起在中国大陆被持续屏蔽，方式是 DNS 污染 + 数据包静默丢弃，三大运营商全部受影响。

判断方法很简单，查一下解析：

```bash
nslookup 你的项目.workers.dev 223.5.5.5
```

如果返回的是 `198.18.x.x` 这类保留地址（属于基准测试网段），说明 DNS 被投毒了——这个 IP 根本连不到 Cloudflare。

**结论：这不是你的部署有问题，是这个域名后缀本身在国内不通。** 换子域名、换项目名、清缓存都没用，同一个后缀共享同一批被封的节点。

### 解法：绑自己的域名

唯一有效的办法是换一个干净的域名，让流量走独立的解析链路：

1. 买一个域名（`.cn` 一年三十块左右，不需要备案——服务器在境外）
2. 在 Cloudflare 里 `Connect a domain` 接入，选 **Free** 计划
3. 到域名注册商处把 **NS** 改成 Cloudflare 给的两条
4. 等 NS 生效（十分钟到一小时，用 `nslookup -type=NS 你的域名 223.5.5.5` 验证）
5. Worker → Settings → Domains & Routes → **Add → Custom domain**，输入根域名（子域名框**留空**）

第 5 步会自动生成 DNS 记录并签发证书，几分钟后状态变 `Active`。

### 实测数据

换成自有域名后，从境内测试（三次）：

```
HTTP 200  总耗时 1.34s / 1.09s / 1.06s
TLS 握手  0.78s / 0.52s / 0.50s
```

首页、归档、关于、标签、sitemap、RSS、robots 全部 200。

结论：**能打开，首屏一秒出头，比「一半请求打不开」是质变**。但没有备案就没法用国内节点，这个速度已经是免费方案的天花板；想再快只能备案 + 国内 CDN，代价是两周时间和一台国内服务器。

## 七、日常写作流

命令敲多了会烦，所以做了两个双击即用的入口（`.bat` + Node 脚本）：

```
1-新建文章.bat   →  生成带日期的 .md 文件，自动用编辑器打开
2-发布文章.bat   →  git add / commit / push，触发自动构建
```

编辑器用 Obsidian：把 `source` 目录作为库打开，写文章在 `_posts` 里，图片放 `images`。

Obsidian 侧要改三个设置，否则写出来的链接博客不认：

- **关闭 wikilink 格式**（`useMarkdownLinks: true`）—— `[[双链]]` 这种语法 Hexo 不支持
- **附件目录设为 `images`** —— 粘贴的截图统一落在一个地方
- **链接格式设为站点绝对路径** —— 生成 `![](/images/xxx.png)` 而不是 `../images/xxx.png`

这些可以直接写进 `source/.obsidian/app.json`：

```json
{
  "useMarkdownLinks": true,
  "newLinkFormat": "absolute",
  "attachmentFolderPath": "images"
}
```

`.obsidian` 以点开头，Hexo 打包时会自动忽略，不会混进 `public`。

发布脚本里顺手做了三件自动化：

1. **图片路径兜底**：把 `../images/x.png` 改成 `/images/x.png`，防止相对路径在子页面里解析失败
2. **按标题重命名**：文件名是 `2026-11-06-0935.md` 这种时间戳时，读 front-matter 的 `title` 改成 `标题.md`，编辑器里一眼能认出
3. **试运行开关**：`PUBLISH_DRY=1` 只跑检查不提交，改脚本时安全

## 八、踩坑清单

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| 1 | 装了 `hexo-wordcount` | 字数统计静默消失，无报错 | 换 `hexo-word-counter` |
| 2 | 入场动效依赖国外 CDN | 整页白屏，只有背景色 | `motion.enable: false` |
| 3 | 不蒜子统计用旧域名 | 页面白屏或统计数字异常 | 域名已废弃，换 `busuanzi.ibruce.info` |
| 4 | 用 `blog/scripts/` 放自己的脚本 | 构建时被 Hexo 当插件加载并执行 | 改放 `blog/tools/` |
| 5 | GitHub 图床 + jsDelivr | 图片大面积裂图 | 图片跟文章一起打包，或换对象存储 |
| 6 | `workers.dev` 域名 | 国内完全打不开 | 绑自有域名 |
| 7 | 文章太少时页脚显示 `0k` | 总字数不足一千，显示成 0k | 关闭全站字数合计，只留每篇 |

第 4 条值得单独说：Hexo 会把站点根目录下的 `scripts/` 当插件目录自动加载。我把「新建文章」的脚本放在那里，结果每次构建都会执行一遍——脚本里还带 `spawn` 动作，在 CI 里跑起来就是灾难。**自己的工具脚本永远别放进 `scripts/`。**

## 九、成本

| 项目 | 费用 |
|---|---|
| Hexo / NexT | 免费 |
| GitHub 仓库 | 免费 |
| Cloudflare Workers 静态托管 | 免费（每月 10 万次请求） |
| 域名 `.cn` | 约 30 元/年 |
| 服务器 / 备案 | 不需要 |

一年三十块，剩下的全是白嫖。代价是首屏一秒出头，以及接受「偶尔某个运营商网络抽风」这件事。

想追求「点开秒开」，就得备案 + 国内节点，那是另一套成本结构：时间两周起，钱一百五起。对个人博客来说，三十块这个方案已经够用了。

## 十、收尾

回头看，真正花时间的不是搭建，是**判断哪些教程已经过期**。静态博客这套东西十年前就成熟了，变的是托管平台的可达性——`workers.dev` 被封、jsDelivr 大陆节点被吊销、不蒜子换域名，这些都是近几年才发生的事，而大量教程还停在能用的年代。

所以搭之前先花十分钟验证「托管平台的域名在国内能不能打开」，比照着教程一步步抄要省事得多。
