# 同步 API 契约（服务端实现，客户端接入中）

根地址：`https://babysync.codeainews.top`。未部署，不能据此认为线上可用。所有响应禁止缓存。JSON错误包含 `error`；409冲突还包含 `kind`、`id`、`current`。

## 身份与会话

原生请求使用 `Authorization: Bearer <token>`，长期令牌仅存原生安全存储。Web 使用 Secure / HttpOnly 的 `__Host-milk_session` Cookie；写请求还需同源 `Origin` 和 `X-CSRF-Token`，其值来自 `__Host-milk_csrf` Cookie。

- `GET /api/auth/status` → `{enabled}`；未配置 Apple 时不允许登录。
- `POST /api/auth/begin` → 请求 `{platform:"ipad"|"web"|"android", reauth?:true}`；返回 `{state,nonce,clientId,platform,authorizeURL?,verifier?}`。Web 必须同源。重新认证必须带现有会话。
- iPad 将 `nonce` 原样传给 Apple authorization request，成功后 `POST /api/auth/complete`，发送 `{state,code}`。服务端验证兑换得到的 Apple JWT；不接受客户端自行提供的用户ID。
- Web / Android 打开 `authorizeURL`。Apple以 form_post 回调 `POST /api/auth/callback`。Web 校验登录发起 Cookie，并设置安全会话 Cookie；Android 回调跳转 `/auth/android?ticket=...`，仅携带一次性短期票据。
- Android App Link 收到票据后 `POST /api/auth/exchange`，发送 `{ticket,verifier}`。verifier 从登录发起时保存在原设备，不能随链接一起传递。票据60秒有效，仅兑换一次。
- 原生登录完成返回 `{token,csrf,accountId,expiresAt}`；原生同步无需使用csrf字段。Web长期令牌不放响应正文。
- `GET /api/account` → `{accountId}`。
- `POST /api/auth/logout` → `{ok:true}`，撤销该会话。其他设备会话仍有效。
- 注销前重新授权完成得到 `reauthTicket`（3分钟有效，绑定原会话）。`DELETE /api/account` 请求 `{reauthTicket}`，先停止账号全部访问，再撤销各客户端Apple刷新凭证，成功删除云端记录。200返回 `{deleted:true}`；202返回 `{deleting:true,message}`，后台重试；本机客户端据此清理账号缓存。

## 记录同步

- `GET /api/sync/snapshot` → `{cursor,entries,settings}`，用于首次登录合并预览。entries含 `id,at,amount,auto,planId?,version`；settings为空或 `{intervalHours,intervalStartedAt,planId?,version}`。
- `GET /api/sync/changes?cursor=0&limit=100` → `{cursor,hasMore,changes}`；每个变更为 `{kind,id,version,seq,deleted,value}`。分页持续至hasMore=false。
- `POST /api/sync/push` 请求 `{requestId,operations}`，最多100项。每项为 `{kind:"entry"|"settings",id,expectedVersion,value}`；删除entry使用 `{kind:"entry",id,expectedVersion,deleted:true}`，不提供value。
- 新记录expectedVersion=0。已存在记录必须使用拉取到的版本。settings的id固定 `feeding`。
- 普通记录value为 `{at,amount,auto:false}`；历史奶量允许1–2000ml，新界面仍按10–300ml滚动。
- 自动记录value含 `{at,amount,auto:true,planId}`，id固定 `auto:<planId>:<at>`。同一内容、同一计划的首次创建可跨设备去重；内容不同返回冲突，不重复累计。
- 成功返回 `{accepted,cursor}`。**客户端不能直接把push响应的cursor当作已拉取游标**，否则可能跳过其他设备的变更；只能在成功应用changes或snapshot后推进拉取游标。
- 409整批回滚，客户端保留待同步操作，展示冲突；不能静默覆盖服务器。删除标记不可用旧版本复活，若用户明确要恢复内容，需要创建新的记录ID。
- 同一requestId重试必须保持完全相同的操作内容；服务端返回原结果。不可给修改后的请求复用旧requestId。

## 仍需集成

三端持久队列与账号隔离、合并/冲突UI、Web重新认证回跳页面、Android验证App Links与回调页、Apple服务端事件通知及真实授权验证。接口已通过本地集成测试，尚不满足生产上线验收。
