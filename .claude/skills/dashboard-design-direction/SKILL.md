---
name: dashboard-design-direction
description: Use before building, changing or reviewing anything visual under src/ui/web — a view, card, table, form, dialog, chart, header, spacing, typography, colour use, or any animation/transition/motion. Encodes the agreed direction for the dashboard (calm and airy, one job per view, hide-don't-delete, functional and precise motion) as concrete numbers, so new work starts there instead of being corrected later. Also use when something "looks cramped", "busy", "over-engineered", or "the animation feels off".
---

# Dashboard design direction

Agreed with the operator on 2026-11-05 after an audit found the dashboard
cramped (gap-1.5/gap-2 everywhere, `text-xs` 325 times, hand-written 9–11.5px
sizes) and over-built (Overview with seven blocks, History with eleven
sections, cards and a table repeating the same data on Providers, 37
keyframes plus decorative Magic UI effects). The direction has three parts:

1. **Calm and airy.** Linear/Vercel register: room to breathe, one accent,
   colour reserved for status.
2. **Hide, don't delete.** Each view does one job. Secondary features move
   behind tabs, a disclosure or a menu. They are never removed without the
   operator agreeing to it explicitly.
3. **Functional, precise motion.** Animate only what changes state. Nothing
   moves for decoration.

The Overview and shell prototype in `design/claude-design-prototypes/` is
the visual reference once it exists. Where it and this file disagree, the
prototype wins and this file gets updated in the same pass.

## Layout and spacing

Use the Tailwind 4px grid only. No arbitrary `[…px]` spacing, and no
`--space-*` token that isn't a multiple of 4.

| Relationship | Spacing |
|---|---|
| Between page sections | `gap-8` (32px), `gap-10` on wide views |
| Card padding | `p-5` / `p-6` (never below `p-4`) |
| Between items in a group (rows, fields, tiles) | `gap-3` / `gap-4` |
| Label and its control, title and its subtitle | `gap-1.5` / `gap-2` |
| Icon and its text, badge and its label | `gap-1.5` |
| Table row height | ≥ 44px (`py-3`) |
| Mobile side gutter | 16px, single column, tap targets ≥ 44px |

`gap-1`/`gap-0.5` are only for pieces that read as a single glyph (a dot and
its count). If two things have different jobs and sit closer than 8px, they
are too close.

## Typography

- **Floor is 12px.** `text-xs` is for metadata only (timestamps, counts,
  captions). Never write `text-[9px]`/`text-[10px]`/`text-[11px]`. The
  `design-guard` hook refuses them.
- **Body, table cells, form labels and buttons use `text-sm` (14px).**
  Section headings are `text-base font-medium`. The page title is `text-xl`
  or `text-2xl`. A hero figure may go larger. Use four sizes per view at most.
- **Section headings are sentence case.** Don't use the uppercase, letter-spaced
  "eyebrow" label above every block. Allow at most one per view, and only when
  it carries information the heading doesn't.
- **Mono is for data, not labels.** Numbers (`tabular-nums`), timestamps,
  URLs, IDs and code use mono. Prose, labels, status names and buttons use sans.
- **Skip the explanatory sentence under a heading** when the content explains
  itself. When one is needed, write one line in `text-sm text-muted-foreground`.

## Surfaces and colour

- **Use one level of card.** Don't put a card inside a card. A section inside
  a card is separated by spacing or a single `Separator`, not by a new border.
- **Give a surface one of border, background tint or shadow, not all three.**
- **Keep one accent colour, for the primary action and the current selection.**
  Status colours (operational/degraded/outage/maintenance) appear only where
  they mean status, and never alone (see `dashboard-a11y`).
- **No decorative background patterns, glows, gradients or illustrations** on
  working surfaces. The hero may keep one subtle status tint.

## One job per view

Before adding a block, name the question the view answers. If the block
doesn't answer it, it goes behind disclosure:

| View | The one question | Lives behind disclosure |
|---|---|---|
| Overview | Is anything down right now, and what? | "While you were away", maintenance calendar, map, customise/arrange |
| Providers | How is each provider doing? | One representation (the list), not cards plus a table |
| Incidents | What broke and is it over? | Timeline chart, notifications sent |
| History | How reliable were they over time? | Tabs per question (trend / reliability / patterns / latency), plus markers |
| Delivery log | Did my alerts get out? | Channel filter as a `Select`, not 31 chips |
| Settings | Change one thing | No illustrated index cards, no side-note cards |

Mechanisms, in order of preference: `Tabs` (peer sub-views), a `Collapsible`
section remembered per operator, a `DropdownMenu` item (actions), a route
(something that deserves a URL). A hidden feature stays reachable in at most
two clicks and from the command palette.

**Controls:**
- One primary `Button` per view. Everything else is `outline` or `ghost`.
- A segmented filter has 5 options at most. Past that, use a `Select` or a combobox.
- Use the primitives at their stock sizes. Don't shrink them with `h-7` or
  `text-[11px]` overrides to make a row fit. Make the row simpler instead.

## Motion

Only state changes animate: something enters, leaves, expands, collapses, is
pressed, changes view, or changes status. **Nothing animates ambiently.** No
typing headlines, border beams, spotlights, drifting dot patterns, breathing
idle states, or numbers ticking up on first paint. Two exceptions are
allowed, because they signal something:

- the continuous pulse on an *active* problem (an open incident's dot, the
  Overview beacon on warn or danger);
- the one-shot ring (`data-pulse`, 1.2s) on a tile whose status just changed.

The three `--duration-*` tokens are introduced in `tokens.css` by phase 0
of the redesign. Until they exist, use the same values literally inside
`motion.css` only.

| Token | Value | Use |
|---|---|---|
| `--duration-fast` | 120ms | hover, press, colour, toggle thumb |
| `--duration-base` | 200ms | tooltip, popover, menu, accordion, row enter |
| `--duration-slow` | 280ms | dialog, sheet, view change |
| `--ease-out` | existing | every entry and every state transition |
| `--ease-entry` | existing | view and dialog entry only |

Nothing runs longer than 300ms, apart from the two exceptions above and
the guided tour's glide between anchors. An exit takes about 75% of its
entry's duration.

- **Animate only `transform` and `opacity`.** The exception is accordion
  height through Radix's `--radix-*-content-height`. Don't animate `width`,
  `top`, `margin` or `box-shadow` on large surfaces (see `animation-performance`).
- **Keep travel small.** Translate 8px at most. Scale starts at `0.96`, never
  `0`. A popover grows from its trigger (`transform-origin` from Radix).
- **Make it interruptible.** Toggles and hovers use CSS `transition`, so they
  reverse mid-flight. Use `@keyframes` only for mount and unmount.
- **Stagger once.** Only on a view's first paint, 30ms step, 6 items at most,
  under 200ms in total. A refetch or poll never replays an entrance, and
  neither does a chart's grow-in.
- **Hover effects go inside `@media (hover: hover)`.** Use press feedback
  (`scale(0.97)`) on buttons only, not on rows or cards.
- **Keyboard-repeated actions don't animate.** That covers command palette
  arrow navigation, tab key focus and shortcut toggles.
- **Respect `prefers-reduced-motion: reduce`.** Drop every translate and scale,
  and keep opacity fades at 150ms or less.
- **Keep one motion system.** Use `css/motion.css` plus the tokens above. A
  new keyframe needs a state change to justify it, written in its comment.
  `motion/react` is already used for what CSS cannot do: drag-reorder and
  layout animation in edit mode (`widgets/edit/`, `DashboardGrid`,
  `FleetOrderDialog`) and the `NumberTicker` spring. Keep it there. Don't
  import it into a new file. The `design-guard` hook refuses it unless the
  file already imports it.
- **Stagger is clamped centrally.** `lib/stagger.ts` caps the step at 30ms
  and the total delay at 200ms, whatever a call site asks for.
- **Numbers never count up on first paint.** `NumberTicker` paints the real
  figure, then counts only when the value changes.

## Charts

- Each chart gets a card with a one-line conclusion above it (see `dashboard-a11y`).
- Use 3 horizontal gridlines at most and no vertical ones. Axis text is
  `text-xs` muted. Keep the legend only when there are 2 or more series.
- No gradient area fill, or at most a single 10%-opacity tint.
- The chart grows in through the `motion.css` wrapper on first paint only,
  with `--duration-base`. Recharts' own animation stays off
  (`isAnimationActive={false}`, see `shadcn-components` § Charts), so a
  refetch never redraws it.

## Checklist before reporting done

- [ ] No `text-[<12px]`, no arbitrary spacing, no card inside a card.
- [ ] The view's one question is answered above the fold. Secondary blocks
      are behind disclosure and still reachable.
- [ ] Every animation is tied to a state change, ≤ 300ms, transform/opacity,
      and gone or reduced under `prefers-reduced-motion`.
- [ ] Wait through a poll cycle on the view. Nothing re-animates.
- [ ] Desktop and 390px screenshots read with the Read tool, both themes.
