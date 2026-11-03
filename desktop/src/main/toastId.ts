// Windows 10 1607 / Server 2016 (the reference machine) rejects toast tags longer than 16 characters
// (WPN_E_TAG_SIZE), and Electron uses the notification id as the tag; its default id is a 36-char UUID.
// Newer Windows allows 64, so a short alphanumeric id works everywhere.
export const TOAST_ID_MAX = 16;

export function toastId(seq: number, now: number = Date.now()): string {
  const id = `m${now.toString(36)}${(seq % 1296).toString(36)}`;
  return id.slice(0, TOAST_ID_MAX);
}
