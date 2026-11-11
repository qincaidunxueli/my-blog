---
title: 关于CVE-2026-16723：fastjson 1.2.83 相关源码注解
date: 2026-11-11
description: 关于相关源码的解释，从源码上理解漏洞产生的原因
---

# CVE-2026-16723：fastjson 1.2.83 源码注解

> 配套文档：`PAYLOAD.md`（载荷构造。本文只讲源码，以及它在哪一行消费载荷的字节）。
> 行号来自官方 `fastjson-1.2.83-sources.jar`，与 `com.alibaba.fastjson:fastjson:1.2.83` 二进制包一致。
> `★` 标记的位置，都是"载荷和源码的交点"。

---

## 1. 阅读顺序

```
DefaultJSONParser:1764    @type 被读出来
    ↓
ParserConfig:1311         四道闸（SafeMode / 长度 / 首末字符哈希 / 黑名单哈希）
    ↓
ParserConfig:1479-1498    探测：把字符串当资源名去读 —— 缺陷所在
    ↓
ParserConfig:1500-1518    jsonType 为真 → 直接 return，跳过危险类加固
    ↓
TypeUtils:1735-1793       loadClass → 类加载器 → defineClass
    ↓
JVM 初始化类              <clinit> 执行
```

---

## 2. 起点：`@type` 被读出来

`DefaultJSONParser.java:1764`

```java
if (key == JSON.DEFAULT_TYPE_KEY && !lexer.isEnabled(Feature.DisableSpecialKeyDetect)) {
    // ★ 1765：这里拿到的就是攻击者写的那个字符串，原样，没有任何字符过滤
    String typeName = lexer.scanSymbol(symbolTable, '"');

    // ★ 1767：直接交给判定，typeName 从此往下传了 4 层，一路没被校验过
    Class<?> clazz = config.checkAutoType(typeName, null, lexer.getFeatures());

    if (Map.class.isAssignableFrom(clazz)) { ... }

    // ★ 1778：拿到 Class 之后立刻取反序列化器 —— 这一步会触发实例化，
    //         也就是类的"首次主动使用"，<clinit>（载荷里的 static 块）由此执行
    ObjectDeserializer deserializer = config.getDeserializer(clazz);
    ...
    return (Map) deserializer.deserialze(this, clazz, fieldName);   // ★ 1788
}
```

漏洞入口不在 ParserConfig，而在这一行 `scanSymbol` 得到一个**完全可控的字符串**。后面所有问题，都建立在"这个字符串从来没被当成不可信输入"之上。

---

## 3. 四道闸，全部在探测之前

`ParserConfig.java:1311` 起，按顺序排列：

```java
public Class<?> checkAutoType(String typeName, Class<?> expectClass, int features) {
    if (typeName == null) return null;                                    // 1312

    // ★ 闸 1：SafeMode。开了就全禁，本漏洞无效（这是唯一真正管用的开关）
    boolean safeMode = this.safeMode
            || (features & safeModeMask) != 0
            || (JSON.DEFAULT_PARSER_FEATURE & safeModeMask) != 0;
    if (safeMode) {
        throw new JSONException("safeMode not support autoType : " + typeName);   // 1330
    }

    // ★ 闸 2：长度。3 <= len < 192
    if (typeName.length() >= 192 || typeName.length() < 3) {
        throw new JSONException("autoType is not support. " + typeName);          // 1339
    }

    String className = typeName.replace('$', '.');                        // 1364

    // ★ 闸 3：首字符/末字符的哈希指纹，用来拦 "[" 开头的数组类型名
    final long h1 = (fnv1a_64_magic_hashcode ^ className.charAt(0)) * fnv1a_64_magic_prime;
    if (h1 == 0xaf64164c86024f1aL) { throw new JSONException(...); }      // 1368
    if ((h1 ^ className.charAt(className.length() - 1)) * fnv1a_64_magic_prime
            == 0x9198507b5af98f0L) { throw new JSONException(...); }      // 1372

    // ★ 闸 4：黑名单哈希。比对的是"类名的哈希"，
    //   而我们的类名是 jar URL，永远不可能命中任何已知恶意类名 —— 黑名单对本漏洞完全无效
    if (internalDenyHashCodes != null) { ... }                            // 1386-1395
    if (!autoTypeSupport) { ... denyHashCodes / acceptHashCodes ... }      // 1447-1477
```

四道闸一条都没拦住 `jar:file:...`：闸 1 没开、闸 2 长度合规、闸 3 只看首末字符、闸 4 比的是类名哈希而不是"名字里有没有 `:`"。

> 这就是黑名单思路的局限：它枚举的是**类的集合**，而攻击者给的是一个**路径字符串**，两者不在同一维度。

---

## 4. 核心缺陷：探测本身在加载

`ParserConfig.java:1479-1498`（全文最关键的 20 行）

```java
boolean jsonType = false;
InputStream is = null;
try {
    // ★ 1482：把用户字符串里的点号换回斜杠，再拼 .class
    //   输入 jar:file:.C:.fj.uploads.p!.Evil
    //   输出 jar:file:/C:/fj/uploads/p!/Evil.class   ← 一次合法的 jar URL
    String resource = typeName.replace('.', '/') + ".class";

    if (defaultClassLoader != null) {
        // ★ 1484：本意是"找同名资源"，实际上 URLClassLoader 会把它当作 URL 打开
        //   这一步 = 任意路径读取 + SSRF 的全部来源
        is = defaultClassLoader.getResourceAsStream(resource);
    } else {
        is = ParserConfig.class.getClassLoader().getResourceAsStream(resource);
    }

    if (is != null) {
        // ★ 1489：读到的字节被当成 class 解析（fastjson 内置的精简 ASM）
        ClassReader classReader = new ClassReader(is, true);
        TypeCollector visitor = new TypeCollector("<clinit>", new Class[0]);
        classReader.accept(visitor);          // ★ 1492
        jsonType = visitor.hasJsonType();     // ★ 1493：只看注解表里有没有 @JSONType
    }
} catch (Exception e) {
    // ★ 1494：全部异常静默丢弃 —— 探测阶段零日志，防守方看不到任何痕迹
} finally {
    IOUtils.close(is);
}
```

三个失误叠在这 20 行里：

| 位置 | 失误 |
|---|---|
| 1482 | 把"类名"当"资源路径"拼接，且没有字符白名单 |
| 1484 | 用 `getResourceAsStream`（资源查找）代替"类名解析"，于是 URL 语义生效 |
| 1493 | 信任判定取的是**被检查对象自己声明**的注解 |

**一句话**：判断"是否可信"的动作，本身执行了一次文件加载。

---

## 5. 拿到 `jsonType` 之后：直接放行

`ParserConfig.java:1500-1518`

```java
if (autoTypeSupport || jsonType || expectClassFlag) {
    // ★ 1501：cacheClass 在 jsonType 为真时也是 true
    //   → 1763 行会把类名写进 mappings → 第二次同名请求命中缓存，不再执行 <clinit>
    boolean cacheClass = autoTypeSupport || jsonType;

    // ★ 1502：typeName 原封不动传下去，注意这里传的是"带冒号和感叹号"的整串
    clazz = TypeUtils.loadClass(typeName, defaultClassLoader, cacheClass);
}

if (clazz != null) {
    if (jsonType) {
        if (autoTypeSupport) {
            TypeUtils.addMapping(typeName, clazz);
        }
        return clazz;                    // ★ 1510：直接返回
    }

    // ★ 1513-1517：1.2.x 后期补的"危险类"加固（ClassLoader / DataSource / RowSet）
    //   但只要 jsonType 为真，1510 行就 return 了，这三条永远不会执行到
    //   —— 这不是"绕过"，是走了另一条分支
    if (ClassLoader.class.isAssignableFrom(clazz)
            || javax.sql.DataSource.class.isAssignableFrom(clazz)
            || javax.sql.RowSet.class.isAssignableFrom(clazz)) {
        throw new JSONException("autoType is not support. " + typeName);
    }
```

`jsonType` 为 false 时的兜底（也就是"没加 `@JSONType`"的下场）：

```java
if (!autoTypeSupport) {
    if (typeName.endsWith("Exception") || typeName.endsWith("Error")) {
        return null;
    }
    throw new JSONException("autoType is not support. " + typeName);   // ★ 1542
}
```

这就是去掉注解后看到的那句报错，一字不差。

---

## 6. 判定逻辑：全文只有一行有效代码

`asm/TypeCollector.java`（108 行，只有这几行参与判定）

```java
public class TypeCollector {
    // ★ 10：常量在类加载时就固定了，值就是那段描述符字符串
    private static String JSONType =
            ASMUtils.desc(com.alibaba.fastjson.annotation.JSONType.class);
    // 展开："Lcom/alibaba/fastjson/annotation/JSONType;"

    protected boolean jsonType;                      // ★ 31：唯一的状态

    // ★ 71-75：ASM 回调，每遇到一个"类级注解"就调一次
    public void visitAnnotation(String desc) {
        if (JSONType.equals(desc)) {
            jsonType = true;         // 只比字符串，不看来历、不看实现、不看加载器
        }
    }

    // ★ 106-108：checkAutoType 就是读它
    public boolean hasJsonType() {
        return jsonType;
    }
}
```

两个被实测证实的推论：

1. **不需要真的 fastjson 注解类。** 打出来的 jar 里只有 `Evil.class`，注解类没打包，照样通过。
2. **`RetentionPolicy.RUNTIME` 不能省。** 否则描述符不进 `RuntimeVisibleAnnotations`，ASM 看不到。

> 语义上的问题在这里：判断"你可不可信"的依据，来自你自己在文件里写的一行声明。

---

## 7. 命名校验：为什么必须改 `this_class`

`TypeUtils.java:1735`

```java
public static Class<?> loadClass(String className, ClassLoader classLoader, boolean cache) {
    if (className == null || className.length() == 0) return null;        // 1736

    if (className.length() > 198) {                                       // 1740
        throw new JSONException("illegal className : " + className);
    }

    // ★ 1744：类缓存。第二次同名请求在这里就返回了，defineClass 不会再执行
    Class<?> clazz = mappings.get(className);
    if (clazz != null) {
        return clazz;
    }
    ...
    try {
        if (classLoader != null) {
            // ★ 1761：className 就是那串 jar URL，原样交给类加载器
            clazz = classLoader.loadClass(className);
            if (cache) {
                mappings.put(className, clazz);   // ★ 1763：类名 → Class 映射
            }
            return clazz;
        }
    } catch (Throwable e) {
        e.printStackTrace();      // ★ 1768：唯一的"真相窗口"，靶场 /rawload 就是抓这里
        // skip
    }
    ...
}
```

最终走到 JVM：

```java
defineClass("jar:file:/C:/fj/uploads/p!/Evil", bytes, 0, bytes.length);
```

JVM 强制校验：**传入的 `name` 必须与 class 文件 `this_class` 自称的名字逐字相同**。否则：

```text
NoClassDefFoundError: jar:file:/C:/fj/uploads/p!/Evil (wrong name: Evil)
```

> 这条规则来自 JVM 规范，不是 fastjson 的要求。所以改的是**字节**：源码里写 `public class Evil`，编译出来必然自称 `Evil`，只能事后改常量池。

---

## 8. 为什么第二次不执行

三行代码就够了：

```java
boolean cacheClass = autoTypeSupport || jsonType;               // 1501：jsonType 为真 → cache=true
clazz = TypeUtils.loadClass(typeName, defaultClassLoader, cacheClass);   // 1502
mappings.put(className, clazz);                                 // 1763：写进缓存
```

下一次同名请求：

```java
Class<?> clazz = mappings.get(className);   // 1744：命中
if (clazz != null) return clazz;            // 1745：直接返回，defineClass 不再执行
```

于是 `ok:true` 但静态块不跑。**这是 fastjson 的正常行为，不是载荷坏了。**

---

## 9. 1.2.84 修在哪里

官方在 `checkAutoType` 入口、长度校验（1338 行）旁边新增了字符检查：

```java
// 1.2.84 新增（示意，具体行号以该版本源码为准）
if (TypeUtils.hasIllegalTypeNameChars(typeName)) {
    throw new JSONException("autoType is not support. " + typeName);
}

public static boolean hasIllegalTypeNameChars(String typeName) {
    return typeName.indexOf(':') >= 0 || typeName.indexOf('!') >= 0;
}
```

**关键在于位置**：它在 1479 行的探测**之前**。所以 `jar:` / `!` 一出现，请求在入口就被拒：

```text
SSRF（1484 行）            ← 被拦
读字节 + 注解识别（1492）   ← 被拦
defineClass + <clinit>     ← 被拦
```

这解释了为什么 1.2.84 上连"探测"都做不了，而底层类加载器本身仍能被直接调用去加载任意文件——**修的是"用 @type 触达加载器"这条路，不是加载器本身。**

---

## 10. 源码与载荷的交点

| 载荷里的东西 | 被哪一行消费 | 缺失后果 |
|---|---|---|
| `@JSONType` 描述符（42 字节） | `TypeCollector.java:71` | `jsonType=false` → `1542` 抛 `autoType is not support` |
| `this_class`（`jar:file:/...!/Evil`） | `TypeUtils.java:1761` → `defineClass` | `wrong name: Evil` |
| `static {}` 里的命令 | `<clinit>`（`1778` 实例化时触发） | 类加载成功，无任何效果 |
| jar 根目录的 `Evil.class` | `ParserConfig.java:1482` 拼出的路径 | `stream=false`，`bytes=0` |

调用链完整版：

```text
@type 字符串（用户可控）
   → replace('.','/') + ".class"     变成一次合法 URL      1482
   → getResourceAsStream             目标替你打开文件       1484
   → ASM 扫注解表                     看到自签的 @JSONType    1492
   → jsonType=true                   判定"可信"            1493
   → loadClass(原始字符串)            交给 classloader       1502
   → defineClass(name=原始字符串)     JVM 按 this_class 校验  1761
   → <clinit>                         代码执行               1778
```

**一句话总结**：这条链上没有一处"绕过"，也没有一处逻辑错误——是检查本身就在做加载，而"可信"的凭据由被检查对象自己签发。
