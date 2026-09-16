import { useEffect, useState, type ComponentPropsWithoutRef } from "react"
import { MotionGlobalConfig, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

interface TypingAnimationProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  /** The finished sentence. It is typed one grapheme at a time, never looped. */
  text: string
  /** Milliseconds between two graphemes. */
  speed?: number
  /** Milliseconds to wait before the first grapheme. */
  delay?: number
}

/**
 * Magic UI's typing animation (magicui.design/docs/components/typing-animation),
 * cut down to the one shape this dashboard uses. What upstream carries and
 * this file does not: the word carousel (`words`, delete/retype phases,
 * `loop`, `pauseDelay`), the `as` element map and the `startOnView` observer.
 * The headline it serves is a single sentence, rendered at the top of the
 * view, so none of that machinery has a caller here and all of it is state to
 * keep correct. The deliberate departures:
 *
 * 1. The whole sentence is painted on the first frame whenever motion is
 *    switched off — the operator's reduced-motion preference, or motion's own
 *    `MotionGlobalConfig.skipAnimations`. Same rule as `NumberTicker`: a
 *    flourish never withholds the words themselves, and the visual harness
 *    renders with reduced motion forced, so a baseline shows the settled line.
 * 2. `aria-label` carries the finished sentence and the typed text is hidden
 *    from the accessibility tree, so a screen reader hears the headline once
 *    instead of one announcement per character.
 * 3. Upstream's `leading-20 tracking-[-0.02em]` default is gone: this renders
 *    inside a heading that already sets its own leading and tracking.
 * 4. The text keeps its space as it types (`grid` with the finished sentence
 *    laid out invisibly underneath), so the block below the headline does not
 *    ride up and settle while the line fills in.
 */
export function TypingAnimation({ text, speed = 45, delay = 0, className, ...props }: TypingAnimationProps) {
  const still = useReducedMotion() === true || MotionGlobalConfig.skipAnimations === true
  const graphemes = Array.from(text)
  const [typed, setTyped] = useState(0)

  useEffect(() => {
    setTyped(0)
  }, [text])

  useEffect(() => {
    if (still || typed >= graphemes.length) {
      return
    }
    const timer = setTimeout(() => {
      setTyped((count) => count + 1)
    }, typed === 0 ? delay + speed : speed)
    return () => {
      clearTimeout(timer)
    }
  }, [still, typed, graphemes.length, speed, delay])

  const done = still || typed >= graphemes.length

  return (
    <span aria-label={text} className={cn("grid", className)} {...props}>
      {/* The finished sentence, reserving the room the typed one will need.
          It is dropped the moment the last grapheme lands, so a settled
          headline is one text node and not the sentence twice over. */}
      {!done && (
        <span aria-hidden="true" className="invisible col-start-1 row-start-1">
          {text}
        </span>
      )}
      <span aria-hidden="true" className="col-start-1 row-start-1">
        {done ? text : graphemes.slice(0, typed).join("")}
        {!done && <span className="typing-caret">|</span>}
      </span>
    </span>
  )
}
