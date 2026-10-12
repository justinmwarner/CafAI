/**
 * Getting the export out of the tablet. Downloads often do nothing inside
 * Decaid's WebView, so both helpers report success instead of throwing and
 * the screen can fall back to showing the JSON for copying.
 */

export function exportFileName(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `cafai-export-${yyyy}-${mm}-${dd}.json`;
}

/** Saves `text` as a file through a temporary `a[download]`. False when the browser refused. */
export function downloadText(fileName: string, text: string, mimeType = 'application/json'): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking at once can cancel the download in Chromium; give it a moment.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies text to the clipboard. `navigator.clipboard` only exists on secure
 * origins, and a skin opened over the LAN (http://<tablet-ip>) is not one,
 * so fall back to the older select-and-copy command. Inside a dialog, pass
 * an element of it as `container`: a dialog keeps focus to itself, and a text
 * area outside it would lose its selection before the copy.
 */
export async function copyText(text: string, container?: HTMLElement): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or not focused: try the fallback below.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  (container ?? document.body).appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
