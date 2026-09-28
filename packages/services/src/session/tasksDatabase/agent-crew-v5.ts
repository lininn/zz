import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** 冻结 v5 SQL 与抽取语义；不依赖运行时 schema，历史快照保持逐字节不变。 */
export const AGENT_CATALOG_MIGRATION_SQL = `
CREATE TABLE agent_crew_agents (
  agent_id TEXT PRIMARY KEY,
  definition_json TEXT NOT NULL
);
CREATE TABLE agent_crew_member_refs (
  group_id TEXT NOT NULL REFERENCES agent_crew_groups(group_id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agent_crew_agents(agent_id) ON DELETE RESTRICT,
  access_mode TEXT CHECK(access_mode IN ('read','write')),
  PRIMARY KEY(group_id,member_id),
  UNIQUE(group_id,sort_order),
  UNIQUE(group_id,agent_id)
);
`;
export const AGENT_CATALOG_EXTRACTION_VERSION =
  "catalog-extraction-v1-canonical-definitions-preserve-duplicates";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function extractCrewAgentCatalog(db: DatabaseSync): void {
  db.exec(AGENT_CATALOG_MIGRATION_SQL);
  const rows = db
    .prepare(`SELECT m.*,g.created_at,g.updated_at FROM agent_crew_members m
    JOIN agent_crew_groups g ON g.group_id=m.group_id ORDER BY m.group_id,m.sort_order`)
    .all();
  const usedIds = new Set(rows.map((row) => String(JSON.parse(String(row.snapshot_json)).agentId)));
  const definitions = new Map<string, Map<string, string>>();
  const groupIds = new Map<string, Set<string>>();
  for (const row of rows) {
    const old = JSON.parse(String(row.snapshot_json));
    const originalId = String(old.agentId);
    const definition = {
      name: old.name,
      systemPrompt: old.rolePrompt,
      runtime: old.runtime,
      accessMode: old.accessMode,
      ...(old.modelSelection !== undefined ? { modelSelection: old.modelSelection } : {}),
      ...(old.toolAllowlist !== undefined ? { toolAllowlist: old.toolAllowlist } : {}),
    };
    const key = canonical(definition);
    const variants = definitions.get(originalId) ?? new Map<string, string>();
    definitions.set(originalId, variants);
    const group = groupIds.get(String(row.group_id)) ?? new Set<string>();
    groupIds.set(String(row.group_id), group);
    let agentId = variants.get(key);
    if (!agentId || group.has(agentId)) {
      if (!variants.size) agentId = originalId;
      else {
        // 同 ID 异定义不能覆盖；历史同群重复成员也需独立资产，保留全部角色与顺序。
        const hash = createHash("sha256")
          .update(`${originalId}\0${key}`)
          .digest("hex")
          .slice(0, 32);
        const base = `crew-migrated-${hash}`;
        agentId = base;
        let suffix = 0;
        while (usedIds.has(agentId)) agentId = `${base}-${++suffix}`;
      }
      usedIds.add(agentId);
      db.prepare("INSERT INTO agent_crew_agents VALUES(?,?)").run(
        agentId,
        JSON.stringify({
          ...definition,
          agentId,
          configVersion: old.configVersion,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
      );
      if (!variants.has(key)) variants.set(key, agentId);
    }
    group.add(agentId);
    db.prepare("INSERT INTO agent_crew_member_refs VALUES(?,?,?,?,NULL)").run(
      String(row.group_id),
      String(row.member_id),
      Number(row.sort_order),
      agentId,
    );
  }
  db.exec(
    "DROP TABLE agent_crew_members; ALTER TABLE agent_crew_member_refs RENAME TO agent_crew_members;",
  );
}
