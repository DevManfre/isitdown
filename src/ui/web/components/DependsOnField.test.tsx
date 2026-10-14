import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { DependsOnField, MAX_DEPENDS_ON } from "./DependsOnField.tsx";

const OPTIONS = [
  { id: "aws", name: "AWS" },
  { id: "cloudflare", name: "Cloudflare" },
  { id: "vercel", name: "Vercel" },
];

function Harness({ initial = [], onChange }: { initial?: string[]; onChange?: (next: string[]) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <I18nextProvider i18n={i18n}>
      <DependsOnField
        value={value}
        options={OPTIONS}
        selfId="vercel"
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </I18nextProvider>
  );
}

describe("DependsOnField", () => {
  it("adds a suggested provider and never offers the provider itself", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(i18n.t("field.depends-on")), "ver");
    expect(screen.queryByRole("button", { name: /Vercel/ })).toBeNull();
    await userEvent.clear(screen.getByLabelText(i18n.t("field.depends-on")));
    await userEvent.type(screen.getByLabelText(i18n.t("field.depends-on")), "cloud");
    await userEvent.click(screen.getByRole("button", { name: /Cloudflare/ }));
    expect(onChange).toHaveBeenLastCalledWith(["cloudflare"]);
  });

  it("takes a slug nobody monitors on Enter, without submitting the form", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(i18n.t("field.depends-on")), "Some Cloud{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["some-cloud"]);
  });

  it("removes a chip", async () => {
    const onChange = vi.fn();
    render(<Harness initial={["aws", "cloudflare"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: i18n.t("field.depends-on-remove", { name: "AWS" }) }));
    expect(onChange).toHaveBeenLastCalledWith(["cloudflare"]);
  });

  it("stops accepting more at the schema's limit", () => {
    render(<Harness initial={Array.from({ length: MAX_DEPENDS_ON }, (_, i) => `p${i}`)} />);
    expect(screen.getByLabelText(i18n.t("field.depends-on"))).toBeDisabled();
  });
});
