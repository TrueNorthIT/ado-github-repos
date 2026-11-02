// Dark or light, worked out from the host theme. The SDK (applyTheme) writes the ADO theme into CSS custom properties
// on :root, notably --background-color as an "r, g, b" triplet, and fires "themeApplied" on window whenever it changes.
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDarkTheme(): boolean {
  const triplet = getComputedStyle(document.documentElement).getPropertyValue("--background-color");
  let rgb = triplet.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);
  // Fallback: what the page actually paints. A transparent background says nothing, so that counts as light.
  if (!rgb || rgb.length < 3) {
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number);
    rgb = bg && bg.length >= 3 && (bg.length === 3 || bg[3] > 0) ? bg.slice(0, 3) : undefined;
  }
  return !!rgb && rgb.length === 3 && luminance(rgb) < 0.5;
}

/** Calls cb with the new value now and whenever the host re-applies its theme. Returns an unsubscribe. */
export function watchTheme(cb: (dark: boolean) => void): () => void {
  const on = () => cb(isDarkTheme());
  window.addEventListener("themeApplied", on);
  on();
  return () => window.removeEventListener("themeApplied", on);
}
