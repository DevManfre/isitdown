import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { openCommandPalette } from "@/components/CommandPalette.tsx";
import { openShortcuts } from "@/components/ShortcutsDialog.tsx";
import { usePollNow } from "@/hooks/queries.ts";
import { createShortcutMatcher } from "@/lib/shortcuts.ts";

/** Whether a dialog, sheet or palette is open: the keys belong to it then. */
const modalOpen = (): boolean => document.querySelector('[role="dialog"][data-state="open"]') !== null;

/**
 * Roadmap 4.17: the keyboard map, wired. Mounted once in the shell, next to the
 * palette it complements.
 *
 * What a key does is `lib/shortcuts.ts`'s call; this hook is only the three
 * things that need React — the router, the poll mutation and a listener that
 * lives as long as the console does.
 */
export function useShortcuts(): void {
  const navigate = useNavigate();
  const poll = usePollNow();
  // Read through refs so the listener is attached once: re-attaching on every
  // render of a shell that re-renders on each poll tick would drop a `g`
  // waiting in the matcher.
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const feed = createShortcutMatcher();
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = feed(
        { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, target },
        Date.now(),
        modalOpen(),
      );
      if (action === null) return;
      // Claimed, so a `/` is not also typed into the field the palette opens.
      event.preventDefault();
      switch (action.kind) {
        case "go":
          void navigateRef.current(action.to);
          break;
        case "search":
          openCommandPalette();
          break;
        case "help":
          openShortcuts();
          break;
        case "poll":
          if (!pollRef.current.isPending) pollRef.current.mutate();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
