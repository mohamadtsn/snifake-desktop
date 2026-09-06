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
