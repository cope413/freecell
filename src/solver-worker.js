// Web Worker: runs the solver off the main thread.
import { solve } from './solver.js';

self.onmessage = (e) => {
  const { id, state, maxNodes } = e.data;
  const t0 = Date.now();
  let result;
  try {
    result = solve(state, { maxNodes: maxNodes || 300000 });
  } catch (err) {
    result = { solved: false, exhausted: false, nodes: 0, error: String(err) };
  }
  self.postMessage({ id, ...result, ms: Date.now() - t0 });
};
