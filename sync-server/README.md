# 跨平台同步服务（开发中）

独立于原局域网 `server.mjs`。用户确认的范围为可选 Apple 登录、iPad/Android/Web 同步，需求与计划见 `../docs/spec/`。

## 当前已验证（尚未生产上线）

SQLite 存储：账号隔离、记录/间隔版本、增量游标、删除标记、幂等请求、同计划自动记录去重、整批事务回滚、重启保留和账号注销阻止旧数据重建。

已实现 Apple JWT/JWK 验证、单次nonce挑战、加密刷新凭证、可撤销会话、Web Cookie/CSRF、Android一次性授权回传及注销重试。真实HTTP测试覆盖未登录拒绝、Cookie写入校验和账号隔离。授权使用受控签名身份测试，真实Apple会员配置与登录尚未验证。

```sh
npm ci --prefix sync-server --ignore-scripts
node --test sync-server/tests/*.test.mjs
# Apple配置未填时登录禁用，可检查healthz和auth/status。
node sync-server/main.mjs
```

部署运行时计划 Node 24；本机 Node 22.22 可运行当前测试，内置 SQLite API 在该版本仍为 experimental。

接口见 [API契约](API.md)，部署配置见 `deploy/`。客户端接入、回调页面、Apple事件通知、HTTPS及实际部署尚未完成，目前不能用于实际用户登录或同步。密钥、数据库和依赖目录不提交Git。
