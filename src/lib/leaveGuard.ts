/**
 * Whether leaving an unsaved draft has to be confirmed.
 *
 * Three surfaces hold a draft - the Sockets rules and the two Config
 * editors - and several exits can throw one away: the tab bar, and inside
 * Config the list, the kind switch, New and Import. One function answers
 * for all of them, so no exit can quietly discard what another would have
 * asked about.
 */

/** Every surface that owns an unsaved draft. */
export type DraftOwner = "sockets" | "sni-editor" | "tunnel-editor";

/**
 * What an owner tells the shell about its draft. `invalid` is the draft's
 * first validation message, or `null` when it could be saved as it is;
 * `save` persists it and rejects if persisting failed.
 */
export type DraftReport = {
  owner: DraftOwner;
  dirty: boolean;
  invalid: string | null;
  save: () => Promise<void>;
};

export type Leave =
  | { kind: "go" }
  | { kind: "confirm"; owner: DraftOwner; saveBlocked: string | null };

/**
 * `staying` is true when the destination is where the user already is:
 * the current tab pressed again, the selected profile selected again.
 */
export function leaveDecision(draft: DraftReport | null, staying: boolean): Leave {
  if (staying) return { kind: "go" };
  if (!draft || !draft.dirty) return { kind: "go" };
  return { kind: "confirm", owner: draft.owner, saveBlocked: draft.invalid };
}

/**
 * An owner's unmount cleanup. Only its own report is cleared: when one
 * editor unmounts and another mounts in the same commit, the incoming
 * report must survive the outgoing cleanup.
 */
export function clearDraft(current: DraftReport | null, owner: DraftOwner): DraftReport | null {
  return current?.owner === owner ? null : current;
}

/** The leave dialog's description, naming what would be lost. */
export const LEAVE_COPY: Record<DraftOwner, string> = {
  sockets: "The routing rules on this tab have changes that have not been saved.",
  "sni-editor": "This SNI profile has changes that have not been saved.",
  "tunnel-editor": "This tunnel has changes that have not been saved.",
};

/** The sentence the Quit dialog prepends when a draft is dirty. */
export const QUIT_COPY: Record<DraftOwner, string> = {
  sockets: "The routing rules on Sockets have unsaved changes, and quitting discards them.",
  "sni-editor": "An SNI profile has unsaved changes, and quitting discards them.",
  "tunnel-editor": "A tunnel has unsaved changes, and quitting discards them.",
};
