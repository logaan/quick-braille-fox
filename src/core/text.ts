// Tiny string helpers shared across core and UI.

/** Length of the longest common prefix of two strings. */
export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/** Uppercase the first character, leaving the rest untouched. */
export function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : (s[0] as string).toUpperCase() + s.slice(1);
}
