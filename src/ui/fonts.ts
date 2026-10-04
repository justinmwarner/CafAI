/**
 * Self-hosted Roboto, latin subset, in the three weights the theme uses, plus
 * the few arrows CafAI prints from the symbols subset (fetched only when one is
 * on screen). Decaid skins run offline from localhost, so no font comes from a
 * CDN; the other subsets would only add bytes to every skin update.
 *
 * Import this once from the entry point (side effects only).
 */
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-700.css';
import './fonts-symbols.css';
