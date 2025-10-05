(function (global) {
  'use strict';

  class HighlightEngine {
    constructor(model) {
      this.model = model;
    }

    downstream(startId) {
      if (!startId) {
        return { nodes: new Set(), edges: new Set() };
      }
      const visited = new Set();
      const edgeIds = new Set();
      const queue = [startId];
      const start = performance.now();
      while (queue.length) {
        const nodeId = queue.shift();
        if (visited.has(nodeId)) {
          continue;
        }
        visited.add(nodeId);
        for (const successor of this.model.successors(nodeId)) {
          const edgeId = `${nodeId}->${successor}`;
          edgeIds.add(edgeId);
          if (!visited.has(successor)) {
            queue.push(successor);
          }
        }
      }
      const duration = performance.now() - start;
      return { nodes: visited, edges: edgeIds, duration };
    }
  }

  global.HighlightEngine = HighlightEngine;
})(typeof window !== 'undefined' ? window : globalThis);
