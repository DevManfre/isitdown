// First, before anything that reads storage or the network — see isolate.ts.
import { serveFixtures } from "./isolate.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CatalogIndex } from "./CatalogIndex.tsx";
import { CATALOG_MARKER } from "./marker.ts";
import { StoryFrame } from "./StoryFrame.tsx";
import { stories } from "./stories.tsx";
import "../css/base.css";

const root = document.getElementById("root");
if (root === null) throw new Error("#root is missing from index.html");
document.documentElement.dataset.catalog = CATALOG_MARKER;

const params = new URLSearchParams(location.search);
const id = params.get("story");
const story = id === null ? undefined : stories().find((entry) => entry.id === id);

if (story !== undefined) {
  serveFixtures(story.fixtures ?? {});
  for (const [key, value] of Object.entries(story.storage ?? {})) localStorage.setItem(key, value);
  // The index sizes each frame to its story rather than guessing a height.
  new ResizeObserver(() => {
    window.parent.postMessage({ catalog: location.search, height: document.documentElement.scrollHeight }, location.origin);
  }).observe(document.body);
  createRoot(root).render(
    <StrictMode>
      <StoryFrame story={story} />
    </StrictMode>,
  );
} else if (params.has("list")) {
  // What the visual harness reads to know which stories exist, stamped the way
  // a view stamps itself ready (see ViewFrame) so the harness's wait applies.
  createRoot(root).render(
    <div id="view" data-animate="list">
      <pre id="story-ids">{JSON.stringify(stories().map((story) => story.id))}</pre>
    </div>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <CatalogIndex stories={stories()} missing={id} />
    </StrictMode>,
  );
}
