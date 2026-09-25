# 森林树数据格式规范 v1

> 一棵树 = 一个 JSON 文件 = 一个 MCP server 的资源 = 一个联邦单元。
> 本规范是「产品即协议」的落地：任何实现（官方客户端 / 社区 skill / 第三方插件）只要产出/消费符合本格式的数据即可接入森林。

## 1. 设计原则

1. **节点描述「达成什么效果」（目标），不描述「怎么达成」**；「怎么达成」是教程（方法）
2. **内容寻址 + 不可变版本**：`version` 为内容哈希；跨树引用用全局地址 `tree://{treeId}/nodes/{nodeId}@{version}`
3. **边是链接**：跨树边指向别处的不可变版本，永不断链
4. **点亮默认 L1 自证**：点亮是「发说说式」社交声明，本地记录，发布才上传；机证/他证是可选插件
5. **默认折叠**：教程先盖住、先尝试，点开才展开（消费端行为，不在数据里强制）

## 2. 顶层结构

```json
{
  "format": "forest-tree/v1",
  "tree": { "id": "k9-math", "name": "K9 数学", "domain": "k9-math" },
  "nodes": [],
  "edges": [],
  "tutorials": [],
  "issues": [],
  "lightups": []
}
```

- `format`：必填，固定 `"forest-tree/v1"`，用于解析器识别
- `nodes` / `edges` / `tutorials` / `issues` / `lightups`：实体数组，可为空
- `lightups` 仅当「发布到森林」时包含点亮证据摘要；本地文件可省略

## 3. 实体字段

### 3.1 节点 Node

```json
{
  "id": "linear-equation",
  "title": "一元一次方程",
  "goal": "会解 ax + b = c 型方程，并能用它列方程解应用题",
  "estMinutes": 10,
  "verifyHint": "做一道代表性方程题 + 讲给别人听你每一步为什么这么做",
  "ownership": "group",
  "ownerId": null,
  "version": "sha256:…",
  "versions": ["sha256:…"]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| id | ✅ | 树内唯一；全局地址 = `tree://{tree.id}/nodes/{id}@{version}` |
| title | ✅ | 短名 |
| goal | ✅ | 目标描述（达成什么效果） |
| estMinutes | ✅ | 建议完成时长，5–15（10 为中位） |
| verifyHint | ✅ | 最小本质的自证提示（做什么能证明你会了）——**不是题集**，题集是实例节点 |
| ownership | ✅ | `"personal"` 或 `"group"` |
| ownerId | 否 | 个人持有时的持有者 |
| version | ✅ | 当前内容版本哈希（含 goal/verifyHint 的哈希） |
| versions | ✅ | 历史版本哈希列表（内容寻址，不可变） |

### 3.2 边 Edge

```json
{ "from": "rational-numbers", "to": "linear-equation", "type": "prereq" }
{ "from": "chase-problem", "to": "linear-equation", "type": "instance-of" }
```

| 字段 | 说明 |
| --- | --- |
| from / to | 节点 id（可跨树：`tree://other-tree/nodes/x@{ver}`） |
| type | `"prereq"`（前置，推荐序非强制）或 `"instance-of"`（实例 → 原理） |

### 3.3 教程 Tutorial

```json
{
  "id": "linear-equation-move-terms",
  "nodeId": "linear-equation",
  "title": "移项合并法",
  "method": "1. 移项（变号）… 2. 合并同类项… 3. 系数化 1…",
  "authorId": "seed",
  "hostInstanceId": "self",
  "visibility": "folded",
  "license": "open",
  "unlockRules": null,
  "version": "sha256:…"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| id | ✅ | 树内唯一；全局地址 = `tree://{tree.id}/nodes/{nodeId}/tutorials/{id}@{version}` |
| nodeId | ✅ | 所属节点（目标） |
| title | ✅ | 方法短名 |
| method | ✅ | 方法内容（怎么做）——默认折叠，点开才展示 |
| authorId | ✅ | 作者（提交教程必须已首次点亮该节点） |
| hostInstanceId | ✅ | 宿主实例（内容留在作者实例，节点只是链接） |
| visibility | ✅ | `"folded"`（默认折叠）或 `"gated"`（门控） |
| license | ✅ | `"open"`（开源）或 `"paid"`（付费） |
| unlockRules | 否 | 门控时的解锁规则（付费 / 点亮兑换 / 求助解锁） |
| version | ✅ | 内容哈希 |

### 3.4 Issue（森林的问题层：举报 / 悬赏 / 卡点 / 反馈统一）

```json
{
  "id": "iss-001",
  "targetType": "tutorial",
  "targetId": "linear-equation-move-terms",
  "kind": "yellow",
  "kindLabel": "red" | "yellow" | "green" | "bounty" | "blocker" | "feedback",
  "title": "无法复现：第三步系数化后结果不符",
  "body": "……",
  "authorId": "…",
  "status": "open",
  "createdAt": "…"
}
```

| 字段 | 说明 |
| --- | --- |
| kind | `"red"`（违法，不公开 + 内部审核 + 每账号限 3 次）/ `"yellow"`（无法复现，多次→沉底）/ `"green"`（需展开说明）/ `"bounty"`（悬赏）/ `"blocker"`（卡点）/ `"feedback"`（意见反馈） |
| status | `"open"` / `"closed"` / `"reviewing"`（红线内部审核中）/ `"resolved"` |

### 3.5 点亮 LightUp（L1 自证）

```json
{
  "id": "lu-001",
  "nodeId": "linear-equation",
  "tutorialId": "linear-equation-move-terms",
  "userId": "…",
  "evidence": { "type": "self", "detail": "做完一道应用题", "timestamp": "…" },
  "verified": false
}
```

| 字段 | 说明 |
| --- | --- |
| evidence.type | `"self"`（默认 L1）；`"auto"` / `"peer"` 为可选插件 |
| verified | L1 下恒 `false`（无系统验收；人治） |

## 4. 蒙尘（遗忘衰减）

消费端（非数据字段）规则：点亮超过 6 个月未复点 → 节点「蒙尘」→ 失去投票权与维护资格。数据层只需保留 `lightups[].timestamp`，蒙尘由消费端计算。

## 5. 跨树寻址

- 节点：`tree://{treeId}/nodes/{nodeId}@{version}`
- 教程：`tree://{treeId}/nodes/{nodeId}/tutorials/{tutorialId}@{version}`
- 省略 `@{version}` 时指向当前版本（可缓存的不可变对象，读取失败可回退缓存）
