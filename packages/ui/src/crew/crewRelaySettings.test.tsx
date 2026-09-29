import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { CrewRelaySettings } from "./CrewRelaySettings.js";
import { crewCreateParamsSchema, type CrewCreateParams } from "@zcode/shared";
import { crewComponentHarness, crewElementNodes as nodes } from "./crewChatHarness.js";
import { chatDetail } from "./crewChatFixtures.js";
import * as relayUi from "./crewRelayUi.js";
import * as catalogUi from "./crewCatalogUi.js";
import * as errors from "./crewErrors.js";

const Fields = () => null;
const imports = {
  "@zcode/shared": { crewCreateParamsSchema },
  "@/hooks/useCrewText.js": { useCrewText: () => (key: string) => key },
  "@/components/ui/button.js": { Button: "button" },
  "@/components/ui/input.js": { Input: "input" },
  "@/components/ui/label.js": { Label: "label" },
  "@/components/ui/checkbox.js": { Checkbox: "input" },
  "@/components/ui/select.js": {
    Select: "select",
    SelectContent: "div",
    SelectItem: "option",
    SelectTrigger: "button",
    SelectValue: "span",
  },
  "./crewRelayUi.js": relayUi,
  "./crewCatalogUi.js": catalogUi,
  "./crewErrors.js": errors,
  "./CrewRelaySettings.js": { CrewRelaySettings: Fields },
  "./CrewWorkspaceField.js": { CrewWorkspaceField: () => null },
};

test("settings callbacks expose modes, K 0..8 and budget; pending guards callbacks", async () => {
  const harness = await crewComponentHarness("CrewRelaySettings.tsx", imports);
  let value = relayUi.crewRelaySettings();
  const render = (disabled = false) =>
    harness.render("CrewRelaySettings", {
      value,
      disabled,
      onChange: (next: typeof value) => {
        value = next;
      },
    });
  const mode = () => nodes(render()).find((node) => node.type === "select")!;
  for (const relayMode of ["auto", "manual", "semi"] as const) {
    (mode().props.onValueChange as (mode: string) => void)(relayMode);
    assert.equal(value.relayMode, relayMode);
  }
  const inputs = nodes(render()).filter((node) => node.type === "input");
  assert.equal(inputs[0]!.props.min, 0);
  assert.equal(inputs[0]!.props.max, 8);
  assert.equal(inputs[1]!.props.min, 1);
  assert.equal(inputs[1]!.props.max, 1440);
  (inputs[0]!.props.onChange as Function)({ target: { valueAsNumber: 3 } });
  const budget = nodes(render()).filter((node) => node.type === "input")[1]!;
  (budget.props.onChange as Function)({ target: { valueAsNumber: 45 } });
  assert.deepEqual(
    { ...value },
    { relayMode: "semi", relayAutoHops: 3, relayBudgetMinutes: 45, relayPaused: false },
  );
  const locked = nodes(render(true)).find((node) => node.type === "select")!;
  (locked.props.onValueChange as Function)("auto");
  assert.equal(value.relayMode, "semi");
});

test("actual group form saves defaults/new settings and preserves paused state; rejects invalid bounds", async () => {
  const harness = await crewComponentHarness("CrewGroupEditor.tsx", imports);
  const saved: CrewCreateParams[] = [];
  const group = { ...chatDetail().group, members: [], relayPaused: true };
  const props = {
    group,
    agents: [],
    pending: false,
    onSave: async (params: CrewCreateParams) => {
      saved.push(params);
    },
    onCancel: () => {},
  };
  const view = () => harness.render("CrewGroupEditor", props);
  const submit = () => (nodes(view())[0]!.props.onSubmit as Function)({ preventDefault() {} });
  const set = (value: ReturnType<typeof relayUi.crewRelaySettings>) => {
    (nodes(view()).find((node) => node.type === Fields)!.props.onChange as Function)(value);
  };
  submit();
  assert.deepEqual(
    { ...saved[0] },
    {
      name: group.name,
      members: [],
      relayMode: "auto",
      relayAutoHops: 2,
      relayBudgetMinutes: 30,
      relayPaused: true,
    },
  );
  set({ relayMode: "semi", relayAutoHops: 0, relayBudgetMinutes: 60, relayPaused: true });
  submit();
  assert.equal(saved[1]?.relayAutoHops, 0);
  assert.equal(saved[1]?.relayBudgetMinutes, 60);
  set({ relayMode: "auto", relayAutoHops: 8, relayBudgetMinutes: 1, relayPaused: true });
  submit();
  assert.equal(saved[2]?.relayMode, "auto");
  for (const invalid of [
    { relayAutoHops: 9 },
    { relayBudgetMinutes: 0 },
    { relayBudgetMinutes: NaN },
  ]) {
    set({ ...relayUi.crewRelaySettings(), ...invalid });
    submit();
    assert.equal(saved.length, 3);
    assert(nodes(view()).some((node) => node.props.role === "alert"));
  }
});

test("budget input explains frozen existing-chain budgets in both locales", () => {
  for (const [locale, hint] of [
    [
      "en-US",
      "Budget changes apply to new requests only. Existing relay chains keep their original budget.",
    ],
    ["zh-CN", "预算修改仅适用于新请求，已有接力链保留原预算。"],
  ] as const) {
    const html = renderToStaticMarkup(
      <ZCodeIntlProvider initialLocale={locale}>
        <CrewRelaySettings
          value={relayUi.crewRelaySettings()}
          disabled={false}
          onChange={() => {}}
        />
      </ZCodeIntlProvider>,
    );
    assert.ok(html.includes(hint));
    assert.match(html, /aria-describedby="[^"]*-budget-hint"/);
  }
});
