/**
 * Single source of truth for the product's own name (SSOT).
 *
 * Every surface that shows or states the brand reads it from here, so a rename
 * is one edit: window title, tray/dialog titles, About screen, API `service`
 * value, MCP server name, auth realm, installer text.
 *
 * `dataDir` is deliberately NOT the pretty name: it is the folder under
 * %APPDATA% / %LOCALAPPDATA% that already holds a live store, backups, logs and
 * saved logins. Renaming it would make an installed app look empty, so the
 * value stays "MuseStudio" and only the brand changed.
 */
export const BRAND = {
  /** Wire identifier, lower case: API `service`, MCP server name, Bearer realm. */
  id: "muse4ai",
  /** Product name as people and agents read it. */
  name: "Muse4AI",
  /** Sub-title: says what it is and that Muse is the service it drives. */
  tagline: "AI agent bridge — works with Muse",
  /** Vietnamese form of the tagline, for the About screen. */
  taglineVi: "Cầu nối AI agent — dùng được với Muse",
  /** Folder name holding the store/backups/logs. Keep as-is: renaming strands data. */
  dataDir: "MuseStudio",
} as const;
