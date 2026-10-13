import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { SyncStore } from '../store.mjs';
import { AppleAuth } from '../auth.mjs';

const keys = await generateKeyPair('RS256');
async function token(nonce, overrides = {}) {
  return new SignJWT({nonce,...overrides}).setProtectedHeader({alg:'RS256'})
    .setIssuer('https://appleid.apple.com').setAudience('test.ipad').setSubject('apple-user')
    .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
}
function fixture(t) {
  const store = new SyncStore(':memory:');
  t.after(() => store.close());
  const auth = new AppleAuth(store, {
    clientIds:{ipad:'test.ipad',web:'test.web',android:'test.web'},
    redirectURI:'https://example.test/api/auth/callback',
    encryptionKey:Buffer.alloc(32, 7), appleKey:keys.publicKey,
    exchange:async ({nonce}) => ({id_token:await token(nonce),refresh_token:'private-refresh'}),
    revoke:async () => {},
  });
  return {store,auth};
}

test('验证授权后创建可撤销会话，重复授权码挑战不可重放', async t => {
  const {auth} = fixture(t);
  const challenge = auth.begin('ipad');
  const result = await auth.complete(challenge.state, 'apple-code');
  assert.equal(auth.session(result.token).accountId, result.accountId);
  assert.throws(() => auth.session('forged'), e => e.status === 401);
  await assert.rejects(auth.complete(challenge.state, 'apple-code'), e => e.status === 400);
  auth.logout(result.token);
  assert.throws(() => auth.session(result.token), e => e.status === 401);
});

test('错误nonce、audience、issuer和过期身份令牌均拒绝', async t => {
  const {auth} = fixture(t);
  const challenge = auth.begin('ipad');
  await assert.rejects(auth.verify(await token('wrong'), 'test.ipad', challenge.nonce));
  await assert.rejects(auth.verify(await token(challenge.nonce), 'wrong-app', challenge.nonce));
  const badIssuer = await new SignJWT({nonce:challenge.nonce}).setProtectedHeader({alg:'RS256'})
    .setIssuer('https://attacker.test').setAudience('test.ipad').setSubject('apple-user').setExpirationTime('5m').sign(keys.privateKey);
  await assert.rejects(auth.verify(badIssuer, 'test.ipad', challenge.nonce));
  const expired = await new SignJWT({nonce:challenge.nonce}).setProtectedHeader({alg:'RS256'})
    .setIssuer('https://appleid.apple.com').setAudience('test.ipad').setSubject('apple-user').setExpirationTime(1).sign(keys.privateKey);
  await assert.rejects(auth.verify(expired, 'test.ipad', challenge.nonce));
  const attacker = await generateKeyPair('RS256');
  const forged = await new SignJWT({nonce:challenge.nonce}).setProtectedHeader({alg:'RS256'})
    .setIssuer('https://appleid.apple.com').setAudience('test.ipad').setSubject('apple-user').setExpirationTime('5m').setIssuedAt().sign(attacker.privateKey);
  await assert.rejects(auth.verify(forged, 'test.ipad', challenge.nonce));
});

test('同一挑战并发完成仅一次成功，平台不匹配拒绝', async t => {
  const {auth} = fixture(t);
  const challenge = auth.begin('ipad');
  const results = await Promise.allSettled([auth.complete(challenge.state,'code','ipad'),auth.complete(challenge.state,'code','ipad')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(auth.complete(auth.begin('web').state,'code','ipad'), e => e.status === 400);
});

test('多客户端授权都被撤销，注销中断后不重复撤销已完成凭证', async t => {
  const {auth} = fixture(t);
  const result = await auth.complete(auth.begin('ipad').state,'code');
  auth.sessions.credential(result.accountId,'test.web','web-refresh');
  const renewed = await auth.complete(auth.begin('ipad',result.token).state,'code2');
  auth.startDeletion(result.token,renewed.reauthTicket);
  const revoked = [];
  auth.revoke = async ({clientId}) => { if (clientId === 'test.web') throw new Error('temporary'); revoked.push(clientId); };
  await assert.rejects(auth.finishDeletion(result.accountId));
  auth.revoke = async ({clientId}) => { revoked.push(clientId); };
  await auth.finishDeletion(result.accountId);
  assert.deepEqual(revoked,['test.ipad','test.web']);
});

test('Android回调只生成一次性票据，必须持有原设备verifier兑换', async t => {
  const {auth} = fixture(t);
  auth.exchange = async ({nonce,clientId}) => ({id_token:await new SignJWT({nonce}).setProtectedHeader({alg:'RS256'}).setIssuer('https://appleid.apple.com').setAudience(clientId).setSubject('apple-user').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey),refresh_token:'android-refresh'});
  const challenge = auth.begin('android');
  const result = await auth.complete(challenge.state,'code','android');
  assert.equal(result.token,undefined);
  assert.throws(() => auth.sessions.exchangeHandoff(result.handoffTicket,'wrong'),e => e.status === 403);
  const session = auth.sessions.exchangeHandoff(result.handoffTicket,challenge.verifier);
  assert.equal(auth.session(session.token).accountId,session.accountId);
  assert.throws(() => auth.sessions.exchangeHandoff(result.handoffTicket,challenge.verifier),e => e.status === 403);
});

test('刷新令牌加密存储，会话只存摘要；注销要求近期重新认证', async t => {
  const {auth,store} = fixture(t);
  const result = await auth.complete(auth.begin('ipad').state, 'apple-code');
  const credential = store.db.prepare('SELECT * FROM credentials').get();
  assert.ok(!credential.refresh_cipher.includes('private-refresh'));
  const session = store.db.prepare('SELECT * FROM sessions').get();
  assert.notEqual(session.token_hash, result.token);
  assert.throws(() => auth.startDeletion(result.token, 'bad-ticket'), e => e.status === 403);
  const renewed = await auth.complete(auth.begin('ipad', result.token).state, 'new-code');
  auth.startDeletion(result.token, renewed.reauthTicket);
  await auth.finishDeletion(result.accountId);
  assert.throws(() => auth.session(result.token), e => e.status === 401);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM credentials').get().n, 0);
});

test('注销撤销失败不恢复账号，后续重试可完成', async t => {
  const {auth,store} = fixture(t);
  const result = await auth.complete(auth.begin('ipad').state, 'apple-code');
  const renewed = await auth.complete(auth.begin('ipad', result.token).state, 'new-code');
  auth.startDeletion(result.token, renewed.reauthTicket);
  auth.revoke = async () => { throw new Error('offline'); };
  await assert.rejects(auth.finishDeletion(result.accountId));
  assert.equal(store.db.prepare('SELECT status FROM accounts').get().status, 'deleting');
  assert.throws(() => auth.session(result.token), e => e.status === 401);
  auth.revoke = async () => {};
  await auth.finishDeletion(result.accountId);
  assert.equal(store.db.prepare('SELECT status FROM accounts').get().status, 'deleted');
});
