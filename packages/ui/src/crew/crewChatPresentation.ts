import type {
  CrewExecution,
  CrewGroupDetail,
  CrewMessage,
  CrewResolvedMember,
} from "@zcode/shared";

export type CrewChatSender = {
  kind: CrewMessage["sender"] | "system";
  memberId: string | null;
  name: string | null;
  configVersion: string | null;
};
export type CrewChatMessage = {
  message: CrewMessage;
  mentions: { memberId: string; name: string | null }[];
  execution?: CrewExecution;
};
export type CrewChatEntry =
  | { kind: "messages"; key: string; sender: CrewChatSender; messages: CrewChatMessage[] }
  | { kind: "execution"; key: string; sender: CrewChatSender; executions: CrewExecution[] };

/** 接力沿用 sender=user 入库；展示来源必须关联执行投影，不能按文本或 ID 格式猜测。 */
export function crewIsRelayDispatch(
  message: CrewMessage,
  executions: readonly CrewExecution[],
): boolean {
  return (
    message.sender === "user" &&
    executions.some(
      (execution) =>
        execution.groupId === message.groupId &&
        execution.conversationId === message.conversationId &&
        execution.epoch === message.epoch &&
        execution.messageId === message.messageId &&
        (execution.hop ?? 0) > 0,
    )
  );
}

/** 服务投影是唯一事实源；先隔离会话，避免历史快照和审批串入其他群聊。 */
export function crewChatEntries(detail: CrewGroupDetail): CrewChatEntry[] {
  if (detail.conversation.groupId !== detail.group.groupId) return [];
  const belongs = (record: { groupId: string; conversationId: string }) =>
    record.groupId === detail.group.groupId &&
    record.conversationId === detail.conversation.conversationId;
  const messages = detail.messages.filter(belongs).toSorted((a, b) => a.sequence - b.sequence);
  const executions = detail.executions.filter(belongs);
  const currentMembers = new Map(detail.resolvedMembers.map((member) => [member.memberId, member]));
  const executionById = new Map(executions.map((execution) => [execution.executionId, execution]));
  const dispatches = new Map<string, CrewExecution[]>();
  const histories = new Map<string, CrewExecution[]>();
  for (const execution of executions) {
    const sent = dispatches.get(execution.messageId) ?? [];
    sent.push(execution);
    dispatches.set(execution.messageId, sent);
    const history = histories.get(execution.memberId) ?? [];
    history.push(execution);
    histories.set(execution.memberId, history);
  }
  for (const history of histories.values()) history.sort((a, b) => b.createdAt - a.createdAt);
  const snapshot = (
    memberId: string | null,
    message: CrewMessage,
  ): CrewResolvedMember | undefined => {
    if (!memberId) return undefined;
    return (
      histories
        .get(memberId)
        ?.find(
          (execution) =>
            execution.epoch === message.epoch && execution.createdAt <= message.createdAt,
        )?.memberSnapshot ?? currentMembers.get(memberId)
    );
  };
  const ranks = new Map(messages.map((message, index) => [message.messageId, index * 2]));
  const ordered: { rank: number; message?: CrewMessage; execution?: CrewExecution }[] =
    messages.map((message, index) => ({ rank: index * 2, message }));
  for (const execution of executions) {
    const sourceRank = ranks.get(execution.messageId);
    const nextMessage =
      sourceRank === undefined
        ? messages.findIndex((message) => message.createdAt >= execution.createdAt)
        : -1;
    ordered.push({
      rank:
        sourceRank !== undefined
          ? sourceRank + 1
          : (nextMessage < 0 ? messages.length : nextMessage) * 2 - 1,
      execution,
    });
  }
  ordered.sort(
    (a, b) => a.rank - b.rank || (a.execution?.createdAt ?? 0) - (b.execution?.createdAt ?? 0),
  );
  const entries: CrewChatEntry[] = [];
  let previousSenderKey = "";
  for (const item of ordered) {
    if (item.execution) {
      const execution = item.execution;
      // 执行归属于发起它的成员：入口以成员身份呈现（头像/名字/身份色），
      // 不再是无主的「系统」事件——否则 agent 干了什么在群聊里读起来不像是它说的。
      const executionSender: CrewChatSender = {
        kind: "member",
        memberId: execution.memberId,
        name: execution.memberSnapshot.name,
        configVersion: execution.memberSnapshot.configVersion,
      };
      const executionSenderKey = JSON.stringify([
        execution.groupId,
        execution.conversationId,
        execution.epoch,
        executionSender,
      ]);
      const previousEntry = entries.at(-1);
      // 同一成员连续派工合并成一个回合，头像与名字只出现一次。
      if (previousEntry?.kind === "execution" && previousSenderKey === executionSenderKey) {
        previousEntry.executions.push(execution);
      } else {
        entries.push({
          kind: "execution",
          key: `execution:${execution.executionId}`,
          sender: executionSender,
          executions: [execution],
        });
      }
      previousSenderKey = executionSenderKey;
      continue;
    }
    const message = item.message!;
    const linked = message.executionId ? executionById.get(message.executionId) : undefined;
    const execution =
      linked?.epoch === message.epoch && linked.memberId === message.memberId ? linked : undefined;
    const member = execution?.memberSnapshot ?? snapshot(message.memberId, message);
    const sender: CrewChatSender = {
      kind: crewIsRelayDispatch(message, dispatches.get(message.messageId) ?? [])
        ? "system"
        : message.sender,
      memberId: message.memberId,
      name: message.sender === "member" ? (member?.name ?? null) : null,
      configVersion: message.sender === "member" ? (member?.configVersion ?? null) : null,
    };
    const projected: CrewChatMessage = {
      message,
      execution,
      mentions: message.mentions.map((memberId) => ({
        memberId,
        name:
          (
            dispatches
              .get(message.messageId)
              ?.find(
                (candidate) => candidate.epoch === message.epoch && candidate.memberId === memberId,
              )?.memberSnapshot ?? snapshot(memberId, message)
          )?.name ?? null,
      })),
    };
    const senderKey = JSON.stringify([
      message.groupId,
      message.conversationId,
      message.epoch,
      sender,
    ]);
    const previous = entries.at(-1);
    if (previous?.kind === "messages" && previousSenderKey === senderKey)
      previous.messages.push(projected);
    else
      entries.push({
        kind: "messages",
        key: `message:${message.messageId}`,
        sender,
        messages: [projected],
      });
    previousSenderKey = senderKey;
  }
  return entries;
}

export function crewReplyPreview(text: string): string | null {
  const lines = text.split("\n");
  return text.length > 1200 || lines.length > 16
    ? `${lines.slice(0, 8).join("\n").slice(0, 600)}…`
    : null;
}

const CHAT_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const CHAT_DAY_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 聊天时间戳：当天只给时分（群聊惯例），跨天补上月日。 */
export function crewChatTimestamp(epochMs: number, now: number = Date.now()): string {
  if (!Number.isFinite(epochMs)) return "";
  const date = new Date(epochMs);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return (sameDay ? CHAT_TIME_FORMAT : CHAT_DAY_TIME_FORMAT).format(date);
}

export function crewExecutionElapsed(execution: CrewExecution, now: number): string {
  const end =
    execution.status === "running" || execution.status === "queued" ? now : execution.updatedAt;
  const seconds = Math.max(0, Math.floor((end - execution.createdAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const tail = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail.padStart(5, "0")}` : tail;
}
