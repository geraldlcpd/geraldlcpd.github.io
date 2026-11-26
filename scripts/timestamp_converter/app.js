(function (global) {
  'use strict';

  const DEFAULT_TIMEZONES = [
    'UTC',
    'Local',
    'America/New_York',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Jakarta',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney'
  ];

  function pad(n, width) {
    return String(n).padStart(width, '0');
  }

  function formatIsoNanoFromNs(epochNs) {
    const msBig = epochNs >= 0n
      ? epochNs / 1000000n
      : (epochNs - 999999n) / 1000000n;
    const subNs = Number(epochNs - msBig * 1000000n);
    const d = new Date(Number(msBig));
    if (Number.isNaN(d.getTime())) throw new Error('Timestamp out of valid Date range.');

    const base =
      d.getUTCFullYear() + '-' +
      pad(d.getUTCMonth() + 1, 2) + '-' +
      pad(d.getUTCDate(), 2) + 'T' +
      pad(d.getUTCHours(), 2) + ':' +
      pad(d.getUTCMinutes(), 2) + ':' +
      pad(d.getUTCSeconds(), 2);

    const totalSubNs = d.getUTCMilliseconds() * 1000000 + subNs;
    const frac = pad(totalSubNs, 9).replace(/0+$/, '');
    return frac ? `${base}.${frac}Z` : `${base}Z`;
  }

  function parseIsoWithNanoseconds(str) {
    // Prefer native Temporal.Instant when available for exact nanosecond parsing
    if (typeof global.Temporal !== 'undefined' && global.Temporal.Instant) {
      try {
        const inst = global.Temporal.Instant.from(str);
        return inst.epochNanoseconds;
      } catch {
        // fall through to regex parser for flexible ISO variants
      }
    }

    const m = str.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/i
    );
    if (!m) return null;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);
    const fracStr = (m[7] || '').slice(0, 9).padEnd(9, '0');
    const tz = m[8] || 'Z';

    let offsetMs = 0;
    if (tz.toUpperCase() !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      const clean = tz.slice(1).replace(':', '');
      const oh = Number(clean.slice(0, 2));
      const om = Number(clean.slice(2, 4));
      offsetMs = sign * ((oh * 60 + om) * 60000);
    }

    const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0) - offsetMs;
    if (Number.isNaN(utcMs)) return null;
    return BigInt(utcMs) * 1000000n + BigInt(fracStr);
  }

  function buildResult(epochNs, detectedFormat) {
    const epochUs = epochNs / 1000n;
    const epochMsBig = epochNs >= 0n
      ? epochNs / 1000000n
      : (epochNs - 999999n) / 1000000n;
    const epochMs = Number(epochMsBig);
    const epochSec = Math.floor(epochMs / 1000);

    const d = new Date(epochMs);
    if (Number.isNaN(d.getTime())) {
      throw new Error('Timestamp is outside valid JavaScript Date range.');
    }

    return {
      epochNs,
      epochUs,
      epochMs,
      epochSec,
      isoUtc: d.toISOString(),
      isoUtcNano: formatIsoNanoFromNs(epochNs),
      rfc2822: d.toUTCString(),
      detectedFormat
    };
  }

  function parseInput(raw) {
    const str = String(raw).trim();
    if (!str) throw new Error('Enter a Unix timestamp, ISO 8601 string, or date.');

    if (str.toLowerCase() === 'now') {
      return buildResult(BigInt(Date.now()) * 1000000n, 'Current Time');
    }

    // Numeric Unix epoch (integer or decimal, optional leading minus)
    if (/^-?\d+(?:\.\d+)?$/.test(str)) {
      if (str.includes('.')) {
        const val = Number(str);
        if (!Number.isFinite(val)) throw new Error('Invalid numeric timestamp.');
        // Treat decimal as seconds
        const ns = BigInt(Math.round(val * 1e9));
        return buildResult(ns, 'Unix Seconds (decimal)');
      }
      const absDigits = str.startsWith('-') ? str.slice(1) : str;
      const big = BigInt(str);
      if (absDigits.length <= 10) {
        return buildResult(big * 1000000000n, 'Unix Seconds');
      }
      if (absDigits.length <= 13) {
        return buildResult(big * 1000000n, 'Unix Milliseconds');
      }
      if (absDigits.length <= 16) {
        return buildResult(big * 1000n, 'Unix Microseconds');
      }
      return buildResult(big, 'Unix Nanoseconds');
    }

    // ISO 8601 / RFC 3339 with optional sub-millisecond precision
    const isoNs = parseIsoWithNanoseconds(str);
    if (isoNs !== null) {
      return buildResult(isoNs, 'ISO 8601 / RFC 3339');
    }

    // Date-only ISO (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const ms = Date.parse(str + 'T00:00:00Z');
      if (!Number.isNaN(ms)) {
        return buildResult(BigInt(ms) * 1000000n, 'ISO Date (UTC midnight)');
      }
    }

    // Fallback to RFC 2822 / general date string
    const parsedMs = Date.parse(str);
    if (!Number.isNaN(parsedMs)) {
      return buildResult(BigInt(parsedMs) * 1000000n, 'RFC 2822 / Date String');
    }

    throw new Error('Unrecognized timestamp format: ' + str);
  }

  function resolveTimeZone(tz) {
    if (!tz || tz === 'Local') {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
    return tz;
  }

  function formatInTimezone(epochMs, timeZone) {
    const resolved = resolveTimeZone(timeZone);
    const d = new Date(epochMs);

    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: resolved,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d).replace(', ', ' ');

    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: resolved,
      weekday: 'short'
    }).format(d);

    let offset = '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: resolved,
        timeZoneName: 'shortOffset'
      }).formatToParts(d);
      const tzPart = parts.find((p) => p.type === 'timeZoneName');
      offset = tzPart ? tzPart.value : '';
    } catch {
      offset = '';
    }

    return {
      timeZone: resolved,
      label: timeZone === 'Local' ? `Local (${resolved})` : resolved,
      formatted,
      weekday,
      offset
    };
  }

  function relativeTime(epochMs, nowMs) {
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    const diffSec = Math.round((epochMs - now) / 1000);
    const abs = Math.abs(diffSec);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

    if (abs < 60) return rtf.format(diffSec, 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
    if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), 'month');
    return rtf.format(Math.round(diffSec / 31536000), 'year');
  }

  const api = {
    DEFAULT_TIMEZONES,
    parseInput,
    formatInTimezone,
    relativeTime
  };

  global.TimestampConverter = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
