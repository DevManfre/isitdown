import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const KEY = "isitdown.railCollapsed";

interface RailApi {
  collapsed: boolean;
  toggle: () => void;
}

const RailContext = createContext<RailApi>({ collapsed: false, toggle: () => {} });

const read = () => {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    /* only costs the choice surviving a reload */
    return false;
  }
};

/**
 * Pinned open, or a collapsed hover strip. The attribute lives on <html> so the
 * pre-paint script in index.html can restore it before the first frame, and
 * hover-expanding the collapsed rail stays CSS alone.
 */
export function RailProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(read);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      const root = document.documentElement;
      if (next) root.setAttribute("data-rail", "collapsed");
      else root.removeAttribute("data-rail");
      try {
        localStorage.setItem(KEY, String(next));
      } catch {
        /* the attribute is already applied */
      }
      return next;
    });
  }, []);

  const api = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
  return <RailContext.Provider value={api}>{children}</RailContext.Provider>;
}

export const useRail = () => useContext(RailContext);
