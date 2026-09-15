import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion, type Variants } from "motion/react"

import { cn } from "@/lib/utils"

/**
 * React Bits' Stepper (reactbits.dev/components/stepper), reduced to the part
 * this dashboard needs. Upstream is a whole wizard — it owns the step state,
 * the card around the panels, the sliding content and the Back/Continue
 * footer. The service dialog already owns all four, so a regeneration of the
 * full component would fight it. What is kept is the chrome: the animated
 * indicators and the connector that fills as a step completes. The departures
 * from upstream:
 *
 * 1. Controlled. `currentStep` is a prop, there is no internal `useState`,
 *    and there is no content or footer — the caller renders those.
 * 2. Every colour is a theme token. Upstream hardcodes `#5227FF`, `#222`,
 *    `#a3a3a3`, `bg-neutral-600` and `text-black`, which are off-palette in
 *    both themes and would fail test/ui/theme.test.ts.
 * 3. Each step carries a translated `label`, rendered beside its circle, and
 *    the row is an `<ol>` with `aria-current="step"`. Upstream draws bare
 *    circles with nothing for a screen reader to read.
 * 4. Reduced motion collapses every transition to zero, as elsewhere in the
 *    dashboard.
 * 5. `StepPanel` keeps upstream's `StepContentWrapper` — the measured, animated
 *    height that carries the panel from one step's size to the next — but not
 *    its `AnimatePresence` slide: the dialog already slides its steps in CSS
 *    (`.anim-step` in motion.css). It also measures with a `ResizeObserver`
 *    rather than only on a re-render, because a panel can change size without
 *    one: the advanced disclosure opens over 200ms, and a validation message
 *    arrives from a request.
 */

export interface StepperStep {
  /** Already translated — this component never resolves a key itself. */
  label: string
}

export function Stepper({
  steps,
  currentStep,
  onStepClick,
  className,
}: {
  steps: StepperStep[]
  currentStep: number
  /** Omit to make the indicators inert; upstream's `disableStepIndicators`. */
  onStepClick?: ((step: number) => void) | undefined
  className?: string
}) {
  return (
    <ol className={cn("flex w-full items-center", className)}>
      {steps.map((entry, index) => {
        const step = index + 1
        const status = currentStep === step ? "active" : currentStep < step ? "inactive" : "complete"
        return (
          <Fragment key={step}>
            <li className="flex shrink-0 items-center gap-2">
              <StepIndicator
                step={step}
                label={entry.label}
                status={status}
                onClick={onStepClick && status !== "active" ? () => onStepClick(step) : undefined}
              />
              <span
                aria-current={status === "active" ? "step" : undefined}
                className={
                  status === "active" ? "text-xs font-medium" : "text-xs font-medium text-muted-foreground"
                }
              >
                {entry.label}
              </span>
            </li>
            {index < steps.length - 1 && <StepConnector isComplete={currentStep > step} />}
          </Fragment>
        )
      })}
    </ol>
  )
}

type StepStatus = "inactive" | "active" | "complete"

function StepIndicator({
  step,
  label,
  status,
  onClick,
}: {
  step: number
  label: string
  status: StepStatus
  onClick?: (() => void) | undefined
}) {
  const reduce = useReducedMotion()
  const circle: Variants = {
    inactive: { scale: 1, backgroundColor: "var(--muted)", color: "var(--muted-foreground)" },
    active: { scale: 1, backgroundColor: "var(--primary)", color: "var(--primary-foreground)" },
    complete: { scale: 1, backgroundColor: "var(--primary)", color: "var(--primary-foreground)" },
  }

  return (
    <motion.button
      type="button"
      // Inert unless it can move the wizard: a circle that does nothing is a
      // picture, and the step is already named beside it.
      aria-hidden={onClick ? undefined : true}
      aria-label={onClick ? label : undefined}
      disabled={!onClick}
      onClick={onClick}
      className={onClick ? "relative cursor-pointer outline-none" : "relative outline-none"}
      animate={status}
      initial={false}
    >
      <motion.span
        variants={circle}
        transition={{ duration: reduce ? 0 : 0.3 }}
        className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold"
      >
        {status === "complete" ? (
          <CheckMark reduce={reduce} />
        ) : status === "active" ? (
          <span className="size-2 rounded-full bg-primary-foreground" />
        ) : (
          step
        )}
      </motion.span>
    </motion.button>
  )
}

function StepConnector({ isComplete }: { isComplete: boolean }) {
  const reduce = useReducedMotion()
  const line: Variants = {
    incomplete: { width: 0 },
    complete: { width: "100%" },
  }

  return (
    <li aria-hidden className="relative mx-2.5 h-px flex-1 overflow-hidden bg-border">
      <motion.span
        className="absolute top-0 left-0 block h-full bg-primary"
        variants={line}
        initial={false}
        animate={isComplete ? "complete" : "incomplete"}
        transition={{ duration: reduce ? 0 : 0.4 }}
      />
    </li>
  )
}

function CheckMark({ reduce }: { reduce: boolean | null }) {
  return (
    <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.1, type: "tween", ease: "easeOut", duration: reduce ? 0 : 0.3 }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  )
}

/**
 * The height animation of the panel these steps sit above. Its child is taken
 * out of flow and measured, and the box around it animates to that height, so
 * a step swap or a disclosure opening resizes the dialog over `duration`
 * instead of jumping.
 */
export function StepPanel({
  children,
  className,
  duration = 1,
}: {
  children: ReactNode
  className?: string
  /** Seconds. */
  duration?: number
}) {
  const reduce = useReducedMotion()
  const content = useRef<HTMLDivElement | null>(null)
  // `undefined` until the first measurement: the box is `height: auto` for one
  // paint, so a runtime with no ResizeObserver — or a first frame before the
  // observer reports — shows the panel at its real size rather than at zero.
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const node = content.current
    if (node === null || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight))
    observer.observe(node)
    setHeight(node.offsetHeight)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      // Clipped while it moves: a shrinking box would otherwise spill its old
      // content over the footer for the length of the animation.
      className={cn("relative overflow-hidden", className)}
      initial={false}
      animate={{ height: height ?? "auto" }}
      transition={{ duration: reduce ? 0 : duration, ease: [0.22, 1, 0.36, 1] }}
    >
      <div ref={content} className="absolute inset-x-0 top-0">
        {children}
      </div>
    </motion.div>
  )
}
