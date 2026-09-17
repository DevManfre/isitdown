import { createHashRouter, Navigate } from "react-router";
import { ROUTE_PATHS } from "../routePaths.ts";
import { App } from "./App.tsx";
import { ViewError } from "./components/ViewError.tsx";
import { DeliveryLog } from "./views/DeliveryLog.tsx";
import { History } from "./views/History.tsx";
import { IncidentDetail } from "./views/IncidentDetail.tsx";
import { Incidents } from "./views/Incidents.tsx";
import { Overview } from "./views/Overview.tsx";
import { ProviderDetail } from "./views/ProviderDetail.tsx";
import { Providers } from "./views/Providers.tsx";
import { Settings } from "./views/Settings.tsx";
import { Wallboard } from "./views/Wallboard.tsx";

export const router = createHashRouter([
  {
    // Roadmap 5.8. A sibling of the shell, not a child of it: the wallboard's
    // whole premise is that there is no rail and no header, and a view nested
    // under `App` renders inside both.
    path: ROUTE_PATHS.wallboard,
    element: <Wallboard />,
    errorElement: <ViewError />,
  },
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
          { path: ROUTE_PATHS.providerDetail, element: <ProviderDetail /> },
          { path: ROUTE_PATHS.incidents, element: <Incidents /> },
          { path: ROUTE_PATHS.incidentDetail, element: <IncidentDetail /> },
          { path: ROUTE_PATHS.history, element: <History /> },
          { path: ROUTE_PATHS.deliveryLog, element: <DeliveryLog /> },
          { path: ROUTE_PATHS.settings, element: <Settings /> },
          { path: ROUTE_PATHS.settingsSection, element: <Settings /> },
        ],
      },
    ],
  },
]);
