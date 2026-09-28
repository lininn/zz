import type { CrewResolvedMember } from "@zcode/shared";
import type { MentionItem } from "../mentionTypes.js";

/** 沿用 mention provider 的候选模型，但 value 为群成员 ID，绝不复用 agent 名称派工。 */
export function mapCrewMembersToMentionItems(
  members: readonly CrewResolvedMember[],
): MentionItem[] {
  return members.map((member) => ({
    id: `crew-member:${member.memberId}`,
    category: "subagents",
    label: member.name,
    description: member.rolePrompt,
    value: member.memberId,
    // Crew 使用独立的结构化 mentions 字段，不把可伪造的 markdown 当作执行指令。
    markdown: "",
    keywords: [member.name, member.rolePrompt, member.memberId],
  }));
}
