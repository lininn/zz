// Real component handlers and controlled hook cells; DOM/viewport coverage belongs to Playwright.
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { ReactElement, ReactNode } from "react";
import type { IServiceAccessor } from "@zcode/services";
import { CrewWorkspaceField } from "./CrewWorkspaceField.js";
import { DirectoryBrowser } from "../DirectoryBrowser.js";
import * as selectUi from "../components/ui/select.js";
const { Select, SelectValue } = selectUi;
import { crewSidebarHarness, sidebarElements, sidebarText } from "./crewSidebarHarness.js";
import * as foregroundRequest from "../lib/foregroundRequest.js";

const find = (
  tree: ReactNode,
  predicate: (el: ReactElement<Record<string, unknown>>) => boolean,
) => {
  const result = sidebarElements(tree).find(predicate);
  assert(result, "Expected real component/handler");
  return result;
};

for (const native of [false, true])
  test(`directory selection updates editor draft and Select for a path absent from workspace tabs (native=${native})`, async () => {
    let saves = 0;
    const selectedPath = "/fixture/chosen-project";
    const services = {
      systemService: { info: async () => ({ homedir: "/fixture" }) },
      fileService: { readdir: async () => [] },
    } as unknown as IServiceAccessor;
    const editor = await crewSidebarHarness("CrewGroupEditor.tsx", {
      "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
      "./CrewWorkspaceField.js": { CrewWorkspaceField },
    });
    const renderEditor = () =>
      editor.render("CrewGroupEditor", {
        agents: [],
        pending: false,
        onSave: async () => {
          saves++;
        },
        onCancel() {},
      });
    const workspaceProps = () => find(renderEditor(), (el) => el.type === CrewWorkspaceField).props;
    const field = await crewSidebarHarness(
      "CrewWorkspaceField.tsx",
      {
        "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
        "@/hooks/useCrewWorkspaceOptions.js": {
          useCrewWorkspaceOptions: () => ({
            workspaces: [],
            canSelectDirectory: native,
            selectDirectory: async () => ({ workspacePath: selectedPath }),
          }),
        },
        "@/hooks/useServices.js": { useOptionalServices: () => services },
        "@/DirectoryBrowser.js": { DirectoryBrowser },
        "@/components/ui/select.js": selectUi,
        "react-dom": { createPortal: (node: ReactNode) => node },
      },
      { document: { body: {} } },
    );
    const renderField = () => field.render("CrewWorkspaceField", workspaceProps());
    assert.equal(find(renderField(), (el) => el.type === Select).props.value, "unbound");
    const choose = find(
      renderField(),
      (el) => Array.isArray(el.props.children) && el.props.children.includes("chooseDirectory"),
    );
    await (choose.props.onClick as () => Promise<void>)();
    if (!native) {
      const dialog = find(renderField(), (el) => el.type === DirectoryBrowser);
      const browser = await crewSidebarHarness(
        "../DirectoryBrowser.tsx",
        {
          // Key 必须与 DirectoryBrowser.tsx 的 import specifier 完全一致；该文件已改用
          // `@/` 别名，旧的 `./` key 不会命中，会把真实 IntlProvider 拉进来并在无 Provider
          // 的 harness 里触发 useContext(null)。
          "@/i18n/IntlProvider.js": {
            useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
          },
          "@/components/ui/button.js": { Button: "button" },
          "@/components/ui/input.js": { Input: "input" },
          "@/logger.js": { logger: { warn() {} } },
          "@/lib/foregroundRequest.js": foregroundRequest,
        },
        { AbortController },
      );
      const renderBrowser = () => browser.render("DirectoryBrowser", dialog.props);
      renderBrowser();
      await setImmediate();
      const input = find(renderBrowser(), (el) => el.type === "input" && el.props.type === "text");
      (input.props.onChange as (event: unknown) => void)({ target: { value: selectedPath } });
      let defaultPrevented = false;
      const form = find(renderBrowser(), (el) => el.type === "form");
      (form.props.onSubmit as (event: unknown) => void)({
        preventDefault() {
          defaultPrevented = true;
        },
        stopPropagation() {},
      });
      // DirectoryBrowser 自身渲染在 portal 中，不再依赖 stopPropagation 与父表单隔离；
      // 提交只要阻止默认导航即可，否则会触发整页刷新。
      assert.equal(defaultPrevented, true, "Browser submit must prevent default navigation");
      await setImmediate();
      const select = find(
        renderBrowser(),
        (el) => el.type === "button" && el.props["data-testid"] === "directory-browser-confirm",
      );
      // disabled 表达式以 selecting 结尾，未选择时可能求值为 undefined（falsy 即启用）。
      assert.ok(!select.props.disabled);
      assert.equal(select.props.type, "button");
      (select.props.onClick as () => void)();
      assert(
        !sidebarElements(renderField()).some((el) => el.type === DirectoryBrowser),
        "Picker closes after selecting",
      );
    }
    const updated = renderField();
    assert.equal(find(updated, (el) => el.type === Select).props.value, selectedPath);
    assert.equal(find(updated, (el) => el.type === SelectValue).props.children, selectedPath);
    // 回归：Radix 会在受控值变化后用隐藏原生 select 回传一次空字符串（下拉项未挂载）。
    // 空 key 不能被当作“未绑定”，否则刚选中的目录会被立刻清掉。
    const selectProps = find(updated, (el) => el.type === Select).props as {
      onValueChange: (key: string) => void;
    };
    selectProps.onValueChange("");
    assert.equal(
      find(renderField(), (el) => el.type === Select).props.value,
      selectedPath,
      "Spurious empty key must not clear the selected directory",
    );
    assert.equal(saves, 0, "Selecting a path changes only the draft, never submits the group");
  });
