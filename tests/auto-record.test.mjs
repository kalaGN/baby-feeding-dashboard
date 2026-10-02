import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const at = (hour, minute = 0) => new Date(2026, 8, 27, hour, minute).getTime();

function start(seed, initialNow, remote = { revision: 0, state: null }) {
  let now = initialNow;
  let intervalTick;
  const data = { 'milk-board-v1': JSON.stringify(seed) };
  const elements = {};
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; this.className = ''; }
    get firstChild() { return this.children[0] || null; }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    setAttribute() {}
    removeAttribute() {}
    reset() {}
    focus() {}
  }
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const document = {
    documentElement: { className: '' },
    getElementById(id) { return elements[id] ||= new Element(); },
    createElement() { return new Element(); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const localStorage = {
    getItem(key) { return data[key] || null; },
    setItem(key, value) { data[key] = value; },
    removeItem(key) { delete data[key]; },
  };
  class XMLHttpRequest {
    open(method) { this.method = method; }
    setRequestHeader() {}
    send(body) {
      if (this.method === 'GET') {
        this.status = 200;
        this.responseText = JSON.stringify({ initialized: remote.revision > 0, revision: remote.revision, state: remote.state });
      } else {
        const submitted = JSON.parse(body);
        if (submitted.revision !== remote.revision) {
          this.status = 409;
          this.responseText = JSON.stringify({ revision: remote.revision });
        } else {
          remote.revision++;
          remote.state = submitted.state;
          this.status = 200;
          this.responseText = JSON.stringify(remote);
        }
      }
      this.readyState = 4;
      this.onreadystatechange();
    }
  }
  const window = { addEventListener() {} };
  vm.runInNewContext(source, {
    Date: FakeDate, Math, JSON, Object, String, Number, isFinite,
    document, localStorage, window, navigator: {}, location: { protocol: 'file:' }, XMLHttpRequest,
    setInterval(fn) { intervalTick = fn; }, setTimeout() {},
    alert(message) { throw new Error(message); }, confirm() { return true; },
  });
  return {
    tick(time) { now = time; intervalTick(); },
    state() { return JSON.parse(data['milk-board-v1']); },
    remote() { return remote.state; },
    text(id) { return elements[id].textContent; },
    click(id) { elements[id].listeners.click(); },
    editFirstEntry() { elements.history.children[0].children[0].listeners.click(); },
    set(id, value) { elements[id].value = String(value); },
    submit(id) { elements[id].listeners.submit({ preventDefault() {} }); },
    reload(time) { return start(this.state(), time); },
  };
}

test('到点按上一笔奶量自动记一笔，刷新和重复计时不重记', () => {
  const app = start({ intervalHours: 3, entries: [{ id: 'manual', at: at(11), amount: 150 }] }, at(13, 59));
  assert.equal(app.text('nextFeedTime'), '14:00');
  app.tick(at(14));
  assert.equal(app.state().entries.length, 2);
  assert.equal(app.state().entries[1].amount, 150);
  assert.equal(app.state().entries[1].at, at(14));
  assert.equal(app.state().entries[1].auto, true);
  app.tick(at(14, 1));
  assert.equal(app.reload(at(14, 1)).state().entries.length, 2);
});

test('没有上一笔时使用 120ml，错过很久的时段不补记', () => {
  const app = start({ intervalHours: 1, intervalStartedAt: at(10), entries: [] }, at(10, 59));
  app.tick(at(11));
  assert.equal(app.state().entries[0].amount, 120);

  const missed = start({ intervalHours: 1, entries: [{ id: 'manual', at: at(10), amount: 90 }] }, at(13, 10));
  assert.equal(missed.state().entries.length, 1);
  assert.equal(missed.text('nextFeedTime'), '14:00');
  missed.tick(at(14));
  assert.equal(missed.state().entries[1].amount, 90);
  assert.equal(missed.state().entries[1].at, at(14));
});

test('旧数据只有间隔、没有记录时，从首次打开的下一整分钟开始计时', () => {
  const app = start({ intervalHours: 3, entries: [] }, at(10, 0) + 20000);
  assert.equal(app.state().intervalStartedAt, at(10, 1));
  assert.equal(app.text('nextFeedTime'), '13:01');
});

test('新增记录只选月日时分，跨年可记录前一天且拒绝未来时间', () => {
  const app = start({ intervalHours: null, entries: [] }, new Date(2026, 0, 1, 0, 30).getTime());
  app.click('addButton');
  app.set('amountInput', 120);
  app.set('monthInput', 12);
  app.set('dayInput', 31);
  app.set('timeInput', '23:30');
  app.submit('feedForm');
  assert.equal(app.state().entries[0].at, new Date(2025, 11, 31, 23, 30).getTime());

  app.click('addButton');
  app.set('amountInput', 120);
  app.set('monthInput', 1);
  app.set('dayInput', 1);
  app.set('timeInput', '01:00');
  app.submit('feedForm');
  assert.equal(app.state().entries.length, 1);
  assert.match(app.text('feedError'), /不能晚于现在/);
});

test('编辑记录保留原日期与记录 ID', () => {
  const original = { id: 'existing', at: at(10), amount: 100 };
  const app = start({ intervalHours: null, entries: [original] }, at(11));
  app.editFirstEntry();
  assert.equal(app.text('feedDialogEyebrow'), '编辑记录');
  app.set('amountInput', 130);
  app.set('timeInput', '09:30');
  app.submit('feedForm');
  assert.equal(app.state().entries.length, 1);
  assert.equal(app.state().entries[0].id, original.id);
  assert.equal(app.state().entries[0].at, at(9, 30));
  assert.equal(app.state().entries[0].amount, 130);
});

test('间隔支持一位小数，3.1 小时得到 3 小时 6 分钟', () => {
  const app = start({ intervalHours: null, entries: [{ id: 'manual', at: at(10), amount: 120 }] }, at(10));
  app.click('intervalButton');
  app.set('intervalInput', '3.1');
  app.submit('intervalForm');
  assert.equal(app.state().intervalHours, 3.1);
  assert.equal(app.text('nextFeedTime'), '13:06');

  app.click('intervalButton');
  app.set('intervalInput', '3.15');
  app.submit('intervalForm');
  assert.equal(app.state().intervalHours, 3.1);
  assert.match(app.text('intervalError'), /3.1/);
});

test('空白浏览器不会抢先初始化服务器，第一笔记录会写入服务器', () => {
  const remote = { revision: 0, state: null };
  const app = start({ intervalHours: null, entries: [] }, at(10), remote);
  assert.equal(remote.revision, 0);
  app.click('addButton');
  app.set('amountInput', 120);
  app.submit('feedForm');
  assert.equal(remote.revision, 1);
  assert.equal(app.remote().entries[0].amount, 120);
});

test('服务器已有记录时优先读取服务器，不用旧浏览器副本覆盖', () => {
  const remote = {
    revision: 2,
    state: { intervalHours: null, intervalStartedAt: null, entries: [{ id: 'server', at: at(9), amount: 140 }] },
  };
  const app = start({ intervalHours: null, entries: [{ id: 'stale', at: at(8), amount: 100 }] }, at(10), remote);
  assert.equal(app.state().entries[0].id, 'server');
  assert.equal(remote.revision, 2);
});
