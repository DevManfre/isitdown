import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { IncidentWordsCard } from "./IncidentWordsCard.tsx";
import type { IncidentWords } from "@/lib/types.ts";

const words: IncidentWords = {
  days: 30,
  incidents: 8,
  phrases: [{ term: "elevated error rates", incidents: 5, providers: ["github", "slack"] }],
  words: [
    { term: "elevated", incidents: 5, providers: ["github", "slack"] },
    { term: "dns", incidents: 3, providers: ["cloudflare"] },
  ],
  components: [{ providerId: "github", componentId: "actions", name: "Actions", badDays: 6 }],
};

const show = (props: Partial<Parameters<typeof IncidentWordsCard>[0]> = {}) =>
  render(
    <I18nextProvider i18n={i18n}>
      <IncidentWordsCard
        data={words}
        isPending={false}
        isError={false}
        onRetry={() => {}}
        nameOf={(id) => id.toUpperCase()}
        {...props}
      />
    </I18nextProvider>,
  );

const open = () => fireEvent.click(screen.getByRole("button", { name: new RegExp(i18n.t("words.title")) }));

describe("IncidentWordsCard", () => {
  beforeEach(() => localStorage.clear());

  it("stays folded, with the top phrase still readable on the fold", () => {
    show();
    expect(screen.getByRole("button", { name: /elevated error rates/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("lists a phrase once rather than again as the words inside it, then the components that went red", () => {
    show();
    open();
    expect(screen.getByText("elevated error rates", { selector: "td" })).toBeInTheDocument();
    expect(screen.queryByText("elevated", { selector: "td" })).toBeNull();
    expect(screen.getByText("dns", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("GITHUB, SLACK")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(i18n.t("words.conclusion-term", { term: "elevated error rates", count: 5, total: 8 }))),
    ).toBeInTheDocument();
  });

  it("says nothing kept breaking when the window has no incidents — good news, not an error", () => {
    show({ data: { ...words, incidents: 0, words: [], phrases: [], components: [] } });
    open();
    expect(screen.getByText(i18n.t("words.empty"))).toBeInTheDocument();
  });

  it("shows skeletons while loading, never the empty state", () => {
    show({ data: undefined, isPending: true });
    open();
    expect(screen.queryByText(i18n.t("words.empty"))).toBeNull();
  });

  it("reports a failed read inline with a retry", () => {
    const onRetry = vi.fn();
    show({ data: undefined, isError: true, onRetry });
    open();
    expect(screen.getByRole("alert")).toHaveTextContent(i18n.t("words.error"));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("action.retry") }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
