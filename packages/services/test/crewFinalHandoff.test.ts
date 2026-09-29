import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCrewHandoff,
  crewObjectiveHash,
  crewRelayMessageId,
} from "../src/crew/crewRelayPolicy.js";

const tag = (to: string, objective = "Implement") =>
  `<crew-handoff>${JSON.stringify({ to, objective, context: "Plan approved" })}</crew-handoff>`;

test("final handoff parsing accepts only the last strict tag, never plain mentions or malformed fallback", () => {
  assert.equal(parseCrewHandoff("@Developer please work"), null);
  assert.equal(
    parseCrewHandoff(`${tag("Developer")}\n<crew-handoff>{broken}</crew-handoff>`),
    null,
  );
  assert.equal(parseCrewHandoff(`${tag("Developer")}\n<crew-handoff>{`), null);
  // 多余字段/缺 context 不再整条拒绝：弱模型写不出严格 JSON，拒收等于断链。
  assert.equal(
    parseCrewHandoff(
      '<crew-handoff>{"to":"x","objective":"o","context":"","extra":true}</crew-handoff>',
    )?.to,
    "x",
  );
  assert.equal(
    parseCrewHandoff('<crew-handoff>{"to":"x","objective":"o","note":"hi"}</crew-handoff>')?.to,
    "x",
  );
  assert.equal(
    parseCrewHandoff('<crew-handoff>{"to":"x","objective":"","context":""}</crew-handoff>'),
    null,
  );
  assert.equal(parseCrewHandoff(`${tag("Developer")}\n${tag("Reviewer")}`)?.to, "Reviewer");
  assert.equal(parseCrewHandoff(tag("开发成员", "检查中文目标"))?.objective, "检查中文目标");
});
test("relay fingerprints normalize whitespace, case and unicode; admission id is unambiguous and bounded", () => {
  assert.equal(crewObjectiveHash(" ＦＩＸ\n  Bug "), crewObjectiveHash("fix bug"));
  assert.notEqual(crewObjectiveHash("fix bug"), crewObjectiveHash("review bug"));
  assert.equal(crewRelayMessageId("root", 2, "dev"), crewRelayMessageId("root", 2, "dev"));
  assert.notEqual(crewRelayMessageId("root", 2, "dev"), crewRelayMessageId("root", 3, "dev"));
  assert.notEqual(crewRelayMessageId("a:b", 2, "c"), crewRelayMessageId("a", 2, "b:c"));
  assert(crewRelayMessageId("r".repeat(256), 8, "t".repeat(256)).length < 256);
});
