import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton.tsx";

/**
 * What a view draws before its first response lands.
 *
 * `useViewReady` releases a view after 1.5s whether or not its data has
 * arrived, and a view that then read `data ?? []` told an operator with twenty
 * providers that none were configured — the empty state standing in for a
 * loading one. This is the loading one: the shape of the page to come, with no
 * figure in it that could be mistaken for a reading.
 *
 * `hero` draws the Overview's headline band; `rows` is the list or table below.
 */
export function ViewSkeleton({ hero = false, rows = 5 }: { hero?: boolean; rows?: number }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" aria-label={t("view.loading")} className="flex flex-col gap-4">
      {hero && (
        <div className="flex flex-col gap-3 border-b border-border pb-7">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-3/4 max-w-xl" />
          <Skeleton className="h-4 w-1/2 max-w-md" />
        </div>
      )}
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}
