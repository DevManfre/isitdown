import { z } from "zod";

/**
 * Settings validation shared by the channels whose whole configuration is a
 * URL. Stated once so three channels cannot end up rejecting three different
 * sets of malformed values, and so the error names the field an operator sees
 * in `config.yml` or in the dashboard.
 */
export function httpUrlSetting(field: string, channel: string): z.ZodType<string> {
  return z
    .string()
    .min(1, `${field} is required for the ${channel} channel`)
    .refine(
      (value) => {
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          return false;
        }
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      },
      { message: `${field} must be an http or https URL for the ${channel} channel` },
    );
}
