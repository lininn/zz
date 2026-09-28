import { useCrewHomeNavigation } from "../../../packages/ui/src/hooks/useCrewHomeNavigation.js";
import { createRoot } from "react-dom/client";
import { CrewHome } from "../../../packages/ui/src/crew/CrewHome.js";
import { CrewSidebar } from "../../../packages/ui/src/crew/CrewSidebar.js";
import { ServiceProvider } from "../../../packages/ui/src/hooks/useServices.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { TabStoreProvider } from "../../../packages/ui/src/store/TabStoreProvider.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import type { IPlatformService } from "@zcode/shared";
import { fixtureServices, fixtureState, fixtureControl } from "./fixture-services.js";

const platform = {
  canSelectFilePath: true,
  selectDirectory: async () => "/fixture/project",
} as IPlatformService;
async function seed() {
  const member = await fixtureServices.crewAgentCatalogService.create({
    name: "Fixture reviewer",
    systemPrompt: "Offline fixture only",
    runtime: "codex-cli",
    accessMode: "read",
  });
  const relay = new URLSearchParams(window.location.search).has("relay");
  const builder = relay
    ? await fixtureServices.crewAgentCatalogService.create({
        name: "Fixture builder",
        systemPrompt: "Offline fixture only",
        runtime: "zcode",
        accessMode: "read",
      })
    : null;
  const group = await fixtureServices.crewService.create({
    name: "Homepage fixture crew",
    members: [{ agentId: member.agentId }, ...(builder ? [{ agentId: builder.agentId }] : [])],
    ...(relay ? { relayMode: "auto" as const, relayAutoHops: 2, relayBudgetMinutes: 30 } : {}),
  });
  await fixtureServices.crewService.bind({
    groupId: group.groupId,
    binding: { workspacePath: "/fixture/project" },
  });
  if (relay) {
    fixtureControl.seedRelay({ groupId: group.groupId, conversationId: group.groupId });
    return;
  }
  fixtureControl.seedExecution({
    groupId: group.groupId,
    conversationId: group.groupId,
    external: true,
    recovery: true,
  });
}
function HomeFixture() {
  const navigation = useCrewHomeNavigation();
  return (
    <div style={{ display: "flex", height: "85vh", minWidth: 0 }}>
      <aside style={{ width: "min(40vw, 300px)", overflow: "auto" }}>
        <CrewSidebar
          selectedGroupId={navigation.groupId}
          selectedConversationId={navigation.conversationId}
          onSelect={navigation.select}
          onEdit={navigation.edit}
          onCreate={navigation.create}
        />
      </aside>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CrewHome
          groupId={navigation.groupId}
          conversationId={navigation.conversationId}
          editing={navigation.editing}
          onFinishEditing={navigation.finishEditing}
          onManage={() => {}}
        />
      </div>
    </div>
  );
}
void seed().then(() => {
  Object.assign(window, { crewFixtureState: fixtureState, crewFixtureControl: fixtureControl });
  createRoot(document.getElementById("root")!).render(
    <ZCodeIntlProvider initialLocale="en-US">
      <ServiceProvider services={fixtureServices}>
        <PlatformProvider platform={platform}>
          <TabStoreProvider>
            <HomeFixture />
          </TabStoreProvider>
        </PlatformProvider>
      </ServiceProvider>
    </ZCodeIntlProvider>,
  );
});
