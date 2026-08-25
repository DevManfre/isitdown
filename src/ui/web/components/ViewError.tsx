import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useRouteError } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Catches a failed initial load for any view. Mounted on the pathless
 * layout route wrapping every view route in routes.tsx (and on the single
 * route the test harness builds), so only the `<Outlet/>` slot is replaced
 * — the rail and header, one level up in App.tsx, stay mounted.
 *
 * Straight port of app.js:273-276's try/catch around the view render, minus
 * the previous React-port behaviour of silently painting "everything is
 * fine" over the top of a failed fetch (a `status` query with no data falls
 * back to an empty provider list, which reads as "nothing configured", not
 * "could not load").
 *
 * Retrying takes two steps, and neither one alone recovers the view.
 *
 * `resetQueries()` clears the failed query's cached error, so the remounted
 * view fetches again instead of re-throwing what it already has. The
 * `navigate()` to the current location is what actually puts the view back:
 * a render-thrown error (which is what `throwOnError` produces — not a loader
 * error) is held in React state by react-router's own `RenderErrorBoundary`,
 * and that state is only dropped when the boundary sees a new `location`
 * object (hooks.js's `getDerivedStateFromProps`). `useRevalidator` is the
 * documented recovery path but does not work here: it clears the boundary via
 * a `revalidation` "loading" → "idle" transition, and with no loaders on these
 * routes there is nothing to await, so React batches both values into a single
 * render and the boundary never observes the intermediate state.
 *
 * The reset is awaited before navigating, so the view never remounts onto a
 * query that is still holding the old error.
 *
 * Vanilla needed no button here: its own 30s tick called `load()` again and
 * recovered on its own. Under TanStack a query that has thrown to an error
 * boundary is unmounted, so nothing is left polling to bring the view back.
 */
export function ViewError() {
  const { t } = useTranslation();
  const error = useRouteError();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground">{t("error.load-failed", { error: errorMessage(error) })}</p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          void client.resetQueries().then(() => {
            navigate(`${location.pathname}${location.search}`, { replace: true });
          });
        }}
      >
        {t("action.retry")}
      </Button>
    </div>
  );
}
