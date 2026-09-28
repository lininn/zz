// 与 crew 现有 harness 一致：执行真实组件/事件处理器，控制 hook 与服务；不是浏览器 E2E。
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import type { ReactElement } from "react";
import type { IServiceAccessor } from "@zcode/services";
import type { FileEntry } from "@zcode/shared";
import ts from "typescript";
import { sidebarElements } from "./crew/crewSidebarHarness.js";
import * as foregroundRequest from "./lib/foregroundRequest.js";
import type { DirectoryBrowser } from "./DirectoryBrowser.js";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("./DirectoryBrowser.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};
const directory = (name: string): FileEntry =>
  ({ name, path: `/home/${name}`, type: "directory" }) as FileEntry;

type Props = Parameters<typeof DirectoryBrowser>[0];
function harness(
  info: () => Promise<{ homedir: string }>,
  readdir: (params: { path: string; includeHidden?: boolean }) => Promise<FileEntry[]>,
) {
  type Cell = { value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void };
  const cells: Cell[] = [];
  let index = 0,
    writesAfterUnmount = 0,
    unmounted = false;
  let effects: (() => void)[] = [];
  const same = (a?: unknown[], b?: unknown[]) =>
    a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const slot = index++;
    if (!same(cells[slot]?.deps, deps)) cells[slot] = { value: factory(), deps };
    return cells[slot]!.value;
  };
  const paths: string[] = [],
    selected: string[] = [];
  const props: Props = {
    services: { systemService: { info }, fileService: { readdir } } as unknown as IServiceAccessor,
    onSelect: (path) => selected.push(path),
    onCancel() {},
    onPathChange: (path) => paths.push(path),
  };
  const intl = {
    formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
      `${id}${values ? `: ${Object.values(values).join(" ")}` : ""}`,
  };
  const exports: { DirectoryBrowser?: (props: Props) => ReactElement } = {};
  runInNewContext(code, {
    exports,
    Error,
    DOMException,
    AbortController,
    require(name: string) {
      if (name === "react")
        return {
          ...require("react"),
          useRef: (value: unknown) => memo(() => ({ current: value }), []),
          useMemo: memo,
          useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps),
          useState: (value: unknown) => {
            const slot = index++;
            cells[slot] ??= { value: typeof value === "function" ? value() : value };
            return [
              cells[slot]!.value,
              (next: unknown) => {
                if (unmounted) writesAfterUnmount++;
                cells[slot]!.value = typeof next === "function" ? next(cells[slot]!.value) : next;
              },
            ];
          },
          useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
            const slot = index++;
            if (!same(cells[slot]?.deps, deps))
              effects.push(() => {
                cells[slot]?.cleanup?.();
                cells[slot] = { deps, cleanup: effect() };
              });
          },
        };
      if (name.endsWith("button.js")) return { Button: "button" };
      if (name.endsWith("input.js")) return { Input: "input" };
      if (name.endsWith("IntlProvider.js")) return { useZCodeIntl: () => ({ intl }) };
      if (name.endsWith("logger.js")) return { logger: { error() {}, warn() {} } };
      if (name.endsWith("foregroundRequest.js")) return foregroundRequest;
      return require(name);
    },
  });
  let tree: ReactElement;
  function render(next: Partial<Props> = {}) {
    Object.assign(props, next);
    index = 0;
    effects = [];
    tree = exports.DirectoryBrowser!(props);
    effects.forEach((effect) => effect());
    return tree;
  }
  const elements = () => sidebarElements(render());
  const button = (text: string) => {
    const element = elements().find(
      (item) => item.type === "button" && item.props.children === text,
    );
    assert.ok(element, `missing button ${text}`);
    return element;
  };
  const click = (text: string) => (button(text).props.onClick as () => void)();
  return {
    render,
    paths,
    selected,
    elements,
    button,
    click,
    text: () =>
      JSON.stringify(
        elements().map((item) => item.props.children),
        (_, value) => (typeof value === "function" ? undefined : value),
      ),
    submit(path: string) {
      const input = elements().find((item) => item.type === "input")!;
      (input.props.onChange as (event: unknown) => void)({ target: { value: path } });
      const form = elements().find((item) => item.type === "form")!;
      let stopped = false,
        prevented = false;
      (form.props.onSubmit as (event: unknown) => void)({
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
      });
      return { stopped, prevented };
    },
    unmount() {
      unmounted = true;
      cells.forEach((cell) => cell.cleanup?.());
    },
    writesAfterUnmount: () => writesAfterUnmount,
  };
}

for (const phase of ["info", "readdir"] as const) {
  test(`${phase} has a 25s deadline, alert and Retry, no false empty directory or stale select`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let failing = true;
    const hook = harness(
      () =>
        phase === "info" && failing ? new Promise(() => {}) : Promise.resolve({ homedir: "/home" }),
      () => (phase === "readdir" && failing ? new Promise(() => {}) : Promise.resolve([])),
    );
    hook.render();
    await flush();
    t.mock.timers.tick(24_999);
    await flush();
    assert.match(hook.text(), /common.loading/);
    t.mock.timers.tick(1);
    await flush();
    assert.doesNotMatch(hook.text(), /common.loading|directoryBrowser.noSubdirs/);
    assert.match(hook.text(), /directoryBrowser.errorTimeout/);
    assert(hook.elements().some((item) => item.props.role === "alert"));
    assert.equal(hook.button("directoryBrowser.selectDir").props.disabled, true);
    failing = false;
    hook.click("common.retry");
    await flush();
    assert.match(hook.text(), /directoryBrowser.noSubdirs/);
    assert.equal(hook.button("directoryBrowser.selectDir").props.disabled, false);
    hook.unmount();
  });
}

test("late initialization cannot overwrite user navigation; Go stops React portal bubbling", async () => {
  const init = Promise.withResolvers<{ homedir: string }>();
  const reads: string[] = [];
  const hook = harness(
    () => init.promise,
    async ({ path }) => {
      reads.push(path);
      return [];
    },
  );
  hook.render();
  await flush();
  const event = hook.submit("/chosen");
  await flush();
  assert.equal(event.prevented, true);
  assert.equal(
    event.stopped,
    true,
    "portal changes DOM ancestry, not React submit propagation to editor.onSave",
  );
  init.resolve({ homedir: "/stale-home" });
  await flush();
  assert.deepEqual(reads, ["/chosen"]);
  hook.click("directoryBrowser.selectDir");
  assert.deepEqual(hook.selected, ["/chosen"]);
  hook.unmount();
});

test("failed navigation invalidates embedded selection and hides old entries, Retry uses failed path", async () => {
  const reads: string[] = [];
  let fail = true;
  const hook = harness(
    async () => ({ homedir: "/home" }),
    async ({ path }) => {
      reads.push(path);
      if (path === "/bad" && fail) throw new Error("EACCES: permission denied");
      return path === "/home" ? [directory("old-entry")] : [];
    },
  );
  hook.render();
  await flush();
  assert.equal(hook.paths.at(-1), "/home");
  hook.submit("/bad");
  assert.equal(
    hook.paths.at(-1),
    "",
    "embedded parent must lose its previously selectable path immediately",
  );
  await flush();
  assert.match(hook.text(), /directoryBrowser.errorPermission/);
  assert.doesNotMatch(hook.text(), /old-entry|directoryBrowser.noSubdirs/);
  hook.click("directoryBrowser.selectDir");
  assert.deepEqual(hook.selected, []);
  fail = false;
  hook.click("common.retry");
  await flush();
  assert.deepEqual(reads, ["/home", "/bad", "/bad"]);
  hook.click("directoryBrowser.selectDir");
  assert.deepEqual(hook.selected, ["/bad"]);
  hook.unmount();
});

for (const outcome of ["resolve", "reject"] as const) {
  test(`stale readdir ${outcome} cannot change the newest path/error`, async () => {
    const stale = Promise.withResolvers<FileEntry[]>();
    const hook = harness(
      async () => ({ homedir: "/home" }),
      ({ path }) => (path === "/old" ? stale.promise : Promise.resolve([])),
    );
    hook.render();
    await flush();
    hook.submit("/old");
    await flush();
    hook.submit("/new");
    await flush();
    if (outcome === "resolve") stale.resolve([directory("obsolete")]);
    else stale.reject(new Error("old failure"));
    await flush();
    hook.click("directoryBrowser.selectDir");
    assert.deepEqual(hook.selected, ["/new"]);
    assert.doesNotMatch(hook.text(), /obsolete|old failure|directoryBrowser.error/);
    hook.unmount();
  });
}

for (const phase of ["info", "readdir"] as const) {
  test(`unmount invalidates ${phase}, clears deadline and prevents callbacks/state updates`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const clear = t.mock.method(globalThis, "clearTimeout");
    const info = Promise.withResolvers<{ homedir: string }>();
    const read = Promise.withResolvers<FileEntry[]>();
    const hook = harness(
      () => (phase === "info" ? info.promise : Promise.resolve({ homedir: "/home" })),
      () => read.promise,
    );
    hook.render();
    await flush();
    const count = hook.paths.length;
    hook.unmount();
    await flush();
    assert(clear.mock.callCount() > 0);
    info.resolve({ homedir: "/late" });
    read.resolve([]);
    await flush();
    t.mock.timers.tick(25_000);
    await flush();
    assert.equal(hook.writesAfterUnmount(), 0);
    assert.equal(hook.paths.length, count);
  });
}

for (const [error, key] of [
  [Object.assign(new Error("closed"), { name: "ConnectionClosed" }), "errorClosed"],
  [new Error("ChannelClient is disposed"), "errorClosed"],
  [new Error("Unauthorized 401"), "errorAuthentication"],
  [new Error("EACCES: permission denied"), "errorPermission"],
  [new Error("ECONNREFUSED"), "errorUnavailable"],
] as const) {
  test(`directory errors distinguish ${key}: ${error.message}`, async () => {
    const hook = harness(
      async () => {
        throw error;
      },
      async () => [],
    );
    hook.render();
    await flush();
    assert.match(hook.text(), new RegExp(`directoryBrowser.${key}`));
    assert.equal(
      Boolean(hook.button("common.retry").props.disabled),
      key === "errorClosed" || key === "errorAuthentication",
    );
    hook.unmount();
  });
}

test("unknown directory errors preserve useful safe details, not credentials or addresses", async () => {
  const hook = harness(
    async () => ({ homedir: "/home" }),
    async () => {
      throw new Error(
        "ENOENT: missing directory /private/workspace from https://internal.test/path?token=secret token=topsecret",
      );
    },
  );
  hook.render();
  await flush();
  assert.match(hook.text(), /ENOENT: missing directory/);
  assert.doesNotMatch(hook.text(), /internal\.test|secret|private\/workspace/);
  hook.unmount();
});

test("service replacement invalidates old initialization and reads only the new connection's home", async () => {
  const old = Promise.withResolvers<{ homedir: string }>();
  let oldReads = 0;
  const hook = harness(
    () => old.promise,
    async () => {
      oldReads++;
      return [];
    },
  );
  hook.render();
  await flush();
  const services = {
    systemService: { info: async () => ({ homedir: "/new-host" }) },
    fileService: { readdir: async () => [] },
  } as unknown as IServiceAccessor;
  hook.render({ services });
  await flush();
  old.resolve({ homedir: "/old-host" });
  await flush();
  hook.click("directoryBrowser.selectDir");
  assert.deepEqual(hook.selected, ["/new-host"]);
  assert.equal(oldReads, 0);
  hook.unmount();
});

test("hidden-directory toggles keep the most recent navigation and ignore late visible-only results", async () => {
  const old = Promise.withResolvers<FileEntry[]>();
  const reads: { path: string; includeHidden?: boolean }[] = [];
  const hook = harness(
    async () => ({ homedir: "/home" }),
    (params) => {
      reads.push(params);
      return params.includeHidden ? Promise.resolve([directory(".hidden")]) : old.promise;
    },
  );
  hook.render();
  await flush();
  hook.click("directoryBrowser.showHidden");
  await flush();
  old.resolve([directory("outdated")]);
  await flush();
  assert.equal(reads.length, 2);
  assert.equal(reads[1]?.path, "/home");
  assert.equal(reads[1]?.includeHidden, true);
  assert.match(hook.text(), /\.hidden/);
  assert.doesNotMatch(hook.text(), /outdated/);
  hook.unmount();
});

test("late directory result after timeout cannot replace a successful manual retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const old = Promise.withResolvers<FileEntry[]>();
  let reads = 0;
  const hook = harness(
    async () => ({ homedir: "/home" }),
    () => (++reads === 1 ? old.promise : Promise.resolve([directory("fresh")])),
  );
  hook.render();
  await flush();
  t.mock.timers.tick(25_000);
  await flush();
  hook.click("common.retry");
  await flush();
  old.resolve([directory("obsolete")]);
  await flush();
  assert.match(hook.text(), /fresh/);
  assert.doesNotMatch(hook.text(), /obsolete/);
  assert.equal(reads, 2);
  hook.unmount();
});
