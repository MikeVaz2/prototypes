/**
 * <tb-space>: lets the viewer make a page (or one element) smaller or larger.
 * Text and spacing scale together through the relative space model (space.css).
 *
 * Attributes: value (a level, reflected; default medium), for (id of the element to
 * size; default the document root). Persists the choice to localStorage when it can.
 * Event: tb-space-change { value, fontSize } (bubbles, composed), fontSize in px.
 */
export const LEVELS = ['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large'];
const DEFAULT = 'medium';
const STORAGE_KEY = 'tb-space';
const LABELS = {
  'xx-small': 'XX-Small', 'x-small': 'X-Small', small: 'Small', medium: 'Medium',
  large: 'Large', 'x-large': 'X-Large', 'xx-large': 'XX-Large', 'xxx-large': 'XXX-Large',
};
const label = (level) => LABELS[level];

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  },
};

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: inline-block; }
    :host([hidden]) { display: none; }
    [part='group'] { display: inline-flex; align-items: center; gap: 0.25em; padding: 0.25em; border: 1px solid var(--tb-border-color, currentColor); border-radius: 999px; }
    button { font: inherit; color: var(--tb-font-color, inherit); background: transparent; border: 0; border-radius: 999px; padding: 0.25em 0.75em; cursor: pointer; }
    button:hover:not(:disabled) { background: var(--tb-hover-background, #8884); }
    button:focus-visible { outline: 2px solid var(--tb-outline-color, Highlight); outline-offset: 2px; }
    button:disabled { opacity: 0.4; cursor: default; }
    output { min-width: 6em; text-align: center; }
  </style>
  <div part="group" role="group" aria-label="Text size">
    <button part="decrease" type="button" data-step="-1" aria-label="Smaller">A&minus;</button>
    <output part="value" aria-live="polite"></output>
    <button part="increase" type="button" data-step="1" aria-label="Larger">A+</button>
  </div>`;

export class SpaceElement extends HTMLElement {
  static observedAttributes = ['value'];

  constructor() {
    super();
    this.attachShadow({mode: 'open'}).append(template.content.cloneNode(true));
    this.shadowRoot.addEventListener('click', this);
  }

  get target() {
    const id = this.getAttribute('for');
    return (id && document.getElementById(id)) || document.documentElement;
  }

  get storageKey() {
    const id = this.getAttribute('for');
    return id ? `${STORAGE_KEY}:${id}` : STORAGE_KEY;
  }

  get value() {
    const v = this.getAttribute('value');
    return LEVELS.includes(v) ? v : DEFAULT;
  }

  set value(v) {
    this.setAttribute('value', LEVELS.includes(v) ? v : DEFAULT);
  }

  /** Computed font size of the target in px. */
  get fontSize() {
    return parseFloat(getComputedStyle(this.target).fontSize);
  }

  /** Move n levels (negative = smaller), clamped to the ends. */
  step(n) {
    const i = Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(this.value) + n));
    this.value = LEVELS[i];
  }

  connectedCallback() {
    const stored = store.get(this.storageKey);
    if (LEVELS.includes(stored)) this.setAttribute('value', stored);
    this.#apply();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) {
      this.#apply();
      this.dispatchEvent(
        new CustomEvent('tb-space-change', {
          bubbles: true,
          composed: true,
          detail: {value: this.value, fontSize: this.fontSize},
        })
      );
    }
  }

  handleEvent(event) {
    const button = event.target.closest?.('button[data-step]');
    if (event.type === 'click' && button && !button.disabled) {
      this.step(Number(button.dataset.step));
      store.set(this.storageKey, this.value);
    }
  }

  #apply() {
    const value = this.value;
    this.target.setAttribute('data-space', value);
    const i = LEVELS.indexOf(value);
    this.shadowRoot.querySelector('output').textContent = label(value);
    this.shadowRoot.querySelector('[data-step="-1"]').disabled = i === 0;
    this.shadowRoot.querySelector('[data-step="1"]').disabled = i === LEVELS.length - 1;
  }
}

if (!customElements.get('tb-space')) customElements.define('tb-space', SpaceElement);
