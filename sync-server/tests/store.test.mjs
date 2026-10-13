import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SyncStore } from '../store.mjs';

const entry = (id, amount = 120, expectedVersion = 0) => ({
  kind: 'entry', id, expectedVersion, value: { at: 1791861600000, amount, auto: false },
});
function fixture(t) {
  const store = new SyncStore(':memory:');
  t.after(() => store.close());
  return { store, a: store.account('apple-a'), b: store.account('apple-b') };
}

test('账号隔离，同一个Apple用户获得同一内部账号', t => {
  const {store, a, b} = fixture(t);
  assert.equal(store.account('apple-a').id, a.id);
  store.push(a.id, 'request-1', [entry('first')]);
  assert.equal(store.snapshot(a.id).entries[0].amount, 120);
  assert.deepEqual(store.snapshot(b.id).entries, []);
  assert.deepEqual(store.changes(b.id, 0).changes, []);
  assert.throws(() => store.snapshot('missing'), e => e.status === 401);
});

test('重复请求幂等，改变重复请求内容被拒绝', t => {
  const {store, a} = fixture(t);
  const first = store.push(a.id, 'request-1', [entry('first')]);
  assert.deepEqual(store.push(a.id, 'request-1', [entry('first')]), first);
  assert.equal(store.changes(a.id, 0).changes.length, 1);
  assert.throws(() => store.push(a.id, 'request-1', [entry('first', 150)]), e => e.status === 409);
});

test('版本冲突使整批回滚，不覆盖新记录', t => {
  const {store, a} = fixture(t);
  store.push(a.id, 'create', [entry('first')]);
  store.push(a.id, 'edit', [entry('first', 140, 1)]);
  assert.throws(() => store.push(a.id, 'stale', [entry('second'), entry('first', 90, 1)]), e => {
    assert.equal(e.status, 409);
    assert.equal(e.details.current.version, 2);
    return true;
  });
  assert.equal(store.snapshot(a.id).entries.length, 1);
  assert.equal(store.snapshot(a.id).entries[0].amount, 140);
});

test('删除传播，旧设备不能复活删除记录，游标分页不遗漏', t => {
  const {store, a} = fixture(t);
  store.push(a.id, 'create', [entry('first'), entry('second')]);
  const page = store.changes(a.id, 0, 1);
  assert.equal(page.changes.length, 1);
  assert.equal(page.hasMore, true);
  assert.equal(store.changes(a.id, page.cursor, 1).changes[0].id, 'second');
  store.push(a.id, 'delete', [{kind:'entry',id:'first',expectedVersion:1,deleted:true}]);
  const changes = store.changes(a.id, 0).changes;
  assert.equal(changes[2].deleted, true);
  assert.equal(changes[2].value, null);
  assert.throws(() => store.push(a.id, 'stale', [entry('first', 120, 1)]), e => e.status === 409);
  assert.equal(store.snapshot(a.id).entries.length, 1);
});

test('间隔带版本同步，非法数据不部分写入', t => {
  const {store, a} = fixture(t);
  store.push(a.id, 'settings', [{kind:'settings',id:'feeding',expectedVersion:0,value:{intervalHours:3.1,intervalStartedAt:1791861600000}}]);
  assert.equal(store.snapshot(a.id).settings.intervalHours, 3.1);
  assert.throws(() => store.push(a.id, 'bad', [entry('first'), entry('bad', -1)]), e => e.status === 400);
  assert.deepEqual(store.snapshot(a.id).entries, []);
});

test('自动记录相同计划时段跨设备去重', t => {
  const {store, a} = fixture(t);
  const value = {at:1791861600000,amount:120,auto:true,planId:'plan-1'};
  const op = {kind:'entry',id:'auto:plan-1:1791861600000',expectedVersion:0,value};
  store.push(a.id, 'device-a', [op]);
  store.push(a.id, 'device-b', [op]);
  assert.equal(store.snapshot(a.id).entries.length, 1);
  assert.equal(store.changes(a.id, 0).changes.length, 1);
  assert.throws(() => store.push(a.id, 'forged', [{...op,id:'random'}]), e => e.status === 400);
});

test('账号删除立即拒绝读写，重连不恢复旧账号', t => {
  const {store, a} = fixture(t);
  store.push(a.id, 'create', [entry('first')]);
  store.beginDeletion(a.id);
  assert.throws(() => store.snapshot(a.id), e => e.status === 401);
  assert.throws(() => store.push(a.id, 'stale', [entry('second')]), e => e.status === 401);
  store.finishDeletion(a.id);
  assert.throws(() => store.account('apple-a'), e => e.status === 410);
});

test('重启保留记录与请求结果', t => {
  const directory = mkdtempSync(join(tmpdir(), 'milk-sync-store-'));
  t.after(() => rmSync(directory, {recursive:true,force:true}));
  const path = join(directory, 'state.sqlite');
  let store = new SyncStore(path);
  const user = store.account('apple-a');
  const result = store.push(user.id, 'create', [entry('first')]);
  store.close();
  store = new SyncStore(path);
  t.after(() => store.close());
  assert.equal(store.snapshot(user.id).entries[0].amount, 120);
  assert.deepEqual(store.push(user.id, 'create', [entry('first')]), result);
});
