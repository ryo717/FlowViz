(function (global) {
  'use strict';

  class Exporter {
    constructor(graphSvg) {
      this.graphSvg = graphSvg;
    }

    exportCsv(model, highlight) {
      const rows = [['source', 'target']];
      if (highlight?.edges?.size) {
        for (const edgeId of highlight.edges) {
          const [source, target] = edgeId.split('->');
          rows.push([source, target]);
        }
      } else {
        for (const edge of model.edges) {
          rows.push([edge.source, edge.target]);
        }
      }
      const csv = rows.map((r) => r.map((value) => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n');
      downloadBlob(csv, 'text/csv;charset=utf-8', 'flowviz-edges.csv');
    }

    async exportPng(filename = 'flowviz.png') {
      const clonedSvg = this.graphSvg.cloneNode(true);
      const bbox = this.graphSvg.getBoundingClientRect();
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clonedSvg.setAttribute('width', bbox.width);
      clonedSvg.setAttribute('height', bbox.height);
      const svgData = new XMLSerializer().serializeToString(clonedSvg);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = 'async';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = bbox.width;
      canvas.height = bbox.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((canvasBlob) => {
        downloadBlob(canvasBlob, 'image/png', filename);
      });
    }
  }

  function downloadBlob(content, type, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  global.Exporter = Exporter;
  global.downloadBlob = downloadBlob;
})(typeof window !== 'undefined' ? window : globalThis);
