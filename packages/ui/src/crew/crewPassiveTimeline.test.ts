import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { conversationTopic } from "../v4/transport.js";

const readSource = async (path: string) =>
  ts.createSourceFile(
    path,
    await readFile(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
function namedSource(ast: ts.SourceFile, name: string): string {
  let result = "";
  function visit(node: ts.Node) {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name?.getText(ast) === name
    )
      result = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(result);
  return result;
}

test("registry passive peek cannot create a connection or reuse another Host/service", async () => {
  const ast = await readSource("../v4/workspaceConnectionRegistry.ts");
  const registry = new Map();
  const code =
    namedSource(ast, "buildWorkspaceConnectionKey") +
    "\n" +
    namedSource(ast, "peekWorkspaceConversationStore");
  const exports: {
    peekWorkspaceConversationStore?: (scope: object, agent: object, id: string) => unknown;
  } = {};
  runInNewContext(
    ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024 },
    }).outputText,
    { exports, registry },
  );
  const peek = exports.peekWorkspaceConversationStore!;
  const scope = {
    workspacePath: "/project",
    workspaceIdentity: "remote-identity",
    remoteSessionId: "host-A",
  };
  const agent = {};
  const store = {};
  let calls = 0;
  assert.equal(peek(scope, agent, "task"), null);
  assert.equal(registry.size, 0);
  const entry = {
    stale: false,
    agentService: agent,
    layer: {
      peek: (id: string) => {
        calls++;
        assert.equal(id, "task");
        return store;
      },
    },
  };
  registry.set("host-A remote-identity", entry);
  assert.equal(peek(scope, agent, "task"), store);
  assert.equal(peek({ ...scope, remoteSessionId: "host-B" }, agent, "task"), null);
  assert.equal(peek(scope, {}, "task"), null);
  entry.stale = true;
  assert.equal(peek(scope, agent, "task"), null);
  assert.equal(calls, 1);
});

test("session layer peek is a pure lookup: no acquire, reference change, or cold restore", async () => {
  const ast = await readSource("../v4/sessionDataLayer.ts");
  const code = `({${namedSource(ast, "peek")}}).peek`;
  const peek = runInNewContext(
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2024 } }).outputText,
    { conversationTopic },
  );
  const store = {};
  const entry = { store, refCount: 0, keepWarmTimer: null };
  const receiver = { disposed: false, entries: new Map([[conversationTopic("task"), entry]]) };
  assert.equal(peek.call(receiver, "task"), store);
  assert.equal(peek.call(receiver, "absent"), null);
  assert.equal(entry.refCount, 0);
  assert.equal(entry.keepWarmTimer, null);
  receiver.disposed = true;
  assert.equal(peek.call(receiver, "task"), null);
});
