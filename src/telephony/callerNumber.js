// Is the caller's number usable to call them back?
//
// Withheld caller IDs reach Twilio as non-numeric values ("anonymous", "Restricted"...)
// or, with some carriers, as +266696687 ("ANONYMOUS" on a phone keypad). Only a plain
// E.164 number counts as callable.

const WITHHELD_PLACEHOLDERS = new Set(['+266696687']);

export function isCallableNumber(number) {
  if (typeof number !== 'string') return false;
  return /^\+[1-9]\d{6,14}$/.test(number) && !WITHHELD_PLACEHOLDERS.has(number);
}
