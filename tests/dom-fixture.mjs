// Minimal DOM for behavior tests, using native EventTarget for dispatch.
// Set currentTarget around each listener to model browser event semantics,
// including its reset before an async listener resumes after await.
export class Element extends EventTarget {
  constructor(tag = 'text', text = '') {
    super();
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.selected = false;
    this._text = text;
    this.pending = [];
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        const add = enabled ?? !classes.has(name);
        if (add) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
    for (const type of ['click', 'input', 'change', 'blur', 'keydown']) {
      this.addEventListener(type, (event) => this[`on${type}`]?.(event));
    }
  }

  addEventListener(type, listener, options) {
    super.addEventListener(type, (event) => {
      Object.defineProperty(event, 'currentTarget', { configurable: true, value: this });
      try {
        const result = listener(event);
        if (result?.then) this.pending.push(result);
      } catch (error) {
        this.pending.push(Promise.reject(error));
      } finally {
        Object.defineProperty(event, 'currentTarget', { configurable: true, value: null });
      }
    }, options);
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
      if (this.tagName === 'select' && (node.selected || this.children.length === 1)) {
        this.value = node.value;
      }
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
      this.parentNode = null;
    }
  }

  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name] ?? null; }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = value; }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((value) => value.trim());
    return walk(this).slice(1).filter((node) => selectors.some((value) =>
      value.startsWith('.') ? node.classList.contains(value.slice(1))
        : value.startsWith('#') ? node.id === value.slice(1) : node.tagName === value));
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  async fire(type, props = {}) {
    if (this.disabled && type === 'click') return;
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, props);
    this.dispatchEvent(event);
    await Promise.all(this.pending.splice(0));
    await settle();
  }
}

export const walk = (node) => [node, ...node.children.flatMap(walk)];
export const find = (node, predicate) => walk(node).find(predicate);
export const button = (node, text) => find(node, (child) =>
  child.tagName === 'button' && child.textContent === text);
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export function installDOM() {
  const events = new EventTarget();
  globalThis.Node = Element;
  globalThis.document = {
    body: new Element('body'),
    createElement: (tag) => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    createTextNode: (text) => new Element('text', String(text)),
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
    getElementById: (id) => find(document.body, (node) => node.id === id),
  };
}
