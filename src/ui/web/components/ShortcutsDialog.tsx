import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { isApplePlatform } from "@/lib/shortcut.ts";
import { SHORTCUTS, type Shortcut } from "@/lib/shortcuts.ts";

export const SHORTCUTS_EVENT = "isitdown:open-shortcuts";

/** Opens the map from anywhere: the `?` key, the palette. */
export function openShortcuts(): void {
  window.dispatchEvent(new Event(SHORTCUTS_EVENT));
}

/** Written out rather than built from the group's name: the catalog check finds a key by its literal. */
const GROUPS = [
  { group: "navigation", labelKey: "shortcuts.group.navigation" },
  { group: "actions", labelKey: "shortcuts.group.actions" },
] as const;

function Keys({ keys }: { keys: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-1">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="flex items-center gap-1">
          {index > 0 && <span className="text-xs text-muted-foreground">{t("shortcuts.then")}</span>}
          <kbd className="min-w-6 rounded bg-muted px-1.5 py-0.5 text-center font-mono text-xs">{key}</kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * The map of every keyboard shortcut — roadmap 4.17. Opened by `?` (the
 * convention GitHub and Linear taught) and by the palette, so a shortcut can
 * be found by someone who has never been told one exists.
 *
 * Read from the same table the matcher runs on, so it cannot list a key that
 * does nothing or leave one out. In the shell for the palette's reason: it has
 * to answer on every screen, and a dialog mounted inside a view would take its
 * listener away with it.
 */
export function ShortcutsDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onRequest = (): void => setOpen(true);
    window.addEventListener(SHORTCUTS_EVENT, onRequest);
    return () => window.removeEventListener(SHORTCUTS_EVENT, onRequest);
  }, []);

  const entries = (group: Shortcut["group"]) => SHORTCUTS.filter((entry) => entry.group === group);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {/* The palette's own chord leads: it is the shortcut every other one
              is a shorter way of reaching. */}
          <section aria-label={t("shortcuts.group.palette")} className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{t("shortcuts.group.palette")}</h3>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt>{t("shortcuts.palette")}</dt>
                <dd>
                  <Keys keys={[isApplePlatform() ? "⌘ K" : "Ctrl K"]} />
                </dd>
              </div>
            </dl>
          </section>
          {GROUPS.map(({ group, labelKey }) => (
            <section key={group} aria-label={t(labelKey)} className="flex flex-col gap-2">
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{t(labelKey)}</h3>
              <dl className="flex flex-col gap-1.5 text-sm">
                {entries(group).map((entry) => (
                  <div key={entry.keys.join(" ")} className="flex items-center justify-between gap-4">
                    <dt>{t(entry.labelKey)}</dt>
                    <dd>
                      <Keys keys={entry.keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
