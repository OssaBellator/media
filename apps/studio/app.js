import { installStudioAgentReviewBridge } from './agent-review-bridge.js';
import { installStudioCreativeObjectRestyleBridge } from './creative-object-restyle-bridge.js';
import { installStudioSemanticSearchBridge } from './semantic-search-bridge.js';

installStudioAgentReviewBridge();
installStudioSemanticSearchBridge();
installStudioCreativeObjectRestyleBridge();
await import('./studio-runtime.js');
