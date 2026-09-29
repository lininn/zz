// Node hook harness: execute actual useCrew against controlled hook cells/cache, not browser E2E.
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { ICrewService } from "@zcode/services";
import { crewGroupDetailSchema } from "@zcode/shared";
import type { CrewController } from "../hooks/useCrew.js";
import { createCrewRequestScope, runCrewCommand } from "../hooks/crewRequestScope.js";
import { crewErrorKey } from "./crewErrors.js";
import { crewCacheScope } from "../hooks/crewCacheScope.js";

const source = await readFile(new URL("../hooks/useCrew.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

export function crewHookHarness(service: ICrewService) {
  type Cell = { value: unknown; deps?: unknown[]; cleanup?: () => void };
  type Entry = {
    data?: unknown;
    error?: unknown;
    isLoading: boolean;
    fetcher: () => Promise<unknown>;
  };
  const cells: Cell[] = [];
  const cache = new Map<string, Entry>();
  const refreshed: unknown[][] = [];
  const reads: { key: unknown[]; options: Record<string, unknown> }[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  const same = (a?: unknown[], b?: unknown[]) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const useMemo = (factory: () => unknown, deps: unknown[]) => {
    const slot = index++;
    if (!same(cells[slot]?.deps, deps)) cells[slot] = { value: factory(), deps };
    return cells[slot]!.value;
  };
  const fetch = async (entry: Entry) => {
    try {
      entry.data = await entry.fetcher();
      entry.error = undefined;
    } catch (error) {
      entry.error = error;
    } finally {
      entry.isLoading = false;
    }
  };
  const mutate = async (key: unknown[] | ((key: unknown[]) => boolean)) => {
    if (typeof key === "function") {
      for (const [id, entry] of cache) {
        const candidate = JSON.parse(id) as unknown[];
        if (key(candidate)) {
          refreshed.push(candidate);
          await fetch(entry);
        }
      }
      return;
    }
    refreshed.push([...key]);
    const entry = cache.get(JSON.stringify(key));
    if (entry) await fetch(entry);
  };
  const swr = (
    key: unknown[] | null,
    fetcher: (() => Promise<unknown>) | null,
    options: Record<string, unknown>,
  ) => {
    if (!key) return { isLoading: false };
    const id = JSON.stringify(key);
    if (!fetcher) return cache.get(id) ?? { isLoading: false };
    reads.push({ key: [...key], options });
    let entry = cache.get(id);
    if (!entry) {
      entry = { isLoading: true, fetcher };
      cache.set(id, entry);
      void fetch(entry);
    } else entry.fetcher = fetcher;
    return entry;
  };
  const exports: {
    useCrew?: (
      group: string | null,
      conversation: string | null,
      visible: boolean,
      readDetail?: boolean,
    ) => CrewController;
  } = {};
  runInNewContext(code, {
    exports,
    crypto,
    Error,
    require: (name: string) => {
      if (name === "react")
        return {
          useMemo,
          useCallback: (fn: unknown, deps: unknown[]) => useMemo(() => fn, deps),
          useRef: (value: unknown) => useMemo(() => ({ current: value }), []),
          useReducer: () => [0, () => {}],
          useEffect: (effect: () => () => void, deps: unknown[]) => {
            const slot = index++;
            if (!same(cells[slot]?.deps, deps))
              effects.push(() => {
                cells[slot]?.cleanup?.();
                cells[slot] = { value: null, deps, cleanup: effect() };
              });
          },
        };
      if (name === "@zcode/shared") return { crewGroupDetailSchema };
      if (name === "swr")
        return { __esModule: true, default: swr, useSWRConfig: () => ({ mutate }) };
      if (name.endsWith("useServices.js")) return { useServices: () => ({ crewService: service }) };
      if (name.endsWith("crewRequestScope.js")) return { createCrewRequestScope, runCrewCommand };
      if (name.endsWith("crewErrors.js")) return { crewErrorKey };
      // useCrew 的 ownerKey 走 crew 兼容 ID（非 secure context 无 crypto.randomUUID）。
      if (name.endsWith("crewCacheScope.js")) return { crewCacheScope };
      // 读路径的超时包装在测试里直接透传：只验证接线，不做真实计时。
      if (name.endsWith("foregroundRequest.js"))
        return { withForegroundDeadline: (fn: () => Promise<unknown>) => fn() };
      throw new Error(`Unexpected hook dependency ${name}`);
    },
  });
  return {
    reads,
    refreshed,
    view(
      group: string | null,
      conversation: string | null = null,
      visible = true,
      readDetail = true,
    ) {
      index = 0;
      effects = [];
      const result = exports.useCrew!(group, conversation, visible, readDetail);
      effects.forEach((effect) => effect());
      return result;
    },
    unmount() {
      cells.forEach((cell) => cell.cleanup?.());
    },
  };
}
