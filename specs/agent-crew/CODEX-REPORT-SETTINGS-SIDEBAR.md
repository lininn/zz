已完成，**未 commit，未修改 `apps/zcode-cli`**。

- 设置页复用原 hook、Panel 和 40px 开关：窄屏初始隐藏，选择 section 后收起，支持按钮、遮罩和 Escape 关闭。
- 桌面保留原 68px→268px 布局、分组及导航 intent。
- 处理首页与设置页同时挂载时的 ID、焦点和 Escape 隔离；共享组件默认行为保持不变。
- `SettingsPage.tsx` 减少 110 行，新增文件均 ≤400 行。

### 验证
| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 errors，72 warnings |
| 架构检查 | 0 violations |
| 新增回归 | **35/35** |
| 原侧栏回归 | **38/38** |
| UI crew（含 SSR） | **41/41** |
| 格式检查、离线 fixture 构建 | 通过 |

报告：`specs/mobile-workspace-sidebar/VERIFICATION.md`  
真机路径与交互脚本：`specs/mobile-workspace-sidebar/e2e/README.md`

**验证限制：**浏览器 bootstrap 被沙箱阻止，真实点击、视觉及真机验收未完成；远端基线 fetch 也受写权限限制。