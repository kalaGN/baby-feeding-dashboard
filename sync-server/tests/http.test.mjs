import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { SyncStore } from '../store.mjs';
import { AppleAuth } from '../auth.mjs';
import { createHandler } from '../routes.mjs';

async function fixture(t, enabled = true) {
  const store = new SyncStore(':memory:');
  const auth = enabled ? new AppleAuth(store, {clientIds:{ipad:'test.ipad',web:'test.web',android:'test.web'},redirectURI:'https://example.test/api/auth/callback',encryptionKey:Buffer.alloc(32,7)}) : null;
  const server = createServer(createHandler({store,auth,origin:'https://example.test'}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const url = 'http://127.0.0.1:' + server.address().port;
  const user = store.account('user-a');
  const session = auth?.sessions.issue(user.id);
  return {store,auth,url,user,session};
}
const mutation = {requestId:'request-1',operations:[{kind:'entry',id:'entry-1',expectedVersion:0,value:{at:1791861600000,amount:120,auto:false}}]};

test('未登录不能读写云端，认证未配置时明确禁用登录', async t => {
  const {url} = await fixture(t, false);
  assert.equal((await fetch(url + '/healthz')).status, 200);
  assert.equal((await (await fetch(url + '/api/auth/status')).json()).enabled, false);
  assert.equal((await fetch(url + '/api/sync/snapshot')).status, 401);
  assert.equal((await fetch(url + '/api/auth/begin', {method:'POST',headers:{'Content-Type':'application/json'},body:'{"platform":"ipad"}'})).status, 503);
});

test('原生Bearer会话同步，其他账号不可读取，重复请求不重复记', async t => {
  const {url,auth,store,session} = await fixture(t);
  const headers = {Authorization:'Bearer ' + session.token,'Content-Type':'application/json'};
  const post = () => fetch(url + '/api/sync/push', {method:'POST',headers,body:JSON.stringify(mutation)});
  assert.equal((await post()).status, 200);
  assert.equal((await post()).status, 200);
  const state = await (await fetch(url + '/api/sync/snapshot',{headers})).json();
  assert.equal(state.entries.length, 1);
  const other = auth.sessions.issue(store.account('user-b').id);
  const response = await fetch(url + '/api/sync/snapshot',{headers:{Authorization:'Bearer '+other.token}});
  assert.deepEqual((await response.json()).entries, []);
});

test('Web Cookie写入必须通过同源和CSRF校验', async t => {
  const {url,session} = await fixture(t);
  const headers = {'Content-Type':'application/json',Cookie:'__Host-milk_session='+session.token,Origin:'https://example.test'};
  const post = extra => fetch(url + '/api/sync/push',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(mutation)});
  assert.equal((await post({})).status, 403);
  assert.equal((await post({'X-CSRF-Token':'bad'})).status, 403);
  assert.equal((await post({'X-CSRF-Token':session.csrf,Origin:'https://attacker.test'})).status, 403);
  assert.equal((await post({'X-CSRF-Token':session.csrf})).status, 200);
});

test('非法请求返回明确错误，退出后令牌不可用', async t => {
  const {url,session} = await fixture(t);
  const headers = {Authorization:'Bearer '+session.token,'Content-Type':'application/json'};
  assert.equal((await fetch(url + '/api/sync/push',{method:'POST',headers,body:'{broken'})).status, 400);
  assert.equal((await fetch(url + '/api/sync/changes?cursor=-1',{headers})).status, 400);
  assert.equal((await fetch(url + '/api/auth/logout',{method:'POST',headers,body:'{}'})).status, 200);
  assert.equal((await fetch(url + '/api/sync/snapshot',{headers})).status, 401);
});

test('Apple网页回调校验浏览器state，不在返回正文暴露会话', async t => {
  const {url,auth,session} = await fixture(t);
  let called = false;
  auth.complete = async (state,code,platform) => { called = true; assert.equal(platform,'web'); return session; };
  const response = await fetch(url+'/api/auth/begin',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:'{"platform":"web"}'});
  const challenge = await response.json();
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=None/);
  const form = new URLSearchParams({state:challenge.state,code:'code'});
  const headers = {'Content-Type':'application/x-www-form-urlencoded'};
  assert.equal((await fetch(url+'/api/auth/callback',{method:'POST',headers,body:form})).status,403);
  assert.equal(called,false);
  const callback = await fetch(url+'/api/auth/callback',{method:'POST',headers:{...headers,Cookie:'__Host-milk_login='+challenge.state},body:form,redirect:'manual'});
  assert.equal(callback.status,303);
  assert.equal(await callback.text(),'');
  assert.match(callback.headers.get('set-cookie'),/__Host-milk_session=.*HttpOnly; SameSite=Lax/);
});
