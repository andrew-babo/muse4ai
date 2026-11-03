// Parsers for Windows display preferences read with `reg query` (cheap, no native module, no PowerShell).

/** HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize /v EnableTransparency → true unless 0. */
export function parseTransparency(regOutput: string): boolean {
  const m = /EnableTransparency\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(regOutput);
  return m ? parseInt(m[1], 16) !== 0 : true;
}

/**
 * HKCU\Control Panel\Desktop /v UserPreferencesMask → true when Windows "Show animations in Windows" is off.
 * That switch (SPI_SETCLIENTAREAANIMATION) is byte 4, bit 0x02 of the mask (measured on the reference
 * Windows Server 2016 VPS). Chromium's prefers-reduced-motion does not follow it there, so the app reads it.
 */
export function parseReducedMotion(regOutput: string): boolean {
  const m = /UserPreferencesMask\s+REG_BINARY\s+([0-9a-f]+)/i.exec(regOutput);
  if (!m || m[1].length < 10) return false;
  const byte4 = parseInt(m[1].slice(8, 10), 16);
  return (byte4 & 0x02) === 0;
}
