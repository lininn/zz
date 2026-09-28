// Offline Claude protocol fixture; no model, credentials, or network.
const scenario = process.argv[2];
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const result = {
  type: "result",
  subtype: "success",
  session_id: "native-crew-claude",
  structured_output: { summary: "Claude fixture completed", status: "succeeded", artifacts: [] },
};
if (scenario === "native-failure") {
  result.subtype = "error_during_execution";
  result.is_error = true;
}
if (scenario === "malformed") {
  process.stdout.write("{broken}\n");
  emit({ type: "new_vendor_event" });
}
if (scenario === "stderr-terminal") process.stderr.write(`${JSON.stringify(result)}\n`);
emit({ type: "system", subtype: "init", session_id: "native-crew-claude" });
if (scenario === "policy") {
  emit({ type: "subagent_started" });
  setInterval(() => {}, 1000);
} else if (scenario === "permission") {
  emit({ type: "permission_request", request_id: "crew-permission", tool_name: "Edit" });
  setInterval(() => {}, 1000);
} else if (scenario === "hang") setInterval(() => {}, 1000);
else if (scenario !== "stderr-terminal") {
  emit(result);
  process.exitCode = scenario === "exit-failure" ? 7 : 0;
}
