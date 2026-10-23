import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { ProjectRepositoryContract } from "#src/project-storage/contract.js";
import { createProjectService } from "#src/project/index.js";

describe("project delete fallback", () => {
  it("soft-deletes an explicit remote mirror row when the host cannot be resolved", async () => {
    const deleteProject = vi.fn(() => 1);
    const afterChange = vi.fn();
    const service = createProjectService({
      repository: async () => ({ deleteProject }) as unknown as ProjectRepositoryContract,
      workspaceDirectory: tmpdir(),
      resolveHost: async () => {
        throw new Error("project.host-offline");
      },
      afterChange,
    });
    await service.deleteProject("project", "remote:server:bogon");
    expect(deleteProject).toHaveBeenCalledWith("project", "remote:server:bogon");
    expect(afterChange).toHaveBeenCalledOnce();
  });

  it("propagates a remote failure when no local mirror row was removed", async () => {
    const service = createProjectService({
      repository: async () => ({ deleteProject: () => 0 }) as unknown as ProjectRepositoryContract,
      workspaceDirectory: tmpdir(),
      resolveHost: async () => {
        throw new Error("project.host-offline");
      },
    });
    await expect(service.deleteProject("project", "remote:server:bogon")).rejects.toThrow(
      "project.host-offline",
    );
  });
});
