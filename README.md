# Prompt Enhancer for DeepSeek Harness

一个 DeepSeek Harness 持久化插件：在聊天输入框工具栏添加星光按钮，使用当前会话选择的模型优化提示词，并将结果回填到输入框。

## 功能

- 挂载到 `conversation.input.right`，位于模型选择器之前。
- 通过插件自己的 `promptEnhancer/enhance` Remote 调用 Host 模型服务。
- 保留原始意图、语言和约束，只返回优化后的提示词正文。
- 成功后只替换草稿，不自动发送消息。
- 优化期间防止重复点击；组件卸载时取消请求。
- 如果等待期间草稿发生变化，保留用户的新内容。
- 提供中英文界面文案、加载状态和错误提示。

## 当前限制

- 仅支持纯文本提示词。
- 含结构化 `@` 引用或处于命令输入阶段时按钮禁用，避免破坏引用芯片和命令状态。
- 已有附件保持不变。
- 每次主动优化都会产生对应模型提供商的 token 消耗。

## 项目结构

```text
.
├── client.js           # Client：Remote 挂载、按钮和草稿回写
├── index.js            # Host：Remote 服务注册和模型流式请求
├── remote-info.js      # 包内 Typert RemoteInfo 实现
├── cordis.patch.yml    # Harness Loader 配置
├── package.json        # 包、Client 和资源导出清单
├── icon.svg            # 原创插件图标
├── locale/             # 插件管理器中英文元数据
└── docs/design.md      # 设计、行为约束和验证记录
```

## 安装依赖

需要 Node.js 与 pnpm：

```bash
pnpm install --ignore-scripts
```

## 静态检查

```bash
node --check index.js
node --check remote-info.js
node --check client.js
```

## 安装到 Harness

在 Harness 插件管理器中选择从本地目录安装，并选择本仓库根目录。安装后启用 `@local/prompt-enhancer`。

也可以由具备 Harness 插件工具的智能体调用 `plugin_manager.install_bundle`，将仓库绝对路径作为 `target`。

## 使用

1. 在聊天输入框输入纯文本提示词。
2. 点击模型选择器左侧的星光按钮。
3. 等待优化结果回填，确认后自行发送。

详细设计与当前验证范围见 [docs/design.md](docs/design.md)。
