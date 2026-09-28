// Node component harness: invokes real handlers against hook cells; not browser/Radix E2E.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
export async function crewSidebarHarness(
  file: string,
  imports: Record<string, unknown>,
  globals: Record<string, unknown> = {},
) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  type Cell = { value: unknown; deps?: unknown[] };
  const cells: Cell[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const i = index++;
    const prev = cells[i];
    if (!prev?.deps || !deps.every((v, j) => Object.is(v, prev.deps![j])))
      cells[i] = { value: fn(), deps };
    return cells[i]!.value;
  };
  const exports: Record<string, (props: never) => ReactElement> = {};
  runInNewContext(code, {
    ...globals,
    exports,
    require: (name: string) => {
      if (name === "react")
        return {
          ...require("react"),
          useState: (initial: unknown) => {
            const i = index++;
            cells[i] ??= { value: typeof initial === "function" ? initial() : initial };
            return [
              cells[i]!.value,
              (next: unknown) => {
                cells[i]!.value = typeof next === "function" ? next(cells[i]!.value) : next;
              },
            ];
          },
          useRef: (initial: unknown) => memo(() => ({ current: initial }), []),
          useMemo: memo,
          useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps),
          useId: () => memo(() => `crew-sidebar-${index}`, []),
          useEffect: (effect: () => void, deps: unknown[]) =>
            memo(() => {
              effects.push(effect);
            }, deps),
        };
      if (name in imports) return imports[name];
      return require(name);
    },
  });
  return {
    render<P>(name: string, props: P) {
      index = 0;
      effects = [];
      const element = exports[name]!(props as never);
      effects.forEach((effect) => effect());
      return element;
    },
  };
}

type Element = ReactElement<Record<string, unknown>>;
export function sidebarElements(node: ReactNode): Element[] {
  const result: Element[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    result.push(child);
    result.push(...sidebarElements(child.props.children as ReactNode));
  });
  return result;
}

export const sidebarText = (key: string, values?: Record<string, unknown>) =>
  `${key}${values ? `:${Object.values(values).join(",")}` : ""}`;
