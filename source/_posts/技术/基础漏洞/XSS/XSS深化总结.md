---
title: XSS深化总结
date: 2026-11-06
---

<!-- more -->
## 一、XSS漏洞产生的根本原因

**核心一句话：网站对用户可控数据没有做正确转义与过滤，导致恶意代码被当成正常HTML/JS解析执行。**

详细原理：

用户提交的内容（URL参数、评论、昵称、请求头）属于可控数据，如果后端直接把这些内容拼接到网页HTML中输出，浏览器会分不清哪些是网站代码、哪些是用户输入，最终把用户写入的恶意代码执行。

**漏洞本质：前端渲染信任了后端输出的所有数据。**

## 二、攻击者可以利用XSS做什么（真实危害）

靶场只弹alert是测试用，真实攻击危害极大：

- **盗取用户Cookie**：劫持用户登录状态，直接登录受害者账号
    
- **劫持用户操作**：以受害者身份发帖、改资料、发私信、下单
    
- **钓鱼伪造页面**：弹出虚假登录框骗取账号密码
    
- **植入木马/挖矿脚本**：用户访问页面即中招
    
- **蠕虫式传播**：存储型XSS可批量感染全站用户
    

## 三、XSS三种类型 + 出现位置（重点区分）

### 1. 反射型XSS（一次性、非持久）

**特点**：数据不存数据库，仅单次请求回显，必须点击恶意链接才触发。

**常见出现位置**：

- 搜索框（搜索关键词回显）
    
- 页面跳转提示、错误提示页
    
- URL参数直接展示在页面的功能
    
- 部分请求头回显（Referer、UA回显）
    

### 2. 存储型XSS（永久性、高危）

**特点**：数据存入数据库，永久挂在页面，**所有访问用户自动中招**，无需点击链接。

**常见出现位置**：

- 评论区、留言板、帖子、弹幕
    
- 用户资料：昵称、签名、个人简介
    
- 站内私信、反馈工单
    

### 3. DOM型XSS（纯前端漏洞）

**特点**：后端无输出漏洞，数据不经过服务器，纯前端JS操作DOM造成。

**常见位置**：前端通过URL、Hash、本地参数修改页面内容的功能。

## 四、常见Payload及构造思路（通用万能）

所有XSS Payload 构造核心就三种思路：

### 1. 标签型（无过滤直接用）

适合：页面直接输出正文、无过滤

`<script>alert(1)</script>`

### 2. 事件型（最通用、免交互）

适合：大部分过滤了script的场景，页面加载自动触发

`&lt;img src=x onerror=alert(1)&gt;`

`<svg onload=alert(1)>`

### 3. 伪协议型（属性内注入专用）

适合：a标签、href属性注入，无法跳出标签时使用

`javascript:alert(1)`

### 4. 高级绕过构造（靶场/实战常用）

- 大小写绕过：`<ScRiPt>`（无strtolower时可用）
    
- 换行绕过空格过滤：`<img%0asrc=x%0donerror=alert(1)>`
    
- HTML实体编码绕过黑名单：`java&#115;cript:alert(1)`
    

## 五、反射型和存储型防护是否一样？

**核心防护完全一样，细微策略不同。**

### 1. 通用核心防护（两种XSS必须做）

- **输出编码（最核心、最重要）**：所有用户数据输出到HTML时，使用 `htmlspecialchars()` 转义特殊符号，让浏览器只当文本不解析代码
    
- **CSP内容安全策略**：即使代码注入成功，禁止非法JS执行，纵深防御
    
- **Cookie开启HttpOnly**：防止JS盗取Cookie，降低危害
    
- **前端避免危险DOM API**：禁止innerHTML、document.write，优先使用innerText
    

### 2. 细微区别

- **存储型XSS**：可以**入库前额外清洗数据**，过滤危险标签事件（辅助防护，不能当主力）
    
- **反射型XSS**：无需输入过滤，只需要输出时编码即可
    

## 六、各类XSS典型漏洞源码（原生危险代码+修复代码）

为直观理解漏洞成因，以下提供**反射型、存储型、DOM型**最经典的漏洞源码，均为未做防护的高危写法，同时配套标准修复方案，贴合真实开发与靶场场景。

### 1. 反射型XSS 漏洞源码（PHP）

**漏洞场景**：搜索功能，直接读取URL参数并回显，无任何转义过滤

```php
<?php
// 高危代码：直接获取用户参数，原样输出到页面
$keyword = $_GET['keyword'];
echo "你搜索的内容：" . $keyword;
?>

// 攻击Payload：?keyword=<img src=x onerror=alert(1)>
// 漏洞原因：可控参数直接拼接HTML，浏览器解析恶意标签
```

**修复写法**：输出时强制HTML实体编码

```php
<?php
$keyword = $_GET['keyword'];
// 核心防护：转义 < > " ' & 所有特殊字符
echo "你搜索的内容：" . htmlspecialchars($keyword, ENT_QUOTES);
?>
```

### 2. 存储型XSS 漏洞源码（PHP+简易数据库逻辑）

**漏洞场景**：评论留言功能，用户内容入库、出库均无过滤转义

```php
<?php
// 1. 接收用户评论，直接存入数据库（无输入清洗）
$comment = $_GET['comment'];
// 模拟入库：恶意代码永久存入数据库
mysqli_query($conn,"insert into comment(content) values('$comment')");

// 2. 读取评论并直接输出页面（无输出编码）
$res = mysqli_query($conn,"select content from comment");
$row = mysqli_fetch_assoc($res);
echo "用户评论：" . $row['content'];
?>

// 攻击Payload：<script>alert(1)</script>
// 漏洞核心：入库、出库双无防护，恶意代码永久留存、全员触发
```

**修复写法**：入库辅助清洗，出库强制编码（核心）

```php
<?php
$comment = $_GET['comment'];
// 出库输出必做编码（核心防护）
$safe_comment = htmlspecialchars($comment, ENT_QUOTES);
mysqli_query($conn,"insert into comment(content) values('$safe_comment')");

// 读取输出同样二次编码，双重保障
$row = mysqli_fetch_assoc($res);
echo "用户评论：" . htmlspecialchars($row['content'], ENT_QUOTES);
?>
```

### 3. DOM型XSS 漏洞源码（前端JS，无后端参与）

**漏洞场景**：前端读取URL参数，通过危险DOM API渲染页面，纯前端漏洞

```html
<script>
// 可控数据源：读取URL?后的参数
let name = location.search.split('name=')[1];
// 危险Sink：innerHTML会解析HTML标签与JS事件
document.getElementById("box").innerHTML = name;
</script>
<div id="box"></div>

// 攻击Payload：?name=<svg onload=alert(1)>
// 漏洞原因：后端无漏洞，前端危险API解析可控恶意内容
```

**修复写法**：替换安全DOM API，禁止解析HTML

```html
<script>
let name = location.search.split('name=')[1];
// 安全写法：innerText仅渲染纯文本，不解析标签、事件
document.getElementById("box").innerText = name;
</script>
```

