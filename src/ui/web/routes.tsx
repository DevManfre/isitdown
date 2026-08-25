import { createHashRouter, Navigate } from "react-router";
import { ROUTE_PATHS } from "../routePaths.ts";
import { App } from "./App.tsx";

/** Replaced view by view in the porting tasks, and gone before Task 14's guard. */
const Placeholder = ({ name }: { name: string }) => <p data-testid={`view-${name}`}>{name}</p>;

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to={ROUTE_PATHS.overview} replace /> },
      { path: ROUTE_PATHS.overview, element: <Placeholder name="overview" /> },
      { path: ROUTE_PATHS.providers, element: <Placeholder name="providers" /> },
      { path: ROUTE_PATHS.incidents, element: <Placeholder name="incidents" /> },
      { path: ROUTE_PATHS.incidentDetail, element: <Placeholder name="incident" /> },
      { path: ROUTE_PATHS.history, element: <Placeholder name="history" /> },
      { path: ROUTE_PATHS.settings, element: <Placeholder name="settings" /> },
    ],
  },
]);
