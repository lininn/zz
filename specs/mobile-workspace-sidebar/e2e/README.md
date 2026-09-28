# 移动端首页侧栏：离线交互验收

## 运行

```sh
node specs/mobile-workspace-sidebar/e2e/build-fixture.mjs
ego-browser nodejs < specs/mobile-workspace-sidebar/e2e/verify-browser.mjs
```

可指定 `SIDEBAR_E2E_SPACE_ID` 复用测试任务空间、`SIDEBAR_E2E_URL` 替换默认 `file:///tmp/zcode-mobile-sidebar-browser/index.html`。

## 测试边界

- 真实 `useWorkspaceSidebar`、`WorkspaceSidebarPanel`、`DesktopTopOverlay`、i18n provider 与生产 Tailwind CSS。
- 场景覆盖 390/768/1023px 初始隐藏、1024/1440px 初始展开、40px 触达、覆盖而非挤压内容、点击导航后收起、开关/遮罩/Escape、跨断点与桌面按钮。
- fixture 的 workspace/任务导航是本地替身，不启动 Host/Agent、不操作真实任务或 workspace、不写应用的 localStorage。
- fixture 只验证给定记忆宽度不因展开收起改变；实际持久化、旧版宽度迁移、桌面拖拽仍需完整应用验证。
- 当前环境：构建和脚本语法检查可执行；ego-browser 连接被沙箱拒绝（`Failed to connect to ego_cli bootstrap`），因此没有把浏览器交互或视觉验收记为通过。

## 手机浏览器自测

1. iOS Safari / Android Chrome 打开 Web 首页，刷新，确认左侧不占内容宽度、左上角开关可点击。
2. 展开后切换 workspace（含当前 workspace）、选择已有任务、新建任务（默认/分组）、新建 conversation，确认回到完整内容区。
3. 反复点击展开/收起，点击右侧遮罩；有外接键盘时测试 Escape、Tab，确认焦点不留在隐藏侧栏。
4. 展开后在侧栏输入框唤起软键盘，确认不会仅因键盘 resize 自动关闭；横竖屏切换检查断点行为。
5. 检查长 workspace 名、文件树、深浅主题、侧栏滚动和手机浏览器地址栏收放。
6. 桌面应用与宽屏 Web 回归：初始展开、快捷键/按钮、拖拽调宽、刷新后的记忆宽度；Electron 小窗口不采用移动端抽屉。
7. 若有远程 workspace，验证同路径不同 identity 的导航仍进入正确 workspace；本次不修改远控独立 shell 或 Host 链路。

## 设置页侧栏：复用交互验收

```sh
# 独立产物，不覆盖首页 fixture
node specs/mobile-workspace-sidebar/e2e/build-fixture.mjs --settings
node --check specs/mobile-workspace-sidebar/e2e/verify-settings-browser.mjs
ego-browser nodejs < specs/mobile-workspace-sidebar/e2e/verify-settings-browser.mjs
```

默认打开 `file:///tmp/zcode-settings-sidebar-browser/index.html`；可用 `SETTINGS_SIDEBAR_E2E_URL` 指定地址，`SIDEBAR_E2E_SPACE_ID` 复用同一任务空间。fixture 支持 `?desktop=1` 模拟 Electron 平台分支、`?locale=zh-CN` 切换中文。平台参数不替代 Electron 原生窗体验收。

- 使用真实 `SettingsPageLayout`、`SettingsSidebarNavigation`、`useWorkspaceSidebar`、共享 Panel/Toggle、Intl/Tooltip provider 和生产 Tailwind CSS。
- 底层额外挂载 inert 的首页 Panel/Toggle，复现真实 Root 的两层共存，验证设置页独立 `settings-sidebar` ID、Escape 与焦点不会命中底层首页。
- 默认停留 appearance，验证进入时不重置 section，320/390/768/1023px 不占内容宽度、展开显示分组/文字、当前/不同 section（包括 crew）选择后关闭；按钮/遮罩/Escape、隐藏导航不可聚焦、跨 1024px 切换、中英文、桌面 68px/268px。
- section 提交是本地替身：不挂载完整 SettingsPage 的服务树、不写设置偏好、不打开真实 onboarding，不启动 Host/Agent。真实页面回调与外部 navigation intent 由 AST 回归执行验证。两者仍不等同真实 App 或真机 E2E。
- 本轮仅构建、语法检查可运行；浏览器 bootstrap 仍被沙箱拒绝，未记浏览器点击/视觉通过。

### 设置页真机自测路径

1. iOS Safari / Android Chrome 打开 Web，首页侧栏 → 设置 → 选择「外观」，返回工作区，再进设置。应先看到已选 section，左侧无 68px 常驻列。
2. 点左上角 40px 开关；抽屉显示文字和分组，内容宽度不变。先选另一 section，再展开选当前 section，每次均自动收起。
3. 展开时反复用原按钮关闭、点击右侧遮罩关闭；外接键盘按 Escape 后焦点回到**设置页**开关，不回到被覆盖首页；Tab 不进入隐藏侧栏或被遮挡内容。
4. 测试系统/外观、模型、插件、crew 等入口；在设置页用 quickpick 发起模型/插件/usage 的导航 intent，确认目标 tab、origin、scope 和面包屑保持原行为。
5. 深浅主题、中英文、长标题与导航滚动；手机地址栏展开/收起、软键盘、横竖屏切换，不应裁掉抽屉底部或产生横向滚动。跨 1024px 后恢复目标模式默认显隐。
6. 宽屏 Web（1024/1440px）保持 268px 分组导航，无移动开关/遮罩；Electron 小窗口仍为 68px 图标栏，大窗口为 268px。检查 macOS 避让区、Windows/Linux 窗控及返回工作区。
7. 返回首页，确认原有展开/收缩、遮罩、Escape、任务导航与桌面宽度记忆仍正常；设置页 Escape 不应改变底层首页原显隐选择。
