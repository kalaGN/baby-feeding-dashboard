(function () {
  'use strict';
  var board = window.MilkBoard, csv = window.MilkBackup;
  var android = window.AndroidStore;
  var ios = window.IOSFiles;
  var version = 'Web';
  var pending = null, busy = false, page = 'Home';
  function el(id) { return document.getElementById(id); }
  function status(text) { el('settingsStatus').textContent = text || ''; }
  function lock(value) {
    busy = value;
    var ids = ['exportCsv', 'importCsv', 'readServerBackup', 'confirmRestore', 'cancelRestore', 'settingsBack', 'settingsClose'];
    for (var i = 0; i < ids.length; i++) el(ids[i]).disabled = value;
  }
  function show(name) {
    page = name;
    var names = ['Home', 'Backup', 'Server', 'Preview', 'About', 'Update'];
    for (var i = 0; i < names.length; i++) el('settings' + names[i]).hidden = names[i] !== name;
    el('settingsBack').hidden = name === 'Home';
    el('settingsTitle').textContent = { Home: '设置', Backup: '备份与还原', Server: '从服务器还原', Preview: '确认还原', About: '关于', Update: '检查更新' }[name];
    status('');
  }
  function open() { if (busy) return; pending = null; show('Home'); board.openDialog('settingsDialog'); }
  function preview(next, source) {
    var current = board.snapshot();
    csv.validate(next.entries);
    if (next.intervalHours !== null && (typeof next.intervalHours !== 'number' || next.intervalHours < .5 || next.intervalHours > 24 || !isFinite(next.intervalHours) || Math.abs(next.intervalHours * 10 - Math.round(next.intervalHours * 10)) > 1e-8)) throw new Error('备份间隔无效');
    if (next.intervalStartedAt !== null && (typeof next.intervalStartedAt !== 'number' || !isFinite(next.intervalStartedAt) || next.intervalStartedAt <= 0)) throw new Error('备份计时起点无效');
    pending = { state: next, revision: current.revision };
    show('Preview');
    el('backupSource').textContent = source;
    el('backupCount').textContent = String(next.entries.length);
    var sorted = next.entries.slice().sort(function (a,b) { return a.at - b.at; });
    el('backupRange').textContent = sorted.length ? new Date(sorted[0].at).toLocaleDateString() + ' — ' + new Date(sorted[sorted.length - 1].at).toLocaleDateString() : '这是一个空备份';
    el('backupReplace').textContent = '还原将替换当前的 ' + current.state.entries.length + ' 条记录。' + (!sorted.length ? '确认后将清空全部记录。' : '请先导出当前记录留存备份。');
  }
  function receiveCsv(text, name) {
    var entries = csv.decode(text), current = board.snapshot();
    preview({ intervalHours: current.state.intervalHours, intervalStartedAt: Math.ceil(Date.now() / 60000) * 60000, entries: entries }, 'CSV 文件：' + (name || '备份.csv'));
  }
  window.MilkFilesReply = function (operation, result) {
    lock(false);
    if (result.cancelled) { status('已取消，记录未改变'); return; }
    if (result.error) { status(result.error); return; }
    try {
      if (operation === 'import') receiveCsv(result.text, result.name);
      if (operation === 'export') status('CSV 已保存');
      if (operation === 'server') {
        if (page !== 'Server') return;
        preview(result.state, '服务器备份');
      }
    } catch (error) { status(error.message); }
  };
  window.MilkSettings = { open: open };
  if (android && android.version) { try { version = android.version(); } catch (ignored) {} }
  else if (ios) version = ios.version || 'iPad';
  el('settingsVersion').textContent = version === 'Web' ? '网页版' : '当前版本 v' + version;
  el('aboutVersion').textContent = version === 'Web' ? '网页版' : '版本 v' + version;
  el('serverRestoreMenu').hidden = !(android && android.readServer);
  el('runUpdate').hidden = !(android && android.checkUpdate);
  el('settingsButton').addEventListener('click', open);
  el('settingsClose').addEventListener('click', function () { if (!busy) { pending = null; board.closeDialog('settingsDialog'); } });
  el('settingsDialog').addEventListener('cancel', function (event) { if (busy) event.preventDefault(); else pending = null; });
  el('settingsBack').addEventListener('click', function () { if (!busy) { pending = null; show(page === 'Home' || page === 'About' || page === 'Update' || page === 'Backup' ? 'Home' : 'Backup'); } });
  el('backupMenu').addEventListener('click', function () { show('Backup'); });
  el('aboutMenu').addEventListener('click', function () { show('About'); });
  el('updateMenu').addEventListener('click', function () {
    show('Update');
    el('updateExplanation').textContent = android && android.checkUpdate ? '当前版本 v' + version + '。启动时每天最多自动检查一次，也可以手动检查。' : ios ? 'iPad 安装版通过 Xcode 安装新版，目前不支持应用内自动更新。' : '网页版刷新页面即可获取新版；Android 安装包可从 GitHub Releases 下载。';
  });
  el('runUpdate').addEventListener('click', function () { android.checkUpdate(); });
  el('exportCsv').addEventListener('click', function () {
    if (busy) return;
    try {
      var text = csv.encode(board.snapshot().state.entries);
      var date = new Date(), name = 'baby-feeding-' + date.getFullYear() + '-' + (date.getMonth()+1) + '-' + date.getDate() + '.csv';
      if (android && android.exportCsv) { lock(true); status('请选择 CSV 保存位置'); android.exportCsv(text, name); }
      else if (ios) { lock(true); status('请选择 CSV 保存位置'); ios.exportCsv(text, name); }
      else {
        var url = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'})), link = document.createElement('a');
        link.href = url; link.download = name; document.body.appendChild(link); link.click(); document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000); status('CSV 已生成，请在浏览器下载中查看');
      }
    } catch (error) { lock(false); status(error.message); }
  });
  el('importCsv').addEventListener('click', function () {
    if (busy) return;
    try {
      board.snapshot();
      if (android && android.importCsv) { lock(true); status('请选择 CSV 备份'); android.importCsv(); }
      else if (ios) { lock(true); status('请选择 CSV 备份'); ios.importCsv(); }
      else { el('csvFile').value = ''; el('csvFile').click(); }
    } catch (error) { lock(false); status(error.message); }
  });
  el('csvFile').addEventListener('change', function () {
    var file = this.files && this.files[0]; if (!file) return;
    if (file.size > 1048576) { status('CSV 文件不能超过 1 MB'); return; }
    lock(true);
    var reader = new FileReader();
    reader.onload = function () { lock(false); try { receiveCsv(reader.result, file.name); } catch (error) { status(error.message); } };
    reader.onerror = function () { lock(false); status('无法读取文件，原记录未改变'); };
    reader.readAsText(file, 'UTF-8');
  });
  el('confirmRestore').addEventListener('click', function () {
    if (!pending || busy) return;
    lock(true); status('正在还原…');
    board.restore(pending.state, pending.revision, function (error) {
      lock(false);
      if (error) { pending = null; show('Backup'); status(error + '，原记录未被本次还原覆盖'); }
      else { pending = null; show('Backup'); status('还原成功，记录已保存'); }
    });
  });
  el('cancelRestore').addEventListener('click', function () { pending = null; show('Backup'); status('已取消，记录未改变'); });
  el('serverRestoreMenu').addEventListener('click', function () { show('Server'); el('backupServer').value = android.serverAddress(); });
  el('readServerBackup').addEventListener('click', function () {
    if (busy) return;
    try { board.snapshot(); lock(true); status('正在读取服务器记录…'); android.readServer(el('backupServer').value); }
    catch (error) { lock(false); status(error.message); }
  });
}());
