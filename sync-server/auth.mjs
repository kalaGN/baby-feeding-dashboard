import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from 'jose';
import { SyncError } from './store.mjs';
import { SessionStore } from './session.mjs';

const ISSUER = 'https://appleid.apple.com';
export class AppleAuth {
  constructor(store, options) {
    this.store = store;
    this.clientIds = options.clientIds;
    this.redirectURI = options.redirectURI;
    this.options = options;
    this.sessions = new SessionStore(store, options.encryptionKey);
    this.appleKey = options.appleKey ?? createRemoteJWKSet(new URL(ISSUER + '/auth/keys'), {timeoutDuration:8000});
    this.exchange = options.exchange ?? (payload => this.appleRequest('/auth/token', {
      clientId:payload.clientId, code:payload.code, grant_type:'authorization_code',
      ...(payload.platform === 'ipad' ? {} : {redirect_uri:this.redirectURI}),
    }));
    this.revoke = options.revoke ?? (credential => this.appleRequest('/auth/revoke', {
      clientId:credential.clientId, token:credential.refreshToken, token_type_hint:'refresh_token',
    }));
  }
  begin(platform, token) {
    const clientId = this.clientIds[platform];
    if (!['ipad','web','android'].includes(platform) || typeof clientId !== 'string' || !clientId) throw new SyncError(400, '登录平台无效');
    const result = this.sessions.challenge(platform, clientId, token);
    if (platform !== 'ipad') {
      const params = new URLSearchParams({client_id:clientId,redirect_uri:this.redirectURI,response_type:'code',response_mode:'form_post',state:result.state,nonce:result.nonce});
      result.authorizeURL = ISSUER + '/auth/authorize?' + params.toString();
    }
    return result;
  }
  async verify(idToken, clientId, nonce) {
    if (typeof idToken !== 'string' || idToken.length > 16000) throw new SyncError(401, 'Apple 身份凭证无效');
    const {payload} = await jwtVerify(idToken, this.appleKey, {
      issuer:ISSUER,audience:clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce'],maxTokenAge:'10m',clockTolerance:5,
    });
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 || payload.nonce !== nonce) throw new SyncError(401, 'Apple 身份校验失败');
    return payload;
  }
  async complete(state, code, platform) {
    if (typeof code !== 'string' || !code || code.length > 4096) throw new SyncError(400, '授权码无效');
    const challenge = this.sessions.consume(state);
    if (platform && platform !== challenge.platform) throw new SyncError(400, '登录平台不匹配');
    let response, identity;
    try {
      response = await this.exchange({code,nonce:challenge.nonce,clientId:challenge.client_id,platform:challenge.platform});
      identity = await this.verify(response.id_token, challenge.client_id, challenge.nonce);
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError(502, 'Apple 登录校验失败，请重新登录');
    }
    if (typeof response.refresh_token !== 'string' || !response.refresh_token) throw new SyncError(502, 'Apple 授权未完成，请重试');
    return this.store.transaction(() => {
      const account = this.store.account(identity.sub);
      let result;
      if (challenge.session_hash) result = this.sessions.reauthenticate(challenge.session_hash, account.id);
      this.sessions.credential(account.id, challenge.client_id, response.refresh_token);
      result ??= this.sessions.issue(account.id);
      return challenge.platform === 'android' ? this.sessions.handoff(result,challenge.verifier_hash) : result;
    });
  }
  session(token) { return this.sessions.session(token); }
  logout(token) { this.sessions.logout(token); }
  startDeletion(token, ticket) { return this.sessions.startDeletion(token, ticket); }
  async finishDeletion(accountId) {
    if (!this.sessions.pendingDeletions().includes(accountId)) throw new SyncError(409, '无待完成注销');
    for (const credential of this.sessions.readCredentials(accountId)) {
      await this.revoke(credential);
      this.sessions.forgetCredential(accountId, credential.clientId);
    }
    this.sessions.finishDeletion(accountId);
  }
  async retryDeletions() {
    const results = [];
    for (const id of this.sessions.pendingDeletions()) {
      try { await this.finishDeletion(id); results.push({id,ok:true}); }
      catch { results.push({id,ok:false}); }
    }
    return results;
  }
  async appleRequest(path, values) {
    const clientId = values.clientId;
    const key = await importPKCS8(this.options.privateKey, 'ES256');
    const clientSecret = await new SignJWT({}).setProtectedHeader({alg:'ES256',kid:this.options.keyId})
      .setIssuer(this.options.teamId).setSubject(clientId).setAudience(ISSUER)
      .setIssuedAt().setExpirationTime('5m').sign(key);
    const body = new URLSearchParams({...values,client_id:clientId,client_secret:clientSecret});
    body.delete('clientId');
    let response;
    try { response = await fetch(ISSUER + path, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(8000)}); }
    catch { throw new SyncError(502, 'Apple 服务暂不可用'); }
    if (!response.ok) throw new SyncError(502, 'Apple 授权处理失败');
    if (path === '/auth/revoke') return;
    try { return await response.json(); } catch { throw new SyncError(502, 'Apple 返回格式无效'); }
  }
}
