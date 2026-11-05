import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * shadcn/ui's Tabs (new-york), on the `radix-ui` package the other primitives
 * already import — no new dependency. Written by hand rather than through the
 * CLI, and edited from upstream in one place, named here so a regeneration
 * knows what it would revert:
 *
 * 1. The list is an underline strip, not upstream's pill segment: the
 *    dashboard's segmented filters already look like pills, and a view's
 *    sub-pages are a different control (dashboard-design-direction). The
 *    current tab is marked by its label colour and a 2px accent rule that
 *    fades in on `--duration-fast`; nothing slides, so arrowing through the
 *    tabs with the keyboard never replays a motion.
 * 2. The panel enters with motion.css's `tab-in` (opacity only, on
 *    `--duration-base`) when it mounts. Radix unmounts the panels that are not
 *    shown, so a chart in a hidden tab is neither drawn nor fetched.
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-6", className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex w-full items-end gap-6 overflow-x-auto border-b border-border [scrollbar-width:none]",
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative -mb-px inline-flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent text-sm font-medium whitespace-nowrap text-muted-foreground outline-none",
        "transition-[color,border-color] duration-(--duration-fast) ease-(--ease-out)",
        "hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        "data-[state=active]:border-primary data-[state=active]:text-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("tab-panel flex flex-col gap-6 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
