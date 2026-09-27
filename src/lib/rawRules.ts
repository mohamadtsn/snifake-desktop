/**
 * The `routing.raw` escape hatch, validated the way the generator reads it.
 *
 * `tunnel/generate.rs` does:
 *
 *     let arr = raw.as_array().ok_or("Raw rules must be a JSON array of
 *                                     rule objects.")?;
 *     rules.extend(arr.iter().cloned());
 *
 * so the value is an **array of rule objects** that is appended to the
 * generated rule list - not an object merged into the routing block. Getting
 * this backwards is worse than not checking at all: the editor would refuse
 * the only shape that works and accept one that saves cleanly and then makes
 * every tunnel start fail, with the reason surfacing from the privileged
 * process a screen away from the box that caused it.
 *
 * Duplicated in TypeScript on the same terms as `rules.ts`: the editor has
 * to answer per keystroke, and Rust re-checks at generation time.
 */
export interface RawRules {
  /** `null` means "no raw block", which is a valid, and the usual, state. */
  value: unknown[] | null;
  error: string | null;
}

export function parseRawRules(text: string): RawRules {
  if (text.trim() === "") return { value: null, error: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { value: null, error: `Not valid JSON: ${(e as Error).message}` };
  }

  if (!Array.isArray(parsed)) {
    return {
      value: null,
      error: "Raw rules must be a JSON array of rule objects, for example [{ … }].",
    };
  }

  const bad = parsed.findIndex(
    (rule) => typeof rule !== "object" || rule === null || Array.isArray(rule),
  );
  if (bad !== -1) {
    return { value: null, error: `Entry ${bad + 1} is not a rule object.` };
  }

  return { value: parsed, error: null };
}
