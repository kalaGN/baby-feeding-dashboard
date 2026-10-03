(function () {
  'use strict';
  var HEADER = ['记录编号', '日期', '时间', '奶量(ml)', '自动记录', '时间戳(ms)'];
  function fail(message) { throw new Error(message); }
  function pad(n, width) { var s = String(n); while (s.length < (width || 2)) s = '0' + s; return s; }
  function dateParts(at) {
    var d = new Date(at);
    return [d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3)];
  }
  function safeId(id) { return /^[\s]*[=+\-@\t\r\n']/.test(id) ? "'" + id : id; }
  function rawId(id) { return id.charAt(0) === "'" && /^[\s]*[=+\-@\t\r\n']/.test(id.substring(1)) ? id.substring(1) : id; }
  function quote(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
  function validate(entries) {
    if (!Array.isArray(entries) || entries.length > 10000) fail('记录不能超过 10000 条');
    var ids = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 120 || ids[e.id]) fail('记录编号为空、重复或过长');
      ids[e.id] = true;
      if (typeof e.at !== 'number' || !isFinite(e.at) || e.at <= 0 || e.at > 253402214400000 || e.at !== Math.floor(e.at)) fail('记录时间无效');
      if (typeof e.amount !== 'number' || e.amount !== Math.floor(e.amount) || e.amount < 1 || e.amount > 2000) fail('奶量须为 1–2000 ml 的整数');
      if (e.auto !== undefined && typeof e.auto !== 'boolean') fail('自动记录标记无效');
    }
    return entries;
  }
  function checkSize(text) { if (text.length > 1048576 || unescape(encodeURIComponent(text)).length > 1048576) fail('CSV 文件不能超过 1 MB'); }
  function encode(entries) {
    validate(entries);
    var lines = [HEADER.join(',')];
    var sorted = entries.slice().sort(function (a, b) { return a.at - b.at; });
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i], parts = dateParts(e.at);
      lines.push([quote(safeId(e.id)), parts[0], parts[1], e.amount, e.auto ? '是' : '否', e.at].join(','));
    }
    var text = '\ufeff' + lines.join('\r\n') + '\r\n'; checkSize(text); return text;
  }
  function rows(text) {
    var result = [], row = [], field = '', quoted = false, closed = false;
    function endField() { row.push(field); field = ''; closed = false; }
    function endRow() { endField(); if (!(row.length === 1 && row[0] === '')) result.push(row); row = []; if (result.length > 10001) fail('记录不能超过 10000 条'); }
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (quoted) { if (c === '"') { if (text.charAt(i + 1) === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; }
      else if (c === ',') endField();
      else if (c === '\n' || c === '\r') { if (c === '\r' && text.charAt(i + 1) === '\n') i++; endRow(); }
      else if (c === '"' && !field && !closed) quoted = true;
      else { if (closed || c === '"') fail('CSV 引号格式无效'); field += c; }
    }
    if (quoted) fail('CSV 引号未闭合');
    if (field || row.length || closed) endRow();
    return result;
  }
  function decode(text) {
    if (typeof text !== 'string') fail('无法读取 CSV');
    checkSize(text);
    var data = rows(text.replace(/^\ufeff/, ''));
    if (!data.length || data[0].join(',') !== HEADER.join(',')) fail('请选择本应用导出的 CSV 备份（表头不匹配）');
    var entries = [];
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (r.length !== HEADER.length || !/^\d+$/.test(r[3]) || !/^\d+$/.test(r[5]) || (r[4] !== '是' && r[4] !== '否')) fail('第 ' + (i + 1) + ' 行字段无效');
      var at = Number(r[5]);
      // Date and time are human-readable columns; timestamp preserves timezone and milliseconds.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r[1]) || !/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(r[2])) fail('第 ' + (i + 1) + ' 行日期或时间格式无效');
      var date = new Date(r[1] + 'T' + r[2]);
      if (!isFinite(date.getTime()) || dateParts(date.getTime())[0] !== r[1] || dateParts(date.getTime())[1] !== r[2]) fail('日期或时间无效');
      // Across time zones the display columns can differ by up to 26 hours.
      if (Math.abs(date.getTime() - at) > 26 * 3600000) fail('日期时间与时间戳不一致，请勿手动修改备份');
      entries.push({ id: rawId(r[0]), at: at, amount: Number(r[3]), auto: r[4] === '是' });
    }
    return validate(entries);
  }
  window.MilkBackup = { encode: encode, decode: decode, validate: validate };
}());
