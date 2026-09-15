import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";

const DENSITY_KEY = "isitdown.settings-density";
const DENSITIES = ["detailed", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

/** Accent-insensitive, case-insensitive: "cadenza" has to find "Cadenza". */
const fold = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** This browser's own choice, like the theme's — never the server's. */
const storedDensity = (): Density => {
  try {
    const value = localStorage.getItem(DENSITY_KEY);
    return DENSITIES.includes(value as Density) ? (value as Density) : "detailed";
  } catch {
    /* a blocked localStorage only costs the remembered density */
    return "detailed";
  }
};

interface Chrome {
  query: string;
  setQuery: (query: string) => void;
  density: Density;
  setDensity: (density: Density) => void;
  /** How many rows each section still shows under the current query. */
  counts: Record<string, number>;
  report: (section: string, row: string, visible: boolean) => void;
}

const ChromeContext = createContext<Chrome | undefined>(undefined);
/** Which section the row being rendered belongs to — set by `SettingsSection`. */
const SectionContext = createContext<string | undefined>(undefined);

export const SettingsSectionScope = SectionContext.Provider;

/**
 * The filter and the density switch that sit above the Settings page, and the
 * registry that tells the section rail how many rows each section still has.
 *
 * The registry is a ref of section → visible row ids rather than derived state
 * on the way down: rows decide their own visibility (they are the only things
 * that know their search text), and a section that has to hide when all its
 * rows are filtered out would otherwise need every row's text lifted into this
 * provider — which is the prop-threading `SettingRow` exists to avoid.
 */
export function SettingsChromeProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [density, setDensityState] = useState<Density>(storedDensity);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const visible = useRef(new Map<string, Set<string>>());

  const setDensity = useCallback((next: Density): void => {
    setDensityState(next);
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      /* the choice still applies to this page view */
    }
  }, []);

  const report = useCallback((section: string, row: string, isVisible: boolean): void => {
    let rows = visible.current.get(section);
    if (rows === undefined) {
      rows = new Set();
      visible.current.set(section, rows);
    }
    if (isVisible === rows.has(row)) return;
    if (isVisible) rows.add(row);
    else rows.delete(row);
    const size = rows.size;
    setCounts((previous) => (previous[section] === size ? previous : { ...previous, [section]: size }));
  }, []);

  const value = useMemo<Chrome>(
    () => ({ query, setQuery, density, setDensity, counts, report }),
    [query, density, counts, report, setDensity],
  );

  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

/**
 * Defaulted rather than thrown: `SettingRow` is rendered by tests and by the
 * Providers table outside this provider, and a filter nobody typed into has
 * exactly the behaviour of no filter at all.
 */
export function useSettingsChrome(): Chrome {
  return (
    useContext(ChromeContext) ?? {
      query: "",
      setQuery: () => {},
      density: "detailed",
      setDensity: () => {},
      counts: {},
      report: () => {},
    }
  );
}

/**
 * Whether one row survives the current filter, registered with its section so
 * the rail's count and the section's own "everything here is filtered out"
 * state follow what is actually on screen.
 */
export function useSettingVisible(search: string): boolean {
  const { query, report } = useSettingsChrome();
  const section = useContext(SectionContext);
  const id = useId();
  const visible = query.trim() === "" || fold(search).includes(fold(query.trim()));

  useEffect(() => {
    if (section === undefined) return;
    report(section, id, visible);
    return () => report(section, id, false);
  }, [section, id, visible, report]);

  return visible;
}

/** How many rows a section shows right now — `undefined` before its first report. */
export function useSectionCount(section: string): number | undefined {
  return useSettingsChrome().counts[section];
}

/**
 * The page's own toolbar: type to narrow forty rows to the one being looked
 * for, and switch the hints off once the page is familiar.
 *
 * The filter is the reason the page can stay one scrolling column — it answers
 * "where is the setting called…" without the operator having to know which
 * section owns it, which was the question the old page had no answer to.
 */
export function SettingsToolbar({ density: showDensity = true }: { density?: boolean } = {}) {
  const { t } = useTranslation();
  const { query, setQuery, density, setDensity } = useSettingsChrome();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-52 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="settings-filter"
          type="search"
          className="h-9 pl-8"
          placeholder={t("settings.filter.placeholder")}
          aria-label={t("settings.filter.label")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {/* The launcher has no rows to fold hints away from, so it carries
          the filter alone; the switch belongs to a category page. */}
      {showDensity && (
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={density}
        aria-label={t("settings.density.label")}
        // A group can be emptied by clicking the pressed item; the page has no
        // third density, so an empty answer keeps the current one.
        onValueChange={(next) => {
          if (next !== "") setDensity(next as Density);
        }}
      >
        <ToggleGroupItem value="detailed" className="px-3 text-xs">
          {t("settings.density.detailed")}
        </ToggleGroupItem>
        <ToggleGroupItem value="compact" className="px-3 text-xs">
          {t("settings.density.compact")}
        </ToggleGroupItem>
      </ToggleGroup>
      )}
    </div>
  );
}
