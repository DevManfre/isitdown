import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { ComponentPicker } from "./ComponentPicker.tsx";

const all = [
  { id: "a", name: "Actions", group: "CI" },
  { id: "b", name: "API Requests", group: "Core" },
  { id: "c", name: "Webhooks", group: "Core" },
];

const mount = (onChange = vi.fn()) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ComponentPicker available={all} supported value={[]} onChange={onChange} loading={false} />
    </I18nextProvider>,
  );

describe("ComponentPicker", () => {
  it("lists every available component", () => {
    mount();
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.getByText("API Requests")).toBeInTheDocument();
    expect(screen.getByText("Webhooks")).toBeInTheDocument();
  });

  it("filters by the search box", async () => {
    mount();
    await userEvent.type(screen.getByRole("searchbox"), "web");
    expect(screen.queryByText("Actions")).toBeNull();
    expect(screen.getByText("Webhooks")).toBeInTheDocument();
  });

  it("reports a single selection through onChange", async () => {
    const onChange = vi.fn();
    mount(onChange);
    await userEvent.click(screen.getByLabelText("Actions"));
    expect(onChange).toHaveBeenCalledWith([{ id: "a", name: "Actions" }]);
  });

  it("selects only what's visible on select-all, not everything", async () => {
    const onChange = vi.fn();
    mount(onChange);
    // Filter down to one component first — this is the one property
    // "select-all" must prove: it picks up the filtered subset, not the
    // full unfiltered list sitting behind the search box.
    await userEvent.type(screen.getByRole("searchbox"), "web");
    await userEvent.click(screen.getByRole("button", { name: i18n.t("components.select-all") }));
    expect(onChange).toHaveBeenCalledWith([{ id: "c", name: "Webhooks" }]);
    expect(onChange).not.toHaveBeenCalledWith(all.map(({ id, name }) => ({ id, name })));
  });

  it("says the adapter can't list components when it's unsupported", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ComponentPicker available={[]} supported={false} value={[]} onChange={vi.fn()} loading={false} />
      </I18nextProvider>,
    );
    expect(screen.getByText(i18n.t("components.unsupported"))).toBeInTheDocument();
  });

  it("says the provider exposes none, distinct from unsupported, when it's just empty", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ComponentPicker available={[]} supported value={[]} onChange={vi.fn()} loading={false} />
      </I18nextProvider>,
    );
    expect(screen.getByText(i18n.t("components.empty"))).toBeInTheDocument();
    expect(screen.queryByText(i18n.t("components.unsupported"))).toBeNull();
  });
});
