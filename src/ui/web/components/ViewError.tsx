import { useRouteError } from "react-router";
import { useTranslation } from "react-i18next";

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
 */
export function ViewError() {
  const { t } = useTranslation();
  const error = useRouteError();
  return <p className="text-muted-foreground">{t("error.load-failed", { error: errorMessage(error) })}</p>;
}
