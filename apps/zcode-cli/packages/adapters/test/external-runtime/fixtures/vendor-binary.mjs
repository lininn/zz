// Offline fake vendor executable. Never invokes a model, network, or user workspace.
import { readFile } from "node:fs/promises";
const [vendor, scenario, ...args] = process.argv.slice(2);
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const final = JSON.stringify({ summary: "fixture complete", status: "succeeded", artifacts: [] });
const session = "native-session-1";
if (scenario === "probe") {
  if (args.includes("--version")) console.log(vendor === "codex" ? "codex-cli 0.156.1" : "1.18.30");
  else if (args.includes("status")) console.log("Logged in");
  else if (args.includes("auth")) console.log("1 credential");
  else if (args.includes("features"))
    console.log(
      "multi_agent stable true\nmulti_agent_v2 stable false\nplugins stable true\nhooks stable true",
    );
  else
    console.log(
      "--json --output-schema --ask-for-approval never --sandbox read-only workspace-write --disable --ignore-user-config --ignore-rules SESSION_ID --format json --session --pure",
    );
  process.exit(0);
}
// 真 codex 不带 --output-schema 也能跑；替身必须同样支持两种调用，
// 否则「默认不强制 JSON」这个行为在测试里根本走不到。
if (vendor === "codex") {
  const schemaIndex = args.indexOf("--output-schema");
  if (schemaIndex >= 0) {
    const schema = args[schemaIndex + 1];
    if (!schema || !JSON.parse(await readFile(schema, "utf8")).properties.summary) process.exit(8);
  }
}
if (scenario === "hang") {
  emit(
    vendor === "codex"
      ? { type: "thread.started", thread_id: session }
      : { type: "step_start", sessionID: session },
  );
  setInterval(() => {}, 1000);
} else {
  if (scenario === "split") {
    process.stdout.write('{"type":"vendor.');
    await new Promise((resolve) => setTimeout(resolve, 15));
    process.stderr.write('{"type":"turn.completed"}\n');
    await new Promise((resolve) => setTimeout(resolve, 15));
    process.stdout.write('future_event"}\r\n');
  }
  if (scenario === "malformed") {
    process.stdout.write("{broken\n");
    emit({ type: "vendor.future_event" });
    process.stderr.write("diagnostic only; never JSON stdout\n");
  }
  if (vendor === "codex") {
    emit({ type: "thread.started", thread_id: session });
    emit({ type: "turn.started" });
    if (scenario === "delegation")
      emit({ type: "item.started", item: { type: "collab_tool_call" } });
    if (scenario === "permission")
      emit({ type: "permission.requested", request_id: "permission-1" });
    if (scenario !== "missing-final") {
      emit({
        type: "item.completed",
        item: {
          id: "message-1",
          type: "agent_message",
          text: scenario === "unstructured" ? "plain text" : final,
        },
      });
      emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    }
  } else {
    emit({ type: "step_start", sessionID: session });
    if (scenario === "delegation")
      emit({ type: "tool_use", part: { tool: "task", state: { status: "running" } } });
    if (scenario === "permission")
      emit({ type: "permission.asked", sessionID: session, properties: { id: "permission-1" } });
    if (scenario !== "missing-final") {
      emit({
        type: "text",
        sessionID: session,
        part: { text: scenario === "unstructured" ? "plain text" : final },
      });
      emit({ type: "step_finish", sessionID: session, part: { reason: "stop" } });
    }
  }
  process.exitCode = scenario === "exit-failure" ? 7 : 0;
}
