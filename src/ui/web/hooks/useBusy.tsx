import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { shouldHoldRefresh } from "@/lib/holdRefresh.ts";

interface BusyControls {
  setDialogOpen: (open: boolean) => void;
  setEditing: (editing: boolean) => void;
}

const BusyContext = createContext<boolean>(false);
const ControlsContext = createContext<BusyControls>({ setDialogOpen: () => {}, setEditing: () => {} });

/**
 * The one decision the poll loop cannot delegate to TanStack Query: never
 * refetch while the operator is mid-interaction. Dialog state comes from Radix
 * `onOpenChange`, editing from field focus — real state, not a DOM probe.
 */
export function BusyProvider({ children }: { children: ReactNode }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const controls = useMemo(() => ({ setDialogOpen, setEditing }), []);
  const busy = shouldHoldRefresh({ hidden: false, dialogOpen, editing });
  return (
    <ControlsContext.Provider value={controls}>
      <BusyContext.Provider value={busy}>{children}</BusyContext.Provider>
    </ControlsContext.Provider>
  );
}

export const useBusy = () => useContext(BusyContext);
export const useBusyControls = () => useContext(ControlsContext);

/**
 * The focus/blur pair every editable field in the dashboard spreads onto its
 * input, so the poll holds still while the operator is typing.
 *
 * It lives here, beside the context it drives, because three call sites had
 * grown their own copy of it — `ServiceDialog` as a local hook, `Settings`'s
 * `ChannelCard` and `Settings` itself as inline object literals — and only the
 * first had an unmount cleanup. Without one, a field that is focused when its
 * component goes away (browser-back, a programmatic navigation, a route change)
 * runs no `onBlur`: `editing` stays `true` in the shared `BusyContext` and the
 * 30s poll is held for the rest of the session, with nothing on screen to say
 * why the data has gone stale. React runs an unmount's cleanup whatever the
 * reason the component is going away, which is the one path a blur handler
 * cannot cover.
 *
 * One exported hook rather than a fixed-up copy at each site: a future consumer
 * is then safe by construction instead of having to remember the cleanup.
 */
export function useFieldProps(): { onFocus: () => void; onBlur: () => void } {
  const { setEditing } = useBusyControls();

  useEffect(() => {
    return () => {
      setEditing(false);
    };
  }, [setEditing]);

  return useMemo(
    () => ({ onFocus: () => setEditing(true), onBlur: () => setEditing(false) }),
    [setEditing],
  );
}
