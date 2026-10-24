/**
 * The pause card's Open Settings brings the usage card into view on the
 * Coach page (D240, spec section 4's links): the card asks when it is tapped,
 * and Settings > Coach > Usage and cost takes the ask when it mounts, as Care's
 * "Set it in Settings" does (src/ui/care/careReveal.ts). A reload or a visit
 * by another way brings nothing into view.
 */
let asked = false;

/** Open Settings was tapped on the pause card. */
export function requestUsageReveal(): void {
  asked = true;
}

/** True once, for the usage card that shows after that tap. */
export function takeUsageReveal(): boolean {
  const was = asked;
  asked = false;
  return was;
}
