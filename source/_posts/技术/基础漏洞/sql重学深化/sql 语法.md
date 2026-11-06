# 前置
学习这个漏洞前确实得学学sql语句 要不然还是有些地方不知道为什么错，绷不住了

### 在这里写一下，遇到的一些语法问题，方便后续回顾（以后掌握可删）

## less23，遇到的
关于顶层子句的顺序问题和嵌套,group by和order by的
顶层子句：属于整条查询的结构块，**不能嵌入 WHERE 的 AND/OR 布尔表达式内部**
顶层子句不能写进where的and/or布尔表达式内部
plaintext
```
1. FROM + JOIN   -- 加载表、多表关联，拿到原始数据集
2. WHERE         -- 过滤原始行，剔除不符合条件的行；不能用聚合函数
3. GROUP BY      -- 对WHERE筛选后的结果分组、合并多行
4. HAVING        -- 分组之后再过滤；**可以使用聚合函数count/sum**
5. SELECT + DISTINCT -- 挑选输出列、计算字段、去重
6. ORDER BY      -- 对SELECT输出的结果集排序
7. LIMIT         -- 截取指定行数，最后一步
```
eg23(过滤#，--)：payload:?id=1' and group by 4 or '1'='1,
#### 1、要写进数据库的句子是这样的
`$sql="SELECT * FROM users WHERE id='$id' LIMIT 0,1";`
由于无法注释掉后面的limit,整个payload就会一直处于where内部，后面打算用换行的方式写成这样payload:?id=1'%0agroup%20by%203%0a%20or%20'1'='1
效果就是：
```
SELECT * FROM users 
WHERE id='1'        -- WHERE 到此结束 ✔
GROUP BY 4          -- 顶层子句，成功跑到WHERE外面了！
OR '1'='1' LIMIT 0,1
```
好像可以，但是
#### 2、`GROUP BY` 后面**只能跟分组字段**，不能直接接 `OR/AND` 布尔运算符。
MySQL 会把整段理解成：
```
GROUP BY 4 OR/AND '1'='1'
```
也就不行了，非零数字全被理解为真，就失去了探测列数的作用
#### 3、group by 和order by 探测列数的区别
#####   1. ORDER BY 探测（CTF/SQLi-Labs 首选）

######   原理
`ORDER BY N`：N 代表**结果集的第 N 列**。
MySQL 允许用数字代替列名：`ORDER BY 1`= 按第 1 列排序。

- N ≤ 总列数：正常执行，页面正常回显
- N > 总列数：抛出报错 `Unknown column 'N' in 'order clause'`

> 通过不断增大数字，报错临界点就是查询的列总数。

######   用法
Less1 payload：`?id=1' order by 3--+`
注释把源码尾部 `' LIMIT 0,1` 删掉，最终执行：
```
SELECT * FROM users WHERE id='1' ORDER BY 3;
```
######   优点
1. 兼容性好，MySQL5/8 都能用，**不受 ONLY_FULL_GROUP_BY 参数影响**
2. 报错信息直观，稳定，靶场通用
######   缺点
1. 必须能注释截断源码后面内容，否则语法断裂（Less23 无法使用）
##### 2. GROUP BY 探测列数（备选，现在不推荐）
###### 原理
`GROUP BY N`：同样支持数字代表结果集第 N 列。
- N ≤ 总列数：正常执行
- N > 总列数：报错 `Unknown column 'N' in 'group statement'`

######   用法
和 order by 写法几乎一样：`?id=1' group by 3--+`
注释截断尾部，让 group by 成为顶层子句。

######   致命缺点（重点）
1. **受 `ONLY_FULL_GROUP_BY` 影响极大**（MySQL5.7、8.0 默认开启）
    
    开启后，哪怕 N 是合法列号，也直接报分组语法错误，探测直接失效。
2. group by 会**合并相同值的行**，会改变返回结果行数，容易干扰页面回显。

#### 对比汇总表

|项目|ORDER BY 探测|GROUP BY 探测|
|---|---|---|
|探测原理|按结果集第 N 列排序，列不存在则报错|按结果集第 N 列分组，列不存在则报错|
|高版本 MySQL (8.0)|✅稳定可用|❌极易被 ONLY_FULL_GROUP_BY 废掉|
|对结果集影响|只改变顺序，**行数不变**|合并重复行，**改变行数**|
|报错信息|`Unknown column ... in 'order clause'`|`Unknown column ... in 'group statement'`|
|推荐程度|⭐⭐⭐⭐⭐ 首选|⭐ 仅旧版本 MySQL 备选|
|使用前提|都需要注释截断源码尾部，放到 WHERE 外面|同左|

#