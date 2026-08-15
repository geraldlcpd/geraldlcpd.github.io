(function () {
  'use strict';

  function jsonParseErrorInfo(text, err) {
    const msg = err.message || String(err);
    let line = 1;
    let column = 1;

    const posMatch = msg.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const before = text.slice(0, pos);
      const lines = before.split('\n');
      line = lines.length;
      column = lines[lines.length - 1].length + 1;
    } else {
      const lineMatch = msg.match(/line\s+(\d+)/i);
      const colMatch = msg.match(/column\s+(\d+)/i);
      if (lineMatch) line = parseInt(lineMatch[1], 10);
      if (colMatch) column = parseInt(colMatch[1], 10);
    }

    const allLines = text.split('\n');
    const context = allLines[line - 1] || '';

    return { message: msg, line, column, context };
  }

  function parseJson(text) {
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch (err) {
      return { ok: false, error: jsonParseErrorInfo(text, err) };
    }
  }

  function parseYaml(text) {
    if (typeof jsyaml === 'undefined') {
      return { ok: false, error: { message: 'js-yaml library not loaded.', line: 1, column: 1, context: '' } };
    }
    try {
      return { ok: true, data: jsyaml.load(text) };
    } catch (err) {
      const msg = err.message || String(err);
      let line = err.mark ? err.mark.line + 1 : 1;
      let column = err.mark ? err.mark.column + 1 : 1;
      const allLines = text.split('\n');
      return { ok: false, error: { message: msg, line, column, context: allLines[line - 1] || '' } };
    }
  }

  function prettyJson(obj, spaces) {
    return JSON.stringify(obj, null, spaces == null ? 2 : spaces);
  }

  function minifyJson(obj) {
    return JSON.stringify(obj);
  }

  function toYaml(obj) {
    if (typeof jsyaml === 'undefined') throw new Error('js-yaml library not loaded.');
    return jsyaml.dump(obj, { lineWidth: 120, noRefs: true });
  }

  function toEscapedString(text) {
    return JSON.stringify(text);
  }

  function detectFormat(text) {
    const trimmed = text.trim();
    if (!trimmed) return 'unknown';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    return 'yaml';
  }

  window.JsonWorkbench = {
    parseJson,
    parseYaml,
    prettyJson,
    minifyJson,
    toYaml,
    toEscapedString,
    detectFormat,
    jsonParseErrorInfo
  };
})();
