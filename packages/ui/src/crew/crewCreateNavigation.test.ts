import assert from "node:assert/strict";
import test from "node:test";
import type { useCrewHomeNavigation } from "../hooks/useCrewHomeNavigation.js";
import { crewSidebarHarness } from "./crewSidebarHarness.js";

test("new draft navigation clears old selection and is invalidated on Host switch", async () => {
  let scope = "host-A";
  const h = await crewSidebarHarness("../hooks/useCrewHomeNavigation.ts", {
    "./useServices.js": { useServices: () => ({ crewService: scope }) },
    "./crewCacheScope.js": { crewCacheScope: (service: string) => service },
  });
  const view = () =>
    h.render("useCrewHomeNavigation", undefined) as unknown as ReturnType<
      typeof useCrewHomeNavigation
    >;
  view().select("old-group", "old-conversation");
  assert.equal(view().conversationId, "old-conversation");
  view().create();
  assert.equal(view().groupId, null);
  assert.equal(view().conversationId, null);
  assert.equal(view().editing, true);
  view().finishEditing();
  assert.equal(view().editing, false);
  view().edit("existing");
  assert.equal(view().groupId, "existing");
  assert.equal(view().editing, true);
  view().create();
  scope = "host-B";
  assert.equal(view().editing, false);
  assert.equal(view().groupId, null);
  view().select("B", "B-chat");
  assert.equal(view().conversationId, "B-chat");
  assert.equal(view().editing, false);
});
