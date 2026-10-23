import type {
  CrewExecution,
  CrewGroup,
  CrewGroupDetail,
  CrewResolvedMember,
  CrewSendParams,
  CrewWorkspaceBinding,
} from "@zcode/shared";

export function isCrewBusy(group: CrewGroup, executions: readonly CrewExecution[] = []): boolean {
  return (
    group.status === "active" ||
    group.status === "recovery_required" ||
    executions.some((execution) =>
      ["queued", "running", "recovery_required"].includes(execution.status),
    )
  );
}

export function crewBindingKey(binding: CrewWorkspaceBinding): string {
  return binding.workspaceIdentity?.trim() || binding.workspacePath;
}

/**
 * Bugfix：`crypto.randomUUID` 仅在 secure context（https/localhost）暴露。
 * 局域网 IP 访问 Web（如 http://172.16.x.x:5173）时该 API 不存在，
 * 直接调用会让 Agent 群组分区打开即崩（ErrorBoundary）。
 * 与 attachmentUploadTransaction 的兼容策略一致：优先 randomUUID，回退 Math.random UUID v4。
 */
export function createCrewId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // RFC 4122 v4 形态；仅作本地草稿/键使用，非安全用途。
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export type CrewDraft = { messageId: string; text: string; memberId: string | null };
export function newCrewDraft(): CrewDraft {
  return { messageId: createCrewId(), text: "", memberId: null };
}

/** 内容变化必须换幂等键；失败后的原样重试保留原键，避免重复执行。 */
export function editCrewDraft(
  draft: CrewDraft,
  change: Partial<Pick<CrewDraft, "text" | "memberId">>,
): CrewDraft {
  const next = { ...draft, ...change };
  return next.text === draft.text && next.memberId === draft.memberId
    ? draft
    : { ...next, messageId: createCrewId() };
}

export function crewSendParams(
  groupId: string,
  conversationId: string,
  draft: CrewDraft,
  members: readonly CrewResolvedMember[],
  // runtime 探测状态只用于展示；派工不被 preflight 误报阻塞，成败由执行边界判定。
  _availability?: CrewGroupDetail["runtimeAvailability"],
): (CrewSendParams & { conversationId: string }) | null {
  if (!draft.text.trim() || draft.text.length > 64000) return null;
  // 普通正文中的 @ 只是内容。只有 provider 选中的稳定 memberId 才能派工。
  if (draft.memberId && !members.some((candidate) => candidate.memberId === draft.memberId)) {
    return null;
  }
  return {
    groupId,
    conversationId,
    messageId: draft.messageId,
    text: draft.text,
    mentions: draft.memberId ? [draft.memberId] : [],
  };
}

/**
 * 群聊输入框此前只有「发送」按钮能提交（textarea 的 Enter 只换行），用户打完字
 * 按回车看起来毫无反应。这里与普通会话对齐：裸 Enter 发送，Shift/Ctrl/Cmd+Enter 换行。
 * IME 组合态的 Enter 是候选确认，@ 选择器打开时的 Enter 归 picker，都不能当成发送。
 */
export function crewEnterSubmits(params: {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  pickerOpen?: boolean;
}): boolean {
  return (
    params.key === "Enter" &&
    !params.shiftKey &&
    !params.ctrlKey &&
    !params.metaKey &&
    !params.isComposing &&
    !params.pickerOpen
  );
}

/** 只有用户直接键入独立 @ 才弹出 picker；粘贴/正文扫描绝不产生结构化派工。 */
export function opensCrewMentionPicker(
  key: string,
  composing: boolean,
  text: string,
  cursor: number | null,
): boolean {
  return (
    key === "@" &&
    !composing &&
    (cursor === 0 || (cursor !== null && /\s/.test(text[cursor - 1] ?? "")))
  );
}
