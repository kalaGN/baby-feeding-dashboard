(function () {
  'use strict';
  var nativeStore = window.AndroidStore && typeof window.AndroidStore.request === 'function' ? window.AndroidStore : null;
  var KEY = 'milk-board-v1';
  var REVISION_KEY = 'milk-board-server-revision-v1';
  var PENDING_KEY = 'milk-board-server-pending-v1';
  var state = readState();
  var serverRevision = 0;
  var pendingSave = false;
  var serverReady = false;
  var serverBusy = false;
  var connecting = false;
  var serverConflict = false;
  var changeSerial = 0;
  var editingEntryId = null;
  var wakeLock = null;
  var AUTO_GRACE_MS = 2 * 60000;
  var weekNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function byId(id) { return document.getElementById(id); }
  function pad(value) { return value < 10 ? '0' + value : String(value); }
  function nextMinute(timestamp) { return Math.ceil(timestamp / 60000) * 60000; }
  function formatTime(timestamp) {
    var date = new Date(timestamp);
    return pad(date.getHours()) + ':' + pad(date.getMinutes());
  }
  function formatDate(date) {
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + weekNames[date.getDay()];
  }
  function sameLocalDay(timestamp, date) {
    var itemDate = new Date(timestamp);
    return itemDate.getFullYear() === date.getFullYear() && itemDate.getMonth() === date.getMonth() && itemDate.getDate() === date.getDate();
  }
  function validEntry(entry) {
    return entry && typeof entry.id === 'string' && typeof entry.at === 'number' && isFinite(entry.at) && typeof entry.amount === 'number' && entry.amount === Math.floor(entry.amount) && entry.amount > 0 && entry.amount <= 2000;
  }
  function readState() {
    var empty = { intervalHours: null, intervalStartedAt: null, entries: [] };
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (typeof raw.intervalHours === 'number' && isFinite(raw.intervalHours) && raw.intervalHours >= 0.5 && raw.intervalHours <= 24) empty.intervalHours = raw.intervalHours;
      if (typeof raw.intervalStartedAt === 'number' && isFinite(raw.intervalStartedAt) && raw.intervalStartedAt > 0) empty.intervalStartedAt = raw.intervalStartedAt;
      if (Object.prototype.toString.call(raw.entries) === '[object Array]') {
        for (var i = 0; i < raw.entries.length; i++) if (validEntry(raw.entries[i])) empty.entries.push(raw.entries[i]);
      }
    } catch (error) { /* Browser storage may be disabled. */ }
    return empty;
  }
  try {
    serverRevision = Number(localStorage.getItem(REVISION_KEY) || 0);
    if (!isFinite(serverRevision) || serverRevision < 0) serverRevision = 0;
    pendingSave = localStorage.getItem(PENDING_KEY) === '1';
  } catch (error) { /* Connection status is checked below. */ }
  function cacheState() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (error) { alert('浏览器无法暂存记录，请检查存储空间或隐私设置。'); return false; }
  }
  function sameState(a, b) {
    if (!b || a.intervalHours !== b.intervalHours || a.intervalStartedAt !== b.intervalStartedAt || a.entries.length !== b.entries.length) return false;
    var left = a.entries.slice().sort(function (x, y) { return x.id < y.id ? -1 : x.id > y.id ? 1 : 0; });
    var right = b.entries.slice().sort(function (x, y) { return x.id < y.id ? -1 : x.id > y.id ? 1 : 0; });
    for (var i = 0; i < left.length; i++) {
      if (left[i].id !== right[i].id || left[i].at !== right[i].at || left[i].amount !== right[i].amount || !!left[i].auto !== !!right[i].auto) return false;
    }
    return true;
  }
  function saveState(silent) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (error) {
      if (!silent) alert('浏览器无法暂存记录，请检查存储空间或隐私设置。');
      return false;
    }
    if (serverReady) {
      pendingSave = true;
      changeSerial++;
      try { localStorage.setItem(PENDING_KEY, '1'); } catch (error) { /* Retry while page stays open. */ }
      flushState();
    }
    return true;
  }
  function api(method, payload, done) {
    if (nativeStore) {
      try {
        var local = JSON.parse(nativeStore.request(method, payload ? JSON.stringify(payload) : ''));
        done(local.status === 200 ? null : (local.body.error || '无法保存到平板，请检查存储空间。'), local.body);
      } catch (error) { done('无法读取平板记录，请检查存储空间。'); }
      return;
    }
    if (typeof XMLHttpRequest !== 'function') { done('浏览器不支持连接服务器'); return; }
    var request = new XMLHttpRequest();
    request.open(method, './api/state', true);
    request.timeout = 8000;
    if (payload) request.setRequestHeader('Content-Type', 'application/json');
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      var result;
      try { result = JSON.parse(request.responseText); } catch (error) { result = null; }
      if (request.status >= 200 && request.status < 300 && result) done(null, result);
      else done(request.status === 409 ? '服务器记录已变化，请保留此页面并检查其他设备。' : '无法连接或保存到服务器，记录暂存在本机。', result);
    };
    request.ontimeout = function () { request.onreadystatechange = null; done('连接服务器超时，记录暂存在本机。'); };
    request.onerror = function () { request.onreadystatechange = null; done('无法连接服务器，记录暂存在本机。'); };
    request.send(payload ? JSON.stringify(payload) : null);
  }
  function setReady(ready) {
    serverReady = ready;
    byId('addButton').disabled = !ready;
    byId('intervalButton').disabled = !ready;
  }
  function flushState() {
    if (!serverReady || serverBusy || serverConflict || !pendingSave) return;
    serverBusy = true;
    var serial = changeSerial;
    api('PUT', { revision: serverRevision, state: state }, function (error, result) {
      serverBusy = false;
      if (error) {
        if (result && result.revision !== undefined) {
          if (sameState(state, result.state)) {
            pendingSave = false;
            try { localStorage.removeItem(PENDING_KEY); } catch (ignored) {}
            acceptServer(result);
            return;
          }
          serverConflict = true;
          setReady(false);
        }
        byId('runtimeStatus').textContent = error;
        return;
      }
      serverRevision = result.revision;
      try { localStorage.setItem(REVISION_KEY, String(serverRevision)); } catch (ignored) {}
      if (serial === changeSerial) {
        pendingSave = false;
        try { localStorage.removeItem(PENDING_KEY); } catch (ignored) {}
        byId('runtimeStatus').textContent = '';
      } else flushState();
    });
  }
  function acceptServer(result) {
    state = result.state;
    serverRevision = result.revision;
    try { localStorage.setItem(REVISION_KEY, String(serverRevision)); } catch (ignored) {}
    cacheState();
    setReady(true);
    byId('runtimeStatus').textContent = '';
    render();
  }
  function connectServer() {
    if (connecting || serverConflict) return;
    connecting = true;
    byId('runtimeStatus').textContent = nativeStore ? '正在读取平板记录…' : '正在连接服务器…';
    setReady(false);
    api('GET', null, function (error, result) {
      connecting = false;
      if (error) { byId('runtimeStatus').textContent = nativeStore ? error : '无法连接服务器，现有记录暂存在本机；连接恢复后再编辑。'; return; }
      if (!result.initialized && !pendingSave && !state.entries.length && !state.intervalHours) {
        serverRevision = 0;
        setReady(true);
        byId('runtimeStatus').textContent = '';
        render();
        return;
      }
      if (!result.initialized || pendingSave) {
        if (result.initialized && result.revision !== serverRevision) {
          if (sameState(state, result.state)) {
            pendingSave = false;
            try { localStorage.removeItem(PENDING_KEY); } catch (ignored) {}
            acceptServer(result);
            return;
          }
          serverConflict = true;
          byId('runtimeStatus').textContent = '服务器记录已变化，本机未同步记录仍保留。请先备份数据，避免覆盖。';
          return;
        }
        serverRevision = result.revision;
        pendingSave = true;
        try { localStorage.setItem(PENDING_KEY, '1'); } catch (ignored) {}
        setReady(true);
        if (state.intervalHours && !state.entries.length && !state.intervalStartedAt) {
          state.intervalStartedAt = nextMinute(Date.now());
          cacheState();
        }
        render();
        flushState();
      } else acceptServer(result);
    });
  }
  function latestEntry(now) {
    var last = null;
    for (var i = 0; i < state.entries.length; i++) {
      var entry = state.entries[i];
      if (entry.at <= now && (!last || entry.at > last.at)) last = entry;
    }
    return last;
  }
  function nextScheduledAt(anchor, now) {
    var intervalMs = Math.round(state.intervalHours * 3600000);
    var nextAt = anchor + intervalMs;
    if (nextAt < now - AUTO_GRACE_MS) {
      nextAt += Math.ceil((now - AUTO_GRACE_MS - nextAt) / intervalMs) * intervalMs;
    }
    return nextAt;
  }
  function autoRecordIfDue(now) {
    if (!state.intervalHours) return;
    var last = latestEntry(now);
    var anchor = last ? last.at : state.intervalStartedAt;
    if (!anchor) return;
    var nextAt = nextScheduledAt(anchor, now);
    if (nextAt > now) return;
    var id = 'auto-' + nextAt;
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].id === id || state.entries[i].at === nextAt) return;
    }
    var entry = { id: id, at: nextAt, amount: last ? last.amount : 120, auto: true };
    state.entries.push(entry);
    if (!saveState(true)) {
      state.entries.pop();
      byId('runtimeStatus').textContent = '自动记录未能保存，请检查浏览器存储空间。';
    }
  }
  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function textElement(tag, className, value) {
    var node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }
  function addDateOptions(id, count, suffix) {
    var select = byId(id);
    for (var number = 1; number <= count; number++) {
      var option = document.createElement('option');
      option.value = String(number);
      option.textContent = number + suffix;
      select.appendChild(option);
    }
  }
  addDateOptions('monthInput', 12, '月');
  addDateOptions('dayInput', 31, '日');
  function selectedFeedTime() {
    var month = Number(byId('monthInput').value);
    var day = Number(byId('dayInput').value);
    var match = /^(\d{2}):(\d{2})$/.exec(byId('timeInput').value);
    if (!match || month < 1 || month > 12 || day < 1 || day > 31) return NaN;
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    if (hour > 23 || minute > 59) return NaN;
    var today = new Date();
    var year = today.getFullYear();
    if (editingEntryId) {
      var original = null;
      for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === editingEntryId) { original = state.entries[i]; break; }
      if (!original) return NaN;
      year = new Date(original.at).getFullYear();
    } else if (today.getMonth() === 0 && month === 12) {
      year--;
    }
    var date = new Date(year, month - 1, day, hour, minute);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return NaN;
    return date.getTime();
  }
  function makeEntryCard(entry) {
    var card = document.createElement('div');
    card.className = 'entry';
    var edit = document.createElement('button');
    edit.className = 'entry-edit';
    edit.type = 'button';
    edit.setAttribute('aria-label', '编辑 ' + formatTime(entry.at) + ' 的 ' + entry.amount + ' 毫升记录');
    var icon = textElement('span', 'entry-icon', '♧');
    icon.setAttribute('aria-hidden', 'true');
    var main = document.createElement('span');
    main.className = 'entry-main';
    main.appendChild(textElement('strong', '', entry.amount + ' ml'));
    main.appendChild(textElement('span', '', formatTime(entry.at) + (entry.auto ? ' · 自动' : '')));
    edit.appendChild(icon);
    edit.appendChild(main);
    edit.appendChild(textElement('span', 'entry-edit-hint', '编辑'));
    edit.addEventListener('click', function () { if (serverReady) openFeedDialog(entry); });
    var remove = textElement('button', 'delete-entry', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', '删除 ' + formatTime(entry.at) + ' 的 ' + entry.amount + ' 毫升记录');
    remove.addEventListener('click', function () {
      if (!serverReady) return;
      if (!confirm('删除 ' + formatTime(entry.at) + ' 的 ' + entry.amount + ' ml 记录？')) return;
      var old = state.entries;
      var remaining = [];
      for (var i = 0; i < old.length; i++) if (old[i].id !== entry.id) remaining.push(old[i]);
      state.entries = remaining;
      var oldStart = state.intervalStartedAt;
      if (!remaining.length && state.intervalHours) state.intervalStartedAt = nextMinute(Date.now());
      if (!saveState()) { state.entries = old; state.intervalStartedAt = oldStart; }
      render();
    });
    card.appendChild(edit);
    card.appendChild(remove);
    return card;
  }
  function render() {
    var now = new Date();
    var currentTime = now.getTime();
    byId('clock').textContent = formatTime(currentTime);
    byId('todayDate').textContent = formatDate(now);
    var entries = state.entries.slice().sort(function (a, b) { return b.at - a.at; });
    var today = [];
    var last = latestEntry(currentTime);
    var total = 0;
    for (var i = 0; i < entries.length; i++) {
      if (sameLocalDay(entries[i].at, now)) {
        today.push(entries[i]);
        total += entries[i].amount;
      }
    }
    byId('lastFeed').textContent = last ? formatTime(last.at) : '还没有记录';
    byId('lastDetail').textContent = last ? last.amount + ' ml · ' + (sameLocalDay(last.at, now) ? '今天' : formatDate(new Date(last.at))) : '记录第一笔后显示奶量';
    byId('todayTotal').textContent = String(total);
    byId('todayCount').textContent = String(today.length);
    byId('intervalText').textContent = state.intervalHours ? state.intervalHours + ' 小时' : '设置间隔';

    if (!state.intervalHours || (!last && !state.intervalStartedAt)) {
      byId('nextFeedTime').textContent = '--:--';
    } else {
      var nextAt = nextScheduledAt(last ? last.at : state.intervalStartedAt, currentTime);
      byId('nextFeedTime').textContent = formatTime(nextAt);
    }

    var history = byId('history');
    clearChildren(history);
    if (!today.length) history.appendChild(textElement('p', 'empty-history', '今天还没有喝奶记录'));
    else for (i = 0; i < today.length; i++) history.appendChild(makeEntryCard(today[i]));
  }
  function openDialog(id) {
    var dialog = byId(id);
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  function closeDialog(id) {
    var dialog = byId(id);
    if (dialog.close) dialog.close();
    else dialog.removeAttribute('open');
  }

  var amountOptions = [];
  var amountWheel = byId('amountWheel');
  var amountRowHeight = 48;
  var amountSnapTimer = null;
  function showSelectedAmount() {
    var value = Number(byId('amountInput').value);
    byId('amountValue').textContent = String(value);
    amountWheel.setAttribute('aria-activedescendant', 'amount-option-' + value);
    for (var a = 0; a < amountOptions.length; a++) {
      var selected = (a + 1) * 10 === value;
      amountOptions[a].className = selected ? 'amount-option selected' : 'amount-option';
      amountOptions[a].setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  }
  function selectAmount(value, scroll) {
    value = Math.max(10, Math.min(300, Math.round(value / 10) * 10));
    byId('amountInput').value = value;
    showSelectedAmount();
    if (scroll) amountWheel.scrollTop = (value / 10 - 1) * amountRowHeight;
  }
  for (var amountChoice = 10; amountChoice <= 300; amountChoice += 10) {
    (function (value) {
      var option = textElement('div', 'amount-option', String(value));
      option.id = 'amount-option-' + value;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-label', value + ' 毫升');
      option.addEventListener('click', function () { selectAmount(value, true); });
      amountWheel.appendChild(option);
      amountOptions.push(option);
    }(amountChoice));
  }
  amountWheel.addEventListener('scroll', function () {
    selectAmount((Math.round(amountWheel.scrollTop / amountRowHeight) + 1) * 10, false);
    if (amountSnapTimer !== null) clearTimeout(amountSnapTimer);
    amountSnapTimer = setTimeout(function () {
      amountSnapTimer = null;
      selectAmount(Number(byId('amountInput').value), true);
    }, 120);
  });
  amountWheel.addEventListener('keydown', function (event) {
    var value = Number(byId('amountInput').value);
    if (event.key === 'ArrowUp') value -= 10;
    else if (event.key === 'ArrowDown') value += 10;
    else if (event.key === 'Home') value = 10;
    else if (event.key === 'End') value = 300;
    else return;
    event.preventDefault(); selectAmount(value, true);
  });
  byId('amountInput').addEventListener('input', showSelectedAmount);
  byId('amountInput').addEventListener('change', showSelectedAmount);
  function openFeedDialog(entry) {
    editingEntryId = entry ? entry.id : null;
    byId('feedForm').reset();
    byId('feedError').textContent = '';
    var date = entry ? new Date(entry.at) : new Date();
    byId('amountInput').value = entry ? Math.max(10, Math.min(300, Math.round(entry.amount / 10) * 10)) : 120;
    showSelectedAmount();
    byId('monthInput').value = String(date.getMonth() + 1);
    byId('dayInput').value = String(date.getDate());
    byId('timeInput').value = formatTime(date.getTime());
    byId('feedDialogEyebrow').textContent = entry ? '编辑记录' : '添加记录';
    byId('feedSubmitButton').textContent = entry ? '保存修改' : '保存记录';
    openDialog('feedDialog');
    selectAmount(Number(byId('amountInput').value), true);
    amountWheel.focus();
  }
  byId('addButton').addEventListener('click', function () {
    if (!serverReady) return;
    openFeedDialog(null);
  });
  byId('intervalButton').addEventListener('click', function () {
    if (!serverReady) return;
    byId('intervalError').textContent = '';
    byId('intervalInput').value = state.intervalHours || '';
    openDialog('intervalDialog');
    byId('intervalInput').focus();
  });
  var closeButtons = document.querySelectorAll('[data-close]');
  for (var c = 0; c < closeButtons.length; c++) {
    closeButtons[c].addEventListener('click', function () { closeDialog(this.getAttribute('data-close')); });
  }
  byId('feedForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!serverReady) return;
    var amount = Number(byId('amountInput').value);
    var at = selectedFeedTime();
    if (amount !== Math.floor(amount) || amount < 10 || amount > 300 || amount % 10 !== 0 || !isFinite(at) || at > Date.now() + 60000) {
      byId('feedError').textContent = '请选择有效的月、日、时间和奶量，不能晚于现在。';
      return;
    }
    if (editingEntryId) {
      var index = -1;
      for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === editingEntryId) { index = i; break; }
      if (index < 0) {
        byId('feedError').textContent = '这条记录已不存在，请关闭后重试。';
        return;
      }
      var original = state.entries[index];
      state.entries[index] = { id: original.id, amount: amount, at: at };
      if (!saveState()) { state.entries[index] = original; return; }
    } else {
      var entry = { id: Date.now() + '-' + Math.random().toString(36).slice(2), amount: amount, at: at };
      state.entries.push(entry);
      if (!saveState()) { state.entries.pop(); return; }
    }
    editingEntryId = null;
    closeDialog('feedDialog');
    render();
  });
  byId('intervalForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!serverReady) return;
    var hours = Number(byId('intervalInput').value);
    var tenths = Math.round(hours * 10);
    if (!isFinite(hours) || hours < 0.5 || hours > 24 || Math.abs(hours * 10 - tenths) > 1e-8) {
      byId('intervalError').textContent = '请输入 0.5 至 24 小时，可填 3.1 这样的数值。';
      return;
    }
    hours = tenths / 10;
    var old = state.intervalHours;
    var oldStart = state.intervalStartedAt;
    state.intervalHours = hours;
    state.intervalStartedAt = nextMinute(Date.now());
    if (!saveState()) { state.intervalHours = old; state.intervalStartedAt = oldStart; return; }
    closeDialog('intervalDialog');
    render();
  });
  function nightModeEnabled() {
    return (' ' + document.documentElement.className + ' ').indexOf(' night ') !== -1;
  }
  function applyTheme(night) {
    document.documentElement.className = night ? 'night' : '';
    byId('themeColor').setAttribute('content', night ? '#0e1714' : '#f5f2e9');
    byId('themeButton').textContent = night ? '☀' : '☾';
    byId('themeButton').setAttribute('aria-pressed', night ? 'true' : 'false');
    byId('themeButton').setAttribute('aria-label', night ? '切换日间模式' : '切换夜间模式');
    byId('themeButton').title = night ? '切换日间模式' : '切换夜间模式';
  }
  byId('themeButton').addEventListener('click', function () {
    var night = !nightModeEnabled();
    applyTheme(night);
    try { localStorage.setItem('milk-board-theme-v1', night ? 'night' : 'day'); } catch (error) { /* Theme still changes for this page. */ }
  });
  applyTheme(nightModeEnabled());
  function keepScreenAwake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request('screen').then(function (lock) { wakeLock = lock; }, function () { wakeLock = null; });
  }
  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || document.webkitIsFullScreen;
  }
  function fullscreenFailed() {
    byId('runtimeStatus').textContent = '这个浏览器未能进入全屏。可尝试用 Chrome 打开，或使用浏览器菜单中的全屏选项。';
  }
  byId('fullscreenButton').addEventListener('click', function () {
    try {
      var entering = !fullscreenElement();
      var method;
      var result;
      if (fullscreenElement()) {
        method = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
        if (!method) { fullscreenFailed(); return; }
        result = method.call(document);
        if (wakeLock && wakeLock.release) wakeLock.release();
        wakeLock = null;
      } else {
        method = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen || document.documentElement.webkitRequestFullScreen;
        if (!method) { fullscreenFailed(); return; }
        result = method.call(document.documentElement);
        keepScreenAwake();
      }
      byId('runtimeStatus').textContent = '';
      if (result && typeof result.then === 'function') result.then(null, fullscreenFailed);
      if (entering) setTimeout(function () { if (!fullscreenElement()) fullscreenFailed(); }, 800);
    } catch (error) { fullscreenFailed(); }
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      tick();
      if (fullscreenElement()) keepScreenAwake();
    }
  });

  function tick() {
    var now = Date.now();
    if (!serverReady && !serverConflict) connectServer();
    if (serverReady) autoRecordIfDue(now);
    render();
    if (serverReady && pendingSave && !serverBusy) flushState();
    if (serverReady && !pendingSave && !serverBusy) {
      serverBusy = true;
      api('GET', null, function (error, result) {
        serverBusy = false;
        if (error) { byId('runtimeStatus').textContent = '暂时无法读取服务器，页面显示上次同步的记录。'; return; }
        if (pendingSave) { flushState(); return; }
        if (result.revision !== serverRevision) acceptServer(result);
        else byId('runtimeStatus').textContent = '';
      });
    }
  }
  window.addEventListener('storage', function (event) {
    if (event.key === KEY) { state = readState(); tick(); }
  });
  tick();
  setInterval(tick, 30000);
  window.milkBoardReady = true;
  if (!nativeStore && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').then(null, function () {});
}());
