import { randomUUID } from "node:crypto";
import {
  ExternalRuntimeResultSchema,
  type ExternalRuntimeEventEnvelope,
  type ExternalRuntimeHandle,
  type ExternalRuntimeTaskRequest,
} from "@zcode/contracts";
import type {
  ExternalRuntimeProcessHandle,
  ExternalRuntimeProcessStartOptions,
} from "./process-host.js";
import {
  record,
  VendorFinalOutputSchema,
  type VendorCliAdapterOptions,
  type VendorNativeEvent,
  type VendorTranslatedEvent,
} from "./vendor-cli-support.js";

const MAX_LINE_LENGTH = 1024 * 1024;
const DEFAULT_OUTPUT_LIMIT = 8 * 1024 * 1024;
type Translator = (event: VendorNativeEvent) => VendorTranslatedEvent[];

/** 仅持有当前进程句柄；持久队列、恢复决策与租约属于既有 dispatch/crew。 */
export class VendorRuntimeSessions {
  private readonly running = new Map<
    string,
    { attemptId: string; runtimeId: string; handle: ExternalRuntimeProcessHandle }
  >();
  private readonly starting = new Set<string>();

  constructor(private readonly options: VendorCliAdapterOptions) {
    if (!options.processHost) throw new Error("Vendor adapter requires a process host");
  }

  async interrupt(input: ExternalRuntimeHandle): Promise<void> {
    const running = this.match(input);
    if (running) await running.handle.interrupt();
  }

  async cancel(input: ExternalRuntimeHandle): Promise<void> {
    const running = this.match(input);
    if (running) await running.handle.cancel();
  }

  private match(input: ExternalRuntimeHandle) {
    const running = this.running.get(input.taskId);
    return running?.attemptId === input.attemptId && running.runtimeId === input.runtimeId
      ? running
      : undefined;
  }

  async *run(
    request: ExternalRuntimeTaskRequest,
    start: ExternalRuntimeProcessStartOptions,
    translate: Translator,
  ): AsyncIterable<ExternalRuntimeEventEnvelope> {
    if (this.starting.has(request.taskId) || this.running.has(request.taskId)) {
      throw new Error("External runtime task already running");
    }
    this.starting.add(request.taskId);
    let handle: ExternalRuntimeProcessHandle | undefined;
    let exited = false;
    try {
      handle = await this.options.processHost!.start({
        ...start,
        supervisor: {
          ...start.supervisor,
          maxOutputBytes: request.budget.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT,
        },
      });
      this.running.set(request.taskId, {
        attemptId: request.attemptId,
        runtimeId: request.runtimeId,
        handle,
      });
      yield* this.consume(request, handle, translate, () => {
        exited = true;
      });
    } finally {
      // 解析失败或消费者提前关闭时必须收敛子进程，不能遗留仍可写入的 vendor。
      if (handle && !exited) await this.confirmExit(handle);
      this.starting.delete(request.taskId);
      this.running.delete(request.taskId);
    }
  }

  private async confirmExit(handle: ExternalRuntimeProcessHandle): Promise<void> {
    try {
      await handle.cancel();
      await handle.completed;
    } catch {
      // 退出确认失败比原协议错误更严重；不能当普通 failed，必须保留句柄和 Crew 租约。
      throw new Error("recovery_required: external runtime cleanup could not confirm process exit");
    }
  }

  private async *consume(
    request: ExternalRuntimeTaskRequest,
    handle: ExternalRuntimeProcessHandle,
    translate: Translator,
    onExit: () => void,
  ): AsyncIterable<ExternalRuntimeEventEnvelope> {
    const now = this.options.now ?? (() => new Date());
    const eventPrefix = randomUUID();
    const eventId = this.options.eventId ?? ((sequence: number) => `${eventPrefix}-${sequence}`);
    let sequence = 1;
    let nativeSessionId = request.resumeNativeSessionId;
    let finalText: string | undefined;
    let terminal: "succeeded" | "failed" | undefined;
    let failure: string | undefined;
    let permissionPending = false;
    const envelope = (type: string, payload: unknown): ExternalRuntimeEventEnvelope => ({
      schemaVersion: 1,
      eventId: eventId(sequence),
      sequence: sequence++,
      taskId: request.taskId,
      attemptId: request.attemptId,
      runtimeId: request.runtimeId,
      ...(nativeSessionId ? { nativeSessionId } : {}),
      timestamp: now().toISOString(),
      type,
      payload,
    });
    const parseLine = (line: string): ExternalRuntimeEventEnvelope[] => {
      if (!line.trim()) return [];
      let native: Record<string, unknown>;
      try {
        native = record(JSON.parse(line));
        if (typeof native.type !== "string" || !native.type) throw new Error("invalid event");
      } catch {
        return [envelope("warning", { nativeType: "malformed" })];
      }
      const translated = translate(native as VendorNativeEvent);
      return translated.map((event) => {
        if (event.nativeSessionId) {
          if (nativeSessionId && nativeSessionId !== event.nativeSessionId) {
            throw new Error("protocol_error: vendor changed native session identity");
          }
          nativeSessionId = event.nativeSessionId;
        }
        if (event.type === "permission.requested") permissionPending = true;
        // 成功终态之后的新文本/第二个终态不允许覆盖已经观测到的结果。
        if (terminal && (event.finalText !== undefined || event.terminal)) {
          throw new Error("protocol_error: vendor emitted conflicting terminal events");
        }
        finalText = event.finalText ?? finalText;
        terminal = event.terminal ?? terminal;
        failure = event.failure ?? failure;
        return envelope(event.type, event.payload);
      });
    };
    yield envelope("task.started", { runtimeState: "running" });
    let buffered = "";
    for await (const chunk of handle.output) {
      if (chunk.stream === "stderr") {
        // stderr 可能含认证提示/密钥片段；不持久化原文，不让它污染 stdout JSONL。
        yield envelope("warning", { nativeType: "stderr", bytes: Buffer.byteLength(chunk.data) });
        continue;
      }
      buffered += chunk.data;
      let boundary = buffered.indexOf("\n");
      while (boundary >= 0) {
        if (boundary > MAX_LINE_LENGTH)
          throw new Error("protocol_error: vendor event exceeds size limit");
        yield* parseLine(buffered.slice(0, boundary));
        buffered = buffered.slice(boundary + 1);
        boundary = buffered.indexOf("\n");
      }
      if (buffered.length > MAX_LINE_LENGTH)
        throw new Error("protocol_error: vendor event exceeds size limit");
    }
    if (buffered.trim()) yield* parseLine(buffered);
    const completed = await handle.completed;
    onExit();
    const cancelled = completed.reason === "cancelled" || completed.reason === "interrupt";
    const processFailed =
      completed.exitCode !== 0 || completed.signal !== null || completed.reason !== "exit";
    let structured: ReturnType<typeof VendorFinalOutputSchema.parse> | undefined;
    if (finalText !== undefined) {
      const parseFinal = (text: string) => {
        try {
          return VendorFinalOutputSchema.parse(JSON.parse(text));
        } catch {
          return undefined;
        }
      };
      // vendor 偶尔不遵守 "Return only JSON"（尤其简单任务直接回一句文本）：
      // 先按整段解析，再尝试提取文本中嵌入的 JSON 对象，最后在任务成功时
      // 以原文兜底为 summary——终态判定仍以 turn 终止事件与退出码为准。
      structured =
        parseFinal(finalText) ??
        (finalText.lastIndexOf("{") >= 0 && finalText.lastIndexOf("}") > finalText.lastIndexOf("{")
          ? parseFinal(finalText.slice(finalText.lastIndexOf("{"), finalText.lastIndexOf("}") + 1))
          : undefined) ??
        (!cancelled && !processFailed && !failure && !permissionPending && terminal === "succeeded"
          ? VendorFinalOutputSchema.parse({
              summary: finalText.slice(0, 8000) || "(no output)",
              status: "succeeded",
              artifacts: [],
            })
          : undefined);
    }
    if (
      !cancelled &&
      !processFailed &&
      !failure &&
      !permissionPending &&
      (!terminal || !structured)
    ) {
      throw new Error(
        "protocol_error: external runtime ended without a structured terminal result",
      );
    }
    const status = cancelled
      ? "cancelled"
      : processFailed || failure || permissionPending || terminal === "failed"
        ? "failed"
        : (structured!.status ?? "succeeded");
    const summary = cancelled
      ? "External runtime cancelled"
      : permissionPending
        ? "External runtime permission reply is unavailable"
        : processFailed
          ? `External runtime exited unsuccessfully (reason=${completed.reason}, exitCode=${completed.exitCode ?? "null"}, signal=${completed.signal ?? "none"})`
          : (failure ?? structured!.summary);
    yield envelope(
      "task.completed",
      ExternalRuntimeResultSchema.parse({
        schemaVersion: 1,
        taskId: request.taskId,
        attemptId: request.attemptId,
        runtimeId: request.runtimeId,
        status,
        runtimeState: status,
        summary,
        completedAt: now().toISOString(),
        ...(nativeSessionId ? { nativeSessionId } : {}),
        artifacts: status === "succeeded" ? (structured?.artifacts ?? []) : [],
      }),
    );
  }
}
