export { attachCDP, getPageMetrics, type Metrics } from './metrics.js';
export {
  heapHalves,
  soak,
  type SoakOptions,
  type SoakResult,
  type SoakSample,
} from './soak.js';
export { calibrateTypingCost, type TypingGesture } from './typing.js';
export { expectNoLeak, type LeakThresholds } from './assert.js';
export { formatSoak } from './format.js';
