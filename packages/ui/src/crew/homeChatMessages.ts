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
} as const satisfies Record<keyof typeof homeChatZh, string>;
