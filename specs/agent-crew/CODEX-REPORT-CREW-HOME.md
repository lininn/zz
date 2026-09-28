**群组首页已落地，但尚未满足全部验收标准。**

已实现：
- 一级「群组」tab，项目 → 群组 → 对话树及状态徽标。
- 新建对话、复制待绑定群、编辑、删除。
- 群聊消息分组、@ 交接、长回复折叠、执行折叠条。
- 复用现有数据层；移动端抽屉、草稿保留、zh/en 同步。

**验证通过**
- `pnpm typecheck`
- `pnpm lint`：0 errors，72 条既有 warnings
- 架构检查：0 违规
- 后端/契约/启动测试：**116/116**
- UI/导航/侧栏测试：**199/199**

**仍有三项限制**
1. Preflight 已修复开发启动误选旧 bundle，但真实 Claude/Codex probe 仍返回 `outer_isolation_missing`。缺少可信隔离装配，尚不能显示可用。
2. ZCode 详情仅展示已有 V4 投影；外部 runtime 仅展示真实状态/摘要。缺失历史或逐步事件时明确说明原因，不触发冷恢复或伪造过程。
3. 真机浏览器及完整 Web 链路验证受沙箱阻断，未计作通过。

已更新 [IMPLEMENTATION.md](specs/agent-crew/IMPLEMENTATION.md) 和[完整报告（含真机路径与阻断证据）](specs/agent-crew/CODEX-REPORT-CREW-HOME.md)。

未修改 `apps/zcode-cli`，未 commit。