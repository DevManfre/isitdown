import { ChevronDown, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";

/**
 * One menu for everything a view can be taken away in — roadmap 5.16's
 * neighbour in spirit: the toolbar, not the bundle, was the thing quietly
 * growing.
 *
 * The History header carried a range toggle and two full sentences ("Download
 * JSON, last 90 days"), and Incidents carried an export pair and a subscribe
 * pair, all as ghost buttons of the same weight as the filters beside them.
 * Nothing said which controls belonged together or why. Collapsing every
 * take-it-with-you action into one labelled menu leaves the row with the
 * controls that change what is on screen, and one button that does not.
 *
 * A section per group, because a download and a subscription are not the same
 * promise: one is a file as it is now, the other is a url that keeps answering.
 */
export interface DownloadGroup {
  /** Section heading, already translated. Omitted for a single unlabelled list. */
  label?: string;
  items: {
    /** The format token as it is written everywhere else: `CSV`, `JSON`, `RSS`. */
    format: string;
    /** A link when the server sends a file; a callback when the browser builds one. */
    href?: string;
    onSelect?: () => void;
    /** What the item promises, spelled out for a screen reader. */
    description: string;
  }[];
}

export function DownloadMenu({ groups, label }: { groups: DownloadGroup[]; label?: string }) {
  const { t } = useTranslation();
  const trigger = label ?? t("action.download");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Download aria-hidden="true" />
          {trigger}
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {groups.map((group, index) => (
          <div key={group.label ?? index}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.label !== undefined && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
            {group.items.map((item) =>
              item.href === undefined ? (
                <DropdownMenuItem
                  key={item.format}
                  onSelect={() => item.onSelect?.()}
                  aria-label={item.description}
                >
                  {item.format}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={item.format} asChild>
                  <a href={item.href} aria-label={item.description}>
                    {item.format}
                  </a>
                </DropdownMenuItem>
              ),
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
