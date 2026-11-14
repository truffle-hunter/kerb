// Export a file: the share sheet where the browser offers one for files, otherwise a download.
import { dev } from './clock.js';

export async function exportFile(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const file = typeof File === 'function' ? new File([blob], name, { type: mime }) : null;
  if (!dev && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}
