/**
 * What Clarity must never see (D-USAGE-5), as attributes it obeys
 * (clarity-js, read 2026-10-22). MASK hides an element's text and images,
 * its children's too. Clarity ignores it on a form field. It drops a field
 * entirely (no value, no hash of one) only when one of the field's attribute
 * values holds a word such as "secret" (its MaskExcludeList), so the API key,
 * the pairing code and the composer carry SECRET_FIELD.
 */
export const MASK = { 'data-clarity-mask': 'true' } as const;
export const SECRET_FIELD = { 'data-private': 'secret' } as const;
