已实现，**未 commit，未修改 `apps/zcode-cli`**。

### 改动
- 窄屏 Web（**<1024px**）默认隐藏侧栏；沿用 `lg` 边界。当前 shell 实际是 flex + CSS 变量布局。
- 现有顶栏新增 **40px 展开/收起按钮**，复用已有翻译。
- 窄屏展开时覆盖内容，不挤压内容区；支持按钮、遮罩和 Escape 关闭。
- 选择 workspace、已有任务、新建任务或 conversation 后自动收起。
- 沿用原宽度动画；桌面应用不启用窄屏策略，保留原按钮、快捷键与宽度记忆逻辑。
- 视口读取有 SSR 防护，新增文件均小于 400 行。

### 验证
| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 errors，72 warnings |
| `pnpm architecture:check --changed` | 通过 |
| 新增侧栏回归 | **38/38** |
| 服务端 crew | **74/74** |
| UI crew（含既有 SSR） | **41/41** |
| 离线浏览器 fixture 构建 | 通过 |

**验证限制：**浏览器连接被沙箱阻止，实际点击及真机视觉验收未完成；基线 fetch 也因 `.git/FETCH_HEAD` 写权限受限而未完成。

建议手机 Safari/Chrome 重点验证：刷新首屏、展开后选择/新建、遮罩关闭、软键盘弹出及横竖屏切换。

完整报告：`specs/mobile-workspace-sidebar/VERIFICATION.md`  
可复跑交互脚本及自测路径：`specs/mobile-workspace-sidebar/e2e/README.md`