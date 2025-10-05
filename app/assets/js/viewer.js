(function (global) {
  'use strict';

  class FlowVizApp {
    constructor() {
      this.parser = new FlowMDParser();
      this.graphSvg = document.getElementById('graph');
      this.toast = document.getElementById('toast');
      this.editor = document.getElementById('flowmd-editor');
      this.statusText = document.getElementById('status-text');
      this.nodeCountBadge = document.getElementById('node-count');
      this.highlightState = { nodes: new Set(), edges: new Set() };
      this.model = null;
      this.highlightEngine = null;
      this.exporter = new Exporter(this.graphSvg);
      this.simulation = null;
    }

    bootstrap() {
      document.getElementById('load-btn').addEventListener('click', () => {
        document.getElementById('flowmd-input').click();
      });
      document.getElementById('flowmd-input').addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        file.text().then((text) => this.parseAndRender(text, file.name)).catch((error) => {
          this.notify(error.message, true);
        });
      });
      document.getElementById('run-editor').addEventListener('click', () => {
        this.parseAndRender(this.editor.value, 'エディタ入力');
      });
      document.getElementById('reset-btn').addEventListener('click', () => {
        this.clear();
      });
      document.getElementById('search-btn').addEventListener('click', () => {
        const query = document.getElementById('search-box').value.trim();
        this.search(query);
      });
      document.getElementById('search-box').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.search(event.target.value.trim());
        }
      });
      document.getElementById('export-csv').addEventListener('click', () => {
        if (!this.model) {
          this.notify('グラフがありません', true);
          return;
        }
        this.exporter.exportCsv(this.model, this.highlightState);
        this.notify('CSV を出力しました');
      });
      document.getElementById('export-png').addEventListener('click', async () => {
        if (!this.model) {
          this.notify('グラフがありません', true);
          return;
        }
        try {
          await this.exporter.exportPng();
          this.notify('PNG を出力しました');
        } catch (error) {
          this.notify(`PNG 出力に失敗: ${error.message}`, true);
        }
      });

      this.createZoomBehaviour();
    }

    parseAndRender(text, sourceLabel) {
      try {
        const graph = this.parser.parse(text);
        this.model = new GraphModel(graph);
        this.highlightEngine = new HighlightEngine(this.model);
        this.renderGraph();
        this.editor.value = text;
        this.statusText.textContent = `${sourceLabel} を読み込みました`;
        this.nodeCountBadge.textContent = `${this.model.nodes.length} ノード`;
        const warnings = graph.meta?.warnings ?? [];
        this.#handleWarnings(warnings);
        if (graph.meta.degrade) {
          const delay = Array.isArray(warnings) && warnings.length ? 1200 : 0;
          setTimeout(() => {
            this.notify('ノード数が多いため縮退モードです', false, 4000);
          }, delay);
        }
      } catch (error) {
        this.notify(error.message, true, 5000);
        console.error(error);
      }
    }

    #handleWarnings(warnings) {
      if (!Array.isArray(warnings) || warnings.length === 0) {
        return;
      }
      const first = warnings[0];
      const message = typeof first === 'string' ? first : first.message ?? '';
      const lineNumber = typeof first === 'object' && first !== null ? first.line : null;
      const lineText = lineNumber ? ` (line ${lineNumber})` : '';
      this.notify(`警告: ${message}${lineText}`, false, 5000);
      if (warnings.length > 1) {
        console.warn('FlowViz warnings:', warnings);
      }
    }

    renderGraph() {
      const svg = d3.select(this.graphSvg);
      svg.selectAll('*').remove();

      const width = this.graphSvg.clientWidth || 800;
      const height = this.graphSvg.clientHeight || 600;

      const defs = svg.append('defs');
      defs
        .append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 18)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#94a3b8');

      const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
      const linkGroup = zoomLayer.append('g').attr('class', 'links');
      const nodeGroup = zoomLayer.append('g').attr('class', 'nodes');

      const links = this.model.edges.map((d) => Object.assign({}, d));
      const nodes = this.model.nodes.map((d) => Object.assign({}, d));

      const orientation = this.model.meta.orientation ?? 'TB';
      const forceX = orientation === 'LR' || orientation === 'RL' ? d3.forceX(width / 2).strength(0.05) : null;
      const forceY = orientation === 'TB' || orientation === 'BT' || orientation === 'TD'
        ? d3.forceY(height / 2).strength(0.05)
        : null;

      this.simulation = d3
        .forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d) => d.id).distance(80))
        .force('charge', d3.forceManyBody().strength(-160))
        .force('center', d3.forceCenter(width / 2, height / 2));

      if (forceX) {
        this.simulation.force('forceX', forceX);
      }
      if (forceY) {
        this.simulation.force('forceY', forceY);
      }

      const link = linkGroup
        .selectAll('line')
        .data(links)
        .enter()
        .append('line')
        .attr('class', 'link');

      const node = nodeGroup
        .selectAll('g')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', 'node')
        .call(
          d3
            .drag()
            .on('start', (event, d) => this.dragStarted(event, d))
            .on('drag', (event, d) => this.dragged(event, d))
            .on('end', (event, d) => this.dragEnded(event, d))
        )
        .on('click', (_, d) => this.highlight(d.id));

      node
        .append('circle')
        .attr('r', 18);

      node
        .append('text')
        .attr('dy', 4)
        .attr('text-anchor', 'middle')
        .text((d) => d.label);

      this.simulation.on('tick', () => {
        link
          .attr('x1', (d) => d.source.x)
          .attr('y1', (d) => d.source.y)
          .attr('x2', (d) => d.target.x)
          .attr('y2', (d) => d.target.y);

        node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      });

      this.linkSelection = link;
      this.nodeSelection = node;
    }

    highlight(nodeId) {
      if (!this.highlightEngine) return;
      const result = this.highlightEngine.downstream(nodeId);
      this.highlightState = result;
      this.applyHighlight();
      const target = this.model.findNode(nodeId);
      if (target) {
        this.notify(`${target.label} から ${result.nodes.size - 1} ノードをハイライト`, false, 3000);
      }
    }

    applyHighlight() {
      if (!this.nodeSelection || !this.linkSelection) return;
      const highlightedNodes = this.highlightState.nodes;
      const highlightedEdges = this.highlightState.edges;

      this.nodeSelection
        .classed('highlight', (d) => highlightedNodes.has(d.id))
        .classed('dim', (d) => highlightedNodes.size && !highlightedNodes.has(d.id));

      this.linkSelection
        .classed('highlight', (d) => highlightedEdges.has(`${d.source.id ?? d.source}->${d.target.id ?? d.target}`))
        .classed('dim', (d) => highlightedEdges.size && !highlightedEdges.has(`${d.source.id ?? d.source}->${d.target.id ?? d.target}`));
    }

    search(query) {
      if (!query) {
        this.notify('検索ワードを入力してください', true);
        return;
      }
      if (!this.model) {
        this.notify('グラフがありません', true);
        return;
      }
      const node = this.model.nodes.find((n) => n.id === query || n.label.includes(query));
      if (!node) {
        this.notify(`「${query}」に一致するノードがありません`, true);
        return;
      }
      this.highlight(node.id);
    }

    createZoomBehaviour() {
      const svg = d3.select(this.graphSvg);
      const zoomLayer = svg.append('g');
      svg.call(
        d3
          .zoom()
          .scaleExtent([0.2, 3])
          .on('zoom', (event) => {
            const rootLayer = svg.select('.zoom-layer');
            if (rootLayer.empty()) return;
            rootLayer.attr('transform', event.transform);
          })
      );
      zoomLayer.remove();
    }

    dragStarted(event, d) {
      if (!event.active) this.simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    dragEnded(event, d) {
      if (!event.active) this.simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    clear() {
      this.editor.value = '';
      this.statusText.textContent = 'ファイル未読込';
      this.nodeCountBadge.textContent = '0 ノード';
      d3.select(this.graphSvg).selectAll('*').remove();
      this.model = null;
      this.highlightEngine = null;
      this.highlightState = { nodes: new Set(), edges: new Set() };
    }

    notify(message, isError = false, timeout = 2500) {
      this.toast.textContent = message;
      this.toast.classList.toggle('error', isError);
      this.toast.classList.add('show');
      clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => {
        this.toast.classList.remove('show');
      }, timeout);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const app = new FlowVizApp();
    app.bootstrap();
    global.__flowVizApp = app;
  });
})(typeof window !== 'undefined' ? window : globalThis);
