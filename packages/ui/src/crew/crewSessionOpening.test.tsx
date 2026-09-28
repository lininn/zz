import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { CrewGetParams } from "@zcode/shared";
import type { ICrewService } from "@zcode/services";
import type { useCrewHomeNavigation } from "../hooks/useCrewHomeNavigation.js";
import { crewCacheScope } from "../hooks/crewCacheScope.js";
import { crewSidebarHarness, sidebarElements, sidebarText } from "./crewSidebarHarness.js";
import { crewHookHarness } from "./crewHookHarness.js";
import { chatDetail } from "./crewChatFixtures.js";
import { crewSidebarConversations } from "./crewSidebarTree.js";
import { crewConversationTitle } from "./CrewConversations.js";
import { isCrewBusy } from "./crewUiHelpers.js";

const Chat = () => null;
const Null = () => null;
type Navigation = ReturnType<typeof useCrewHomeNavigation>;
const ui = {
  "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
  "@/components/ui/button.js": { Button: "button" },
};
async function navigationHarness(initialService: ICrewService) {
  let service = initialService;
  const harness = await crewSidebarHarness("../hooks/useCrewHomeNavigation.ts", {
    "./useServices.js": { useServices: () => ({ crewService: service }) },
    "./crewCacheScope.js": { crewCacheScope },
  });
  return {
    render: () => harness.render("useCrewHomeNavigation", {}) as unknown as Navigation,
    host: (next: ICrewService) => {
      service = next;
    },
  };
}

for (const mobile of [false, true]) {
  test(`actual sidebar click -> navigation hook -> detail -> main chat; drawer=${mobile}`, async () => {
    const detail = chatDetail();
    detail.conversation.status = "recovery_required";
    const reads: string[] = [];
    const service = {
      list: async () => [detail.group],
      listConversations: async () => [detail.conversation],
      get: async ({ groupId, conversationId }: CrewGetParams) => {
        reads.push(`${groupId}/${conversationId}`);
        return detail;
      },
    } as unknown as ICrewService;
    const navigation = await navigationHarness(service);
    let selected = navigation.render();
    let drawerOpen = true;
    const groupHook = crewHookHarness(service);
    const mainHook = crewHookHarness(service);
    const row = await crewSidebarHarness("CrewSidebarGroup.tsx", {
      ...ui,
      "@/hooks/useCrew.js": {
        useCrew: (...args: Parameters<typeof groupHook.view>) => groupHook.view(...args),
      },
      "./CrewStatus.js": { CrewStatus: Null },
      "./CrewConversations.js": { crewConversationTitle },
      "./crewSidebarTree.js": { crewSidebarConversations },
      "./crewUiHelpers.js": { isCrewBusy },
      "./CrewSidebarActions.js": { CrewSidebarActions: Null },
      "./CrewSidebarFeedback.js": { CrewSidebarFeedback: Null },
    });
    const home = await crewSidebarHarness("CrewHome.tsx", {
      ...ui,
      "@/hooks/useCrew.js": {
        useCrew: (...args: Parameters<typeof mainHook.view>) => mainHook.view(...args),
      },
      "@/hooks/useCrewAgentCatalog.js": { useCrewAgentCatalog: () => ({}) },
      "./CrewChatView.js": { CrewChatView: Chat },
      "./CrewGroupEditor.js": { CrewGroupEditor: Null },
      "./crewUiHelpers.js": { crewBindingKey: () => "unused" },
    });
    const tree = () =>
      sidebarElements(
        row.render("CrewSidebarGroup", {
          visible: drawerOpen,
          group: detail.group,
          selectedGroupId: selected.groupId,
          selectedConversationId: selected.conversationId,
          captureNavigation: () => () => true,
          onEdit: selected.edit,
          onSelect: (groupId: string, conversationId: string) => {
            selected.select(groupId, conversationId);
            if (mobile && drawerOpen) drawerOpen = false;
          },
        }),
      );
    const main = () =>
      sidebarElements(
        home.render("CrewHome", {
          ...selected,
          visible: true,
          onFinishEditing: selected.finishEditing,
          onManage() {},
        }),
      );
    main();
    await setImmediate();
    assert(main().some((node) => node.props.children === "home.chooseConversation"));
    const expander = tree().find((node) => node.props["aria-expanded"] === false)!;
    (expander.props.onClick as () => void)();
    tree();
    await setImmediate();
    assert.equal(navigation.render().conversationId, null, "expansion must not select");
    assert.deepEqual(reads, [], "tree must not read details/preflight");
    const conversation = tree().find((node) => node.props["data-conversation-id"] === "chat")!;
    (conversation.props.onClick as () => void)();
    selected = navigation.render();
    assert.equal(selected.groupId, "group");
    assert.equal(selected.conversationId, "chat");
    assert.equal(drawerOpen, !mobile);
    tree(); // mobile sidebar now invisible/readDetail=false; main stays visible/readDetail=true.
    assert(main().some((node) => node.props.children === "home.loading"));
    await setImmediate();
    const chat = main().find((node) => node.type === Chat);
    assert(chat);
    assert.equal((chat.props.detail as typeof detail).conversation.status, "recovery_required");
    assert.deepEqual(reads, ["group/chat"]);
    assert.equal(
      tree().find((node) => node.props["data-conversation-id"] === "chat")?.props["aria-current"],
      "page",
    );
    assert.equal(
      navigation.render().conversationId,
      "chat",
      "hiding a drawer must preserve selection",
    );
    groupHook.unmount();
    mainHook.unmount();
  });
}

test("navigation preserves same-Host selection and fences a replacement Host", async () => {
  const navigation = await navigationHarness({} as unknown as ICrewService);
  navigation.render().select("group", "chat");
  assert.equal(navigation.render().conversationId, "chat");
  navigation.host({} as unknown as ICrewService);
  assert.equal(navigation.render().conversationId, null);
  navigation.render().select("other", "second");
  assert.equal(navigation.render().groupId, "other");
});
