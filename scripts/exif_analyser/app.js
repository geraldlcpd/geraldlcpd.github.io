(function (global) {
  'use strict';

  var PARSE_OPTIONS = {
    tiff: true,
    xmp: true,
    iptc: true,
    icc: true,
    jfif: true,
    ihdr: true,
    ifd0: true,
    ifd1: true,
    exif: true,
    gps: true,
    interop: true,
    makerNote: true,
    userComment: true,
    multiSegment: true,
    mergeOutput: true,
    translateKeys: true,
    translateValues: true,
    reviveValues: true,
    sanitize: true,
    silentErrors: true
  };

  var MOST_USED_FIELDS = [
    { keys: ['Make'], label: 'Camera Make' },
    { keys: ['Model'], label: 'Camera Model' },
    { keys: ['LensModel', 'Lens'], label: 'Lens' },
    { keys: ['DateTimeOriginal'], label: 'Date Taken' },
    { keys: ['ExposureTime'], label: 'Shutter Speed' },
    { keys: ['FNumber'], label: 'Aperture' },
    { keys: ['ISO', 'ISOSpeedRatings'], label: 'ISO' },
    { keys: ['FocalLength'], label: 'Focal Length' },
    { keys: ['FocalLengthIn35mmFormat'], label: '35mm Equivalent' },
    { keys: ['ExposureProgram'], label: 'Exposure Program' },
    { keys: ['MeteringMode'], label: 'Metering Mode' },
    { keys: ['Flash'], label: 'Flash' },
    { keys: ['WhiteBalance'], label: 'White Balance' },
    { keys: ['ImageWidth', 'ExifImageWidth'], label: 'Dimensions', combined: 'dimensions' },
    { keys: ['Orientation'], label: 'Orientation' },
    { keys: ['latitude', 'longitude'], label: 'GPS Coordinates', combined: 'gps' },
    { keys: ['GPSAltitude'], label: 'Altitude' },
    { keys: ['GPSImgDirection'], label: 'Direction' },
    { keys: ['Software'], label: 'Software' },
    { keys: ['Artist'], label: 'Artist' },
    { keys: ['Copyright', 'CopyrightNotice'], label: 'Copyright' },
    { keys: ['CreateDate'], label: 'Created' },
    { keys: ['ModifyDate'], label: 'Modified' }
  ];

  var OTHER_GROUP_ORDER = [
    'Camera & Software',
    'Lens',
    'Exposure & Metering',
    'Focus & Scene',
    'Flash & Lighting',
    'Image Properties',
    'GPS & Location',
    'Date & Time',
    'Video',
    'XMP',
    'IPTC',
    'ICC / Color',
    'Thumbnail (IFD1)',
    'Other'
  ];

  var GROUP_RULES = [
    { name: 'Lens', re: /^(lens|focal)/i },
    { name: 'Exposure & Metering', re: /^(exposure|shutter|aperture|iso|metering|brightness|sensitivity|gain|gamma)/i },
    { name: 'Focus & Scene', re: /^(focus|subject|scene|macro|af)/i },
    { name: 'Flash & Lighting', re: /^(flash|whitebalance|lightsource|colortemp|illuminant)/i },
    { name: 'GPS & Location', re: /^(gps|latitude|longitude|altitude)/i },
    { name: 'Date & Time', re: /(date|time|offsettime|subsec)/i },
    { name: 'Video', re: /^(video|audio|duration|framerate|codec|track|rotation|handler)/i },
    { name: 'IPTC', re: /^(caption|keywords|headline|byline|credit|source|urgency|category|city|country|objectname|writer|contact)/i },
    { name: 'ICC / Color', re: /^(profile|icc|colorspace|chromatic|whitepoint|renderingintent)/i },
    { name: 'Thumbnail (IFD1)', re: /^thumbnail/i },
    { name: 'Image Properties', re: /^(image|exifimage|orientation|resolution|compression|bitsper|samplesper|photometric|planar|color|width|height|xresolution|yresolution|jfif)/i },
    { name: 'Camera & Software', re: /^(make|model|software|serial|owner|artist|copyright|hostcomputer|processing)/i }
  ];

  function firstPresent(obj, keys) {
    if (!obj) return undefined;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  function isEmptyValue(v) {
    if (v === undefined || v === null || v === '') return true;
    if (typeof v === 'number' && Number.isNaN(v)) return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function pad2(n) {
    return String(Math.abs(Math.floor(n))).padStart(2, '0');
  }

  function toDms(deg, isLat) {
    if (!Number.isFinite(deg)) return '';
    var hemi = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W');
    var abs = Math.abs(deg);
    var d = Math.floor(abs);
    var mFloat = (abs - d) * 60;
    var m = Math.floor(mFloat);
    var s = (mFloat - m) * 60;
    return d + '° ' + pad2(m) + "' " + s.toFixed(2) + '" ' + hemi;
  }

  function formatCoordinate(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      decimal: lat.toFixed(6) + ', ' + lon.toFixed(6),
      dms: toDms(lat, true) + ' · ' + toDms(lon, false),
      latitude: lat,
      longitude: lon
    };
  }

  function formatExposureTime(v) {
    var n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return String(v);
    if (n >= 1) return n.toFixed(n % 1 === 0 ? 0 : 1) + 's';
    var denom = Math.round(1 / n);
    return '1/' + denom + 's';
  }

  function formatFNumber(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return 'f/' + (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1));
  }

  function formatFocal(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return (n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)) + ' mm';
  }

  function formatDateValue(v) {
    if (v instanceof Date && !Number.isNaN(+v)) return v.toUTCString();
    return String(v);
  }

  function formatValue(key, value) {
    if (isEmptyValue(value)) return '—';
    if (value instanceof Date) return formatDateValue(value);
    if (value instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value) && !(value instanceof Float32Array) && !(value instanceof Float64Array))) {
      if (value.length > 64) return '[' + value.length + ' bytes]';
      var arr = Array.from(value);
      return arr.join(' ');
    }
    if (key === 'ExposureTime' || key === 'ShutterSpeedValue') return formatExposureTime(value);
    if (key === 'FNumber' || key === 'ApertureValue' || key === 'MaxApertureValue') return formatFNumber(value);
    if (/FocalLength/i.test(key) && Number.isFinite(Number(value))) return formatFocal(value);
    if (key === 'GPSAltitude' && Number.isFinite(Number(value))) return Number(value).toFixed(1) + ' m';
    if ((key === 'latitude' || key === 'longitude') && Number.isFinite(Number(value))) return Number(value).toFixed(6);
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (e) {
        return String(value);
      }
    }
    return String(value);
  }

  function flattenMetadata(obj, prefix, out) {
    out = out || {};
    if (!obj || typeof obj !== 'object' || obj instanceof Date || ArrayBuffer.isView(obj)) {
      if (prefix) out[prefix] = obj;
      return out;
    }
    if (Array.isArray(obj)) {
      out[prefix || 'value'] = obj;
      return out;
    }
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = obj[k];
      var next = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !(v instanceof Date) && !ArrayBuffer.isView(v) && !Array.isArray(v) && Object.keys(v).length && Object.keys(v).length < 80) {
        flattenMetadata(v, next, out);
      } else {
        out[next] = v;
      }
    }
    return out;
  }

  function pickGroup(key) {
    var base = key.split('.').pop();
    if (/^xmp\./i.test(key) || /^(dc|xmp|photoshop|aux|crs|Iptc4xmpCore)\./i.test(key)) return 'XMP';
    for (var i = 0; i < GROUP_RULES.length; i++) {
      if (GROUP_RULES[i].re.test(base) || GROUP_RULES[i].re.test(key)) return GROUP_RULES[i].name;
    }
    return 'Other';
  }

  function groupMetadata(flat, gps) {
    var usedKeys = {};
    var mostUsed = [];
    var width = firstPresent(flat, ['ImageWidth', 'ExifImageWidth']);
    var height = firstPresent(flat, ['ImageHeight', 'ExifImageHeight']);
    var lat = gps && Number.isFinite(gps.latitude) ? gps.latitude : Number(flat.latitude);
    var lon = gps && Number.isFinite(gps.longitude) ? gps.longitude : Number(flat.longitude);
    var coords = formatCoordinate(lat, lon);

    for (var i = 0; i < MOST_USED_FIELDS.length; i++) {
      var spec = MOST_USED_FIELDS[i];
      if (spec.combined === 'dimensions') {
        if (isEmptyValue(width) || isEmptyValue(height)) continue;
        mostUsed.push({ key: 'Dimensions', label: spec.label, value: width + ' × ' + height + ' px' });
        usedKeys.ImageWidth = true;
        usedKeys.ExifImageWidth = true;
        usedKeys.ImageHeight = true;
        usedKeys.ExifImageHeight = true;
        continue;
      }
      if (spec.combined === 'gps') {
        if (!coords) continue;
        mostUsed.push({ key: 'GPSCoordinates', label: spec.label, value: coords.decimal + '  (' + coords.dms + ')' });
        usedKeys.latitude = true;
        usedKeys.longitude = true;
        usedKeys.GPSLatitude = true;
        usedKeys.GPSLongitude = true;
        usedKeys.GPSLatitudeRef = true;
        usedKeys.GPSLongitudeRef = true;
        continue;
      }
      var raw = firstPresent(flat, spec.keys);
      if (isEmptyValue(raw)) continue;
      var canonical = spec.keys[0];
      mostUsed.push({ key: canonical, label: spec.label, value: formatValue(canonical, raw) });
      for (var j = 0; j < spec.keys.length; j++) usedKeys[spec.keys[j]] = true;
    }

    var other = {};
    var allKeys = Object.keys(flat);
    for (var k = 0; k < allKeys.length; k++) {
      var key = allKeys[k];
      var leaf = key.split('.').pop();
      if (usedKeys[key] || usedKeys[leaf]) continue;
      var val = flat[key];
      if (isEmptyValue(val)) continue;
      if (key === 'errors') continue;
      var g = pickGroup(key);
      if (!other[g]) other[g] = [];
      other[g].push({ key: key, label: leaf, value: formatValue(leaf, val) });
    }

    var orderedOther = {};
    for (var o = 0; o < OTHER_GROUP_ORDER.length; o++) {
      var name = OTHER_GROUP_ORDER[o];
      if (other[name] && other[name].length) {
        other[name].sort(function (a, b) { return a.label.localeCompare(b.label); });
        orderedOther[name] = other[name];
      }
    }
    return { mostUsed: mostUsed, other: orderedOther };
  }

  function countFields(grouped) {
    var n = grouped.mostUsed.length;
    var names = Object.keys(grouped.other);
    for (var i = 0; i < names.length; i++) n += grouped.other[names[i]].length;
    return n;
  }

  function buildExposureLine(meta) {
    var parts = [];
    var make = firstPresent(meta, ['Make']);
    var model = firstPresent(meta, ['Model']);
    if (make || model) parts.push([make, model].filter(Boolean).join(' '));
    var f = firstPresent(meta, ['FNumber']);
    if (!isEmptyValue(f)) parts.push(formatFNumber(f));
    var shutter = firstPresent(meta, ['ExposureTime']);
    if (!isEmptyValue(shutter)) parts.push(formatExposureTime(shutter));
    var iso = firstPresent(meta, ['ISO', 'ISOSpeedRatings']);
    if (!isEmptyValue(iso)) parts.push('ISO ' + iso);
    var fl = firstPresent(meta, ['FocalLength']);
    if (!isEmptyValue(fl)) parts.push(formatFocal(fl));
    return parts.join(' · ');
  }

  function buildSummary(file, metadata, gps) {
    var w = firstPresent(metadata, ['ImageWidth', 'ExifImageWidth']);
    var h = firstPresent(metadata, ['ImageHeight', 'ExifImageHeight']);
    return {
      name: file.name,
      mime: file.type || 'unknown',
      size: file.size,
      sizeLabel: formatBytes(file.size),
      width: w,
      height: h,
      dimensions: (!isEmptyValue(w) && !isEmptyValue(h)) ? w + ' × ' + h + ' px' : '',
      make: firstPresent(metadata, ['Make']) || '',
      model: firstPresent(metadata, ['Model']) || '',
      lens: firstPresent(metadata, ['LensModel', 'Lens']) || '',
      dateTaken: formatValue('DateTimeOriginal', firstPresent(metadata, ['DateTimeOriginal', 'CreateDate'])) || '',
      exposureLine: buildExposureLine(metadata),
      gps: gps && Number.isFinite(gps.latitude) ? formatCoordinate(gps.latitude, gps.longitude) : null
    };
  }

  function mergeGps(parsed, gpsResult) {
    var lat = parsed && Number.isFinite(Number(parsed.latitude)) ? Number(parsed.latitude) : undefined;
    var lon = parsed && Number.isFinite(Number(parsed.longitude)) ? Number(parsed.longitude) : undefined;
    if (gpsResult) {
      if (!Number.isFinite(lat) && Number.isFinite(gpsResult.latitude)) lat = gpsResult.latitude;
      if (!Number.isFinite(lon) && Number.isFinite(gpsResult.longitude)) lon = gpsResult.longitude;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    var alt = parsed && parsed.GPSAltitude;
    return {
      latitude: lat,
      longitude: lon,
      altitude: alt,
      direction: parsed && parsed.GPSImgDirection,
      speed: parsed && parsed.GPSSpeed,
      dop: parsed && parsed.GPSDOP,
      datum: parsed && parsed.GPSMapDatum
    };
  }

  async function parseFile(file) {
    if (!global.exifr) throw new Error('exifr library is not loaded.');
    var parsed = await global.exifr.parse(file, PARSE_OPTIONS);
    var gpsResult = null;
    var orientation = null;
    var rotation = null;
    var thumbnailUrl = null;
    try { gpsResult = await global.exifr.gps(file); } catch (e) { /* ignore */ }
    try { orientation = await global.exifr.orientation(file); } catch (e) { /* ignore */ }
    try { rotation = await global.exifr.rotation(file); } catch (e) { /* ignore */ }
    try { thumbnailUrl = await global.exifr.thumbnailUrl(file); } catch (e) { /* ignore */ }

    var metadata = parsed && typeof parsed === 'object' ? parsed : {};
    if (orientation != null && metadata.Orientation == null) metadata.Orientation = orientation;
    if (rotation && rotation.deg != null && metadata.Rotation == null) metadata.Rotation = rotation.deg;

    var gps = mergeGps(metadata, gpsResult);
    if (gps) {
      metadata.latitude = gps.latitude;
      metadata.longitude = gps.longitude;
    }

    var flat = flattenMetadata(metadata);
    var grouped = groupMetadata(flat, gps);
    var summary = buildSummary(file, metadata, gps);

    return {
      metadata: metadata,
      flat: flat,
      gps: gps,
      orientation: orientation,
      rotation: rotation,
      thumbnailUrl: thumbnailUrl,
      mostUsed: grouped.mostUsed,
      other: grouped.other,
      summary: summary,
      fieldCount: countFields(grouped)
    };
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function reportFileStem(name) {
    return String(name || 'media').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'media';
  }

  function buildReport(state) {
    return {
      file: state.summary,
      summary: state.summary,
      mostUsed: state.mostUsed,
      other: state.other,
      gps: state.gps,
      mapSnapshot: state.mapSnapshot || null,
      generatedAt: new Date().toISOString(),
      fieldCount: state.fieldCount
    };
  }

  function rowsToHtmlTable(rows) {
    if (!rows || !rows.length) return '<p class="empty">None</p>';
    var html = '<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      html += '<tr><td>' + escapeHtml(rows[i].label) + '</td><td>' + escapeHtml(rows[i].value) + '</td></tr>';
    }
    return html + '</tbody></table>';
  }

  function exportHtml(report) {
    var s = report.summary || {};
    var gps = report.gps;
    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>EXIF Report — ' +
      escapeHtml(s.name) + '</title><style>' +
      'body{font-family:Segoe UI,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:2rem}' +
      'h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:1.75rem;border-bottom:1px solid #334155;padding-bottom:.4rem}' +
      'table{width:100%;border-collapse:collapse;margin:.75rem 0}th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid #334155;vertical-align:top}' +
      'th{color:#94a3b8;font-weight:600;width:32%}td{word-break:break-word}' +
      '.meta{color:#94a3b8;margin:.25rem 0}.line{font-weight:600;color:#a5b4fc}' +
      'img.map{max-width:100%;border-radius:8px;margin:1rem 0}footer{margin-top:2rem;color:#64748b;font-size:.85rem}' +
      '</style></head><body>';
    html += '<h1>EXIF Analyser Report</h1>';
    html += '<p class="meta">' + escapeHtml(s.name) + ' · ' + escapeHtml(s.mime) + ' · ' + escapeHtml(s.sizeLabel);
    if (s.dimensions) html += ' · ' + escapeHtml(s.dimensions);
    html += '</p>';
    if (s.exposureLine) html += '<p class="line">' + escapeHtml(s.exposureLine) + '</p>';
    html += '<h2>Most Used Fields</h2>' + rowsToHtmlTable(report.mostUsed);
    html += '<h2>All Other Fields</h2>';
    var groups = Object.keys(report.other || {});
    if (!groups.length) html += '<p class="empty">No additional fields.</p>';
    for (var i = 0; i < groups.length; i++) {
      html += '<h2>' + escapeHtml(groups[i]) + '</h2>' + rowsToHtmlTable(report.other[groups[i]]);
    }
    if (gps) {
      var c = formatCoordinate(gps.latitude, gps.longitude);
      html += '<h2>GPS</h2><table><tbody>';
      html += '<tr><td>Coordinates</td><td>' + escapeHtml(c.decimal) + '<br>' + escapeHtml(c.dms) + '</td></tr>';
      if (!isEmptyValue(gps.altitude)) html += '<tr><td>Altitude</td><td>' + escapeHtml(formatValue('GPSAltitude', gps.altitude)) + '</td></tr>';
      if (!isEmptyValue(gps.direction)) html += '<tr><td>Direction</td><td>' + escapeHtml(String(gps.direction)) + '</td></tr>';
      html += '<tr><td>OpenStreetMap</td><td><a href="https://www.openstreetmap.org/?mlat=' + gps.latitude + '&amp;mlon=' + gps.longitude + '#map=16/' + gps.latitude + '/' + gps.longitude + '">View map</a></td></tr>';
      html += '</tbody></table>';
      if (report.mapSnapshot) html += '<img class="map" alt="Map snapshot" src="' + report.mapSnapshot + '">';
    }
    html += '<footer>Generated by EXIF Analyser · ' + escapeHtml(report.generatedAt) + ' · ' + report.fieldCount + ' fields</footer></body></html>';
    return html;
  }

  function mdEscape(str) {
    return String(str == null ? '' : str).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function rowsToMdTable(rows) {
    if (!rows || !rows.length) return '_None_\n';
    var md = '| Field | Value |\n| --- | --- |\n';
    for (var i = 0; i < rows.length; i++) {
      md += '| ' + mdEscape(rows[i].label) + ' | ' + mdEscape(rows[i].value) + ' |\n';
    }
    return md + '\n';
  }

  function exportMarkdown(report) {
    var s = report.summary || {};
    var md = '# EXIF Analyser Report\n\n';
    md += '**File:** ' + mdEscape(s.name) + '  \n';
    md += '**Type:** ' + mdEscape(s.mime) + ' · **Size:** ' + mdEscape(s.sizeLabel);
    if (s.dimensions) md += ' · **Dimensions:** ' + mdEscape(s.dimensions);
    md += '\n\n';
    if (s.exposureLine) md += '> ' + mdEscape(s.exposureLine) + '\n\n';
    md += '## Most Used Fields\n\n' + rowsToMdTable(report.mostUsed);
    md += '## All Other Fields\n\n';
    var groups = Object.keys(report.other || {});
    if (!groups.length) md += '_No additional fields._\n\n';
    for (var i = 0; i < groups.length; i++) {
      md += '### ' + groups[i] + '\n\n' + rowsToMdTable(report.other[groups[i]]);
    }
    if (report.gps) {
      var c = formatCoordinate(report.gps.latitude, report.gps.longitude);
      md += '## GPS\n\n';
      md += '- **Coordinates:** ' + c.decimal + ' (' + c.dms + ')\n';
      if (!isEmptyValue(report.gps.altitude)) md += '- **Altitude:** ' + formatValue('GPSAltitude', report.gps.altitude) + '\n';
      if (!isEmptyValue(report.gps.direction)) md += '- **Direction:** ' + report.gps.direction + '\n';
      md += '- **OpenStreetMap:** https://www.openstreetmap.org/?mlat=' + report.gps.latitude + '&mlon=' + report.gps.longitude + '#map=16/' + report.gps.latitude + '/' + report.gps.longitude + '\n\n';
    }
    md += '---\nGenerated by EXIF Analyser · ' + report.generatedAt + ' · ' + report.fieldCount + ' fields\n';
    return md;
  }

  function downloadFile(content, filename, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function exportPdf(report) {
    if (typeof html2pdf === 'undefined') throw new Error('html2pdf is not loaded.');
    var html = exportHtml(report);
    var iframe = document.createElement('iframe');
    iframe.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:800px;height:1100px;border:0;');
    document.body.appendChild(iframe);
    var doc = iframe.contentDocument;
    doc.open();
    doc.write(html.replace('background:#0f172a;color:#e2e8f0', 'background:#ffffff;color:#0f172a'));
    doc.close();
    var body = doc.body;
    var filename = reportFileStem(report.summary && report.summary.name) + '_exif.pdf';
    await html2pdf().set({
      margin: 10,
      filename: filename,
      image: { type: 'jpeg', quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(body).save();
    iframe.remove();
  }

  global.ExifAnalyser = {
    PARSE_OPTIONS: PARSE_OPTIONS,
    MOST_USED_FIELDS: MOST_USED_FIELDS,
    parseFile: parseFile,
    groupMetadata: groupMetadata,
    formatCoordinate: formatCoordinate,
    formatValue: formatValue,
    buildSummary: buildSummary,
    buildReport: buildReport,
    exportHtml: exportHtml,
    exportMarkdown: exportMarkdown,
    exportPdf: exportPdf,
    downloadFile: downloadFile,
    reportFileStem: reportFileStem,
    formatBytes: formatBytes,
    escapeHtml: escapeHtml,
    OTHER_GROUP_ORDER: OTHER_GROUP_ORDER
  };
})(typeof window !== 'undefined' ? window : this);
