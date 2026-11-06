---
title: XSS 高频事件
date: 2026-11-06
description: 关于XSS可能用到的一些事件
---
<!-- more -->
# XSS 高频事件（

> 场景：`< >`被过滤，不能注入`<script>`标签，**只能给已有 HTML 标签追加事件属性**，事件触发就执行 JS。

##  鼠标事件（最常用，level3 就是这类）

- `onclick`：鼠标**单击**元素触发（level3 用的）
- `ondblclick`：鼠标**双击**触发
- `onmouseover`：鼠标**悬浮放上去**就触发（推荐，不用点击）
- `onmouseout`：鼠标**移开**元素触发
- `onmousemove`：鼠标在元素上移动持续触发
- `oncontextmenu`：**右键菜单**（右键点击）触发

##  焦点 / 键盘事件（input 输入框神器，XSSlab 高频）

- `onfocus`：元素**获得焦点**（点进输入框）触发
- `onblur`：元素**失去焦点**（点别处）触发
- `onkeydown`：按下按键瞬间触发
- `onkeyup`：松开按键触发
- `onkeypress`：按键按下并产生字符时触发

##  加载 / 错误事件（可以页面加载自动执行，不需要用户交互！重点）

> 这类最好用，不用用户点、不用悬浮，页面渲染直接弹

- `onload`：**元素加载成功**触发（img、svg、iframe、body）
- `onerror`：**元素加载失败**触发，最经典！

> 示例：`<img src=x onerror=alert(1)>` src=x 图片不存在，直接执行 JS

- `onpageshow`：页面展示时触发（body）

##  表单、内容事件

- `onchange`：输入框内容改变、下拉框切换触发
- `onselect`：选中输入框里面文字时触发
- `oncopy`：复制内容触发
- `oncut`：剪切内容触发
- `onpaste`：粘贴内容触发

## HTML5 新事件（过滤严格靶场备选）

- `ontoggle`：`<details>`折叠面板展开 / 收起触发
- `onstart`：`<marquee>`滚动标签启动触发

---

# 两个重要分类（实战区分）

1. **需要用户交互**：`onclick / onmouseover / onfocus`（level3 用的，必须用户做动作）
2. **无交互自动执行**：`onerror、onload`（优先选！不需要用户点击，访问页面直接触发）

> 举 onerror 例子：
> 
> payload：`'><img src=x onerror=alert(1)//`
> 
> 原理：图片地址`x`不存在，触发 onerror，自动执行 alert，不用任何点击。

## 靶场使用小规则（审计 payload 思路）

1. 上下文是 input 输入框：优先 `onfocus onmouseover onclick`
2. 可以注入 img/svg 标签：优先 `onerror / onload`，**免交互**
3. 单引号闭合属性：payload 用 `' 事件名=alert(1)//`
4. 双引号闭合属性：payload 用 `" 事件名=alert(1)//`

## 避坑提醒

很多 WAF 会拦截常见事件，遇到过滤可以轮换试：

`onmouseover`被拦 → 换`onfocus`；`onerror`被拦 → 换`onload`