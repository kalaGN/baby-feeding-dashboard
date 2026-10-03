import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const at = (hour, minute = 0) => new Date(2026, 8, 27, hour, minute).getTime();

function start(seed, initialNow, remote = { revision: 0, state: null }, localSync = {}, native = false) {
  let now = initialNow;
  let intervalTick;
  const data = { 'milk-board-v1': JSON.stringify(seed) };
  if (localSync.pending) data['milk-board-server-pending-v1'] = '1';
  if (localSync.revision !== undefined) data['milk-board-server-revision-v1'] = String(localSync.revision);
  const elements = {};
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.textContent = ''; this.value = ''; this.className = ''; this.style = {}; }
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
          this.responseText = JSON.stringify({ revision: remote.revision, state: remote.state });
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
  if (native) window.AndroidStore = {
    request(method, payload) {
      if (method === 'PUT') {
        if (remote.failWrites) return JSON.stringify({status:500,body:{error:'存储空间不足'}});
        const submitted = JSON.parse(payload);
        if (submitted.revision !== remote.revision) return JSON.stringify({status:409,body:remote});
        remote.state = submitted.state; remote.revision++;
      }
      return JSON.stringify({status:200,body:{initialized:remote.revision > 0,...remote}});
    },
  };
  if (native === 'ios') {
    const store = window.AndroidStore;
    window.IOSStore = { request(method, payload, done) { done(JSON.parse(store.request(method, payload ? JSON.stringify(payload) : ''))); } };
    delete window.AndroidStore;
  }
  vm.runInNewContext(source, {
    Date: FakeDate, Math, JSON, Object, String, Number, isFinite,
    document, localStorage, window, navigator: {}, location: { protocol: 'file:' }, XMLHttpRequest: native ? undefined : XMLHttpRequest,
    setInterval(fn) { intervalTick = fn; }, setTimeout() {}, clearTimeout() {},
    alert(message) { throw new Error(message); }, confirm() { return true; },
  });
  return {
    board: window.MilkBoard,
    tick(time) { now = time; intervalTick(); },
    state() { return JSON.parse(data['milk-board-v1']); },
    remote() { return remote.state; },
    text(id) { return elements[id].textContent; },
    click(id) { elements[id].listeners.click(); },
    editFirstEntry() { elements.history.children[0].children[0].listeners.click(); },
    set(id, value) { elements[id].value = String(value); },
    submit(id) { elements[id].listeners.submit({ preventDefault() {} }); },
    input(id) { elements[id].listeners.input(); },
    scrollInterval(id, top) { elements[id].scrollTop=top;elements[id].listeners.scroll(); },
    intervalKey(id, key) { elements[id].listeners.keydown({key,preventDefault() {}}); },
    scrollAmount(top) { elements.amountWheel.scrollTop=top;elements.amountWheel.listeners.scroll(); },
    amountKey(key) { elements.amountWheel.listeners.keydown({key,preventDefault() {}}); },
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
  app.set('feedHourInput', '23'); app.set('feedMinuteInput', '30');
  app.submit('feedForm');
  assert.equal(app.state().entries[0].at, new Date(2025, 11, 31, 23, 30).getTime());

  app.click('addButton');
  app.set('amountInput', 120);
  app.set('monthInput', 1);
  app.set('dayInput', 1);
  app.set('feedHourInput', '1'); app.set('feedMinuteInput', '0');
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
  app.set('feedHourInput', '9'); app.set('feedMinuteInput', '30');
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
  assert.match(app.text('intervalError'), /每档6分钟/);
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

test('服务器已写入但平板丢失确认时，内容相同可自动恢复同步', () => {
  const seed = { intervalHours: null, intervalStartedAt: null, entries: [{ id: 'saved', at: at(9), amount: 120 }] };
  const remote = { revision: 2, state: seed };
  const app = start(seed, at(10), remote, { revision: 1, pending: true });
  assert.equal(app.text('runtimeStatus'), '');
  assert.equal(app.state().entries[0].id, 'saved');
  assert.equal(remote.revision, 2);
});


test('独立 APK 无网络接口仍可新增编辑并自动保存', () => {
  const empty = {intervalHours:null,intervalStartedAt:null,entries:[]};
  const app = start(empty, at(12), {revision:0,state:empty}, {}, true);
  app.click('addButton');
  app.submit('feedForm');
  assert.equal(app.remote().entries.length,1);
  assert.equal(app.remote().entries[0].amount,120);
  app.editFirstEntry();
  app.set('amountInput',150);
  app.submit('feedForm');
  assert.equal(app.remote().entries[0].amount,150);
  assert.equal(app.text('runtimeStatus'),'');
});


test('奶量滚动选择默认120，实时显示并保存10与300边界，拒绝非10ml档位', () => {
  const seed={intervalHours:null,intervalStartedAt:null,entries:[]};
  const app=start(seed,at(12));
  app.click('addButton'); assert.equal(app.text('amountValue'),'120');
  app.set('amountInput',10); app.input('amountInput'); assert.equal(app.text('amountValue'),'10');
  app.submit('feedForm'); assert.equal(app.remote().entries[0].amount,10);
  app.editFirstEntry(); app.set('amountInput',300); app.input('amountInput');
  assert.equal(app.text('amountValue'),'300'); app.submit('feedForm'); assert.equal(app.remote().entries[0].amount,300);
  for (const amount of [0,310,115]) {
    app.click('addButton');app.set('amountInput',amount);app.submit('feedForm');
    assert.equal(app.remote().entries.length,1);assert.ok(app.text('feedError'));
  }
});


test('上下滚动与上下键按10ml选择，首尾保持10与300', () => {
  const app=start({intervalHours:null,intervalStartedAt:null,entries:[]},at(12));
  app.click('addButton'); app.amountKey('ArrowDown'); assert.equal(app.text('amountValue'),'130');
  app.amountKey('ArrowUp'); assert.equal(app.text('amountValue'),'120');
  app.scrollAmount(48*14); assert.equal(app.text('amountValue'),'150');
  app.amountKey('Home'); app.amountKey('ArrowUp'); assert.equal(app.text('amountValue'),'10');
  app.amountKey('End'); app.amountKey('ArrowDown'); assert.equal(app.text('amountValue'),'300');
  app.submit('feedForm'); assert.equal(app.remote().entries[0].amount,300);
});


test('小时与分钟独立滚动，保留6分钟精度与小时0至12及分钟边界', () => {
  const app = start({ intervalHours: 3.1, entries: [] }, at(12));
  app.click('intervalButton');
  assert.equal(app.text('intervalValue'), '3小时6分钟');
  app.intervalKey('intervalHourWheel', 'ArrowDown');
  assert.equal(app.text('intervalValue'), '4小时6分钟');
  app.intervalKey('intervalMinuteWheel', 'ArrowDown');
  assert.equal(app.text('intervalValue'), '4小时12分钟');
  app.scrollInterval('intervalHourWheel', 3 * 48);
  app.scrollInterval('intervalMinuteWheel', 48);
  app.submit('intervalForm');
  assert.equal(app.state().intervalHours, 3.1);
  app.intervalKey('intervalHourWheel', 'End');
  assert.equal(app.text('intervalValue'), '12小时6分钟');
  app.intervalKey('intervalMinuteWheel', 'End');
  app.submit('intervalForm'); assert.equal(app.state().intervalHours, 12.9);
  app.intervalKey('intervalHourWheel', 'Home');
  app.intervalKey('intervalMinuteWheel', 'Home');
  app.submit('intervalForm'); assert.equal(app.state().intervalHours, 0.5);
});


test('近7与30天按本地日期汇总，包含零记录日且排除范围外及未来记录', () => {
  const now = new Date(2026, 0, 2, 12).getTime();
  const app = start({intervalHours:null,entries:[
    {id:'today',at:now,amount:120},
    {id:'yesterday',at:new Date(2026,0,1,23,59).getTime(),amount:180},
    {id:'edge',at:new Date(2025,11,27).getTime(),amount:400},
    {id:'outside7',at:new Date(2025,11,26,23,59).getTime(),amount:300},
    {id:'outside30',at:new Date(2025,11,3,23,59).getTime(),amount:200},
    {id:'future',at:now+3600000,amount:100}
  ]},now);
  app.click('statsButton');
  assert.equal(app.text('statsTotal'),'700');
  assert.equal(app.text('statsAverage'),'100');
  assert.equal(app.text('statsRange'),'12/27 — 1/2');
  app.click('stats30Button');
  assert.equal(app.text('statsTotal'),'1000');
  assert.equal(app.text('statsAverage'),'33');
  assert.equal(app.text('statsRange'),'12/4 — 1/2');
});


test('iPad异步桥接保存新增编辑记录，重启后读取本机数据', () => {
  const remote = { revision: 0, state: null };
  const seed = { intervalHours: null, intervalStartedAt: null, entries: [] };
  const app = start(seed, at(12), remote, {}, 'ios');
  app.click('addButton'); app.submit('feedForm');
  assert.equal(remote.state.entries[0].amount, 120);
  app.editFirstEntry(); app.set('amountInput', 150); app.submit('feedForm');
  assert.equal(remote.state.entries[0].amount, 150);
  const restarted = start(seed, at(12), remote, {}, 'ios');
  assert.equal(restarted.text('todayTotal'), '150');
});


test('还原明确提交后持久保存；取消预览无写入，陈旧版本和存储失败保留原记录', () => {
  const old = {intervalHours:3,intervalStartedAt:null,entries:[{id:'old',at:at(8),amount:120}]};
  const next = {...old,entries:[{id:'restored',at:at(9),amount:110,auto:true}]};
  for (const platform of [true,'ios',false]) {
    const remote = {revision:1,state:old};
    const app = start({},at(10),remote,{},platform);
    const preview = app.board.snapshot();
    assert.equal(app.remote().entries[0].id,'old');
    let error;
    app.board.restore(next,preview.revision+1,e=>error=e);
    assert.ok(error); assert.equal(app.state().entries[0].id,'old');
    app.board.restore(next,preview.revision,e=>error=e);
    assert.equal(error,null); assert.equal(app.state().entries[0].id,'restored');
    const reopened = start({},at(10),remote,{},platform);
    assert.equal(reopened.state().entries[0].amount,110);
  }
  const remote = {revision:1,state:old,failWrites:true};
  const app = start({},at(10),remote,{},true);
  let error;
  app.board.restore(next,app.board.snapshot().revision,e=>error=e);
  assert.match(error,/存储空间/); assert.equal(app.state().entries[0].id,'old');
  // Another device writes after the preview: backend refuses that old revision.
  remote.failWrites=false; const revision=app.board.snapshot().revision; remote.revision++;
  app.board.restore(next,revision,e=>error=e);
  assert.ok(error); assert.equal(app.state().entries[0].id,'old');
});
