/**
 * Whether an automatic refresh should leave the page alone this tick. A hidden
 * tab has nothing to show, and a repaint under an open dialog or a focused
 * field would throw away what the operator is in the middle of typing.
 */
export function shouldHoldRefresh(page: {
  hidden: boolean;
  dialogOpen: boolean;
  editing: boolean;
}): boolean {
  return page.hidden || page.dialogOpen || page.editing;
}
