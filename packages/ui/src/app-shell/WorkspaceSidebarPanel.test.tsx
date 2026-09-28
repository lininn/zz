import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { MobileWorkspaceSidebarToggle } from "./MobileWorkspaceSidebarToggle.js";
import { WorkspaceSidebarPanel } from "./WorkspaceSidebarPanel.js";

for (const locale of ["zh-CN", "en-US"] as const) {
  for (const visible of [false, true]) {
    test(`mobile toggle is localized, 40px, and linked to the sidebar (${locale}, ${visible})`, () => {
      const html = renderToStaticMarkup(
        <ZCodeIntlProvider initialLocale={locale}>
          <MobileWorkspaceSidebarToggle visible={visible} onToggle={() => {}} />
        </ZCodeIntlProvider>,
      );
      assert.match(html, /size-10/);
      assert.match(html, /aria-controls="sidebar"/);
      assert.match(html, new RegExp(`aria-expanded="${visible}"`));
      assert.doesNotMatch(html, /workspaceSidebar\.toggleSidebar/);
      assert.match(html, /data-testid="mobile-sidebar-toggle"/);
    });
  }
}

for (const mobile of [false, true]) {
  for (const visible of [false, true]) {
    test(`panel SSR preserves width animation and correct interaction state (${mobile}, ${visible})`, () => {
      const html = renderToStaticMarkup(
        <ZCodeIntlProvider initialLocale="en-US">
          <WorkspaceSidebarPanel visible={visible} mobile={mobile} onDismiss={() => {}}>
            <button type="button">Workspace</button>
          </WorkspaceSidebarPanel>
        </ZCodeIntlProvider>,
      );
      assert.match(html, /id="sidebar"/);
      assert.match(html, /w-\[var\(--workspace-sidebar-panel-width\)\]/);
      assert.match(html, /transition-\[width,opacity\]/);
      assert.equal(html.includes('inert=""'), !visible);
      assert.equal(html.includes('aria-hidden="true"'), !visible);
      assert.equal(html.includes('data-testid="mobile-sidebar-backdrop"'), mobile && visible);
      assert.equal(html.includes("absolute inset-y-0 left-0 z-30"), mobile);
      assert.equal(html.includes("max-w-[50%]"), !mobile);
    });
  }
}
