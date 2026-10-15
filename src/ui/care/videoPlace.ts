/**
 * Whether YouTube's player may be put on CafAI's page, and how links to
 * outside pages open (D154).
 *
 * Decaid's navigation guard (`classifySkinNavigation`, Decaid's
 * lib/src/skin_feature/skin_view.dart) sends every http(s) page outside the
 * skin's own to the system browser, a frame's included, wherever the WebView
 * asks it about frames: on Windows (tried with Decaid 0.8.8: the frame stayed
 * empty and YouTube opened in the browser), and on iOS and macOS, whose
 * WKWebView asks too. Android's WebView never asks about a frame's http(s)
 * loads, so there, as in any browser, the player plays in place.
 */
import type { HostEnvironment } from '../../api/types.ts';

export function videoPlaysInPlace(host: Pick<HostEnvironment, 'insideDecaid' | 'platform'>): boolean {
  return !host.insideDecaid || host.platform === 'android';
}

/**
 * Inside Decaid a plain link, which Decaid opens in the system browser (as
 * On Visualizer, D121); in a browser a new tab, so CafAI stays open.
 */
export function outsideLinkProps(host: Pick<HostEnvironment, 'insideDecaid'>): { target?: '_blank'; rel?: string } {
  return host.insideDecaid ? {} : { target: '_blank', rel: 'noopener noreferrer' };
}
