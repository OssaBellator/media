import {
  createCollaborationResolutionDraft,
  finalizeCollaborationResolutionIntent,
} from '../../packages/core/src/collaboration-resolution-decisions.js';
import {
  applyCollaborationResolutionDecision,
  renderCollaborationResolutionDecisionPanel,
} from './collaboration-resolution-view.js';

function clone(value) { return structuredClone(value); }

export class CollaborationResolutionSession {
  #model;
  #draft;
  #onFinalize;
  #closed = false;

  constructor({ model, onFinalize = async () => {} } = {}) {
    if (!model || model.schema !== 'media.collaboration-resolution.v1' || model.status !== 'conflict') {
      throw new Error('Collaboration resolution session requires a conflict model');
    }
    if (typeof onFinalize !== 'function') throw new Error('Collaboration resolution onFinalize must be a function');
    this.#model = clone(model);
    this.#draft = createCollaborationResolutionDraft(this.#model);
    this.#onFinalize = onFinalize;
  }

  #assertOpen() {
    if (this.#closed) throw new Error('Collaboration resolution session is closed');
  }

  snapshot() {
    return { model: clone(this.#model), draft: clone(this.#draft), closed: this.#closed };
  }

  render() {
    this.#assertOpen();
    return renderCollaborationResolutionDecisionPanel({ model: this.#model, draft: this.#draft });
  }

  choose(groupId, choice) {
    this.#assertOpen();
    this.#draft = applyCollaborationResolutionDecision(this.#draft, { groupId, choice });
    return this.snapshot();
  }

  async finalize() {
    this.#assertOpen();
    const intent = finalizeCollaborationResolutionIntent(this.#draft);
    await this.#onFinalize(clone(intent));
    return clone(intent);
  }

  close() {
    this.#closed = true;
  }
}
