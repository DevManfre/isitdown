import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Activity, MonitorCog, RefreshCw, Server } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command.tsx";
import { NAV_ROUTES, ROUTE_PATHS } from "../../routePaths.ts";
import { usePollNow, useStatusChrome } from "@/hooks/queries.ts";
import { useTheme } from "@/hooks/useTheme.tsx";

/**
 * The command palette — roadmap 5.4. ⌘K, or Ctrl+K.
 *
 * The console shell was already built for it: the rail has the views, the
 * header has the poll button and the theme toggle, and the fleet is a list of
 * providers with names. This puts all three behind one keystroke rather than
 * inventing a fourth place to look.
 *
 * Mounted in `App`, beside `Rail` and `Header` rather than inside a view: the
 * shortcut has to work on every screen, and a palette that unmounted with the
 * view would take its own listener with it.
 *
 * A provider opens the History view's drawer, which is where a provider's
 * detail lives today — passed as route state rather than as a url, because
 * there is no per-provider route yet (roadmap 5.6 is where that goes). The
 * effect is what a click on that row does, reached from the keyboard.
 */
/** What the header's search button dispatches to open the palette. */
export const PALETTE_EVENT = "isitdown:open-palette";

/** Opens the palette from anywhere in the shell. */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(PALETTE_EVENT));
}

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const poll = usePollNow();
  const { cycle } = useTheme();
  // Chrome-safe, like everything else mounted in the shell: a throw here would
  // escape the view's error boundary and take the console down with it. With no
  // data the palette still opens, with its views and its two actions.
  const { data: status } = useStatusChrome();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // The browser's own ⌘K (the address bar's search, on some) would
      // otherwise take the keystroke before this ever sees it.
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    // The header carries a search affordance that says "⌘K" on it, and a
    // keystroke nobody can discover is a keystroke most operators never use.
    // The button asks for the palette through an event rather than through a
    // lifted state: the palette is a sibling of the header in `App`, and
    // hoisting `open` into the shell would put a re-render of the whole console
    // behind every keystroke typed into the palette's own input.
    const onRequest = (): void => setOpen(true);
    window.addEventListener(PALETTE_EVENT, onRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(PALETTE_EVENT, onRequest);
    };
  }, []);

  /** Every item closes the palette first: the action it runs changes the screen. */
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const providers = (status?.providers ?? []).filter((provider) => provider.enabled);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("palette.title")}
      description={t("palette.description")}
    >
      <CommandInput placeholder={t("palette.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>

        <CommandGroup heading={t("palette.views")}>
          {NAV_ROUTES.map((route) => (
            <CommandItem
              key={route.name}
              value={t(route.labelKey)}
              onSelect={run(() => void navigate(ROUTE_PATHS[route.name]))}
            >
              <Activity aria-hidden="true" />
              {t(route.labelKey)}
            </CommandItem>
          ))}
        </CommandGroup>

        {providers.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("palette.providers")}>
              {providers.map((provider) => (
                <CommandItem
                  key={provider.id}
                  // Searchable by the name an operator reads and by the id they
                  // configured, since either is what comes to mind first.
                  value={`${provider.name} ${provider.id}`}
                  onSelect={run(() =>
                    void navigate(ROUTE_PATHS.history, { state: { openProvider: provider.id } }),
                  )}
                >
                  <Server aria-hidden="true" />
                  {provider.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading={t("palette.actions")}>
          <CommandItem
            value={t("action.poll-now")}
            disabled={poll.isPending}
            onSelect={run(() => poll.mutate())}
          >
            <RefreshCw aria-hidden="true" />
            {t("action.poll-now")}
          </CommandItem>
          <CommandItem value={t("palette.cycle-theme")} onSelect={run(() => cycle())}>
            <MonitorCog aria-hidden="true" />
            {t("palette.cycle-theme")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
