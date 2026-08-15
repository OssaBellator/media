import { CollaborationResolutionSession } from './collaboration-resolution-session.js';

export class CollaborationResolutionController {
  #container;
  #session;
  #onError;
  #listener;
  #mounted = false;
  #tail = Promise.resolve();

  constructor({ container, session, onError = () => {} } = {}) {
    if (!container || typeof container.addEventListener !== 'function' || typeof container.removeEventListener !== 'function') {
      throw new Error('Collaboration resolution controller requires a DOM-like container');
    }
    if (!(session instanceof CollaborationResolutionSession)) {
      throw new Error('Collaboration resolution controller requires CollaborationResolutionSession');
    }
    if (typeof onError !== 'function') throw new Error('Collaboration resolution onError must be a function');
    this.#container = container;
    this.#session = session;
    this.#onError = onError;
    this.#listener = (event) => {
      this.handleClick(event?.target).catch((error) => this.#onError(error));
    };
  }

  snapshot() { return { mounted: this.#mounted, session: this.#session.snapshot() }; }

  render() {
    if (!this.#mounted) throw new Error('Collaboration resolution controller is not mounted');
    this.#container.innerHTML = this.#session.render();
    return this.#container.innerHTML;
  }

  mount() {
    if (this.#mounted) return this.render();
    this.#mounted = true;
    this.#container.addEventListener('click', this.#listener);
    return this.render();
  }

  unmount() {
    if (!this.#mounted) return;
    this.#container.removeEventListener('click', this.#listener);
    this.#mounted = false;
  }

  handleClick(target) {
    const run = this.#tail.then(async () => {
      if (!this.#mounted) throw new Error('Collaboration resolution controller is not mounted');
      const decision = target?.closest?.('[data-collaboration-decision]');
      if (decision) {
        this.#session.choose(decision.dataset.resolutionGroupId, decision.dataset.collaborationDecision);
        return { type: 'decision', snapshot: this.#session.snapshot(), html: this.render() };
      }
      const finalize = target?.closest?.('[data-collaboration-resolution-finalize]');
      if (finalize) {
        if (finalize.disabled) return { type: 'blocked', snapshot: this.#session.snapshot() };
        const intent = await this.#session.finalize();
        return { type: 'finalized', intent, snapshot: this.#session.snapshot() };
      }
      return { type: 'ignored', snapshot: this.#session.snapshot() };
    });
    this.#tail = run.catch(() => {});
    return run;
  }
}
