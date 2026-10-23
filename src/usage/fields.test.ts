// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { guardFields } from './fields.ts';

/** MutationObserver callbacks run as a microtask after the change. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('guardFields (D214)', () => {
  it('marks every field on the page, and each one added later, nested ones included', async () => {
    document.body.innerHTML = '<input id="tds"><textarea id="other"></textarea><select id="grinder"></select><p id="text">Kiambu</p>';
    const stop = guardFields(document);
    for (const id of ['tds', 'other', 'grinder']) expect(document.getElementById(id), id).toHaveAttribute('data-private', 'secret');
    expect(document.getElementById('text')).not.toHaveAttribute('data-private');

    const card = document.createElement('section');
    card.innerHTML = '<label>Roaster <input id="roaster"></label>';
    document.body.appendChild(card);
    const field = document.createElement('input');
    document.body.appendChild(field);
    await settle();
    expect(document.getElementById('roaster')).toHaveAttribute('data-private', 'secret');
    expect(field).toHaveAttribute('data-private', 'secret');
    stop();
  });

  it('leaves a field that already says what it is alone, and stops watching when told', async () => {
    document.body.innerHTML = '<input id="own" data-private="password">';
    const stop = guardFields(document);
    expect(document.getElementById('own')).toHaveAttribute('data-private', 'password');
    stop();
    const later = document.createElement('input');
    document.body.appendChild(later);
    await settle();
    expect(later).not.toHaveAttribute('data-private');
  });
});
