/**
 * The two decisions behind the dashboard's 30-second poll of `/status`, kept
 * out of app.js so they can be exercised without a browser.
 *
 * Most ticks find nothing new — the server polls providers every few minutes —
 * so the shell compares a fingerprint of what it renders and repaints only
 * when that actually changed, and never while the operator is mid-interaction.
 */

/**
 * A fingerprint of everything the shell renders. Two equal snapshots mean a
 * repaint would rebuild the same DOM, so it can be skipped entirely.
 *
 * @param {unknown} status the `/status` payload
 * @param {unknown} config the `/config` payload
 * @returns {string}
 */
export function snapshot(status, config) {
  return JSON.stringify([status ?? null, config ?? null]);
}

/**
 * Whether an automatic refresh should leave the page alone this tick. A hidden
 * tab has nothing to show, and a repaint under an open dialog or a focused
 * field would throw away what the operator is in the middle of typing.
 *
 * @param {{ hidden: boolean, dialogOpen: boolean, editing: boolean }} page
 * @returns {boolean}
 */
export function shouldHoldRefresh(page) {
  return page.hidden || page.dialogOpen || page.editing;
}
