import { createRoot } from "react-dom/client";
import { CrewSection } from "../../../packages/ui/src/crew/CrewSection.js";
import { ServiceProvider } from "../../../packages/ui/src/hooks/useServices.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { TabStoreProvider } from "../../../packages/ui/src/store/TabStoreProvider.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import type { IPlatformService } from "@zcode/shared";
import { fixtureServices, fixtureState, fixtureControl } from "./fixture-services.js";

const platform = {
  canSelectFilePath: true,
  selectDirectory: async () => "/fixture/workspace",
} as IPlatformService;
Object.assign(window, { crewFixtureState: fixtureState, crewFixtureControl: fixtureControl });
createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale="en-US">
    <ServiceProvider services={fixtureServices}>
      <PlatformProvider platform={platform}>
        <TabStoreProvider>
          <CrewSection />
        </TabStoreProvider>
      </PlatformProvider>
    </ServiceProvider>
  </ZCodeIntlProvider>,
);
