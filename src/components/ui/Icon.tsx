/**
 * Every glyph in the workbench, and the only place icon policy lives.
 *
 * Material Symbols rather than an SVG set because the mockups are drawn
 * with them, and because the font ships in the bundle: this application's
 * users are frequently unable to reach a CDN, which is the reason they
 * have this application.
 *
 * `opsz` follows the rendered size. A variable icon font drawn at 12px
 * with the 24px optical size looks spindly next to the same glyph at
 * 20px, and that inconsistency is the tell that icons were pasted rather
 * than chosen. Weight and fill are set once, in `theme.css`.
 *
 * A glyph is an image of a control, never a label, so it is always
 * `aria-hidden`: the control around it carries the accessible name.
 */
export function Icon({
  name,
  size = 16,
  className,
}: {
  /** A Material Symbols glyph name, e.g. `shield`, `bolt`, `settings`. */
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`material-symbols-outlined shrink-0 leading-none${className ? ` ${className}` : ""}`}
      style={{
        fontSize: size,
        width: size,
        height: size,
        fontVariationSettings: `'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
      }}
    >
      {name}
    </span>
  );
}
