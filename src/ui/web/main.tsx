import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { createQueryClient } from "@/lib/queryClient.ts";
import { BusyProvider } from "@/hooks/useBusy.tsx";
import { ThemeProvider } from "@/hooks/useTheme.tsx";
import { router } from "@/routes.tsx";
import "./css/base.css";

const client = createQueryClient();

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <BusyProvider>
            <RouterProvider router={router} />
          </BusyProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);
