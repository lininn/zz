import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrewAgentInput, CrewRuntimeCommand, CrewRuntimeTask } from "@zcode/shared";
import type { IZCodeSessionService } from "../src/zcode-session/zcodeSession.js";
import { CrewService } from "../src/crew/crewService.js";
import { CrewWriteAdmission } from "../src/crew/crewAdmission.js";
import { CrewLeaseStore } from "../src/crew/crewLease.js";
import { createCrewRuntime } from "../src/crew/crewRuntime.js";
import { fakeAgent } from "./crewAdmissionFixture.js";

export const externalRole: CrewAgentInput = {
  name: "Reviewer",
  systemPrompt: "Review only the requested changes.",
  runtime: "claude-cli",
  accessMode: "read",
};
export async function externalCrewFixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "crew-p1-")));
  const f = fakeAgent();
  const path = join(dir, "tasks.sqlite");
  const leases = new CrewLeaseStore(path, "900001:owner", () => true);
  const gate = new CrewWriteAdmission(f.agent, leases, () => true);
  const calls: CrewRuntimeCommand[] = [];
  const tasks = new Map<string, CrewRuntimeTask>();
  let available = true;
  let running = false;
  let permission = false;
  let unknown = false;
  let beforeStart: (() => Promise<void>) | undefined;
  f.agent.crewRuntime = async ({ command }) => {
    calls.push(command);
    if (command.action === "probe")
      return {
        kind: "probe",
        probe: {
          runtimeId: command.runtimeId,
          available,
          reason: available ? undefined : "binary_not_found",
        },
      };
    if (command.action === "start") {
      await beforeStart?.();
      if (unknown) throw new Error("unknown ack");
      tasks.set(command.taskId, {
        taskId: command.taskId,
        runtimeId: command.runtimeId,
        runtimeState: running || permission ? "running" : "succeeded",
        settled: !running && !permission,
        summary: "External result",
        nativeSessionId: "native-1",
        ...(permission
          ? {
              permission: {
                requestId: "p1",
                toolName: "Edit",
                description: "Request write",
                canRespond: true,
              },
            }
          : {}),
      });
    }
    const task = tasks.get(command.taskId);
    if (!task) throw new Error("not found");
    if (command.action === "cancel") {
      task.settled = true;
      task.runtimeState = "cancelled";
      task.summary = "crew.cancelled";
      delete task.permission;
    }
    if (command.action === "permission") {
      task.settled = true;
      task.runtimeState = command.approved ? "succeeded" : "cancelled";
      delete task.permission;
    }
    return { kind: "task", task: { ...task } };
  };
  const sessions = {
    createSession: () => {
      throw new Error("MUST NOT FALL BACK TO ZCODE");
    },
  } as unknown as IZCodeSessionService;
  const runtime = createCrewRuntime({ agent: gate.wrap(f.agent), sessions, admission: gate });
  const service = new CrewService({
    databasePath: path,
    ownerId: "900001:owner",
    isOwnerAlive: () => true,
    runtime,
  });
  const catalog = new CrewAgentCatalogService(path);
  const roleAgent = await catalog.create(externalRole);
  const group = await service.create({
    name: "P1 crew",
    members: [{ agentId: roleAgent.agentId }],
  });
  await service.bind({ groupId: group.groupId, binding: { workspacePath: dir } });
  return {
    catalog,
    roleAgent,
    dir,
    path,
    f,
    gate,
    leases,
    service,
    group,
    calls,
    tasks,
    runtime,
    available(value: boolean) {
      available = value;
    },
    running(value: boolean) {
      running = value;
    },
    permission(value: boolean) {
      permission = value;
    },
    unknown(value: boolean) {
      unknown = value;
    },
    beforeStart(fn: () => Promise<void>) {
      beforeStart = fn;
    },
    send(messageId: string, conversationId?: string) {
      return service.send({
        groupId: group.groupId,
        conversationId,
        messageId,
        text: `Task ${messageId}`,
        mentions: [group.members[0]!.memberId],
      });
    },
    async close() {
      for (const task of tasks.values()) {
        task.settled = true;
        task.runtimeState = "cancelled";
        delete task.permission;
      }
      await service.dispose();
      await catalog.dispose();
      gate.dispose();
      leases.close();
      f.frames.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
export async function waitForTask(f: Awaited<ReturnType<typeof externalCrewFixture>>) {
  for (let i = 0; i < 1000; i++) {
    const task = [...f.tasks.values()][0];
    if (task) return task;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("fixture did not start");
}
