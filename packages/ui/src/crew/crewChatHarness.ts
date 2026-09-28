// Execute the actual component source with controlled hooks/children; not browser E2E.
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

type Props = Record<string, unknown>;
export type ChatElement = ReactElement<Props>;
export function crewElementNodes(node: ReactNode): ChatElement[] {
  const result: ChatElement[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Props>(child)) return;
    result.push(child, ...crewElementNodes(child.props.children as ReactNode));
  });
  return result;
}
export async function crewComponentHarness(file: string, imports: Record<string, unknown>) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: Record<string, (props: Props) => ReactNode> = {};
  const cells: unknown[] = [];
  let index = 0;
  runInNewContext(code, {
    exports,
    Date,
    setInterval,
    clearInterval,
    require: (name: string) => {
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "react")
        return {
          useId: () => "crew-test-panel",
          useMemo: (factory: () => unknown) => factory(),
          useEffect: () => {},
          useState: (initial: unknown) => {
            const slot = index++;
            if (!(slot in cells)) cells[slot] = typeof initial === "function" ? initial() : initial;
            return [
              cells[slot],
              (value: unknown) => {
                cells[slot] = typeof value === "function" ? value(cells[slot]) : value;
              },
            ];
          },
        };
      if (name in imports) return imports[name];
      throw new Error(`Unexpected component dependency ${name}`);
    },
  });
  return {
    render(name: string, props: Props) {
      index = 0;
      return exports[name]!(props);
    },
    renderElement(element: ChatElement) {
      index = 0;
      return (element.type as (props: Props) => ReactNode)(element.props);
    },
  };
}
