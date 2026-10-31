import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark.tsx";
import { useInstanceIdentity } from "@/hooks/useInstanceIdentity.ts";
import { cn } from "@/lib/utils.ts";

/**
 * The mark this instance wears — roadmap 4.19: the operator's logo where one is
 * set, the product's own where it is not, and the product's own again where the
 * address does not load. A logo that 404s must not leave a broken-image glyph
 * in the corner of every screen.
 *
 * Decorative, like `BrandMark`: the name beside it says what it is.
 */
export function InstanceMark({ className }: { className?: string | undefined }) {
  const { logoUrl } = useInstanceIdentity();
  const [failed, setFailed] = useState(false);
  // A new address deserves its own chance, whatever happened to the last one.
  useEffect(() => setFailed(false), [logoUrl]);

  if (logoUrl === null || failed) return <BrandMark {...(className === undefined ? {} : { className })} />;
  return (
    <img
      src={logoUrl}
      alt=""
      data-slot="instance-logo"
      className={cn("shrink-0 object-contain", className)}
      onError={() => setFailed(true)}
    />
  );
}
