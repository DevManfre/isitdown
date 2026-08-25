import { createHashRouter, Navigate } from "react-router";
import { ROUTE_PATHS } from "../routePaths.ts";
import { App } from "./App.tsx";
import { ViewError } from "./components/ViewError.tsx";
import { Overview } from "./views/Overview.tsx";
import { Providers } from "./views/Providers.tsx";

/** Replaced view by view in the porting tasks, and gone before Task 14's guard. */
const Placeholder = ({ name }: { name: string }) => <p data-testid={`view-${name}`}>{name}</p>;

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    // Belt and suspenders: Rail and Header (both off-limits to this task)
    // call `useStatus()` themselves for their own poll/rail chrome. When
    // `/status` is the query that fails, *their* call throws too — as a
    // sibling of the `<Outlet/>` matched below, not a descendant of it, so
    // it escapes the nested `errorElement` and would otherwise hit React
    // Router's raw "Unexpected Application Error!" screen with the rail
    // gone too. This root boundary at least renders translated copy instead
    // of a raw stack trace; it does not keep the rail standing for that
    // specific case. See the task report for the full explanation.
    errorElement: <ViewError />,
    children: [
      { index: true, element: <Navigate to={ROUTE_PATHS.overview} replace /> },
      {
        // Pathless layout route: no `path`/`element` of its own, so it
        // defaults to rendering its matched child straight through. Its only
        // job is to scope `errorElement` to the `<Outlet/>` slot in App.tsx
        // — a failed initial load replaces just the view, not the rail or
        // header one level up.
        errorElement: <ViewError />,
        children: [
          { path: ROUTE_PATHS.overview, element: <Overview /> },
          { path: ROUTE_PATHS.providers, element: <Providers /> },
          { path: ROUTE_PATHS.incidents, element: <Placeholder name="incidents" /> },
          { path: ROUTE_PATHS.incidentDetail, element: <Placeholder name="incident" /> },
          { path: ROUTE_PATHS.history, element: <Placeholder name="history" /> },
          { path: ROUTE_PATHS.settings, element: <Placeholder name="settings" /> },
        ],
      },
    ],
  },
]);
