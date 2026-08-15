import { installStudioAgentReviewBridge } from './agent-review-bridge.js';
import { installStudioSemanticSearchBridge } from './semantic-search-bridge.js';

installStudioAgentReviewBridge();
installStudioSemanticSearchBridge();
await import('./studio-runtime.js');
