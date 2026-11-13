/**
 * <tb-theme>: lets the viewer choose Auto / Light / Dark.
 *
 * Attributes: value (auto | light | dark, reflected), for (id of the element to theme;
 * default: the document root). Persists the choice to localStorage when it can.
 * Event: tb-theme-change { value, scheme } (bubbles, composed), where scheme is the
 * resolved light | dark after applying.
 */
export const THEMES = ['auto', 'light', 'dark'];
const LABELS = {auto: 'Auto', light: 'Light', dark: 'Dark'};
const STORAGE_KEY = 'tb-theme';

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
    fieldset { display: flex; gap: 0.25em; margin: 0; padding: 0.25em; border: 1px solid var(--tb-border-color, currentColor); border-radius: 999px; }
    legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    label { position: relative; display: inline-flex; padding: 0.25em 0.75em; border-radius: 999px; cursor: pointer; color: var(--tb-font-color, inherit); }
    input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    label:has(input:checked) { background: var(--tb-hover-background, #8884); }
    label:has(input:focus-visible) { outline: 2px solid var(--tb-outline-color, Highlight); outline-offset: 2px; }
  </style>
  <fieldset part="group">
    <legend>Theme</legend>
    ${THEMES.map((t) => `<label part="option"><input type="radio" name="theme" value="${t}" />${LABELS[t]}</label>`).join('')}
  </fieldset>`;

export class ThemeElement extends HTMLElement {
  static observedAttributes = ['value'];

  #media = null;
  #onMedia = () => this.value === 'auto' && this.#notify();

  constructor() {
    super();
    this.attachShadow({mode: 'open'}).append(template.content.cloneNode(true));
    this.shadowRoot.addEventListener('change', this);
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
    return THEMES.includes(v) ? v : 'auto';
  }

  set value(v) {
    this.setAttribute('value', THEMES.includes(v) ? v : 'auto');
  }

  /** Resolved scheme of the target: 'light' | 'dark'. */
  get scheme() {
    return getComputedStyle(this.target).getPropertyValue('--tb-scheme').trim() || 'light';
  }

  connectedCallback() {
    const stored = store.get(this.storageKey);
    if (THEMES.includes(stored)) this.setAttribute('value', stored);
    this.#apply();
    this.#media = matchMedia('(prefers-color-scheme: dark)');
    this.#media.addEventListener('change', this.#onMedia);
  }

  disconnectedCallback() {
    this.#media?.removeEventListener('change', this.#onMedia);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) {
      this.#apply();
      this.#notify();
    }
  }

  handleEvent(event) {
    if (event.type === 'change' && event.target.name === 'theme') {
      store.set(this.storageKey, event.target.value);
      this.value = event.target.value;
    }
  }

  #apply() {
    const value = this.value;
    this.target.setAttribute('data-theme', value);
    for (const input of this.shadowRoot.querySelectorAll('input')) {
      input.checked = input.value === value;
    }
  }

  #notify() {
    this.dispatchEvent(
      new CustomEvent('tb-theme-change', {
        bubbles: true,
        composed: true,
        detail: {value: this.value, scheme: this.scheme},
      })
    );
  }
}

if (!customElements.get('tb-theme')) customElements.define('tb-theme', ThemeElement);
