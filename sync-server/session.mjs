import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { SyncError } from './store.mjs';

const secret = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export class SessionStore {
  constructor(store, encryptionKey) {
    if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) throw new Error('会话加密密钥必须是32字节');
    this.store = store; this.db = store.db; this.key = encryptionKey;
  }
  issue(accountId) {
    this.store.requireAccount(accountId);
    const token = secret(), csrf = secret(), expiresAt = Date.now() + 7 * 86400000;
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token), accountId, hash(csrf), expiresAt);
    return {token,csrf,accountId,expiresAt};
  }
  session(token) {
    if (typeof token !== 'string' || token.length > 256) throw new SyncError(401, '请重新登录');
    const row = this.db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now());
    if (!row) throw new SyncError(401, '请重新登录');
    this.store.requireAccount(row.account_id);
    return {accountId:row.account_id,csrfHash:row.csrf_hash,expiresAt:row.expires_at,sessionHash:row.token_hash};
  }
  csrf(token, csrf) {
    if (typeof csrf !== 'string' || hash(csrf) !== this.session(token).csrfHash) throw new SyncError(403, '请求校验失败');
  }
  logout(token) {
    if (typeof token !== 'string') return;
    this.store.transaction(() => {
      this.db.prepare('DELETE FROM reauth_tickets WHERE session_hash=?').run(hash(token));
      this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
    });
  }
  challenge(platform, clientId, token) {
    this.cleanup();
    if (this.db.prepare('SELECT COUNT(*) n FROM challenges').get().n >= 10000) throw new SyncError(429, '登录请求繁忙，请稍后重试');
    const sessionHash = token ? this.session(token).sessionHash : null;
    const state = secret(), nonce = secret();
    const verifier = platform === 'android' ? secret() : null;
    this.db.prepare('INSERT INTO challenges(state_hash,nonce,platform,client_id,session_hash,expires_at,verifier_hash) VALUES (?,?,?,?,?,?,?)').run(hash(state), nonce, platform, clientId, sessionHash, Date.now() + 5 * 60000, verifier ? hash(verifier) : null);
    return {state,nonce,platform,clientId,...(verifier ? {verifier} : {})};
  }
  challengePlatform(state) {
    if (typeof state !== 'string' || state.length > 256) throw new SyncError(400, '登录请求无效');
    const row = this.db.prepare('SELECT platform FROM challenges WHERE state_hash=? AND expires_at>?').get(hash(state), Date.now());
    if (!row) throw new SyncError(400, '登录请求已过期');
    return row.platform;
  }
  pack(text, aad) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
  }
  unpack(packed, aad) {
    const data = Buffer.from(packed,'base64url'), decipher = createDecipheriv('aes-256-gcm',this.key,data.subarray(0,12));
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(data.subarray(12,28));
    return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
  }
  handoff(result, verifierHash) {
    const ticket = secret(), ticketHash = hash(ticket);
    this.db.prepare('INSERT INTO handoff_tickets VALUES (?,?,?,?)').run(ticketHash,verifierHash,this.pack(JSON.stringify(result),ticketHash),Date.now()+60000);
    return {handoffTicket:ticket};
  }
  exchangeHandoff(ticket, verifier) {
    if (typeof ticket !== 'string' || typeof verifier !== 'string' || ticket.length > 256 || verifier.length > 256) throw new SyncError(400, '授权票据无效');
    return this.store.transaction(() => {
      const row = this.db.prepare('SELECT * FROM handoff_tickets WHERE ticket_hash=?').get(hash(ticket));
      if (!row || row.expires_at < Date.now() || row.verifier_hash !== hash(verifier)) throw new SyncError(403, '授权票据校验失败');
      this.db.prepare('DELETE FROM handoff_tickets WHERE ticket_hash=?').run(hash(ticket));
      const result = JSON.parse(this.unpack(row.result_cipher,row.ticket_hash));
      if (result.token) this.session(result.token);
      return result;
    });
  }
  consume(state) {
    if (typeof state !== 'string' || state.length > 256) throw new SyncError(400, '登录请求无效');
    const row = this.db.prepare('DELETE FROM challenges WHERE state_hash=? RETURNING *').get(hash(state));
    if (!row || row.expires_at < Date.now()) throw new SyncError(400, '登录请求已过期，请重试');
    return row;
  }
  credential(accountId, clientId, refreshToken) {
    if (typeof refreshToken !== 'string' || !refreshToken) throw new SyncError(502, 'Apple 未返回有效授权凭证');
    const packed = this.pack(refreshToken, accountId + ':' + clientId);
    this.db.prepare('INSERT INTO credentials VALUES (?,?,?) ON CONFLICT(account_id,client_id) DO UPDATE SET refresh_cipher=excluded.refresh_cipher').run(accountId, clientId, packed);
  }
  readCredentials(accountId) {
    return this.db.prepare('SELECT * FROM credentials WHERE account_id=?').all(accountId).map(row => {
      return {clientId:row.client_id,refreshToken:this.unpack(row.refresh_cipher, accountId + ':' + row.client_id)};
    });
  }
  forgetCredential(accountId, clientId) {
    this.db.prepare('DELETE FROM credentials WHERE account_id=? AND client_id=?').run(accountId, clientId);
  }
  reauthenticate(sessionHash, accountId) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(sessionHash, Date.now());
    if (!row || row.account_id !== accountId) throw new SyncError(403, '请使用当前账号重新认证');
    const ticket = secret();
    this.db.prepare('INSERT INTO reauth_tickets VALUES (?,?,?)').run(hash(ticket), sessionHash, Date.now() + 3 * 60000);
    return {reauthTicket:ticket,accountId};
  }
  startDeletion(token, ticket) {
    const session = this.session(token);
    if (typeof ticket !== 'string' || ticket.length > 256) throw new SyncError(403, '请先重新认证');
    this.store.transaction(() => {
      const row = this.db.prepare('DELETE FROM reauth_tickets WHERE ticket_hash=? RETURNING *').get(hash(ticket));
      if (!row || row.session_hash !== session.sessionHash || row.expires_at < Date.now()) throw new SyncError(403, '请先重新认证');
      this.db.prepare("UPDATE accounts SET status='deleting' WHERE id=? AND status='active'").run(session.accountId);
      this.db.prepare('DELETE FROM reauth_tickets WHERE session_hash IN (SELECT token_hash FROM sessions WHERE account_id=?)').run(session.accountId);
      this.db.prepare('DELETE FROM sessions WHERE account_id=?').run(session.accountId);
    });
    return session.accountId;
  }
  finishDeletion(accountId) {
    this.store.transaction(() => {
      if (this.db.prepare('SELECT status FROM accounts WHERE id=?').get(accountId)?.status !== 'deleting') throw new SyncError(409, '无待完成的注销');
      for (const table of ['records','changes','requests','credentials']) this.db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(accountId);
      this.db.prepare("UPDATE accounts SET status='deleted' WHERE id=?").run(accountId);
    });
  }
  pendingDeletions() { return this.db.prepare("SELECT id FROM accounts WHERE status='deleting'").all().map(row => row.id); }
  cleanup() {
    this.store.transaction(() => {
      const now = Date.now();
      this.db.prepare('DELETE FROM reauth_tickets WHERE expires_at<=? OR session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)').run(now,now);
      this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
      for (const table of ['challenges','handoff_tickets']) this.db.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).run(now);
    });
  }
}
