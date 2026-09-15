import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ProviderIcon } from "@/components/ProviderIcon.tsx";

/**
 * What step one decided, carried into step two and reversible in one click.
 *
 * The old form answered "which adapter am I on?" only by reading a row of
 * sixteen chips for the darker one, and answered "which base URL?" from a
 * field halfway down the scroll. Both are the premise of everything below
 * them, so they read as a premise: one line, above the fields, with the way
 * back attached.
 */
export function ServiceIdentity({
  name, adapter, baseUrl, onChange,
}: {
  name: string;
  adapter: string;
  baseUrl: string;
  /** Absent in edit mode: an existing service's adapter is not re-choosable. */
  onChange?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
      <ProviderIcon name={name === "" ? adapter : name} baseUrl={baseUrl} size={22} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{name === "" ? t("add.unnamed") : name}</span>
          <Badge variant="outline" className="font-mono text-[10px]">{adapter}</Badge>
        </div>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{baseUrl}</span>
      </div>
      {onChange !== undefined && (
        <Button type="button" variant="outline" size="sm" onClick={onChange}>
          {t("action.change")}
        </Button>
      )}
    </div>
  );
}
