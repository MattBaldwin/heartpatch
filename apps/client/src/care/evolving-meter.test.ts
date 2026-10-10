import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARE_TEXT, evolvingBar } from './care-view.js';
import { evolvingMeterEl } from './evolving-meter.js';

/** A stand-in element: just what `el` and the meter touch. */
class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attrs = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly classes = new Set<string>();
  readonly classList = {
    toggle: (name: string, on: boolean) => {
      if (on) this.classes.add(name);
      else this.classes.delete(name);
    },
  };
  hidden = false;
  textContent = '';
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
    if (name === 'class') for (const c of value.split(' ')) this.classes.add(c);
  }
  append(...nodes: (FakeElement | string)[]) {
    for (const node of nodes) if (typeof node !== 'string') this.children.push(node);
  }
  /** The first descendant with `cls`. */
  find(cls: string): FakeElement {
    const queue = [...this.children];
    for (let node = queue.shift(); node; node = queue.shift()) {
      if (node.classes.has(cls)) return node;
      queue.push(...node.children);
    }
    throw new Error(`no .${cls}`);
  }
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function meter() {
  const m = evolvingMeterEl('evolving-test');
  const root = m.root as unknown as FakeElement;
  const line = root.find('evolving-line');
  return {
    update: (...args: Parameters<typeof m.update>) => {
      m.update(...args);
    },
    root,
    label: line.children[0] as FakeElement,
    value: line.children[1] as FakeElement,
    fill: root.find('evolving-fill'),
    gain: root.find('evolving-gain'),
    sub: root.find('evolving-sub'),
  };
}

describe('evolvingMeterEl update()', () => {
  it('starts hidden and hides again with no bar', () => {
    const m = meter();
    expect(m.root.hidden).toBe(true);
    m.update(evolvingBar(40));
    expect(m.root.hidden).toBe(false);
    m.update(null);
    expect(m.root.hidden).toBe(true);
  });

  it('shows the label, percent and fill, with no stripe or sub-line', () => {
    const m = meter();
    m.update(evolvingBar(62));
    expect(m.root.attrs.get('data-testid')).toBe('evolving-test');
    expect(m.label.textContent).toBe(CARE_TEXT.evolving);
    expect(m.value.textContent).toBe('62%');
    expect(m.fill.style['width']).toBe('62%');
    expect(m.gain.hidden).toBe(true);
    expect(m.sub.hidden).toBe(true);
    expect(m.root.classes.has('evolving-ready')).toBe(false);
  });

  it('stripes the gain from `gainedFrom` up to the fill', () => {
    const m = meter();
    m.update(evolvingBar(70), { gainedFrom: 0.45 });
    expect(m.fill.style['width']).toBe('45%');
    expect(m.gain.style['left']).toBe('45%');
    expect(m.gain.style['width']).toBe('25%');
    expect(m.gain.hidden).toBe(false);
  });

  it('never stripes past the fill', () => {
    const m = meter();
    m.update(evolvingBar(30), { gainedFrom: 0.8 });
    expect(m.fill.style['width']).toBe('30%');
    expect(m.gain.hidden).toBe(true);
  });

  it('turns ready with its sub-line, and the caller can replace or drop it', () => {
    const m = meter();
    m.update(evolvingBar(100));
    expect(m.root.classes.has('evolving-ready')).toBe(true);
    expect(m.label.textContent).toBe(CARE_TEXT.readyToEvolve);
    expect(m.value.textContent).toBe('');
    expect(m.sub.textContent).toBe(CARE_TEXT.evolvesNextXp);
    expect(m.sub.hidden).toBe(false);

    m.update(evolvingBar(100), { sub: CARE_TEXT.evolvingGain(20) });
    expect(m.sub.textContent).toBe(CARE_TEXT.evolvingGain(20));
    m.update(evolvingBar(100), { sub: null });
    expect(m.sub.hidden).toBe(true);

    // Back below ready: the ready look goes.
    m.update(evolvingBar(10));
    expect(m.root.classes.has('evolving-ready')).toBe(false);
    expect(m.sub.hidden).toBe(true);
  });
});
