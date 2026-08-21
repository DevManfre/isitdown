import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
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
