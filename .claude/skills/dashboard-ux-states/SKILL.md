---
name: dashboard-ux-states
description: Use when building or changing any dashboard view, card, list, table or form under src/ui/web — and when reviewing one. Enforces the four states every data surface needs (loading, empty, error, populated), first-run onboarding, safe destructive actions, and form feedback. Also use when a view "looks empty", "flashes", or a user can lose work.
---

# Dashboard UX states

A view is not done when the populated case looks right. Each surface that
reads data or takes input has to handle every state below. Check them in this
order before you call a UI change finished.

## 1. Loading is not empty

`hooks/useViewReady.ts` shows the view after 1.5 s even when data has not
arrived. A `data ?? []` fallback then shows the *empty* state ("No providers
configured yet", "all 0 operational") to an operator who has twenty
providers. That is a lie, not a loading state.

- Branch on TanStack Query's `isPending` **before** the `?? []` fallback.
- While pending, render `components/ui/skeleton.tsx` shaped like the final
  layout: tile skeletons for stat tiles, 3–5 row skeletons for lists and
  tables. Don't use a spinner on a whole view.
- Hero numbers and summaries never render from fallback data. Show a
  skeleton or `—`, never `0`.
- Keep the skeleton the same size as the content, so the layout doesn't jump
  when the data lands.

## 2. Empty states give the next action

An empty state answers "why is this empty, and what do I do?":

- **Zero configured** (no providers or channels): show a card with one
  sentence and a primary `Button` that opens the dialog that fixes it
  (e.g. ServiceDialog). Muted text alone is a dead end for a first-run
  operator.
- **Filtered to nothing**: name the filter and offer to clear it. DeliveryLog
  (`views/DeliveryLog.tsx`) is the reference.
- **Nothing happened yet** (no incidents in the window): this is good news.
  Say so in a positive tone. Don't make it look like an error.

## 3. Errors

Every routed view already has a `ViewError` with Retry from `routes.tsx`. Don't
add a second one. A card with its own query (GeoCard, IncidentMap) handles
its own error inline with `role="alert"` and a retry, so one failing card
doesn't blank the whole view.

## 4. Destructive and lossy actions

| Action | Required |
|---|---|
| Delete something the operator configured (service, rule, channel) | a confirm `Dialog` like `RemoveServiceDialog`, or an undo toast through `SettingsToasts` |
| Overwrite state (restore a backup, import) | a confirm `Dialog`, never `window.confirm` |
| Close a dialog that holds a dirty form (Escape, outside click, ✕) | guard `onOpenChange`: if dirty, ask "Discard changes?" first |

Autosaving settings rows don't need an unsaved-changes guard. Dialog forms do.

## 5. Form feedback

- Validate a field on blur, not only on submit. While the error stays, set
  `aria-invalid` and point `aria-describedby` at the message.
- The form-level error message has `role="alert"`, so screen readers announce it.
- Disable the submit button only while the request is in flight. Show the
  reason when it's blocked; don't just grey it out.
- After a successful save, confirm with a toast or an inline ✓. A silent
  success makes the operator wonder whether it worked.

## 6. Copy

Every string goes through `t()` (see `i18n-strings`). That includes strings
inside payloads the operator will see, such as dry-run or test messages.
Keyboard hints depend on the platform: show `⌘K` on macOS and `Ctrl K` on
everything else.

## Checklist before reporting done

- [ ] Throttle the network in devtools (or delay the fetch). The skeleton
      shows, never the empty state.
- [ ] Load with zero providers. There is a button that leads somewhere.
- [ ] Stop the API. ViewError appears with Retry.
- [ ] Every delete or overwrite asks first, or can be undone.
- [ ] Press Escape on a half-filled dialog. You are asked before the input is lost.
- [ ] `test:visual` frames you agreed were reviewed as images (CLAUDE.md).
