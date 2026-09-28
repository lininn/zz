import { crewRuntimeParamsSchema, crewRuntimeReplySchema } from "@zcode/shared";
import type { ExternalRuntimeFacade } from "../app/external-runtime.js";
import { parseParams, type ZCodeProtocolAgentServerContext } from "./server-types.js";

const runtimes = new WeakMap<
  ZCodeProtocolAgentServerContext,
  Map<string, Promise<ExternalRuntimeFacade>>
>();

/** A standalone external facade: no ZCode session, model selection or foreground runtime. */
export async function handleCrewRuntime(context: ZCodeProtocolAgentServerContext, raw: unknown) {
  const { workspace, command } = parseParams(crewRuntimeParamsSchema, raw);
  context.assertServing?.();
  const factory = context.deps.createCrewRuntimeFacade;
  if (!factory) {
    if (command.action === "probe")
      return {
        kind: "probe" as const,
        probe: {
          runtimeId: command.runtimeId,
          available: false,
          reason: "external runtime facade unavailable",
        },
      };
    throw new Error("external runtime facade unavailable");
  }
  let entries = runtimes.get(context);
  if (!entries) {
    entries = new Map();
    runtimes.set(context, entries);
  }
  const key = JSON.stringify([
    workspace.workspaceIdentity?.trim() || workspace.workspacePath,
    workspace.remoteSessionId ?? "",
  ]);
  let pending = entries.get(key);
  if (!pending) {
    pending = factory(workspace);
    entries.set(key, pending);
    void pending.catch(() => entries?.delete(key));
  }
  const facade = await pending;
  context.assertServing?.();
  return crewRuntimeReplySchema.parse(await facade.crewRuntime(command));
}

export async function closeCrewRuntimes(context: ZCodeProtocolAgentServerContext): Promise<void> {
  const entries = runtimes.get(context);
  if (!entries) return;
  const results = await Promise.allSettled(
    [...entries.values()].map(async (pending) => (await pending).shutdown()),
  );
  runtimes.delete(context);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length)
    throw new AggregateError(
      failed.map((result) => result.reason),
      "Crew runtime shutdown failed",
    );
}
