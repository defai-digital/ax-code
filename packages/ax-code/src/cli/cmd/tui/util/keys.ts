// Key names that confirm a dialog or menu selection. Terminals variously
// report the Enter key as "return", "linefeed" (ctrl+j), or "kpenter" (numpad
// Enter) — accept all three anywhere a confirm key is handled so behavior
// doesn't depend on how the terminal encodes the key.
export const CONFIRM_KEYS: ReadonlySet<string> = new Set(["return", "linefeed", "kpenter"])
