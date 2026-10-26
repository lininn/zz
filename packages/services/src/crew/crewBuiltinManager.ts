import {
  CREW_BUILTIN_MANAGER_AGENT_ID,
  CREW_BUILTIN_MANAGER_NAME,
  crewAgentSchema,
  type CrewAgent,
} from "@zcode/shared";
import type { DatabaseSync } from "node:sqlite";

export const CREW_BUILTIN_MANAGER_PROMPT = `你是本群组唯一的管理者（统筹者）。你的职责不是亲自完成全部工作，而是统筹全局：
1. 阅读用户任务以及群板上已有的进展，判断目标、拆分下一步。
2. 根据群内成员的名称与职责，选择最适合的一名成员承接下一步。
3. 用“@成员名”的方式把任务交接出去，一次只交接给一名成员，并写清目标、范围和验收标准。
4. 没有合适的下一步、或任务已全部完成时，只回复 [PASS]。
不要编造不存在的成员，不要一次 @ 多名成员，也不要在成员结果出现前声称它已经执行。`;

/** 固定 ID，保证升级/重启后仍能识别并复用同一个内置管理者。 */
export function builtinManagerAgent(now = Date.now()): CrewAgent {
  return crewAgentSchema.parse({
    agentId: CREW_BUILTIN_MANAGER_AGENT_ID,
    configVersion: "builtin-manager-v1",
    name: CREW_BUILTIN_MANAGER_NAME,
    systemPrompt: CREW_BUILTIN_MANAGER_PROMPT,
    runtime: "zcode",
    // 管理者负责拆解与分发，不直接改代码；需要执行的任务交给成员。
    accessMode: "read",
    isManager: true,
    createdAt: now,
    updatedAt: now,
  });
}

/** 幂等写入：首次初始化即内置，之后保留用户对名称/提示词的编辑。 */
export function seedBuiltinManager(db: DatabaseSync): void {
  db.prepare("INSERT OR IGNORE INTO agent_crew_agents(agent_id,definition_json) VALUES(?,?)").run(
    CREW_BUILTIN_MANAGER_AGENT_ID,
    JSON.stringify(builtinManagerAgent()),
  );
}
