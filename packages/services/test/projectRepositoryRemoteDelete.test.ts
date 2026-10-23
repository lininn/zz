import { describe, expect, it } from "vitest";
import { fixture, port } from "#src/project-storage/test-fixture.js";

describe("project repository remote delete", () => {
  it("soft-deletes an explicit host row and reports whether it changed", async () => {
    const { db, context } = await fixture();
    await port.migrate(db, context);
    db.exec("INSERT INTO hosts(host_id,kind) VALUES ('remote:server:s','server')");
    const foreign = port.repository(db, "remote:server:s");
    const project = foreign.saveProject({ roots: ["/remote"] });
    const local = port.repository(db);
    expect(local.deleteProject(project.id, "local")).toBe(0);
    expect(local.deleteProject(project.id, "remote:server:s")).toBe(1);
    expect(local.deleteProject(project.id, "remote:server:s")).toBe(0);
    expect(
      foreign.readTree({ includeDeleted: true }).projects.find((row) => row.id === project.id)
        ?.deleted,
    ).toBe(true);
  });
});
