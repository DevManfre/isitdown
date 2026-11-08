import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { useServiceMutations } from "@/hooks/queries.ts";
import { cn } from "@/lib/utils.ts";

/**
 * The star on a provider — roadmap 5.14. A toggle, so the label stays the same
 * and `aria-pressed` carries the state; the filled glyph is the second cue, not
 * the only one. A failed save reads inline beside it, since the toasts belong
 * to Settings.
 */
export function FavoriteStar({
  providerId,
  name,
  favorite,
}: {
  providerId: string;
  name: string;
  favorite: boolean;
}) {
  const { t } = useTranslation();
  const { patch } = useServiceMutations();
  const label = t("provider.favorite.label", { name });

  return (
    <span className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-pressed={favorite}
        aria-label={label}
        title={label}
        disabled={patch.isPending}
        onClick={() => patch.mutate({ id: providerId, patch: { favorite: !favorite } })}
      >
        <Star aria-hidden="true" className={cn(favorite && "fill-current text-primary")} />
      </Button>
      {patch.isError && (
        <span role="alert" className="text-xs text-destructive">
          {t("toast.failed", { error: patch.error instanceof Error ? patch.error.message : String(patch.error) })}
        </span>
      )}
    </span>
  );
}
