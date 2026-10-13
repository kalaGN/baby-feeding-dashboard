import { randomUUID } from 'node:crypto';
import { SyncError } from './store.mjs';

function send(response, status, body, headers = {}) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  response.end(JSON.stringify(body));
}
function cookies(request) {
  const values = {};
  for (const piece of (request.headers.cookie ?? '').split(';')) {
    const index = piece.indexOf('=');
    if (index > 0) values[piece.slice(0,index).trim()] = piece.slice(index+1).trim();
  }
  return values;
}
function cookie(name, value, maxAge, sameSite = 'Lax', httpOnly = true) {
  return `${name}=${value}; Path=/; Secure; ${httpOnly ? 'HttpOnly; ' : ''}SameSite=${sameSite}; Max-Age=${maxAge}`;
}
function body(request, form = false) {
  return new Promise((resolve,reject) => {
    let length = 0, chunks = [], tooLarge = false;
    request.on('data', chunk => {
      length += chunk.length;
      if (length > 1048576) { tooLarge = true; chunks = []; }
      else if (!tooLarge) chunks.push(chunk);
    });
    request.on('error', () => reject(new SyncError(400, '请求未完整发送')));
    request.on('end', () => {
      if (tooLarge) { reject(new SyncError(413, '请求不能超过1 MB')); return; }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const result = form ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text || '{}');
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
        resolve(result);
      } catch { reject(new SyncError(400, '请求格式无效')); }
    });
  });
}

export function createHandler({store,auth,origin,trustProxy = false,log = () => {}}) {
  const limits = new Map();
  return async (request,response) => {
    const requestId = randomUUID(), started = Date.now();
    response.setHeader('X-Request-ID', requestId);
    response.on('finish', () => log({requestId,status:response.statusCode,durationMs:Date.now()-started}));
    try {
      const url = new URL(request.url, origin);
      const remote = request.socket.remoteAddress ?? 'unknown';
      const forwarded = request.headers['x-forwarded-for'];
      const ip = trustProxy && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote) && typeof forwarded === 'string' && forwarded.length < 80 ? forwarded : remote;
      const now = Date.now();
      for (const [key,value] of limits) if (value.until < now) limits.delete(key);
      const rate = limits.get(ip) ?? {count:0,until:now+60000};
      if (++rate.count > 300 || limits.size > 10000) throw new SyncError(429, '请求过于频繁');
      limits.set(ip,rate);
      if (url.pathname === '/healthz' && request.method === 'GET') return send(response,200,{ok:true});
      if (url.pathname === '/api/auth/status' && request.method === 'GET') return send(response,200,{enabled:!!auth});
      const jar = cookies(request);
      const bearer = /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(request.headers.authorization ?? '');
      const token = bearer?.[1] ?? jar['__Host-milk_session'];
      const requireOrigin = () => {
        if (request.headers.origin !== origin) throw new SyncError(403, '请求来源无效');
      };
      const login = () => {
        if (!auth) throw new SyncError(401, '请登录后同步');
        const session = auth.session(token);
        if (request.method !== 'GET' && !bearer) { requireOrigin(); auth.sessions.csrf(token, request.headers['x-csrf-token']); }
        return session;
      };
      if (url.pathname === '/api/auth/begin' && request.method === 'POST') {
        if (!auth) throw new SyncError(503, 'Apple 登录尚未配置');
        const value = await body(request);
        if (!['ipad','web','android'].includes(value.platform)) throw new SyncError(400, '登录平台无效');
        if (value.platform === 'web') requireOrigin();
        if (value.reauth) login();
        const challenge = auth.begin(value.platform, value.reauth ? token : undefined);
        const headers = value.platform === 'web' ? {'Set-Cookie':cookie('__Host-milk_login', challenge.state, 300, 'None')} : {};
        return send(response,200,challenge,headers);
      }
      if (url.pathname === '/api/auth/complete' && request.method === 'POST') {
        if (!auth) throw new SyncError(503, 'Apple 登录尚未配置');
        const value = await body(request);
        return send(response,200,await auth.complete(value.state, value.code, 'ipad'));
      }
      if (url.pathname === '/api/auth/callback' && request.method === 'POST') {
        if (!auth) throw new SyncError(503, 'Apple 登录尚未配置');
        const value = await body(request, true);
        if (auth.sessions.challengePlatform(value.state) === 'android') {
          const result = await auth.complete(value.state,value.code,'android');
          response.writeHead(303,{Location:'/auth/android?ticket='+encodeURIComponent(result.handoffTicket),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
          return response.end();
        }
        if (!value.state || jar['__Host-milk_login'] !== value.state) throw new SyncError(403, '登录来源校验失败，请重新登录');
        const result = await auth.complete(value.state, value.code, 'web');
        if (result.reauthTicket) return send(response,200,{accountId:result.accountId,reauthTicket:result.reauthTicket});
        response.writeHead(303,{Location:'/', 'Cache-Control':'no-store','Set-Cookie':[
          cookie('__Host-milk_session',result.token,604800),cookie('__Host-milk_csrf',result.csrf,604800,'Lax',false),cookie('__Host-milk_login','',0,'None'),
        ]});
        return response.end();
      }
      if (url.pathname === '/api/auth/exchange' && request.method === 'POST') {
        if (!auth) throw new SyncError(503, 'Apple 登录尚未配置');
        const value = await body(request);
        return send(response,200,auth.sessions.exchangeHandoff(value.ticket,value.verifier));
      }
      if (url.pathname === '/api/account' && request.method === 'GET') return send(response,200,{accountId:login().accountId});
      if (url.pathname === '/api/sync/snapshot' && request.method === 'GET') return send(response,200,store.snapshot(login().accountId));
      if (url.pathname === '/api/sync/changes' && request.method === 'GET') return send(response,200,store.changes(login().accountId,Number(url.searchParams.get('cursor') ?? 0),Number(url.searchParams.get('limit') ?? 100)));
      if (url.pathname === '/api/sync/push' && request.method === 'POST') {
        const accountId = login().accountId, value = await body(request);
        return send(response,200,store.push(accountId,value.requestId,value.operations));
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        login(); auth.logout(token);
        return send(response,200,{ok:true},{'Set-Cookie':[cookie('__Host-milk_session','',0),cookie('__Host-milk_csrf','',0,'Lax',false)]});
      }
      if (url.pathname === '/api/account' && request.method === 'DELETE') {
        login(); const value = await body(request);
        const accountId = auth.startDeletion(token,value.reauthTicket);
        try { await auth.finishDeletion(accountId); return send(response,200,{deleted:true}); }
        catch { return send(response,202,{deleting:true,message:'云端访问已停止，授权撤销将在后台重试'}); }
      }
      throw new SyncError(404, '接口不存在');
    } catch (error) {
      if (error instanceof SyncError) send(response,error.status,{error:error.message,...error.details});
      else send(response,500,{error:'服务暂不可用，请保留本机记录并稍后重试'});
    }
  };
}
