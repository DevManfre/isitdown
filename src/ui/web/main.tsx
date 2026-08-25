import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { BusyProvider } from "@/hooks/useBusy.tsx";
import { ThemeProvider } from "@/hooks/useTheme.tsx";
import { RailProvider } from "@/hooks/useRail.tsx";
import { router } from "@/routes.tsx";
import "./css/base.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // The server polls providers every few minutes; a refetch on every mount
      // would add nothing but requests.
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <RailProvider>
            <BusyProvider>
              <RouterProvider router={router} />
            </BusyProvider>
          </RailProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);
