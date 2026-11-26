(function (global) {
  'use strict';

  const MAX_LCS_CELLS = 250000;

  function sortJsonValue(value) {
    if (Array.isArray(value)) {
      return value.map(sortJsonValue);
    }
    if (value !== null && typeof value === 'object') {
      const sorted = {};
      const keys = Object.keys(value).sort();
      for (const k of keys) {
        sorted[k] = sortJsonValue(value[k]);
      }
      return sorted;
    }
    return value;
  }

  function canonicalizeJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('Invalid JSON: ' + err.message);
    }
    return JSON.stringify(sortJsonValue(parsed), null, 2);
  }

  function normalizeLine(line, opts) {
    let s = line;
    if (opts.ignoreWhitespace) {
      s = s.replace(/\s+/g, ' ').trim();
    }
    if (opts.ignoreCase) {
      s = s.toLowerCase();
    }
    return s;
  }

  function splitLines(text) {
    if (text === '') return [];
    return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  function diffLines(leftText, rightText, options) {
    const opts = options || {};
    const leftRaw = splitLines(leftText);
    const rightRaw = splitLines(rightText);
    const leftNorm = leftRaw.map((l) => normalizeLine(l, opts));
    const rightNorm = rightRaw.map((l) => normalizeLine(l, opts));

    // Trim common prefix and suffix to shrink DP table
    let prefix = 0;
    while (
      prefix < leftNorm.length &&
      prefix < rightNorm.length &&
      leftNorm[prefix] === rightNorm[prefix]
    ) {
      prefix++;
    }

    let suffix = 0;
    while (
      suffix < leftNorm.length - prefix &&
      suffix < rightNorm.length - prefix &&
      leftNorm[leftNorm.length - 1 - suffix] === rightNorm[rightNorm.length - 1 - suffix]
    ) {
      suffix++;
    }

    const ops = [];
    for (let i = 0; i < prefix; i++) {
      ops.push({ type: 'equal', leftLine: i + 1, rightLine: i + 1, text: rightRaw[i] });
    }

    const n = leftNorm.length - prefix - suffix;
    const m = rightNorm.length - prefix - suffix;

    if (n > 0 || m > 0) {
      if (n * m <= MAX_LCS_CELLS) {
        const dp = new Int32Array((n + 1) * (m + 1));
        const cols = m + 1;
        for (let i = n - 1; i >= 0; i--) {
          const row = i * cols;
          const nextRow = (i + 1) * cols;
          for (let j = m - 1; j >= 0; j--) {
            if (leftNorm[prefix + i] === rightNorm[prefix + j]) {
              dp[row + j] = dp[nextRow + j + 1] + 1;
            } else {
              const down = dp[nextRow + j];
              const right = dp[row + j + 1];
              dp[row + j] = down >= right ? down : right;
            }
          }
        }

        let i = 0;
        let j = 0;
        while (i < n && j < m) {
          if (leftNorm[prefix + i] === rightNorm[prefix + j]) {
            ops.push({
              type: 'equal',
              leftLine: prefix + i + 1,
              rightLine: prefix + j + 1,
              text: rightRaw[prefix + j]
            });
            i++;
            j++;
          } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
            ops.push({
              type: 'del',
              leftLine: prefix + i + 1,
              rightLine: null,
              text: leftRaw[prefix + i]
            });
            i++;
          } else {
            ops.push({
              type: 'add',
              leftLine: null,
              rightLine: prefix + j + 1,
              text: rightRaw[prefix + j]
            });
            j++;
          }
        }
        while (i < n) {
          ops.push({
            type: 'del',
            leftLine: prefix + i + 1,
            rightLine: null,
            text: leftRaw[prefix + i]
          });
          i++;
        }
        while (j < m) {
          ops.push({
            type: 'add',
            leftLine: null,
            rightLine: prefix + j + 1,
            text: rightRaw[prefix + j]
          });
          j++;
        }
      } else {
        // Fallback for very large inputs: emit middle block as del then add
        for (let i = 0; i < n; i++) {
          ops.push({
            type: 'del',
            leftLine: prefix + i + 1,
            rightLine: null,
            text: leftRaw[prefix + i]
          });
        }
        for (let j = 0; j < m; j++) {
          ops.push({
            type: 'add',
            leftLine: null,
            rightLine: prefix + j + 1,
            text: rightRaw[prefix + j]
          });
        }
      }
    }

    for (let k = 0; k < suffix; k++) {
      const li = leftRaw.length - suffix + k;
      const ri = rightRaw.length - suffix + k;
      ops.push({ type: 'equal', leftLine: li + 1, rightLine: ri + 1, text: rightRaw[ri] });
    }

    return ops;
  }

  function tokenizeLine(str) {
    return str.match(/\s+|[A-Za-z0-9_]+|./g) || [];
  }

  function diffWords(oldLine, newLine) {
    const a = tokenizeLine(oldLine);
    const b = tokenizeLine(newLine);
    const n = a.length;
    const m = b.length;

    if (n * m > 40000) {
      return {
        left: [{ type: 'del', text: oldLine }],
        right: [{ type: 'add', text: newLine }]
      };
    }

    const dp = new Int32Array((n + 1) * (m + 1));
    const cols = m + 1;
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        if (a[i] === b[j]) {
          dp[i * cols + j] = dp[(i + 1) * cols + (j + 1)] + 1;
        } else {
          const down = dp[(i + 1) * cols + j];
          const right = dp[i * cols + (j + 1)];
          dp[i * cols + j] = down >= right ? down : right;
        }
      }
    }

    const leftTokens = [];
    const rightTokens = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        leftTokens.push({ type: 'equal', text: a[i] });
        rightTokens.push({ type: 'equal', text: b[j] });
        i++;
        j++;
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
        leftTokens.push({ type: 'del', text: a[i] });
        i++;
      } else {
        rightTokens.push({ type: 'add', text: b[j] });
        j++;
      }
    }
    while (i < n) {
      leftTokens.push({ type: 'del', text: a[i++] });
    }
    while (j < m) {
      rightTokens.push({ type: 'add', text: b[j++] });
    }

    return { left: mergeTokens(leftTokens), right: mergeTokens(rightTokens) };
  }

  function mergeTokens(tokens) {
    const out = [];
    for (const t of tokens) {
      if (out.length && out[out.length - 1].type === t.type) {
        out[out.length - 1].text += t.text;
      } else {
        out.push({ type: t.type, text: t.text });
      }
    }
    return out;
  }

  function toUnifiedDiff(ops, leftLabel, rightLabel, contextLines) {
    const ctx = typeof contextLines === 'number' ? contextLines : 3;
    const leftName = leftLabel || 'a/original';
    const rightName = rightLabel || 'b/modified';
    const header = [`--- ${leftName}`, `+++ ${rightName}`];

    const changeIndices = [];
    for (let i = 0; i < ops.length; i++) {
      if (ops[i].type !== 'equal') changeIndices.push(i);
    }
    if (changeIndices.length === 0) {
      return header.join('\n') + '\n';
    }

    const hunks = [];
    let start = Math.max(0, changeIndices[0] - ctx);
    let end = Math.min(ops.length - 1, changeIndices[0] + ctx);

    for (let k = 1; k < changeIndices.length; k++) {
      const idx = changeIndices[k];
      if (idx - ctx <= end + 1) {
        end = Math.min(ops.length - 1, idx + ctx);
      } else {
        hunks.push([start, end]);
        start = Math.max(0, idx - ctx);
        end = Math.min(ops.length - 1, idx + ctx);
      }
    }
    hunks.push([start, end]);

    const lines = [...header];
    for (const [hStart, hEnd] of hunks) {
      let leftStart = null;
      let rightStart = null;
      let leftCount = 0;
      let rightCount = 0;
      const body = [];

      for (let i = hStart; i <= hEnd; i++) {
        const op = ops[i];
        if (op.type === 'equal') {
          if (leftStart === null) leftStart = op.leftLine;
          if (rightStart === null) rightStart = op.rightLine;
          leftCount++;
          rightCount++;
          body.push(' ' + op.text);
        } else if (op.type === 'del') {
          if (leftStart === null) leftStart = op.leftLine;
          leftCount++;
          body.push('-' + op.text);
        } else {
          if (rightStart === null) rightStart = op.rightLine;
          rightCount++;
          body.push('+' + op.text);
        }
      }

      if (leftStart === null) leftStart = 0;
      if (rightStart === null) rightStart = 0;
      lines.push(`@@ -${leftStart},${leftCount} +${rightStart},${rightCount} @@`);
      lines.push(...body);
    }

    return lines.join('\n') + '\n';
  }

  function summarize(ops) {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (const op of ops) {
      if (op.type === 'add') added++;
      else if (op.type === 'del') removed++;
      else unchanged++;
    }
    return { added, removed, unchanged };
  }

  const api = {
    canonicalizeJson,
    diffLines,
    diffWords,
    toUnifiedDiff,
    summarize
  };

  global.DiffViewer = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
