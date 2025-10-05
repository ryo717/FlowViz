(function (global) {
  'use strict';

  const ORIENTATION_PATTERN = /^(graph|flowchart)\s+(TB|TD|BT|RL|LR)?/i;
  const EDGE_PATTERN = /^(?<lhs>[A-Za-z0-9_\-]+)\s*(?<edge>-->|--|==>|==|-.->|===>)\s*(?<label>\|[^|]+\|)?\s*(?<rhs>[A-Za-z0-9_\-]+)(?<decor>.*)$/;
  const NODE_PATTERN = /^(?<id>[A-Za-z0-9_\-]+)(?<shape>\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|>[^<]*<)?$/;

  class FlowMDParser {
    constructor(options = {}) {
      this.maxNodes = options.maxNodes ?? 1000;
      this.preferredMaxNodes = options.preferredMaxNodes ?? 300;
    }

    parse(text) {
      if (typeof text !== 'string') {
        throw new FlowMDError('FlowMD source must be a string');
      }

      const lines = text.split(/\r?\n/);
      const ctx = {
        orientation: 'TB',
        nodes: new Map(),
        edges: [],
        groups: new Map(),
        logs: [],
        warnings: [],
        errors: [],
        currentGroup: null,
        line: 0,
      };

      for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        ctx.line = index + 1;
        const line = rawLine.trim();
        if (!line || line.startsWith('%%')) {
          continue;
        }

        if (!ctx.orientationParsed) {
          this.#parseHeader(line, ctx);
          continue;
        }

        if (/^subgraph\s+/i.test(line)) {
          ctx.currentGroup = this.#parseSubgraph(line, ctx);
          continue;
        }

        if (/^end$/i.test(line)) {
          ctx.currentGroup = null;
          continue;
        }

        if (this.#parseEdge(line, ctx)) {
          continue;
        }

        if (this.#parseNode(line, ctx)) {
          continue;
        }

        ctx.warnings.push(this.#makeWarning('Unrecognised statement', ctx));
      }

      const nodeArray = Array.from(ctx.nodes.values());
      const groups = {};
      for (const [name, nodesOfGroup] of ctx.groups.entries()) {
        groups[name] = Array.from(nodesOfGroup);
      }

      const meta = {
        orientation: ctx.orientation,
        preferredMaxNodes: this.preferredMaxNodes,
        maxNodes: this.maxNodes,
        warnings: ctx.warnings,
        logs: ctx.logs,
        groups,
        degrade: nodeArray.length > this.preferredMaxNodes,
        overflow: nodeArray.length > this.maxNodes,
      };

      if (meta.overflow) {
        throw new FlowMDError(`Node count ${nodeArray.length} exceeds hard limit ${this.maxNodes}`);
      }

      return {
        nodes: nodeArray,
        edges: ctx.edges,
        meta,
      };
    }

    #parseHeader(line, ctx) {
      const match = ORIENTATION_PATTERN.exec(line);
      if (!match) {
        throw new FlowMDError('FlowMD must start with graph/flowchart declaration', ctx.line);
      }
      ctx.orientationParsed = true;
      ctx.orientation = (match[2] || 'TB').toUpperCase();
      ctx.logs.push({ type: 'orientation', value: ctx.orientation, line: ctx.line });
    }

    #parseSubgraph(line, ctx) {
      const [, nameRaw] = line.split(/\s+/, 2);
      const name = nameRaw?.trim();
      if (!name) {
        ctx.warnings.push(this.#makeWarning('Empty subgraph name', ctx));
        return null;
      }
      if (!ctx.groups.has(name)) {
        ctx.groups.set(name, new Set());
      }
      return name;
    }

    #parseEdge(line, ctx) {
      const match = EDGE_PATTERN.exec(line);
      if (!match) {
        return false;
      }
      const { lhs, rhs, label } = match.groups;
      const edgeLabel = label ? label.slice(1, -1).trim() : '';
      const source = this.#ensureNode(lhs, ctx, { line: ctx.line });
      const target = this.#ensureNode(rhs, ctx, { line: ctx.line });
      ctx.edges.push({
        id: `${source.id}->${target.id}`,
        source: source.id,
        target: target.id,
        label: edgeLabel,
        line: ctx.line,
      });
      return true;
    }

    #parseNode(line, ctx) {
      const match = NODE_PATTERN.exec(line);
      if (!match) {
        return false;
      }
      const { id, shape } = match.groups;
      const node = this.#ensureNode(id, ctx, { line: ctx.line, shape });
      if (ctx.currentGroup) {
        ctx.groups.get(ctx.currentGroup)?.add(node.id);
      }
      return true;
    }

    #ensureNode(id, ctx, extra = {}) {
      if (!ctx.nodes.has(id)) {
        const label = extra.shape ? extra.shape.slice(1, -1).trim() : id;
        ctx.nodes.set(id, {
          id,
          label: label || id,
          shape: extra.shape ? extra.shape[0] : '[]',
          line: extra.line ?? ctx.line,
          group: ctx.currentGroup,
        });
      } else if (extra.shape) {
        const node = ctx.nodes.get(id);
        if (extra.shape && extra.shape.length > 2) {
          node.label = extra.shape.slice(1, -1).trim() || node.label;
        }
      }
      return ctx.nodes.get(id);
    }

    #makeWarning(message, ctx) {
      return {
        message,
        line: ctx.line,
      };
    }
  }

  class FlowMDError extends Error {
    constructor(message, line) {
      super(line ? `${message} (line ${line})` : message);
      this.name = 'FlowMDError';
      this.line = line ?? null;
    }
  }

  global.FlowMDParser = FlowMDParser;
  global.FlowMDError = FlowMDError;
})(typeof window !== 'undefined' ? window : globalThis);
