import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallAppRow } from "./InstallAppRow.tsx";
import i18n from "@/lib/i18n.ts";
import * as pwa from "@/lib/pwa.ts";

describe("the install row (roadmap 5.21)", () => {
  let standalone = false;
  let installable = false;

  beforeEach(() => {
    standalone = false;
    installable = false;
    vi.spyOn(pwa, "isStandalone").mockImplementation(() => standalone);
    vi.spyOn(pwa, "canInstall").mockImplementation(() => installable);
    vi.spyOn(pwa, "onInstallabilityChange").mockReturnValue(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still appears where the browser never offers, and says how to install by hand", () => {
    // A row that vanished on iOS would read as a feature that does not exist
    // there, when it is Share then Add to Home Screen.
    render(<InstallAppRow />);
    expect(screen.getByText(i18n.t("settings.install.manual"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("settings.install.action") })).toBeDisabled();
  });

  it("offers the install once the browser has said it can", async () => {
    installable = true;
    const prompt = vi.spyOn(pwa, "promptInstall").mockResolvedValue(true);
    render(<InstallAppRow />);

    const button = screen.getByRole("button", { name: i18n.t("settings.install.action") });
    expect(button).toBeEnabled();
    await userEvent.click(button);

    expect(prompt).toHaveBeenCalled();
  });

  it("offers nothing when this already is the installed app", () => {
    standalone = true;
    render(<InstallAppRow />);
    expect(screen.queryByRole("button", { name: i18n.t("settings.install.action") })).not.toBeInTheDocument();
    expect(screen.getByText(i18n.t("settings.install.done"))).toBeInTheDocument();
  });
});
