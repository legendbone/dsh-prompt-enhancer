# AGENTS.md

本文件规定在本项目中工作的 AI Agent 的提交纪律。

## 提交规则

- 之后的每次改动都可以直接提交（commit），无需事先征得确认。即使改动有问题，用户也可以直接回退（revert）对应提交，因此不必为「是否需要提交」反复确认。
- 每次完成一处有意义的改动后即刻提交，保持提交粒度清晰、message 如实描述改动内容。
- 提交前先做静态检查：`node --check index.js && node --check client.js && node --check remote-info.js`。
- 行为、约束或验证范围有变化时，同步更新 `docs/design.md` 并在同一次提交中一并纳入。
