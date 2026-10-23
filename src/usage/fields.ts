/**
 * Every form field kept out of Clarity entirely while the device shares
 * (D214). Clarity sends a short hash of a text field's value when it
 * changes, and a short value (a TDS, a grind setting, a bag's name) is easy
 * to find again from one; it sends nothing of a field one of whose attribute
 * values holds a word such as "secret" (its MaskExcludeList). So every input,
 * textarea and select gets SECRET_FIELD before Clarity sees it: the fields on
 * the page at once, and each one added later by an observer made before
 * Clarity's own, which therefore runs first on every change.
 */
import { SECRET_FIELD } from './mask.ts';

const FIELDS = 'input, textarea, select';
const [ATTRIBUTE, VALUE] = Object.entries(SECRET_FIELD)[0]!;

function mark(field: Element): void {
  if (!field.hasAttribute(ATTRIBUTE)) field.setAttribute(ATTRIBUTE, VALUE);
}

function markWithin(node: Node): void {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  if (element.matches(FIELDS)) mark(element);
  element.querySelectorAll(FIELDS).forEach(mark);
}

/** Mark the document's fields now and as they come; the returned function stops watching. */
export function guardFields(doc: Document): () => void {
  doc.querySelectorAll(FIELDS).forEach(mark);
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(markWithin);
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}
