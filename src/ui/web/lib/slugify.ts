/**
 * Turn a human service name into the id the engine keys everything on.
 *
 * The shape is not cosmetic: `config.schema.ts` validates a service id against
 * `/^[a-z0-9][a-z0-9-]*$/`, so a slug an operator would type by hand (spaces,
 * accents, an underscore, a trailing dash) is a rejected write. Deriving it
 * here means the dialog can only ever send a value that schema accepts —
 * dashes, never underscores, whatever the name looks like.
 *
 * Returns an empty string for a name with nothing sluggable in it (empty,
 * whitespace, punctuation only); the caller treats that like an empty field.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
