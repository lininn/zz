/** Homepage chat strings for the locale owner to merge; components use useCrewText. */
export const homeChatZh = {
  "crew.home.system": "系统",
  "crew.home.messages": "群聊消息",
  "crew.home.emptyHint": "发送消息开始讨论，使用 @ 选择成员派工。",
  "crew.home.handoff": "{from} → @{to}",
  "crew.home.expandReply": "展开完整回复",
  "crew.home.collapseReply": "收起回复",
  "crew.home.scrollToLatest": "滚动到最新消息",
  "crew.home.showExecution": "展开 {name} 的执行详情",
  "crew.home.hideExecution": "收起 {name} 的执行详情",
  "crew.home.executionDetails": "{name} 的执行详情",
  "crew.home.elapsed": "耗时",
  /** 外部运行时在跑：后端只在 task.completed 给内容，运行中只能表达状态。 */
  "crew.home.working": "工作中",
  "crew.home.showOutput": "查看输出",
  "crew.home.hideOutput": "收起输出",
  /** 频道头的在场提示，例如「正在工作：前端 Codex、设计师」。 */
  "crew.home.workingMembers": "正在工作：{names}",
} as const;

export const homeChatEn = {
  "crew.home.system": "System",
  "crew.home.messages": "Crew messages",
  "crew.home.emptyHint": "Start a discussion, or use @ to assign a member.",
  "crew.home.handoff": "{from} → @{to}",
  "crew.home.expandReply": "Show full reply",
  "crew.home.collapseReply": "Collapse reply",
  "crew.home.scrollToLatest": "Scroll to latest messages",
  "crew.home.showExecution": "Show execution details for {name}",
  "crew.home.hideExecution": "Hide execution details for {name}",
  "crew.home.executionDetails": "Execution details for {name}",
  "crew.home.elapsed": "Elapsed time",
  /** External runtime in flight: the backend only reports content at task.completed. */
  "crew.home.working": "Working",
  "crew.home.showOutput": "Show output",
  "crew.home.hideOutput": "Hide output",
  /** Channel-header presence hint, e.g. "Working: Frontend Codex, Designer". */
  "crew.home.workingMembers": "Working: {names}",
} as const satisfies Record<keyof typeof homeChatZh, string>;
