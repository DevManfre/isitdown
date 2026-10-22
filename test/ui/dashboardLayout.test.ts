import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LAYOUT } from "../../src/ui/dashboardLayout.ts";
import { layoutSchema } from "../../src/ui/dashboardLayoutSchema.ts";

const fleet = { filter: { groups: [], providers: [] } };

function issuePath(input: unknown): string | undefined {
  const result = layoutSchema.safeParse(input);
  assert.equal(result.success, false, "expected the layout to be rejected");
  return result.error?.issues[0]?.path.join(".");
}

test("the default layout is today's Overview, in order, all full width", () => {
  assert.deepEqual(layoutSchema.parse(DEFAULT_LAYOUT), DEFAULT_LAYOUT);
  assert.deepEqual(
    DEFAULT_LAYOUT.widgets.map((w) => [w.type, w.width]),
    [
      ["fleet-rings", "full"],
      ["geo-map", "full"],
      ["shared-failure", "full"],
      ["stack-band", "full"],
      ["fleet-list", "full"],
    ],
  );
});

test("a fleet widget without props gets the whole-fleet filter", () => {
  const parsed = layoutSchema.parse({
    version: 1,
    widgets: [{ id: "a", type: "fleet-list", width: "half", props: {} }],
  });
  assert.deepEqual(parsed.widgets[0]?.props, fleet);
});

test("a filter naming providers that do not exist is still a valid layout", () => {
  // Orphans are the dashboard's to draw, not the server's to rewrite.
  const parsed = layoutSchema.safeParse({
    version: 1,
    widgets: [
      { id: "a", type: "fleet-list", width: "half", props: { filter: { groups: ["gone"], providers: ["heroku"] } } },
    ],
  });
  assert.equal(parsed.success, true);
});

const rejected: { name: string; widgets: unknown; path: string }[] = [
  {
    name: "an unknown widget type",
    widgets: [{ id: "a", type: "clock", width: "full", props: {} }],
    path: "widgets.0.type",
  },
  {
    name: "a width the widget does not allow",
    widgets: [{ id: "a", type: "geo-map", width: "third", props: {} }],
    path: "widgets.0.width",
  },
  {
    name: "two widgets with the same id",
    widgets: [
      { id: "a", type: "fleet-list", width: "full", props: fleet },
      { id: "a", type: "stack-band", width: "full", props: fleet },
    ],
    path: "widgets.1.id",
  },
  {
    name: "a filter on a widget that takes none",
    widgets: [{ id: "a", type: "geo-map", width: "full", props: fleet }],
    path: "widgets.0.props",
  },
  {
    name: "more than fifty widgets",
    widgets: Array.from({ length: 51 }, (_, i) => ({ id: `w${i}`, type: "stack-band", width: "third", props: fleet })),
    path: "widgets",
  },
];

for (const { name, widgets, path } of rejected) {
  test(`the layout schema rejects ${name}`, () => {
    assert.equal(issuePath({ version: 1, widgets }), path);
  });
}

test("the layout schema rejects a version it does not know", () => {
  assert.equal(issuePath({ version: 2, widgets: [] }), "version");
});
