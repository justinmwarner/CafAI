/**
 * Whether Decent's video is open on the Care screen (D156). While it is, a
 * drink starting leaves the screen where it is, as it does while the barista
 * types (useDrinkFocus.ts): the barista is following the video, often doing
 * the very step it shows (a flush, the wand's rinse), and the switch would
 * close the video and lose its place. CareScreen.tsx sets it while its player
 * is open; nothing else does.
 */
let open = false;

export function setCareVideoOpen(value: boolean): void {
  open = value;
}

export function isCareVideoOpen(): boolean {
  return open;
}
