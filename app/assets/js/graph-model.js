(function (global) {
  'use strict';

  class GraphModel {
    constructor(graph) {
      this.nodes = graph.nodes;
      this.edges = graph.edges;
      this.meta = graph.meta ?? {};
      this.adjacency = this.#buildAdjacency();
      this.cycles = this.#detectCycles();
      if (this.cycles.length) {
        if (!Array.isArray(this.meta.warnings)) {
          this.meta.warnings = [];
        }
        for (const cycle of this.cycles) {
          const message = `Cycle detected: ${cycle.join(' -> ')}`;
          if (!this.meta.warnings.some((warning) => warning.message === message)) {
            this.meta.warnings.push({ message, nodes: cycle });
          }
        }
      }
    }

    #buildAdjacency() {
      const map = new Map();
      for (const node of this.nodes) {
        map.set(node.id, new Set());
      }
      for (const edge of this.edges) {
        if (!map.has(edge.source)) {
          map.set(edge.source, new Set());
        }
        if (!map.has(edge.target)) {
          map.set(edge.target, new Set());
        }
        map.get(edge.source).add(edge.target);
      }
      return map;
    }

    #detectCycles() {
      const visited = new Set();
      const stack = new Set();
      const path = [];
      const seen = new Set();
      const cycles = [];

      const dfs = (nodeId) => {
        visited.add(nodeId);
        stack.add(nodeId);
        path.push(nodeId);
        const successors = this.adjacency.get(nodeId) ?? new Set();
        for (const successor of successors) {
          if (!visited.has(successor)) {
            dfs(successor);
          } else if (stack.has(successor)) {
            const index = path.indexOf(successor);
            if (index !== -1) {
              const cyclePath = [...path.slice(index), successor];
              const key = cyclePath.join('->');
              if (!seen.has(key)) {
                seen.add(key);
                cycles.push(cyclePath);
              }
            }
          }
        }
        stack.delete(nodeId);
        path.pop();
      };

      for (const node of this.adjacency.keys()) {
        if (!visited.has(node)) {
          dfs(node);
        }
      }

      return cycles;
    }

    successors(nodeId) {
      return Array.from(this.adjacency.get(nodeId) ?? []);
    }

    findNode(nodeId) {
      return this.nodes.find((node) => node.id === nodeId) ?? null;
    }

    toJSON() {
      return {
        nodes: this.nodes,
        edges: this.edges,
        meta: this.meta,
      };
    }
  }

  global.GraphModel = GraphModel;
})(typeof window !== 'undefined' ? window : globalThis);
