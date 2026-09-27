/**
 * Motion values shared between components, on the same reasoning
 * `theme.css` keeps its easing and duration tokens in one place: two
 * hand-typed copies of one curve are two curves that have not drifted yet.
 *
 * CSS-driven motion stays in `theme.css`. This file is only for values a
 * `motion/react` component needs as JavaScript.
 */

/**
 * One spring for every layout move in the drawers, so a row entering, a row
 * leaving and the list closing a gap all move with the same physical
 * vocabulary. A spring rather than a curve because these get interrupted:
 * deleting two profiles quickly must not queue two 300ms tweens.
 */
export const LIST_SPRING = { type: "spring", stiffness: 520, damping: 42, mass: 1 } as const;

/**
 * The toggle thumb and the segmented thumb. Stiffer and lighter than
 * `LIST_SPRING` because the travel is 16px, not a whole row: at list
 * stiffness a switch feels like it is dragging something heavy.
 *
 * A spring, again, because these get interrupted - a user flicking a switch
 * twice must not watch two tweens queue.
 */
export const THUMB_SPRING = {
  type: "spring",
  stiffness: 700,
  damping: 40,
  mass: 0.6,
} as const;

/**
 * Tab changes and the modal sheet's arrival. A tween, not a spring: these
 * are cross-fades with a small scale, and a spring's overshoot on opacity
 * reads as a flicker.
 */
export const PANEL_TWEEN = {
  type: "tween",
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
} as const;
