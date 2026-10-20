import type { z } from "zod";

/** A zod failure as the one-line message every config route answers a 400 with. */
export const issues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
