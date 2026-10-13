import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

export class SyncError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}
const reject = (status, message, details) => { throw new SyncError(status, message, details); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const decode = row => ({kind:row.kind,id:row.id,version:row.version,seq:row.seq,deleted:!!row.deleted,value:row.value === null ? null : JSON.parse(row.value)});
function validateOperation(op) {
  if (!op || !['entry','settings'].includes(op.kind) || !validId(op.id) || !Number.isSafeInteger(op.expectedVersion) || op.expectedVersion < 0) reject(400, '记录操作格式无效');
  if (op.deleted === true && op.kind === 'entry' && op.value === undefined) return;
  if (op.deleted !== undefined && op.deleted !== false) reject(400, '删除操作无效');
  const value = op.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(400, '记录内容无效');
  if (op.kind === 'settings') {
    if (op.id !== 'feeding' || !Number.isFinite(value.intervalHours) || value.intervalHours < 0.5 || value.intervalHours > 24 || Math.abs(value.intervalHours * 10 - Math.round(value.intervalHours * 10)) > 1e-8 || !positive(value.intervalStartedAt)) reject(400, '间隔设置无效');
    if (Object.keys(value).some(key => !['intervalHours','intervalStartedAt','planId'].includes(key))) reject(400, '间隔字段无效');
  } else {
    if (!positive(value.at) || !Number.isInteger(value.amount) || value.amount < 1 || value.amount > 2000 || typeof value.auto !== 'boolean') reject(400, '喂奶记录无效');
    if (Object.keys(value).some(key => !['at','amount','auto','planId'].includes(key))) reject(400, '记录字段无效');
    if (value.auto && (!validId(value.planId) || op.id !== `auto:${value.planId}:${value.at}`)) reject(400, '自动记录计划无效');
  }
  if (value.planId !== undefined && !validId(value.planId)) reject(400, '计划编号无效');
}

export class SyncStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
    for (const file of readdirSync(new URL('./migrations/', import.meta.url)).filter(file => /^\d+\.sql$/.test(file)).sort()) {
      const version = Number(file.split('.')[0]);
      if (!this.db.prepare('SELECT version FROM schema_version WHERE version=?').get(version)) this.transaction(() => this.db.exec(readFileSync(new URL('./migrations/' + file, import.meta.url), 'utf8')));
    }
  }
  close() { this.db.close(); }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  account(subject) {
    if (typeof subject !== 'string' || !subject || subject.length > 256) reject(400, '无效的 Apple 用户标识');
    const existing = this.db.prepare('SELECT id,status FROM accounts WHERE apple_subject=?').get(subject);
    if (existing) {
      if (existing.status !== 'active') reject(410, '账号已注销或正在注销');
      return {...existing};
    }
    const id = randomUUID();
    this.db.prepare('INSERT INTO accounts(id,apple_subject) VALUES (?,?)').run(id, subject);
    return {id,status:'active'};
  }
  requireAccount(id) {
    if (this.db.prepare('SELECT status FROM accounts WHERE id=?').get(id)?.status !== 'active') reject(401, '请重新登录');
  }
  cursor(id) { return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM changes WHERE account_id=?').get(id).cursor; }
  snapshot(id) {
    return this.transaction(() => {
      this.requireAccount(id);
      const rows = this.db.prepare('SELECT * FROM records WHERE account_id=? AND deleted=0 ORDER BY seq').all(id).map(decode);
      const settings = rows.find(r => r.kind === 'settings');
      return {cursor:this.cursor(id),entries:rows.filter(r => r.kind === 'entry').map(r => ({id:r.id,...r.value,version:r.version})),settings:settings ? {...settings.value,version:settings.version} : null};
    });
  }
  push(accountId, requestId, operations) {
    this.requireAccount(accountId);
    if (!validId(requestId) || !Array.isArray(operations) || !operations.length || operations.length > 100) reject(400, '同步请求无效');
    const keys = new Set();
    for (const op of operations) {
      validateOperation(op);
      const key = op.kind + ':' + op.id;
      if (keys.has(key)) reject(400, '同一批不能重复修改一条记录');
      keys.add(key);
    }
    const digest = createHash('sha256').update(JSON.stringify(operations)).digest('hex');
    return this.transaction(() => {
      this.requireAccount(accountId);
      const previous = this.db.prepare('SELECT digest,result FROM requests WHERE account_id=? AND id=?').get(accountId, requestId);
      if (previous) {
        if (previous.digest !== digest) reject(409, '重复请求内容发生变化');
        return JSON.parse(previous.result);
      }
      const accepted = [];
      for (const op of operations) {
        const row = this.db.prepare('SELECT * FROM records WHERE account_id=? AND kind=? AND id=?').get(accountId, op.kind, op.id);
        // 相同自动计划的首次创建可跨设备去重；修改仍须匹配版本。
        if (op.value?.auto && op.expectedVersion === 0 && row && !row.deleted && row.value === JSON.stringify(op.value)) {
          accepted.push(decode(row)); continue;
        }
        if ((row?.version ?? 0) !== op.expectedVersion || (row?.deleted && op.deleted !== true)) reject(409, '记录已在其他设备修改', {kind:op.kind,id:op.id,current:row ? decode(row) : null});
        if (op.deleted && !row) reject(409, '记录不存在', {kind:op.kind,id:op.id,current:null});
        const version = (row?.version ?? 0) + 1;
        const deleted = op.deleted === true ? 1 : 0;
        const value = deleted ? null : JSON.stringify(op.value);
        const seq = Number(this.db.prepare('INSERT INTO changes(account_id,kind,id,version,deleted,value) VALUES (?,?,?,?,?,?)').run(accountId, op.kind, op.id, version, deleted, value).lastInsertRowid);
        this.db.prepare('INSERT INTO records(account_id,kind,id,version,seq,deleted,value) VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_id,kind,id) DO UPDATE SET version=excluded.version,seq=excluded.seq,deleted=excluded.deleted,value=excluded.value').run(accountId, op.kind, op.id, version, seq, deleted, value);
        accepted.push({kind:op.kind,id:op.id,version,seq,deleted:!!deleted,value:deleted ? null : op.value});
      }
      if (this.db.prepare("SELECT COUNT(*) AS count FROM records WHERE account_id=? AND kind='entry' AND deleted=0").get(accountId).count > 10000) reject(400, '最多保存10000条记录');
      const result = {accepted,cursor:this.cursor(accountId)};
      this.db.prepare('INSERT INTO requests(account_id,id,digest,result) VALUES (?,?,?,?)').run(accountId, requestId, digest, JSON.stringify(result));
      return result;
    });
  }
  changes(id, cursor, limit = 100) {
    this.requireAccount(id);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500 || cursor > this.cursor(id)) reject(400, '同步游标无效');
    const rows = this.db.prepare('SELECT * FROM changes WHERE account_id=? AND seq>? ORDER BY seq LIMIT ?').all(id, cursor, limit + 1);
    const page = rows.slice(0, limit);
    return {changes:page.map(decode),cursor:page.length ? page.at(-1).seq : cursor,hasMore:rows.length > limit};
  }
  beginDeletion(id) {
    this.transaction(() => {
      this.requireAccount(id);
      this.db.prepare("UPDATE accounts SET status='deleting' WHERE id=?").run(id);
    });
  }
  finishDeletion(id) {
    this.transaction(() => {
      if (this.db.prepare('SELECT status FROM accounts WHERE id=?').get(id)?.status !== 'deleting') reject(409, '账号没有待完成注销');
      for (const table of ['records','changes','requests']) this.db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);
      // 保留注销标识，阻止离线设备重新创建账号并上传旧数据。
      this.db.prepare("UPDATE accounts SET status='deleted' WHERE id=?").run(id);
    });
  }
}
