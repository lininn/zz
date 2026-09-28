import { createHash } from "node:crypto";
import { crewHandoffSchema, type CrewGroup, type CrewHandoff } from "@zcode/shared";

/** 只解析最终回复的最后一个标签；尾标签损坏时不能回退执行更早的指令。 */
export function parseCrewHandoff(text: string): CrewHandoff | null {
  const start = text.lastIndexOf("<crew-handoff>");
  if (start < 0) return null;
  const end = text.indexOf("</crew-handoff>", start);
  if (end < 0) return null;
  try {
    return crewHandoffSchema.parse(JSON.parse(text.slice(start + "<crew-handoff>".length, end)));
  } catch {
    return null;
  }
}
export function crewObjectiveHash(objective: string): string {
  return createHash("sha256")
    .update(objective.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase())
    .digest("hex");
}
export function crewRelayMessageId(root: string, hop: number, to: string): string {
  return `crew-relay-${createHash("sha256")
    .update(JSON.stringify([root, hop, to]))
    .digest("hex")}`;
}
export function mayAutoRelay(group: CrewGroup, hop: number): boolean {
  return (
    !group.relayPaused &&
    (group.relayMode === "auto" ||
      (group.relayMode === "semi" && hop <= (group.relayAutoHops ?? 2)))
  );
}
