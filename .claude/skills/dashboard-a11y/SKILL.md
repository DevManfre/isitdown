---
name: dashboard-a11y
description: Use when adding or changing any interactive element, status indicator, chart, dialog or form in src/ui/web, or when asked about accessibility, keyboard navigation, screen readers or contrast. Captures this dashboard's a11y conventions and the gaps found in past audits.
---

# Dashboard accessibility

The dashboard is a status monitor. If an operator can't perceive a status,
the dashboard has failed at its one job. Every rule here is in service of
that.

## Status is never colour alone

- A status dot is a `StatusDot` with a `label` (it renders `role="img"`). If
  you draw a coloured span by hand, you've made a bug.
- Dense grids (fleet dots, heatmap cells) need the name and status
  reachable without a mouse. Make each cell a focusable `Link` or button with
  `aria-label="{name}: {status}"`. Don't use a `<span>` as a HoverCard
  trigger.
- A `title` attribute is not an accessible name, and keyboards can't reach it.

## Charts need a text equivalent

Every chart wrapper gets `role="img"` and an `aria-label` that states the
*conclusion* (e.g. "99.92% uptime over 30 days, 2 incidents"), not "chart".
For a grid-shaped chart (the 168-cell heatmap), add an sr-only summary or
table. The colours come from `lib/chartConfig.ts` (CLAUDE.md), and they
must stay distinguishable in both themes.

## Interactive elements

- Clickable means `<button>` or `<Link>`. An `onClick` on a `div` or `span` is a bug.
- Icon-only buttons are `Button size="icon"` with an `aria-label` from `t()`.
- Toggles and segmented controls use `ui/toggle-group.tsx`. Don't hand-roll
  `aria-pressed` buttons.
- Don't remove an outline unless a wrapper restores the ring with
  `focus-within` (see `NumberSetting`). The global `:focus-visible` fallback
  lives in `css/base.css`; don't fight it.

## Dialogs, drawers, palettes

Use Radix `Dialog` or `Sheet` from `components/ui/`, which handle focus
trapping, Escape and focus return. When a dialog closes, focus goes back to
whatever opened it. If you unmount the trigger, choose a sensible new target.

## Forms

- Every input gets a `Label htmlFor`. A placeholder doesn't count as a label.
- An invalid field gets `aria-invalid` and `aria-describedby` pointing at the error.
- A form-level error gets `role="alert"`.
- A required field gets `required` or `aria-required`.

## Motion and live data

- Any new animation must be honoured by the `prefers-reduced-motion` block
  in `css/motion.css`.
- Polling updates must not steal focus or scroll position.
- A status change worth announcing (e.g. one provider goes down) uses a
  polite live region. A full re-render doesn't.

## Verify

- Tab through the changed view with no mouse. Every action can be reached,
  and focus is always visible.
- Check in Vitest with Testing Library role queries
  (`getByRole('button', { name })`). If the query can't find the element, a
  screen reader can't either. That makes this a test of behaviour, in line
  with `testing-discipline`.
- Look at both themes' frames from `test:visual`, and check the contrast of
  any new token.
