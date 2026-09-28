import assert from "node:assert/strict";
import test from "node:test";
import { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewController } from "../hooks/useCrew.js";
import { useCrewText } from "../hooks/useCrewText.js";
import { TabStoreProvider } from "../store/TabStoreProvider.js";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { CrewGroupEditor } from "./CrewGroupEditor.js";
import { chatDetail } from "./crewChatFixtures.js";
import { crewSidebarHarness, sidebarElements, sidebarText } from "./crewSidebarHarness.js";

const selection = {
  groupId: null,
  conversationId: null,
  editing: true,
  onFinishEditing() {},
  onManage() {},
};
const controller = (overrides: Partial<CrewController> = {}) =>
  ({ groups: [], loading: false, pending: false, ...overrides }) as CrewController;

async function homeHarness(crew: CrewController) {
  return crewSidebarHarness("CrewHome.tsx", {
    "@/hooks/useCrew.js": { useCrew: () => crew },
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
    "@/hooks/useCrewAgentCatalog.js": { useCrewAgentCatalog: () => ({ agents: [] }) },
    "@/components/ui/button.js": { Button: "button" },
    "./CrewChatView.js": { CrewChatView: () => null },
    "./CrewGroupEditor.js": { CrewGroupEditor },
    "./crewUiHelpers.js": { crewBindingKey: JSON.stringify },
  });
}

function editorElement(node: ReactNode) {
  const wrapper = sidebarElements(node).find(
    (element) => typeof element.type === "function" && element.type.name === "CrewHomeEditor",
  );
  assert(wrapper, "CrewHome must mount its editor without a persisted group/detail");
  return (
    wrapper.type as (props: unknown) => ReactElement<{
      onSave: Parameters<typeof CrewGroupEditor>[0]["onSave"];
      onCancel: () => void;
    }>
  )(wrapper.props);
}

for (const loading of [false, true])
  for (const locale of ["zh-CN", "en-US"] as const)
    test(`new editor renders without group/detail while list loading=${loading} (${locale})`, async () => {
      // Render the actual editor under the real locale/tab providers.
      const leaf = await crewSidebarHarness("CrewHome.tsx", {
        "@/hooks/useCrew.js": { useCrew: () => controller({ loading }) },
        "@/hooks/useCrewText.js": { useCrewText },
        "@/hooks/useCrewAgentCatalog.js": { useCrewAgentCatalog: () => ({ agents: [] }) },
        "@/components/ui/button.js": { Button: "button" },
        "./CrewChatView.js": { CrewChatView: () => null },
        "./CrewGroupEditor.js": { CrewGroupEditor },
        "./crewUiHelpers.js": { crewBindingKey: JSON.stringify },
      });
      function StubbedHome() {
        return leaf.render("CrewHome", selection);
      }
      const html = renderToStaticMarkup(
        <ZCodeIntlProvider initialLocale={locale}>
          <TabStoreProvider>
            <StubbedHome />
          </TabStoreProvider>
        </ZCodeIntlProvider>,
      );
      assert.match(html, /data-testid="crew-editor"/);
      assert.match(html, locale === "zh-CN" ? /创建群组/ : /Create crew/);
      assert.doesNotMatch(html, /role="alert"|Select a crew conversation|从左侧选择/);
    });

test("sidebar create invokes onCreate instead of onManage, including while groups load", async () => {
  const events: string[] = [];
  const h = await crewSidebarHarness("CrewSidebar.tsx", {
    "@/hooks/useCrew.js": { useCrew: () => controller({ loading: true }) },
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
    "./CrewSidebarGroup.js": { CrewSidebarGroup: () => null },
    "./CrewSidebarFeedback.js": { CrewSidebarFeedback: () => null },
    "./crewSidebarTree.js": { crewSidebarTree: () => [] },
  });
  const node = h.render("CrewSidebar", {
    selectedGroupId: null,
    selectedConversationId: null,
    onSelect() {},
    onEdit() {},
    onCreate: () => events.push("create"),
    onManage: () => events.push("manage"),
  });
  const create = sidebarElements(node).find(
    (el) =>
      renderToStaticMarkup(el).includes("createGroup") && typeof el.props.onClick === "function",
  );
  assert(create, "create action exists independently of management");
  (create.props.onClick as () => void)();
  assert.deepEqual(events, ["create"]);
});

const params = { name: "New crew", members: [] };
const binding = { workspacePath: "/fixture/chosen" };
const saved = { ...chatDetail().group, workspaceBinding: null };
const success = (value = saved, current = true) => ({
  ok: true as const,
  value,
  isCurrent: () => current,
});

test("create then bind failure retains editor and retry updates the accepted group instead of creating twice", async () => {
  const events: string[] = [];
  let attempts = 0;
  const home = await homeHarness(
    controller({
      create: async () => {
        events.push("create");
        return success();
      },
      update: async (input) => {
        events.push(`update:${input.groupId}`);
        return success();
      },
      bind: async (input) => {
        events.push(`bind:${input.groupId}`);
        return ++attempts === 1 ? { ok: false, error: null, isCurrent: () => true } : success();
      },
    }),
  );
  const view = () =>
    editorElement(
      home.render("CrewHome", { ...selection, onFinishEditing: () => events.push("finish") }),
    );
  await view().props.onSave(params, binding);
  assert.deepEqual(events, ["create", `bind:${saved.groupId}`]);
  await view().props.onSave(params, binding);
  assert.deepEqual(events, [
    "create",
    `bind:${saved.groupId}`,
    `update:${saved.groupId}`,
    `bind:${saved.groupId}`,
    "finish",
  ]);
});

test("canceling an unsaved editor does not create a group", async () => {
  let finished = false;
  const home = await homeHarness(
    controller({
      create: async () => {
        throw new Error("must not create");
      },
    }),
  );
  editorElement(
    home.render("CrewHome", {
      ...selection,
      onFinishEditing: () => {
        finished = true;
      },
    }),
  ).props.onCancel();
  assert.equal(finished, true);
});

test("stale create completion neither binds nor navigates", async () => {
  const home = await homeHarness(
    controller({
      create: async () => success(saved, false),
      bind: async () => {
        throw new Error("stale bind");
      },
    }),
  );
  await editorElement(
    home.render("CrewHome", {
      ...selection,
      onFinishEditing: () => {
        throw new Error("stale finish");
      },
    }),
  ).props.onSave(params, binding);
});
