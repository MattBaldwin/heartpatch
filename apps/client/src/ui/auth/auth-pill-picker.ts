import { el } from '../dom.js';

// Big pill choices over a form `<select>` (controls audit): the select stays
// the field's value, so validation and the submitted value don't change. The
// pills are radios, so VoiceOver reads "2014, radio button, 4 of 8" and the
// arrow keys move between them.

/** The first birth year we offer as a pill is this many years back (age 10). */
const YOUNGEST_PILL_AGE = 10; // TUNE: the game is for ages 10–17
const OLDEST_PILL_AGE = 17;

/** Birth-year pill values for `thisYear`, newest first: ages 10–17. */
export function birthYearPills(thisYear: number): string[] {
  const years: string[] = [];
  for (let age = YOUNGEST_PILL_AGE; age <= OLDEST_PILL_AGE; age++) years.push(String(thisYear - age));
  return years;
}

/**
 * Pill radios for `values` of `select`, plus a pill that opens the whole list
 * for everyone else. Picking a pill sets the select; setting the select (a
 * test, autofill, the opened list) lights the matching pill.
 */
export function pillPicker(
  select: HTMLSelectElement,
  labelId: string,
  values: string[],
  moreLabel: string,
): HTMLElement {
  const group = el('div', { class: 'auth-pills', role: 'radiogroup', 'aria-labelledby': labelId });
  const radios = values.map((value) => {
    const radio = el('input', {
      type: 'radio',
      name: `${select.id}-pick`,
      value,
      class: 'auth-pill-input',
    });
    radio.addEventListener('change', () => {
      select.value = value;
    });
    group.append(
      el('label', { class: 'auth-pill' }, radio, el('span', { class: 'auth-pill-face' }, value)),
    );
    return radio;
  });
  const more = el('button', { type: 'button', class: 'auth-pill auth-pill-more' }, moreLabel);

  /** The whole list, for a year no pill covers. */
  const openList = () => {
    select.classList.remove('auth-pill-select-tucked');
    select.removeAttribute('aria-hidden');
    select.tabIndex = 0;
    more.hidden = true;
  };
  const sync = () => {
    for (const radio of radios) radio.checked = radio.value === select.value;
    if (select.value && !values.includes(select.value)) openList();
  };

  // Tucked away rather than hidden: still the form's control and still found
  // by its label, but the pills are what a player (and VoiceOver) meet.
  select.classList.add('auth-pill-select-tucked');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  select.addEventListener('change', sync);
  more.addEventListener('click', () => {
    openList();
    select.focus();
  });
  group.append(more, select);
  return group;
}
