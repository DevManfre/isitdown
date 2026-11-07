import type { RoutingRule } from "@/lib/types.ts";

/** `provider#component`, the target `COMPONENT_SEPARATOR` in `src/core/routing.ts` defines. */
export const componentMuteTarget = (providerId: string, componentId: string): string => `${providerId}#${componentId}`;

/**
 * Silenced means a rule for exactly this component that sends nowhere. A rule
 * for the same target that routes somewhere is the operator's own, and reads as
 * not silenced.
 */
export const isComponentSilenced = (rules: RoutingRule[], target: string): boolean =>
  rules.some((rule) => rule.provider === target && rule.channels.length === 0);

/**
 * The first matching rule decides, so the silence goes first: behind a
 * catch-all it would never be reached. Every class and any severity, because
 * "silence this component" does not mean "silence some of it".
 */
export const withComponentSilenced = (rules: RoutingRule[], target: string): RoutingRule[] =>
  isComponentSilenced(rules, target)
    ? rules
    : [{ provider: target, classes: ["status", "incident", "maintenance", "monitoring"], minSeverity: "any", channels: [] }, ...rules];

/** Drops only the silencing rules for the target, never a rule that routes it. */
export const withoutComponentSilence = (rules: RoutingRule[], target: string): RoutingRule[] =>
  isComponentSilenced(rules, target)
    ? rules.filter((rule) => !(rule.provider === target && rule.channels.length === 0))
    : rules;
