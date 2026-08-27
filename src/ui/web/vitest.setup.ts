import "@testing-library/jest-dom/vitest";
import { MotionGlobalConfig } from "motion/react";

// `NumberTicker` springs from 0 up to its value, so a test asserting the figure
// an operator reads would otherwise be racing an animation. motion's own switch
// for this is `skipAnimations`, which the ticker treats exactly like the
// reduced-motion preference: paint the target on the first frame. It is set
// here rather than faked per test because every suite wants the settled figure.
MotionGlobalConfig.skipAnimations = true;
