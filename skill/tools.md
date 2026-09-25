# 森林树 Skill 工具定义（MCP tools 草案）

> 这是 skill 包的工具层。核心原则：工具都是**确定性程序**（不依赖 LLM、无 key），AI 只在上层调用。验证/记录/计数全部本地。

## 个人事件域（本地私有，不上传）

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `record_event` | source: manual / timer / node-task; nodeId?; durationMin; status | 记录一次事件（手动/计时/节点任务） |
| `list_actions` | — | 推荐行动队列（待办事件，带完成条件） |
| `list_habits` | — | 习惯列表（事件的重复归纳） |
| `local_lightup` | nodeId; tutorialId?; detail | 本地点亮（不上传网络） |

## 知识树域（可联邦）

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `get_tree` | treeId | 取树（节点 DAG + 前置/实例边） |
| `get_node` | nodeId | 取节点（目标 + 教程列表，默认折叠元数据） |
| `expand_tutorial` | tutorialId | 点开教程（记录卡点信号：第几次点开） |
| `submit_tutorial` | nodeId; method; … | 提交教程（**必须先首次点亮该节点**） |
| `create_node` | title; goal; estMinutes; verifyHint | 提出新目标 |
| `report_blocker` | nodeId; tutorialId?; step | 上报卡点 |
| `open_issue` | targetType; targetId; kind: red/yellow/green/bounty/feedback | 开 issue（红线不公开+限3次，见 spec） |
| `propose` | nodeId; type: to-group/split/merge/major-edit | 发起提案 |
| `vote` | proposalId; choice | 投票（未蒙尘点亮者一人一票） |
| `publish` | nodeId/tutorialId/trailId | 发布到森林（选择性、可撤销） |

## 约束（实现层必须遵守）

- 机证/他证 = 可选插件，**默认 L1 自证**
- 点亮记录、投票计票、版本链完整性**不可插件化**
- 红线 issue 不公开，直接进实例内部审核，每账号限 3 次
- 所有跨网络操作幂等（内容寻址）
