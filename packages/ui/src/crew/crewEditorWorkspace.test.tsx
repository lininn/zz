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
          "./i18n/IntlProvider.js": {
            useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
          },
          "./components/ui/button.js": { Button: "button" },
          "./components/ui/input.js": { Input: "input" },
          "./logger.js": { logger: { warn() {} } },
          "./lib/foregroundRequest.js": foregroundRequest,
        },
        { AbortController },
      );
      const renderBrowser = () => browser.render("DirectoryBrowser", dialog.props);
      renderBrowser();
      await setImmediate();
      const input = find(renderBrowser(), (el) => el.type === "input" && el.props.type === "text");
      (input.props.onChange as (event: unknown) => void)({ target: { value: selectedPath } });
      let stopped = false;
      const form = find(renderBrowser(), (el) => el.type === "form");
      (form.props.onSubmit as (event: unknown) => void)({
        preventDefault() {},
        stopPropagation() {
          stopped = true;
        },
      });
      assert.equal(stopped, true, "Portal submits must not reach the parent group save form");
      await setImmediate();
      const select = find(
        renderBrowser(),
        (el) => el.type === "button" && el.props.children === "directoryBrowser.selectDir",
      );
      assert.equal(select.props.disabled, false);
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
    assert.equal(saves, 0, "Selecting a path changes only the draft, never submits the group");
  });
