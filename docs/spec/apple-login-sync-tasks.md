# 跨平台同步任务清单（待审核）

对应 [实现计划](apple-login-sync-plan.md)。用户已确认计划与任务并授权开发。当前已完成本地服务端基础；未部署或修改服务器。

- [x] 1. SQLite 同步存储与迁移
  - 文件：`sync-server/store.mjs`、`sync-server/migrations/001.sql`、`sync-server/tests/store.test.mjs`。
  - 验收：账号隔离、版本冲突、删除标记、增量游标和幂等均在事务内完成；失败不部分写入。
  - 验证：`node --test sync-server/tests/store.test.mjs`，包含并发和重启用例。
- [ ] 2. Apple 授权验证与会话
  - 文件：`sync-server/auth.mjs`、`sync-server/session.mjs`、`sync-server/package.json`、锁文件和认证测试。
  - 验收：拒绝错误签名/audience/nonce/过期令牌，网页 state 一次性；会话可撤销，测试身份入口不允许生产启用。
  - 验证：受控 Apple 上游及真实授权两层验证；真实授权等待会员配置。
- [ ] 3. HTTP 同步与注销接口
  - 文件：`sync-server/main.mjs`、`sync-server/routes.mjs`、`sync-server/tests/http.test.mjs`。
  - 验收：无登录不可读取记录，Web 请求验证 CSRF；账号删除撤销授权，失败可重试且不可重建已删除数据。
  - 验证：真实本地 HTTP 测试、限流/超时/错误路径与账户隔离测试。
- [ ] 4. 共用账号与同步 UI
  - 文件：`dist/index.html`、`dist/style.css`、`dist/account.js`、`dist/sync.js`、对应测试。
  - 验收：免登录功能不受影响，旧数据确认后才上传；离线队列、冲突确认、退出/换账号数据隔离。
  - 验证：浏览器实际操作、既有 `node --test tests/*.test.mjs` 回归。
- [ ] 5. iPad 原生接入
  - 文件：iOS 授权、Keychain、同步桥接、工程配置及测试，分小批实现。
  - 验收：取消登录无数据变化，重启保留待同步队列；令牌不传入页面 localStorage。
  - 验证：模拟器构建、真实 iPad 登录与两设备同步。
- [ ] 6. Android 与 Web 登录接入
  - 文件：Android 授权回调/安全存储及配置、Web 同域登录流程；分小批实现。
  - 验收：三个平台同一用户标识；回调只能兑换一次，不在 URL 携带长期令牌。
  - 验证：Android 单元测试与设备授权、Web 浏览器授权；未登录和旧设备兼容测试。
- [ ] 7. 阿里云部署文件与恢复
  - 文件：`sync-server/deploy/` 下的 systemd、Nginx、配置模板、部署及备份说明。
  - 验收：服务非 root，数据目录独立，公开接口经 HTTPS；备份可恢复，生产关闭测试身份。
  - 验证：用户在 iTerm2 执行受审查命令后，核对外部 HTTPS、健康接口、认证失败及恢复演练。
- [ ] 8. 隐私及 App Store 材料更新
  - 文件：隐私页面、App Store 文案、iOS 隐私清单、README。
  - 验收：准确说明登录后的云端存储、账号删除、退出和数据保留，未登录仍本地使用。
  - 验证：发行包资源检查、真机/TestFlight 和 Apple 服务端校验。

## 当前等待

2026-10-13：同步服务20项测试与原有23项回归全部通过；独立启动healthz返回ok，缺少Apple配置时auth/status明确返回enabled=false。任务2/3服务端代码已实现，仍需真实Apple验证、回调客户端集成及事件通知；任务7已准备Nginx/systemd模板但未部署。下阶段继续共用同步协调和账号界面、原生接入。

Apple实际登录配置、生产签名和App Store提交需开发者会员开通。iTerm2无法由电脑操作工具接管，最终服务器命令仍由用户执行。
