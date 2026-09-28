import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { useWorkspaceSidebar } from "../hooks/useWorkspaceSidebar.js";
import { SettingsPageLayout } from "./SettingsPageLayout.js";
import { SettingsSidebarNavigation } from "./SettingsSidebarNavigation.js";
import { createSettingsPageConfig } from "./settingsPageConfig.js";

const noop = () => {};

for (const mobile of [false, true]) {
  for (const visible of [false, true]) {
    test(`settings layout keeps desktop grid or shared mobile drawer (${mobile}, ${visible})`, () => {
      const html = renderToStaticMarkup(
        <ZCodeIntlProvider initialLocale="en-US">
          <SettingsPageLayout
            activeSection="appearance"
            sidebarState={{
              isMobileSidebar: mobile,
              isSidebarVisible: visible,
              handleToggleSidebar: noop,
              handleDismissMobileSidebar: noop,
            }}
            sidebar={<nav>Settings navigation</nav>}
            windowControls={<div data-native-controls="true" />}
          >
            <section inert={mobile && visible}>Current appearance section</section>
          </SettingsPageLayout>
        </ZCodeIntlProvider>,
      );
      assert.match(html, /data-active-section="appearance"/);
      assert.match(html, /Current appearance section/);
      assert.match(html, /data-native-controls="true"/);
      assert.match(html, /grid-rows-\[minmax\(0,1fr\)\]/);
      assert.equal(html.includes('data-testid="mobile-sidebar-toggle"'), mobile);
      assert.equal(html.includes('data-testid="mobile-sidebar-backdrop"'), mobile && visible);
      assert.equal(html.includes('<section inert="">'), mobile && visible);
      if (mobile) {
        assert.match(html, /h-full min-h-0 grid-cols-\[minmax\(0,1fr\)\]/);
        assert.doesNotMatch(html, /grid-cols-\[68px/);
        assert.match(html, new RegExp(`--workspace-sidebar-panel-width:${visible ? 268 : 0}px`));
        assert.match(html, /transition-\[width,opacity\]/);
        assert.match(html, /duration-200/);
        assert.match(html, /max-w-\[calc\(100%_-_3rem\)\]/);
        assert.match(html, new RegExp(`aria-expanded="${visible}"`));
        assert.match(html, /aria-controls="settings-sidebar"/);
        assert.match(html, /id="settings-sidebar"/);
        assert.doesNotMatch(html, /id="sidebar"/);
        assert.match(html, /size-10/);
        assert.equal(
          html.includes('<aside class="h-full overflow-hidden select-none" aria-hidden="true"'),
          !visible,
        );
      } else {
        assert.match(html, /grid-cols-\[268px_minmax\(0,1fr\)\]/);
        assert.doesNotMatch(html, /grid-cols-\[68px/);
        assert.match(html, /<aside class="min-w-0"><nav>/);
        assert.doesNotMatch(html, /--workspace-sidebar|inert|max-w-\[50%\]/);
      }
    });
  }
}

for (const sidebarRail of [false, true]) {
  test(`settings desktop layout follows the rail state (${sidebarRail ? "68px" : "268px"})`, () => {
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale="en-US">
        <SettingsPageLayout
          activeSection="appearance"
          sidebarState={{
            isMobileSidebar: false,
            isSidebarVisible: true,
            handleToggleSidebar: noop,
            handleDismissMobileSidebar: noop,
          }}
          sidebarRail={sidebarRail}
          sidebar={<nav>Settings navigation</nav>}
        >
          <section>Current appearance section</section>
        </SettingsPageLayout>
      </ZCodeIntlProvider>,
    );
    assert.match(html, /transition-\[grid-template-columns\]/);
    assert.match(html, /duration-200/);
    if (sidebarRail) {
      assert.match(html, /grid-cols-\[68px_minmax\(0,1fr\)\]/);
      assert.doesNotMatch(html, /grid-cols-\[268px/);
    } else {
      assert.match(html, /grid-cols-\[268px_minmax\(0,1fr\)\]/);
      assert.doesNotMatch(html, /grid-cols-\[68px/);
    }
  });
}

for (const locale of ["en-US", "zh-CN"] as const) {
  for (const mobile of [false, true]) {
    for (const rail of [false, true]) {
      test(`settings navigation preserves groups, active section and labels (${locale}, ${mobile}, rail=${rail})`, () => {
        const { settingsSectionGroups: groups, settingsSections } = createSettingsPageConfig({
          isDesktop: false,
          isMacDesktop: false,
          isWindowsDesktop: false,
        });
        const html = renderToStaticMarkup(
          <ZCodeIntlProvider initialLocale={locale}>
            <TooltipProvider>
              <SettingsSidebarNavigation
                groups={groups}
                activeSection="appearance"
                mobile={mobile}
                rail={rail}
                onSelectSection={noop}
                onOpenOnboarding={noop}
              />
            </TooltipProvider>
          </ZCodeIntlProvider>,
        );
        for (const group of groups) {
          assert.match(html, new RegExp(`aria-labelledby="settings-sidebar-group-${group.id}"`));
          assert.match(html, new RegExp(`id="settings-sidebar-group-${group.id}"`));
        }
        assert.equal(
          (html.match(/data-testid="settings-section-nav-/g) ?? []).length,
          settingsSections.length,
        );
        assert.match(html, /aria-current="page"[^>]*data-testid="settings-section-nav-appearance"/);
        assert.doesNotMatch(html, /settings\.sidebar\.group\.|settings\.appearanceTitle/);
        assert.match(html, /id="settings-section-nav"/);
        // 图标 rail 压缩只由状态驱动（rail 且非移动抽屉）；其余形态始终显示文字。
        const collapsed = !mobile && rail;
        assert.equal(html.includes("sr-only"), collapsed);
        assert.equal(html.includes("size-10"), collapsed);
        assert.equal(html.includes("max-lg:"), false);
      });
    }
  }
}

function ServerLayout({ isDesktop }: { isDesktop: boolean }) {
  const state = useWorkspaceSidebar(isDesktop);
  return (
    <SettingsPageLayout
      activeSection="appearance"
      sidebarState={state}
      sidebar={<nav>Navigation</nav>}
    >
      <section>Current appearance section</section>
    </SettingsPageLayout>
  );
}

for (const isDesktop of [false, true]) {
  test(`settings hook/layout SSR does not access window (${isDesktop})`, () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get() {
        throw new Error("SSR must not read window");
      },
    });
    try {
      const html = renderToStaticMarkup(<ServerLayout isDesktop={isDesktop} />);
      assert.match(html, /data-active-section="appearance"/);
      assert.match(html, /grid-cols-\[268px_minmax\(0,1fr\)\]/);
      assert.doesNotMatch(html, /mobile-sidebar-toggle|inert/);
    } finally {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
}
