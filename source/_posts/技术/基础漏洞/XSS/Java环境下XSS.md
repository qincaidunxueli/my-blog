---
title: Java环境下XSS
date: 2026-11-06
description: 关于XSS在java环境下和PHP下的不同之处
---
<!-- more -->
# 一、XSS常见触发位置

XSS漏洞在产生后必然会有相关的输入/输出，因此我们只需快速找到这些输入/输出点，即可快速跟踪发现漏洞。

输入在Java中常用"request.getParameter(param)"或"${param}"获取用户的输入信息。输出主要表现为前端的渲染，我们可以通过定位前端中一些常见的标识来找到输出，任何根据后端逻辑判断漏洞是否存在

## 1. JSP表达式

"<%=变量 %>"是”<% out.println(变量); %>“的简写方式，”<%=%>“用于将已声明的变量或表达式输出到外网页中。
下面两种形式的写法，效果相同：
第一种：
```
<%=msg%>
<% out.println(变量); %>
```
第二种
```
<% String msg=request.getParameter('msg'); %>
<%=msg%>
```
通过”request.getParameter”获取msg传入的值，然后通过<%=msg%>输出到网页中。
## 2. EL

EL(Expression Language,表达式语言)是为了使JSP写起来更简单。
例如：“<%=request.getParameter("username")%>”等价于“${param.username}”。
JSP标准标签库(JSTL)是一个JSP标签集合，它封装了JSP应用的通用核心功能：

| 标签              | 描述                                                             |
| --------------- | -------------------------------------------------------------- |
| `<c:out>`       | 在 JSP 页面输出数据，等价于脚本表达式 `<%= ... %>`，**默认会自动转义 HTML，天然可以防御 XSS** |
| `<c:set>`       | 定义 / 保存域中的变量，设置属性值                                             |
| `<c:remove>`    | 删除指定域中的变量 / 属性                                                 |
| `<c:catch>`     | 捕获标签体内抛出的异常，并且可以把异常信息保存到变量中                                    |
| `<c:if>`        | 条件判断标签，作用和 Java 中的`if`一样                                       |
| `<c:choose>`    | 多分支判断的父标签，本身不做判断，只作为`<c:when>`、`<c:otherwise>`的容器（类似 switch）   |
| `<c:when>`      | `<c:choose>`的子标签，写判断条件，条件成立则执行标签内代码                            |
| `<c:otherwise>` | `<c:choose>`的子标签，放在所有`<c:when>`之后，当上面所有 when 条件都不成立时执行         |
| `<c:import>`    | 引入一个绝对或者相对 URL 对应的页面内容，将内容包含到当前页面                              |
| `<c:forEach>`   | 基础迭代标签，用来遍历集合、数组，实现循环                                          |
| `<c:forTokens>` | 分隔迭代标签，按照指定分隔符拆分字符串并循环输出                                       |
| `<c:param>`     | 用于给包含或者重定向的 URL 传递请求参数                                         |
| `<c:redirect>`  | 服务端重定向，跳转到新的 URL 地址                                            |
| `<c:url>`       | 生成带参数的 URL，自动处理 URL 编码                                         |
（1）<c:out>标签
<c:out>标签用来显示一个表达式的结果，与<%= %>作用相似，它们的区别是，<c:out>标签可以直接通过“.”操作符来访问属性，如：
<c:out value="${user.getUsername}"

  (2) <c:if>
  <c:if>标签用来判断表达式的值，如果表达式的值为true，则执行其主体内容：
  ```
  <c:if test="${user.salary>200}"
  <p>我的工资为：value="${user.salary>200}"</p>
  </c:if>
  ```
  (3) <c:forEach>
  <c:forEach>标签的作用是迭代输出标签内部的内容。它既可以进行固定次数的迭代输出，也可以依据集合中对象的个数来决定迭代次数：
```
<table>
    <tr><th>名字</th><th>说明</th><th>图片预览</th></tr>
    <c:forEach items="${data}" var="item">
        <tr><td>${item.advertName}</td><td>${item.notes}</td><td><img src="${item.defPath}"/></td></tr>
    </c:forEach>
</table>

<ul>
    <li><a href="?nowPage=${nowPage-1}">←上一页</a></li>
    <c:forEach varStatus="i" begin="1" end="${sumPage}">
        <c:choose>
            <c:when test="${nowPage==i.count}">
                <li class='disabled'>${i.count}</li>
            </c:when>
            <c:otherwise>
                <li class='active'><a href="?nowPage=${i.count}">${i.count}</a></li>
            </c:otherwise>
        </c:choose>
    </c:forEach>
    <li><a href="?nowPage=${nowPage+1}">下一页→</a></li>
</ul>
```
 代码解释:
1.第一段：遍历 `${data}` 集合，每一条数据存入 `item`，在表格里输出广告名称、说明、图片。
2.第二段：分页页码，`begin="1" end="${sumPage}"` 从第 1 页循环到总页数；
`<c:when>` 判断当前页等于页码时，页码不可点击（`disabled`）
`<c:otherwise>` 其余页码生成可跳转链接
3.`varStatus="i"`：迭代状态对象，`i.count` 代表当前循环的序号

## 3. ModelAndView 类的使用

MdoelAndView类用来存储处理完成后的结果数据，以及显示该数据的视图，其前端JSP页面可以使用“${参数}”的方法来获取值：
```
package com.dgr.controller;
// 包声明：当前类放在 com.dgr.controller 包下

import org.springframework.stereotype.Controller;
// 导入@Controller注解，标记这是SpringMVC控制器
import org.springframework.web.bind.annotation.RequestMapping;
// 请求映射注解，用来绑定访问地址
import org.springframework.web.servlet.ModelAndView;
// 模型视图对象：同时携带【数据Model】+【视图View】

@RequestMapping("mvc")
// 类上的@RequestMapping：给当前控制器加路径前缀
// 这个类下所有接口地址前面都要带上 /mvc
@Controller
// 核心注解：告诉Spring，这是MVC控制器，接收web请求
public class TestRequestMapping {

    @RequestMapping(value="/getMessage")
    // 方法级别的映射，拼接类上路径，完整访问地址： /mvc/getMessage
    public ModelAndView getMessage(){
        // 返回值是ModelAndView，封装页面数据和跳转页面名称
        ModelAndView modelAndView = new ModelAndView();
        // 实例化ModelAndView对象

        modelAndView.setViewName("message");
        // 设置视图名：跳转到名为 message 的页面
        // 配合视图解析器，会自动拼接前后缀，比如 /WEB-INF/jsp/message.jsp

        modelAndView.addObject("message", "Hello World");
        // 向域中存入数据：key=message，值=Hello World
        // 在jsp页面可以用EL表达式 ${message} 取出这个值展示

        return modelAndView;
        // 返回模型视图，交给SpringMVC处理，渲染页面
    }
}
```
## 4. ModelMap

Spring 也提供了ModelMap类，这是Java.util.Map实现的，可以根据模型属性的具体类型自动生成模型属性的名称：
```
Public String testmethod(String someparam,ModelMap model){
     //省略方法处理逻辑
     //将数据放置到ModelMap类的model对象中，第二个参数可以是任何java类型
     Model.addAttribute("key",someparam);
     return "success";
}
```
## 5. Model类的使用

Model类是一个接口类，通过attribute()添加数据，储存的数据域的范围是requestScope:
```
Public String index(Model model){
      Model.addAttribute("result","后台返回");
      return "result";
}
```
通过这些常见语法的总结我们不难归纳出一些常见的关键字，通过这些关键字可以快速地定位至具有前后端交互功能的代码片段：
```
<%=
${
<c:out
<c:if
<c:forEach
ModelAndview
ModelMap
Model
request.getParameter
request.getAttribute
response.getWriter().print()
response.getWriter().writer()
```

## 与phpXSS常见触发位置对比

### PHP 输出语法（漏洞风险点）

1、`<?php echo $_GET['msg']; ?>` 直接输出，无转义，典型反射 XSS
简写：`<?=$_GET['msg'] ?>`（短标签，审计高频漏洞点）
2、获取用户输入：
`$_GET[] URL 参数`、`$_POST[]` POST 提交、`$_REQUEST[]` 统一获取 GET/POST
3、、输出函数（高危，直接输出）
echo、print、print_r、var_dump
重点：PHP 原生 echo不会自动转义 HTML

 PHP 防御函数：`htmlspecialchars()`，等价 JSP 的`<c:out>`
```
<?php echo htmlspecialchars($_GET['msg']); ?>
```

存储型场景：从 MySQL 取出数据，直接 echo 输出，就是存储 XSS
```
// 从数据库读取评论内容
$comment = $row['comment'];
echo $comment;
```

**PHP 审计关键词**：
```
<?=
echo
print
$_GET
$_POST
$_REQUEST
htmlspecialchars
```

### 三、核心异同对比

| 项目         | JSP(JavaWeb)                              | PHP                              |
| ---------- | ----------------------------------------- | -------------------------------- |
| 获取用户输入     | `request.getParameter()` / `${param.xxx}` | `$_GET / $_POST / $_REQUEST`     |
| 直接输出（危险）   | `<%=xxx%>`、`${xxx}`                       | `echo、<?= ?>`                    |
| 自带自动转义输出   | `<c:out value=""/>`                       | 无原生标签，需要手动调用`htmlspecialchars()` |
| 后端传数据到页面   | Model/ModelAndView/ModelMap 存入 request 域  | 直接在脚本内拼接变量，不需要单独 Model 对象        |
| DOM-XSS 场景 | JS 中取出`${}`渲染到 DOM                        | JS 取出 PHP echo 出来的值渲染 DOM        |
# 二、反射型XSS

这类型XSS在源码上看其实和php环境下差不多

# 三、存储型XSS

## 整套审计追踪流程

### 1. 入口发现

访问路由 `/show`，页面会打印用户留言，根据 `web.xml` 找到该路由对应的 Servlet：`com.sec.servlet.ShowServlet`。

```
<servlet>
    <description></description>
    <display-name>show</display-name>
    <servlet-name>show</servlet-name>
    <servlet-class>com.sec.servlet.ShowServlet</servlet-class>
</servlet>
<servlet-mapping>
    <servlet-name>show</servlet-name>
    <url-pattern>/show</url-pattern>
</servlet-mapping>
```

### 2. ShowServlet（查询 + 转发）

在`ShowServlet`中：

1.实例化业务类 `MessageInfoServiceImpl`
2.调用 `MessageInfoShowService()` 获取留言列表
3.通过 `req.setAttribute("msg", msg)` 将留言列表放到 request 域
4.转发到 `message.jsp` 页面渲染输出

```
public void ShowMessage(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
    MessageInfoService msginfo = new MessageInfoServiceImpl();
    List<MessageInfo> msg = msginfo.MessageInfoShowService();
    if(msg != null){
        req.setAttribute("msg", msg);
        req.getRequestDispatcher("/message.jsp").forward(req, resp);
    }
}
```

### 3. Service 层调用 DAO 层查询

`MessageInfoShowService()` 调用 `MessageInfoShowDao()`，由 DAO 负责和数据库交互：

```
public List<MessageInfo> MessageInfoShowService(){
    List<MessageInfo> msg = msginfo.MessageInfoShowDao();
    return msg;
}
```

### 4. DAO 层：读取数据库留言

`MessageInfoShowDao` 建立 JDBC 连接，执行`select * from message`查询全部留言，循环取出`name`、`mail`、`message`字段，封装进实体类，最后返回 List 给上层：

```
public List<MessageInfo> MessageInfoShowDao(){
    Connection conns = null;
    PreparedStatement ps = null;
    ResultSet rs = null;
    List<MessageInfo> messageinfo = null;
    try {
        Class.forName("com.mysql.cj.jdbc.Driver");
        conns = DriverManager.getConnection("jdbc:mysql://localhost:3306/sec_xss","root","root");
        String sql = "select * from message";
        ps = conns.prepareStatement(sql);
        rs = ps.executeQuery();
        messageinfo = new ArrayList<MessageInfo>();
        while(rs.next()){
            MessageInfo msg = new MessageInfo();
            msg.setName(rs.getString("name"));
            msg.setMail(rs.getString("mail"));
            msg.setMessage(rs.getString("message"));
            messageinfo.add(msg);
        }
    } catch (Exception e) {
        // 异常处理
    } finally {
        // 资源关闭
    }
    return messageinfo;
}
```

### 5. 输出点：message.jsp（漏洞真正爆发点）

JSP 页面从 request 域取出`msg`列表，循环遍历，**直接输出数据库读取出来的数据，没有任何 HTML 转义**，恶意脚本直接写入 HTML 页面，浏览器解析执行，触发 XSS。

```
<%
    List<MessageInfo> msginfo = (ArrayList<MessageInfo>)request.getAttribute("msg");
    for(MessageInfo m:msginfo){
%>
<table>
    <tr><td class="blytd">姓名：</td><td><%=m.getName()%></td></tr>
    <tr><td class="blytd">mail：</td><td><%=m.getMail()%></td></tr>
    <tr><td class="blytd">内容：</td><td><%=m.getMessage()%></td></tr>
</table>
<%
    }
%>
```

 这里的`<%= %>`就是 JSP 脚本表达式，**默认不做 HTML 编码**，是本次漏洞的输出点。

### 6. 回溯入库链路（漏洞输入入口）

上面这条是**查询展示链路**，接下来需要逆向追踪：**数据是怎么写入数据库的**，也就是攻击入口。

1.`MessageInfoStoreDao` 负责入库操作，使用 JDBC `INSERT`语句把`name/mail/message`插入`message`表：


```
public boolean MessageInfoStoreDao(String name, String mail, String message){
    Connection conn = null;
    PreparedStatement ps = null;
    boolean result = false;
    try {
        Class.forName("com.mysql.cj.jdbc.Driver");
        conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/sec_xss","root","root");
        String sql = "INSERT INTO message (name,mail,message) VALUES (?,?,?)";
        ps = conn.prepareStatement(sql);
        ps.setString(1, name);
        ps.setString(2, mail);
        ps.setString(3, message);
        ps.executeUpdate();
        result = true;
    } catch (Exception e) {
        e.printStackTrace();
    } finally {
        //关闭资源
    }
    return result;
}
```

 这里使用了`PreparedStatement`预编译，**防止了 SQL 注入，但是完全没有对 XSS 做过滤转义**恶意 JS 原样存入数据库。

2.Service 层只是简单调用 DAO：

```
public boolean MessageInfoStoreService(String name, String mail, String message){
    return msginfo.MessageInfoStoreDao(name, mail, message);
}
```

3.最终入口 `StoreXSS` Servlet：

通过 `req.getParameter()` 获取 GET 参数，**没有校验、过滤**，直接传给 Service 入库：


```
public void StoreXSS(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
    String name = req.getParameter("name");
    String mail = req.getParameter("mail");
    String message = req.getParameter("message");
    if(name != null && mail != null && message != null){
        MessageInfoService msginfo = new MessageInfoServiceImpl();
        msginfo.MessageInfoStoreService(name, mail, message);
        resp.getWriter().print("<script>alert(\"添加成功\")</script>");
        resp.getWriter().flush();
        resp.getWriter().close();
    }
}
```

### 7. 漏洞复现

构造 GET 请求，传入 XSS payload：

```
?name=123&mail=123&message=<script>alert('QCCA')</script>
```

1.访问该 Servlet，留言存入数据库
2.访问 `/show` 查看留言页面
3.JSP 直接输出数据库中的`<script>`标签，浏览器执行 JS 弹窗，存储 XSS 触发

## 漏洞根源

1. 输入侧：没有对用户提交的`message`做过滤
2. **输出侧（最关键）：JSP 页面使用`<%= %>`直接输出数据库字段，没有 HTML 实体编码**
3. 预编译仅仅防御 SQL 注入，和 XSS 防护无关
## 和 PHP 版本存储 XSS 审计对比

1.Java 这套 MVC 架构：**输入、入库、查询、输出被拆分到 Servlet/Service/Dao/JSP 多个文件**，审计需要顺着调用栈跨文件追踪，漏洞不在 Java 代码里，而在 JSP 视图层；
2.传统 PHP：很多时候入库、查询、echo 输出写在同一个 PHP 文件里，一条文件内就能走完完整链路；
3.攻击利用层面：两者 Payload 完全一样，浏览器只关心最终返回的 HTML，不区分后端语言。

# 对于XSS的修复

和PHP本质逻辑一样，只是因为环境不同，语法差异，最简单的就是对所有的输出采用HTML实体编码
```
<c:out value="${msg}" /> 
1. 功能：把${msg}的数据展示到页面（显示数据） 
2. 自带特性：默认对输出内容做HTML实体编码，< > & " ' 都会被转义 
```
