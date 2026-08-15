(function () {
  'use strict';

  const PRESETS = {
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *'
  };

  const FIELD_NAMES_5 = ['minute', 'hour', 'day of month', 'month', 'day of week'];
  const FIELD_NAMES_6 = ['second', 'minute', 'hour', 'day of month', 'month', 'day of week'];

  const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function expandPreset(expr) {
    const trimmed = expr.trim();
  if (PRESETS[trimmed]) return PRESETS[trimmed];
    return trimmed;
  }

  function parseField(field, min, max) {
    const values = new Set();
    const parts = field.split(',');

    for (const part of parts) {
      const stepMatch = part.match(/^(.+)\/(\d+)$/);
      let rangePart = part;
      let step = 1;
      if (stepMatch) {
        rangePart = stepMatch[1];
        step = parseInt(stepMatch[2], 10);
        if (step < 1) throw new Error(`Invalid step in "${part}"`);
      }

      if (rangePart === '*') {
        for (let i = min; i <= max; i += step) values.add(i);
        continue;
      }

      const rangeMatch = rangePart.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        let start = parseInt(rangeMatch[1], 10);
        let end = parseInt(rangeMatch[2], 10);
        if (start < min || end > max || start > end) {
          throw new Error(`Range out of bounds: ${rangePart}`);
        }
        for (let i = start; i <= end; i += step) values.add(i);
        continue;
      }

      const n = parseInt(rangePart, 10);
      if (Number.isNaN(n) || n < min || n > max) {
        throw new Error(`Invalid value "${rangePart}" (expected ${min}-${max})`);
      }
      values.add(n);
    }

    return values;
  }

  function parseCron(expr) {
    const raw = expandPreset(expr);
    const fields = raw.trim().split(/\s+/);
    if (fields.length !== 5 && fields.length !== 6) {
      throw new Error(`Expected 5 or 6 fields, got ${fields.length}.`);
    }

    const is6 = fields.length === 6;
    const names = is6 ? FIELD_NAMES_6 : FIELD_NAMES_5;
    const offset = is6 ? 0 : -1;

    const second = is6 ? parseField(fields[0], 0, 59) : new Set([0]);
    const minute = parseField(fields[1 + offset], 0, 59);
    const hour = parseField(fields[2 + offset], 0, 23);
    const dom = parseField(fields[3 + offset], 1, 31);
    const month = parseField(fields[4 + offset], 1, 12);
    const dow = parseField(fields[5 + offset], 0, 7);

    const dowNorm = new Set();
    dow.forEach((d) => dowNorm.add(d === 7 ? 0 : d));

    return { second, minute, hour, dom, month, dow: dowNorm, is6, names, rawFields: fields };
  }

  function describeField(name, fieldStr, values, labels) {
    if (fieldStr === '*') return `every ${name}`;
    if (fieldStr.includes('/')) {
      const [base, step] = fieldStr.split('/');
      if (base === '*') return `every ${step} ${name}${step !== '1' ? 's' : ''}`;
    }
    if (values.size === 1) {
      const v = [...values][0];
      if (labels) return `${name} ${labels[v] || v}`;
      return `${name} ${v}`;
    }
    const sorted = [...values].sort((a, b) => a - b);
    if (labels) return `${name} on ${sorted.map((v) => labels[v] || v).join(', ')}`;
    return `${name} at ${sorted.join(', ')}`;
  }

  function humanize(cron) {
    const f = cron.rawFields;
    const off = cron.is6 ? 0 : -1;
    const parts = [];

    if (cron.is6 && f[0] !== '0' && f[0] !== '*') {
      parts.push(describeField('second', f[0], cron.second));
    }
    if (f[1 + off] !== '*') parts.push(describeField('minute', f[1 + off], cron.minute));
    if (f[2 + off] !== '*') parts.push(describeField('hour', f[2 + off], cron.hour));
    if (f[3 + off] !== '*') parts.push(describeField('day', f[3 + off], cron.dom));
    if (f[4 + off] !== '*') parts.push(describeField('month', f[4 + off], cron.month, MONTH_NAMES));
    if (f[5 + off] !== '*') parts.push(describeField('weekday', f[5 + off], cron.dow, DOW_NAMES));

    if (parts.length === 0) return 'Every minute';
    return 'At ' + parts.join(', ');
  }

  function matches(cron, date) {
    const sec = date.getSeconds();
    const min = date.getMinutes();
    const hr = date.getHours();
    const dom = date.getDate();
    const mon = date.getMonth() + 1;
    const dow = date.getDay();

    if (!cron.second.has(sec)) return false;
    if (!cron.minute.has(min)) return false;
    if (!cron.hour.has(hr)) return false;
    if (!cron.month.has(mon)) return false;

    const domMatch = cron.dom.has(dom);
    const dowMatch = cron.dow.has(dow);
    const domStar = cron.rawFields[cron.is6 ? 3 : 2] === '*';
    const dowStar = cron.rawFields[cron.is6 ? 5 : 4] === '*';

    if (domStar && dowStar) return true;
    if (!domStar && !dowStar) return domMatch || dowMatch;
    if (!domStar) return domMatch;
    return dowMatch;
  }

  function nextRuns(cron, count, fromDate) {
    const results = [];
    const cursor = new Date(fromDate || Date.now());
    cursor.setMilliseconds(0);
    cursor.setSeconds(cursor.getSeconds() + 1);

    let safety = 0;
    const maxIter = 525600 * 4;

    while (results.length < count && safety < maxIter) {
      if (matches(cron, cursor)) results.push(new Date(cursor));
      cursor.setSeconds(cursor.getSeconds() + 1);
      safety++;
    }

    if (results.length < count) {
      throw new Error('Could not find enough matching run times within search window.');
    }
    return results;
  }

  window.CronExplainer = {
    PRESETS,
    expandPreset,
    parseCron,
    humanize,
    nextRuns,
    FIELD_NAMES_5,
    FIELD_NAMES_6
  };
})();
