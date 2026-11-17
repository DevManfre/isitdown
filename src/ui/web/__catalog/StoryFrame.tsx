import { createElement, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { createHashRouter, RouterProvider } from "react-router";
import i18n from "@/lib/i18n.ts";
import { createQueryClient } from "@/lib/queryClient.ts";
import { ViewError } from "@/components/ViewError.tsx";
import { ViewFrame } from "@/components/ViewFrame.tsx";
import { BusyProvider } from "@/hooks/useBusy.tsx";
import { ThemeProvider } from "@/hooks/useTheme.tsx";
import type { Story } from "./stories.tsx";

/**
 * One story, under the providers every real route sits under — the same set
 * `test/harness.tsx` mounts — and a one-route router whose `errorElement` is
 * the view's own, so a component whose first load fails shows exactly what
 * the dashboard would show.
 *
 * Inside `ViewFrame`, so the story is held until its first reads come back and
 * then stamps `#view[data-animate]`: the readiness signal the visual harness
 * already waits for on every view. The retry is off for the same reason the
 * test harness turns it off — an error story must reach its boundary now, not
 * after a backoff.
 */
export function StoryFrame({ story }: { story: Story }) {
  const [client] = useState(() => createQueryClient({ retry: false }));
  const [router] = useState(() =>
    createHashRouter([
      {
        path: "*",
        element: (
          <ViewFrame view={story.id}>
            <div data-story={story.id} style={story.width === undefined ? undefined : { maxWidth: story.width }}>
              {createElement(story.component, story.props)}
            </div>
          </ViewFrame>
        ),
        errorElement: (
          <ViewFrame view={story.id}>
            <ViewError />
          </ViewFrame>
        ),
      },
    ]),
  );

  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <BusyProvider>
            <main>
              <RouterProvider router={router} />
            </main>
          </BusyProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
