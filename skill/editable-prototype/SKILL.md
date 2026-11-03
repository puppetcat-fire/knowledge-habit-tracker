---
name: editable-prototype
description: Create and revise a user-editable HTML interaction prototype with draggable elements, editable text, page states, button destinations, and an in-page annotation sidebar. Use when the user wants to adjust a prototype, leave comments on it, or confirm navigation first.
---

# 可编辑交互原型

先用可编辑原型确定页面、状态和跳转，再依据用户确认的原型实现产品。低保真不代表删减需求。

读取用户指定的原始需求和后续明确修正。保留页面、业务规则和已有功能，将尚未确定的语义写入项目 notes，不自行解决。区分页面跳转、同页展开和状态变化；待机、计时中、战报可以作为原型中的独立状态，并说明它们不是额外的正式导航页。

默认只创建或修改独立原型目录，不改生产页面、真实账号、记录或后端。使用明确标注的模拟数据。用户要求先编辑后实现时，完成可编辑原型即可交付；等用户明确确认原型和实现范围后再实现产品。

## 生成编辑器

复制 [assets/editor.html](assets/editor.html) 和 [assets/server.cjs](assets/server.cjs) 到独立目录，分别命名为 index.html 和 server.cjs，创建 project.json。不需要安装依赖。

项目结构：

```json
{"format":"editable-prototype/v1","id":"stable-project-id","title":"原型标题","updatedAt":"","notes":"来源与待定规则","startScreen":"idle","width":390,"height":720,"screens":[{"id":"idle","name":"计时·待机","elements":[{"id":"start","type":"button","text":"开始计时","x":95,"y":420,"w":200,"h":48,"target":"running","variant":"primary"}]},{"id":"running","name":"计时·运行中","elements":[]}]}
```

支持 text、button、input、card；variant 为 primary 或 default；target 是屏幕 id 或空字符串。保持元素 id 稳定，方便映射到实现。将 JSON 同样嵌入 index.html 的 script#prototype-data；转义小于号，避免关闭 script 标签。

独立本机服务模式将 body 的 data-save-mode 设置为 server。运行 `node server.cjs 3102`，绑定 127.0.0.1；选空闲端口，不终止无关进程。服务只读写该原型目录的 project.json 和 comments.json（批注）。浏览器“保存到文件”写入这个文件，之后实现优先读取它。重新生成前先读取已有文件，保留用户编辑。

离线打开 HTML 时只保存浏览器草稿，用户可导出 JSON 或包含编辑结果的 HTML。导出的 HTML 不依赖本机服务。浏览器草稿不能当作已经写入项目文件。

## 批注侧栏

编辑器右上角的「批注」按钮打开侧边栏，用户不必口头描述位置：在画布上点一个元素，写下要改什么，批注就挂到那个元素；也可以「改为整页批注」挂到当前页面。列表里每条批注可定位回元素、标记已处理、删除；有批注的元素在画布上显示橙色圆点。

- 批注写入原型目录的 `comments.json`，结构为 `{"format":"editable-prototype-comments/v1","comments":[…]}`，本机服务模式下由 `/api/comments` 读写
- 离线直开 HTML 时批注只存浏览器草稿，用「导出 Markdown」交给实现方
- 实现前先读批注（未处理优先）：`npm run prototype:comments`，`--open-only` 只看未处理，`--json` 出原始数据
- `npm run prototype:check` 会一并校验 `comments.json` 并报出未处理条数；指向已删除页面/元素的批注只提醒，不判失败

批注是用户对交互契约的修订意图。实现时逐条核对，已实现的批注请让用户标记「已处理」，不要自行删除。

## 编辑与验证

编辑模式支持拖动元素、修改文字/位置/大小/目的地、增删页面与元素、撤销重做。预览模式验证跳转及返回路径。编辑器工具不进入最终产品界面。

每个交互明确目的地，无目标按钮提示未设置，不假装完成业务。删除页面清除指向它的链接；导入先验证，失败保留草稿。检查一条实际页面链、修改后保存/重载和导出结果，用真实浏览器核对并保存截图。

交付原型链接、文件位置与简短编辑方法。用户确认后将原型视为交互契约，实现时逐项核对状态、元素和跳转，不以美化或简化为由改变它们。
