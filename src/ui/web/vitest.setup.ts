import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { configure } from "@testing-library/dom";
import { MotionGlobalConfig } from "motion/react";

// Testing Library's own deadline for `findBy*`, separate from Vitest's
// `testTimeout` and far shorter: 1s by default. The paginated views wait on a
// query refetch and a re-render inside that second, which is comfortable alone
// and not comfortable under `npm run coverage`, where v8 instrumentation and 79
// parallel files push a correct render past it. The failures rotated between
// pagination tests and vanished on a re-run, which is what a deadline looks
// like rather than a defect. Raising it weakens nothing: a render that never
// happens still fails the test, it just gets long enough to be sure.
configure({ asyncUtilTimeout: 5_000 });

// `NumberTicker` springs from 0 up to its value, so a test asserting the figure
// an operator reads would otherwise be racing an animation. motion's own switch
// for this is `skipAnimations`, which the ticker treats exactly like the
// reduced-motion preference: paint the target on the first frame. It is set
// here rather than faked per test because every suite wants the settled figure.
MotionGlobalConfig.skipAnimations = true;

// What a view remembers between visits (roadmap 4.16) lives in localStorage, so
// without this a filter chosen in one test is the starting point of the next —
// the order of the tests would be part of what they assert. Cleared here rather
// than in each file because every suite that mounts a view is exposed to it.
afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* a test that blocks storage on purpose has nothing to clear */
  }
});
