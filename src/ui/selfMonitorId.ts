/**
 * The instance's own provider row — roadmap 10.6. Shared by the server and the
 * dashboard: the server seeds and polls it, the dashboard keeps it out of the
 * question "has the operator set anything up yet".
 *
 * The row id and the adapter id are the same word on purpose: there is one
 * instance, so there is never a second row to tell apart. Not `isitdown`: that
 * adapter reads *another* instance (roadmap 2.11).
 */
export const SELF_MONITOR_ID = "self";
