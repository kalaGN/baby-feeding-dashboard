# Apple 登录与跨平台同步实现计划（待审核）

前置需求：[已确认的产品方案](apple-login-sync.md)。部署目标为用户提供的阿里云空服务器；未连接或修改服务器。

## 部署结构

一个 HTTPS 域名承载网页、Apple 网页登录回调及同步 API。首版一个服务进程和一份 SQLite 数据库，不引入 Redis、集群或额外数据库服务。

- 服务端采用 Node.js 24、SQLite；本地现有 Node 22 不替换，开发时按服务目录指定运行时。
- 使用 Nginx 作为 HTTPS 反向代理，systemd 管理服务，服务仅监听 `127.0.0.1:4180`；新建专用非 root 服务用户和数据目录。证书签发前核对 DNS、域名备案要求及安全组。
- 数据库事务完成记录变更、增量游标和幂等结果写入；数据库备份使用一致性备份，不直接复制正在写入的文件。
- Apple 私钥及令牌加密密钥仅在部署环境保存，不写入 Git 或输出到日志。
- 部署时核对安全组、域名 DNS、证书、备份及恢复；不改动服务器已有服务，若实际并非空服务器则先调整部署计划。

## 实现顺序与验收点

1. **同步服务基础**：账号隔离、SQLite 迁移、记录版本、删除标记、游标及幂等接口。通过跨账号访问拒绝、重复请求、并发编辑和重启保留测试。
2. **Apple 登录与会话**：原生授权码及网页回调验证；Web Cookie、原生安全令牌存储；撤销和注销。先使用受控测试身份验证错误路径，真实 Apple 授权须等会员配置。
3. **共用同步界面**：账号与同步菜单、首次合并预览、冲突处理和同步状态；访客与账号数据隔离。测试取消合并、切账号和离线未同步记录。
4. **iPad 接入**：AuthenticationServices、Keychain、网络桥接及持久待同步队列；更新隐私清单。验证离线重启、合并和系统取消登录。
5. **Android / Web 接入**：网页 Apple 授权与安全回调；Android 使用应用链接和一次性交换票据，不在 URL 传长期会话令牌。保留旧 Android WebView 的界面兼容性。
6. **多设备验证与部署**：三端新增、编辑、删除、间隔同步、自动记录去重；限流、令牌失效、服务错误和恢复备份。部署测试数据服务后再配置真实 Apple 登录。
7. **上架材料同步**：同步开关的数据上传说明、账号删除、隐私政策与 App Privacy 申报；再次归档、真机测试和 TestFlight。

## 需要明确的产品细节

- 旧记录合并按记录 ID 去重；日期和奶量相同但 ID 不同的记录不自动删除，避免丢失真实的两笔记录。
- 自动记录同一计划时段使用稳定计划 ID 去重；同步间隔以服务端版本为准，旧设备离线计划需在重连时核对。
- 服务端时间用于判定版本和会话有效性；不以设备本地时钟直接决定冲突输赢。
- 云端账号删除需要重新认证。删除后会话失效；其他离线设备重连时停止上传并清理账号缓存，访客数据独立保留。

## 依赖和验证

- 优先 Node 内置 HTTP、crypto 和 SQLite；Node 24 SQLite API 当前为 release candidate，运行时固定版本并做迁移和重启测试，部署前确认可接受这一依赖状态。
- JWT / JWK 验证优先使用维护中的专用库，具体版本在任务阶段查官方文档并锁定；不自行实现密码学签名验证。
- 回归命令：`node --test tests/*.test.mjs`。
- 新服务计划命令：`node --test sync-server/tests/*.test.mjs`、`node sync-server/main.mjs`；入口在实现阶段创建。
- 模拟身份测试不代表 Apple 实际授权成功；只有实际三端授权与线上隔离测试通过才报告同步完成。

## 尚缺配置

已确认目标：`39.96.160.146`，用户 `root`，SSH 端口 `22`，域名 `babysync.codeainews.top`。

用户已通过密码在 iTerm2 登录，并提供只读命令结果：Alibaba Cloud Linux 3.2104 U13.4，x86_64，根盘 40 GB / 可用 33 GB；PATH 未找到 Node、Nginx、Docker，监听端口只有 22。尚未修改服务器。电脑操作工具禁止控制 iTerm2，远端命令由用户执行，不收集密码。

仍需 Apple 开发者会员开通后的 Team ID、App ID / Services ID 配置。DNS、HTTPS、glibc、SELinux 和安全组尚未验证。服务器配置脚本和安装包在本地准备后，由用户在已登录的终端执行。

## 官方技术参考

- [Node.js 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Apple 身份验证](https://developer.apple.com/documentation/signinwithapple/verifying-a-user)
- [Apple 登录配置](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple)
- [账号删除与授权撤销](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)
