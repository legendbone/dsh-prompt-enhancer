# DeepSeek Harness 提示词增强插件设计

## 目标

在当前 Harness Web GUI 的聊天输入框工具栏中添加“增强提示词”按钮。用户点击后，插件使用当前会话选择的模型优化输入框文本，并将结果回填到输入框，不自动发送消息。

## 功能范围

- 按钮挂载到 `conversation.input.right`，位于模型选择器之前。
- 使用当前 `modelSelection` 投影中的 `next ?? lastUsed` 模型。
- 通过插件自己的 `promptEnhancer/enhance` Remote 调用 Host，Host 使用 `ctx.llm` 发起一次独立请求。
- 只优化纯文本草稿；已有附件保持不变。
- 第一版不处理结构化引用芯片或命令草稿：存在 `occurrences` 或输入阶段不是 `plain` 时按钮禁用，避免把引用或命令退化为普通文本。
- 优化期间按钮显示加载状态并禁止重复点击；组件卸载时取消请求。
- 成功时替换草稿并恢复输入框焦点，不调用提交接口。
- 如果等待期间草稿 revision 或文本发生变化，则保留用户的新内容，并提示“文本已修改，未覆盖”。
- 空文本、无当前模型、含结构化引用或命令状态下不可点击。
- 调用失败、空结果和输出截断均显示错误提示，不修改原草稿。

## 模型请求约束

- 系统指令要求保留原始意图、语言和约束，不虚构需求，只返回优化后的提示词正文。
- 生成上限按“输出部分 + 推理头部余量”估算：输出部分 `min(4096, max(1024, ceil(估算输入 tokens × 2.5)))`，再叠加 `REASONING_HEADROOM_TOKENS = 4096` 的思考预算，整体封顶 `MAX_TOTAL_TOKENS = 16384`。`maxTokens` 是包含推理/思考 token 的总上限，因此必须为推理模型预留思考开销，否则输出会被截断（见 2026-11-17 修复记录）。
- 估算输入超过 1638 tokens（约 1600 汉字或 1200 英文单词）时前置拦截，提示“草稿过长，请分段增强”，不发起模型请求。
- Host 仅移除完整包裹输出的 Markdown 代码围栏；不追加解释、前缀或其他内容。
- 该请求是用户主动触发的辅助转换，不进入聊天消息流，不唤醒 Agent，也不改变会话模型选择。
- 模型调用仍会产生对应提供商的 token 消耗。

## 界面与资源

- 使用原创星光图标、原生主题 token 和中英文界面文案。
- 提供悬停提示、加载状态、成功提示和错误提示。
- 不导入 Harness UI primitives，不读取其他插件 DOM，不修改应用根节点。

## 文件位置

- 插件包：`dsh-plugins/dsh-prompt-enhancer/`
- Host：`index.js`，负责模型调用和 Remote 服务注册。
- Client：`client.js`，负责 Remote 挂载、按钮渲染和草稿回写。
- 清单与资源：`package.json`、`cordis.patch.yml`、`locale/`、`icon.svg`。

## 验证范围

1. JavaScript 语法、JSON 清单和 YAML 基本结构检查。
2. 安装后检查 Host Remote 注册与 Client 槽位占用。
3. 在当前 GUI 检查按钮显示；输入纯文本后点击，确认结果回填且未自动发送。
4. 检查空文本禁用、重复点击防护、失败提示，以及等待期间编辑不被覆盖。
5. 若当前环境无浏览器控制能力，则明确保留实际视觉效果和点击验证为人工验证项。

## 实施验证记录

- 已通过 Host、Client、RemoteInfo 的 JavaScript 语法检查和中英文 JSON 资源检查。
- 已通过模拟 LLM 流测试：正文组装、完整代码围栏移除、空结果拒绝、提供商错误透传。
- 插件已安装并启用到当前 `desktop` 配置，`conversation.input.right` 中存在 active 的 `dsh-prompt-enhancer` 注册。
- 已修复首次安装时插件本地 `zod` 依赖缺失，以及动态 Remote 命名空间必须通过 `ctx.get()` 读取的问题。
- 当前环境没有浏览器点击与截图控制能力；按钮实际视觉位置、真实模型点击调用和草稿回填仍需在当前 GUI 人工验证。

## 2026-11-02 修复记录：typertRemote 绑定缺失

现象：点击增强按钮报错 `typert gateway: promptEnhancer/enhance: Service "promptEnhancer" has no visible typertRemote binding`。

根因：`@deepseek-ai/dsh-api-gateway` 的 `validateBinding()` 在调用 Host 业务方法前，会从 `ctx.get(serviceKey)` 取回 Service，并读取其 `typertRemote` 绑定，要求 `binding.service === original`、`binding.serviceKey === serviceKey`、`binding.namespace === descriptor.namespace`。原 `apply()` 用 `ctx.provide('promptEnhancer', { enhance })` 提供的普通对象没有 `typertRemote`，因此网关在 `binding-invalid` 处失败。严格描述符本身已注册成功（否则会先报 `invocation-unavailable` / `definition-unavailable`），所以问题只在可见绑定。

修复：在 Host 提供的 Service 上显式声明冻结的 `typertRemote = { service, serviceKey: 'promptEnhancer', namespace: 'promptEnhancer' }`（等价于 `bindTypertRemote(service, 'promptEnhancer')`），保持 service 身份与 Cordis key、Remote namespace 三者一致。

验证：
- `node --check index.js` 通过。
- 冒烟测试（用真实 zod 加载修复后的 `apply`，模拟 `ctx.provide`/`ctx.typert.register`）确认：Service 暴露 `typertRemote`，`binding.service === service`、`serviceKey`/`namespace` 均正确，描述符 `service`/`namespace` 与之匹配，且复刻的打包版 `validateBinding` 接受该绑定。
- 已核对运行版本 0.2.1-rc.5 打包代码：`dsh-api-gateway` 的 `validateBinding`/`readBinding` 与本修复一致；`dsh-llm` 的 `prepareCall(config, signal)` 与 `prepared.stream`、`dsh-llm-pi-ai` 对 `options.system` 的支持均与 `enhance()` 用法兼容。
- 集成测试（直接从运行中的 0.2.1-rc.5 `app.asar` 解出 `@deepseek-ai/cordis`、`dsh-typert-registry`、`dsh-api-gateway`，用真实 Context/Registry/Gateway 加载本插件 `apply` 并以假 LLM 注入）：
  - 修复后：严格描述符注册成功，`ctx.get('promptEnhancer').typertRemote.service === 自身`，`ctx.typertGateway.invoke({ namespace: 'promptEnhancer', method: 'enhance', ... })` 成功返回 `{ ok: true, text: '优化后的提示词正文' }`，并观察到 `llm.prepareCall` 与 `llm.stream`（`system` 系统提示词、`sessionId` 均已传入）。
  - 修复前（对照）：同一集成测试稳定复现用户所报错误 `typert gateway: promptEnhancer/enhance: Service "promptEnhancer" has no visible typertRemote binding`。
- 由于 Host 端插件代码在进程启动时加载，运行中的 GUI 需重启应用（或在插件管理器中重新启用/重载该插件）后才会加载本次修复；之后在 GUI 实际点击验证真实模型回填。

## 2026-11-03 修复记录：安装目录被清空导致插件完全不加载

现象：用户反馈「提示词增强插件不生效了」，GUI 输入框工具栏（`+` / 工作区修改 / 模型选择 / 发送）里已经看不到星光增强按钮，点击也没有任何反应。

根因：DSH 通过 `~/.dsh/profiles/desktop/package.json` 的 `"@local/prompt-enhancer": "link:/Users/mac/Projects/RealSlots_1/dsh-plugins/prompt-enhancer"` 引用插件，`node_modules/@local/prompt-enhancer` 是指向该目录的符号链接。该安装目录在 2026-11-02 18:48 前后被清空——只剩下空的 `locale/` 和 `node_modules/.pnpm/zod@4.4.3/node_modules/zod` 目录骨架，`index.js`、`client.js`、`remote-info.js`、`package.json`、`cordis.patch.yml`、`icon.svg`、`locale/*.json` 全部缺失（`find -type f` 结果为 0）。因此启动时该 bundle 无法解析，既没有 Host `promptEnhancer` service，也没有 Client 槽位注册；生成的 `~/.dsh/profiles/desktop/cordis.yml` 中完全不含 `prompt-enhancer` 条目（对照：同批次的 `@local/dsh-workspace-workflows`、`dsh-project-notes`、`@zzerx/dsh-plugin-daily-log` 均在），故按钮消失。与上次的 typertRemote 绑定问题无关——那要求插件先能加载。

证据：
- `find /Users/mac/Projects/RealSlots_1/dsh-plugins/prompt-enhancer -type f` → 0 个文件；仅 `locale/`、`node_modules/.pnpm/zod@4.4.3/node_modules/zod`（内部同样无文件）等空目录。
- `grep -i prompt-enhancer ~/.dsh/profiles/desktop/cordis.yml` → 无命中。
- 仓库 `/Users/mac/Projects/_github/_self/prompt-enhancer` 文件完整，`index.js` 含上次的 typertRemote 修复。

修复：
1. 重新为插件提供运行时依赖：把 profile 中真实的 `zod@4.4.3` 复制到仓库 `node_modules/zod`（该目录被 `.gitignore` 忽略，属于安装产物，不入库）。
2. 把被清空的安装目录 `/Users/mac/Projects/RealSlots_1/dsh-plugins/prompt-enhancer` 替换为指向仓库的符号链接，使 profile 的 `link:` 依赖、`pnpm-lock.yaml` 与 `node_modules` 链接全部继续有效，同时把仓库作为唯一源码来源（避免再次出现“安装副本被清空/与源码不同步”）。

验证：
- `node --check index.js client.js remote-info.js` 全部通过。
- 经 profile 链接解析：`require.resolve('@local/prompt-enhancer')` → 仓库 `index.js`，`@local/prompt-enhancer/client` → 仓库 `client.js`；动态 `import()` 仓库入口成功（可加载 `zod`），导出 `apply`/`inject=['llm','typert']`。
- Host `apply` 冒烟测试（mock ctx）：`ctx.provide('promptEnhancer', service)` 成功；`service.typertRemote.service === service`、`serviceKey/namespace='promptEnhancer'`，与描述符 `namespace` 一致，复刻的 `validateBinding` 判定通过。
- `~/.dsh/profiles/desktop/cordis.yml` 由启动时按 bundle patch 合并生成（profile `cordis.patch.yml` 不含 workspace-workflows/project-notes，但生成结果含之），故重启后应自动包含 `prompt-enhancer`。

待人工验证：Host 端仍在进程启动时加载，这次是“插件目录缺失”级别的变化，必须重启 DeepSeek Harness 应用（或在插件管理器重新启用/重载该插件）后才会重新出现按钮；重启后在 GUI 输入纯文本点击星光按钮，确认回填且不自动发送。

## 2026-11-03 变更：改为 tgz 自包含安装（不再依赖本地源码目录）

背景：`link:` 安装的运行时实体是本地源码目录，旧路径一旦被清空插件即整体失效（见上一节）。按用户要求改为 tgz 自包含安装，插件实体落进 DSH profile。

做法：
1. 仓库内 `npm pack --pack-destination dist` 生成 `local-prompt-enhancer-1.0.0.tgz`（`files` 含 index.js / client.js / remote-info.js / cordis.patch.yml / icon.svg / locale/*.json）。
2. 把 tgz 放到 profile 的稳定位置：`~/.dsh/profiles/desktop/vendor/local-prompt-enhancer-1.0.0.tgz`。
3. profile `package.json` 依赖改为 `"@local/prompt-enhancer": "file:/Users/mac/.dsh/profiles/desktop/vendor/local-prompt-enhancer-1.0.0.tgz"`；`dsh.profile.bundles` 里的 `@local/prompt-enhancer` 保持不变。
4. 用 DSH 自带 pnpm（`/Users/mac/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs`）在 profile 执行 `pnpm install --offline --ignore-scripts`。profile 的 `nodeLinker: hoisted`，插件被解包为 `~/.dsh/profiles/desktop/node_modules/@local/prompt-enhancer` 的**真实目录**（非符号链接），依赖 `zod@4.4.3` 复用本地 store。

结果：运行时只读 profile 内文件，不再依赖 `/Users/mac/Projects/...` 源码目录；源码仓库仍作为构建来源。

验证：
- `node_modules/@local/prompt-enhancer` 为真实目录，`pwd -P` 位于 profile 内；`require.resolve('@local/prompt-enhancer')` 与 `/client` 均落在 profile 内，`zod` 解析到 profile 的 `node_modules/zod`。
- 装后副本 `node --check index.js client.js remote-info.js` 通过；Host `apply` 冒烟通过（`typertRemote` 绑定正确）。
- `pnpm-lock.yaml` 记录 `file:vendor/local-prompt-enhancer-1.0.0.tgz` + integrity，packages/snapshots 含 `zod: 4.4.3`。

以后更新插件的流程：
```bash
cd /Users/mac/Projects/_github/_self/prompt-enhancer
npm pack --pack-destination dist
cp -f dist/local-prompt-enhancer-1.0.0.tgz /Users/mac/.dsh/profiles/desktop/vendor/
# 若改了版本号，同步更新 profile package.json 里 file: 的文件名
cd /Users/mac/.dsh/profiles/desktop
node /Users/mac/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs install --offline --ignore-scripts
# 然后重启 DeepSeek Harness
```

注意：旧路径 `/Users/mac/Projects/RealSlots_1/dsh-plugins/prompt-enhancer` 已不再被 profile 引用；它现在是上一节临时创建的、指向仓库的遗留符号链接，可在重启验证通过后删除。

待人工验证：重启 DSH 后按钮重新出现；输入纯文本点星光，确认真实模型回填且不自动发送。

## 2026-11-03 修复：新建会话时增强按钮不可用（模型选择缺少默认回退）

现象：重启后，在**新开启的会话**里星光按钮不可用（置灰）；已有会话正常。

根因：client.js 取当前模型用的是会话持久投影 `modelSelection` 的 `next ?? lastUsed`。该投影只有在会话选过/用过模型后才有值；**全新会话在发第一条消息前是空的**，于是 `selection === undefined`、`disabled` 恒为真。而原生模型 seat（`conversation.input.model`）用的是 `ctx.modelDirectories.directoryFor(sessionId).store`，其快照会回退到 `catalog.value.default` —— 所以新会话里模型选择器有默认模型，而增强按钮没有。

修复（client.js，版本 1.1.2）：
- `createButton(remote, t, getModels)`，其中 `getModels = () => ctx.get('modelDirectories')`；
- 组件内用 `React.useMemo` 按 `props.sessionId` 懒取 `models.directoryFor(sessionId)`（`try/catch` 兜底），得到其 `.store`；
- 用 `React.useSyncExternalStore` 订阅该 store，`selection = state.current ?? <modelSelection 投影>`；`reasoningEffort = current.reasoningEffort ?? retainedEffort`；
- 挂载时调用 `directory.load()` 触发模型目录加载；
- package.json 的 `dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-model-selection`，保证模型目录服务先行就绪。
采用懒解析 + 兜底：即使该服务缺失，也只是退回旧的投影逻辑（新会话仍可能置灰），不会导致插件整体不加载。

验证：`node --check client.js` 通过；安装副本 1.1.2 与仓库 `client.js` 的 sha256 一致（`e91d6dc…`）；`require.resolve('@local/prompt-enhancer')` 落在 profile 内。

待人工验证：重启后在**新建会话**输入纯文本，星光按钮应可点击并正确回填。

## 2026-11-03 修复（二）：新建会话按钮仍置灰 → 渲染期不再用 selection 门控（版本 1.1.3）

现象（1.1.2 之后实测）：重启进入**新建会话**，输入纯文本「测试提示词」后星光按钮仍在但置灰；模型选择器已显示「K3.1 Pro · Kimi Code High」。说明按钮渲染正常，是 `disabled` 仍为真。1.1.2 的目录回退没能把 `selection` 补上（`ctx.get('modelDirectories')` 在该插件上下文可能不可解析，或 blank 会话的目录 snapshot 仍为 null），而渲染期强依赖 selection 本身过于脆弱。

修复（client.js，版本 1.1.3）：
- `disabled` 只保留 `pending || !input || draft.trim()===''`，不再用 selection / plain / inputActions 在渲染期门控——只要有纯文本就可点击；
- 点击时再解析模型：优先 `selection`（投影/目录 store），为空则调用 `ctx.remote.session.modelCatalog()` 取 `value.default` 作为 provider/model 兜底；仍取不到才提示「无法确定当前模型」；
- 点击时校验 `plain` 与 `props.inputActions`，缺失时给出明确提示，而不是静默置灰。

验证：`node --check client.js` 通过；安装副本 1.1.3 与仓库 `client.js` 的 sha256 一致（`675cf3b…`）。

待人工验证：重启后新建会话输入纯文本，按钮应可点击；若点击后弹出错误提示，请把提示文字发我以便继续定位。

补充（1.1.4）：为保证点击期兜底可用，模块 `inject` 增加 `remote.session`（与 `dsh-client-ui-model-selection` 的 ModelDirectoryResolver 一致），确保 `ctx.remote.session.modelCatalog()` 已就绪。重新打包安装 1.1.4；安装副本 `client.js` sha256 为 `c36e3d9…`，与仓库一致。

## 2026-11-09 变更：项目重命名为 dsh-prompt-enhancer

按用户要求，工程名称由 `prompt-enhancer` 改为 `dsh-prompt-enhancer`，GitHub 仓库同步重命名为 `legendbone/dsh-prompt-enhancer`。

- npm 包名：`@local/prompt-enhancer` → `@local/dsh-prompt-enhancer`。
- 插件 id（cordis patch id / client slot id）：`prompt-enhancer` → `dsh-prompt-enhancer`。
- README 标题与安装说明同步更新。
- 内部 service 命名空间（`promptEnhancer`、`promptEnhancer/enhance`）保持不变，避免改动现有 Remote 契约。
- 上文中 2026-11-02 至 2026-11-03 的历史记录保持原样（记录的是当时真实的路径与包名）。

## 2026-11-09 变更：输出上限随输入动态调整 + 草稿过长前置拦截（版本 1.2.0）

背景：原先输出上限写死 2048 tokens（`index.js` 中 `maxTokens: 2048`）。固定上限与输入长度无关：短草稿浪费额度，长草稿一旦输出超限就走 `max-tokens` 整单失败。按建议改为随输入动态预算，并加一道输入闸门。

改动：
- `index.js`：新增 `estimateTokens()`（CJK/全角字符≈1 token/字，其他字符≈1 token/4 字符）、`outputTokenBudget()`（`min(4096, max(1024, ceil(est × 2.5)))`），以及 `MAX_INPUT_TOKENS = floor(4096 / 2.5) = 1638`。`enhance()` 的 `maxTokens` 改为 `outputTokenBudget(request.prompt)`；调用 LLM 前对 `estimateTokens(request.prompt) > MAX_INPUT_TOKENS` 返回 `input-too-long`，避免生成撞到 `max-tokens` 才失败。
- `client.js`：内置同样的 `estimateTokens()` 与 `MAX_INPUT_TOKENS`；渲染期计算 `tooLong` 用于悬停提示（`label` 优先显示该提示），点击命中 `tooLong` 时直接弹“草稿过长，请分段增强”且不发起请求；中英文字典新增 `tooLong`。
- 保留原有 `max-tokens` 显式失败语义（输出超限时不覆盖原草稿），Host 侧 `input-too-long` 作为客户端闸门之外的兜底。

验证：
- `node --check index.js`、`node --check client.js`、`node --check remote-info.js` 全部通过。
- 抽取 `index.js` 中的估算/预算函数做数值验证：
  - 常量 `MIN=1024 / MAX=4096 / MULT=2.5 / MAX_INPUT=1638`。
  - 空或短草稿 → 1024（比旧的 2048 更省）；600 汉字 → 1500；1600 汉字 → 4000；1700 汉字 → 预算封顶 4096 且 `gated=true`；2000 英文符 → 估算 500、预算 1250。
  - 边界：`est=1638` 不拦截、`est=1639` 拦截，预算在 `MAX_INPUT_TOKENS` 处已达 4095（≈ 上限），与设计自洽。

待人工验证：重新 `npm pack` 装入 profile 并重启 DSH 后，在新建会话分别输入短草稿（应正常回填、预算 1024）与超长草稿（点击即提示“草稿过长，请分段增强”且不发请求）各验证一次。

## 2026-11-17 修复：推理 token 挤占输出预算导致 max-tokens 失败（版本 1.2.1）

现象：用户点击「增强提示词」后提示「提示词增强失败：The enhanced prompt reached the output token limit.」（运行版本 1.1.4，截图见 m00001）。1.1.4 的 `index.js` 把 `maxTokens` 写死为 `2048`。

根因：Provider 的 `maxTokens` 是**生成 token 总上限，包含推理/思考 token**，不只是回填正文。用户当前模型（如 Kimi K3.1 Pro，选择 `high` 推理档）单次增强会先花掉约 1k–2k 思考 token，再开始输出；固定 2048 的预算在思考后所剩无几，正文被截断，provider 返回 stopReason `length` → `dsh-llm-pi-ai` 映射为 `{kind:'max-tokens'}` → 插件报上面的错误。

实证（直连本地 magpie 网关 `http://127.0.0.1:3425/v1/chat/completions`，`reasoning_effort=high`）：
- 813 字草稿 + `max_tokens=2048` → `finish_reason=length`，`completion_tokens=2048`（其中 `reasoning_tokens=1379`），正文仅 1212 字即被截断。
- 同一 813 字草稿 + `max_tokens=8192` → `finish_reason=stop`，`completion_tokens=2928`（`reasoning_tokens=1847`），正文 1915 字，正常。
- 873 字草稿 + `max_tokens=8192` → `stop`，`reasoning_tokens=725`，正文 2251 字。
- 复盘：1.2.0 的纯动态预算对该 813 字草稿只给到 `ceil(813×2.5)=2033`，同样会被思考 token 吃穿，因此 1.2.0 并未真正修好这个场景。

修复（`index.js`，版本 1.2.1）：`outputTokenBudget()` 在原有按输入估算的输出预算之上，叠加固定的 `REASONING_HEADROOM_TOKENS = 4096` 思考余量，再用 `MAX_TOTAL_TOKENS = 16384` 整体封顶：

```
outputBudget = min(4096, max(1024, ceil(估算输入 tokens × 2.5)))
maxTokens    = min(16384, outputBudget + 4096)
```

输出部分的下限/上限与 `MAX_INPUT_TOKENS = 1638` 输入闸门保持不变；`client.js` 只用于前置闸门，无需改动。`max-tokens` 显式失败语义保留为最后兜底。

数值验证（按新公式）：
- 空/短草稿 → 1024 + 4096 = 5120。
- 813 字 → 2033 + 4096 = 6129（> 实测所需的 2928）。
- 1638 字（闸门边界）→ 4096 + 4096 = 8192。
- 均 ≤ 16384，且都能覆盖“思考 + 正文”。

其它验证：
- `node --check index.js`、`node --check client.js`、`node --check remote-info.js` 通过。
- `npm pack` 生成 `dist/local-dsh-prompt-enhancer-1.2.1.tgz`，装入 profile `vendor/`，profile `package.json` 依赖改为 1.2.1，pnpm 重新安装为真实目录；安装副本与仓库一致。

待人工验证：重启 DeepSeek Harness（Host 端在进程启动时加载）后，用当前 Kimi K3.1 Pro（High）在新建会话输入中长纯文本草稿点击星光按钮，确认正常回填、不再出现 max-tokens 失败。
