# 项目规则

## 架构原则

- 项目包含共用看板界面、Android/iPad 原生能力、局域网服务和云端同步服务。按运行环境与职责划分，避免互相隐式依赖。
- 未登录功能始终可以使用；云端故障不能阻止本机记录。访客和不同账号的数据必须隔离，旧记录上传需用户明确确认。
- 共用 UI 只维护一份；平台差异通过原生桥接或明确的存储适配器处理，不复制三套页面。
- 优先标准库、现有模块和少量直接调用。不建立空目录、通用框架、无实际用途的 repository/service/controller 多层包装。
- 下列树是目标布局。未实现的模块按任务逐步创建，不为匹配目录树一次性搬动现有代码。

## 目录与文件规划

```text
.
├── AGENTS.md                     # 开发、架构与发布约束
├── SPEC.md                       # 现有看板规格
├── README.md / README.en.md       # 用户入口与使用说明
├── server.mjs                    # 原局域网 Web 静态资源与单份状态服务
├── dist/                         # 当前共用 UI 的源文件和可直接发布资源
│   ├── index.html                # 页面结构与弹窗
│   ├── style.css                 # 布局、响应式与夜间主题
│   ├── app.js                    # 现有记录流程、时间展示及交互
│   ├── backup.js                 # CSV 编解码与校验
│   ├── settings.js               # 设置页面导航与操作
│   ├── account.js                # 计划：账号 UI、合并预览与注销确认
│   ├── sync.js                   # 计划：同步协调、离线队列与冲突处理
│   ├── storage.js                # 按需拆分：访客/账号存储及平台适配
│   ├── bridge.js                 # 按需拆分：原生能力的统一调用契约
│   └── sw.js / manifest.webmanifest / icon-*.png
├── android/
│   ├── app/src/main/java/com/kalagn/babyfeeding/
│   │   ├── MainActivity.java     # 生命周期、WebView 配置和桥接装配
│   │   ├── StateStore.java       # 本机访客/账号记录及持久化
│   │   ├── AppUpdater.java / UpdateRetry.java / ReleaseInfo.java
│   │   ├── UpdateApkProvider.java
│   │   ├── AppleSignIn.java      # 计划：外部授权与应用链接回调
│   │   ├── SessionStore.java     # 计划：Keystore 保护的会话存储
│   │   └── SyncClient.java       # 计划：原生网络传输与错误转换
│   ├── app/src/main/res/         # Android 图标、文案、系统配置
│   └── app/src/test/             # Android 单元测试
├── ios/
│   ├── BabyFeedingDashboard/
│   │   ├── App.swift             # 应用入口、控制器及能力装配
│   │   ├── SceneDelegate.swift   # Scene 生命周期与原生窗口创建
│   │   ├── StateStore.swift      # 本机记录及原子写入
│   │   ├── ThemeBridge.swift     # 网页主题与原生安全区域背景同步
│   │   ├── AppleSignIn.swift     # 计划：AuthenticationServices 授权
│   │   ├── SessionStore.swift    # 计划：Keychain 会话存储
│   │   ├── SyncClient.swift      # 计划：原生网络传输与错误转换
│   │   └── Info.plist / PrivacyInfo.xcprivacy / Assets.xcassets/
│   ├── BabyFeedingDashboard.xcodeproj/
│   └── Tests/                    # iOS 存储、授权与桥接测试
├── sync-server/                  # 独立多用户云端服务
│   ├── main.mjs                  # 计划：启动、配置、关闭与进程级错误
│   ├── routes.mjs                # 计划：HTTP 路由、认证/CSRF与输入边界
│   ├── auth.mjs                  # 计划：Apple 授权、JWK/JWT验证及撤销
│   ├── session.mjs               # 计划：会话、一次性票据和令牌加密
│   ├── store.mjs                 # SQLite事务、版本、游标、删除标记及幂等
│   ├── migrations/               # 编号 SQL 迁移，已应用迁移不可修改
│   ├── tests/                    # 真实SQLite、认证模拟与HTTP集成测试
│   ├── deploy/                   # 计划：Nginx/systemd模板、部署及恢复说明
│   └── package.json / package-lock.json / README.md
├── tests/                        # 共用 UI、CSV 与局域网服务测试
├── docs/
│   ├── spec/                     # 功能需求、实现计划和任务状态
│   ├── app-store/                # Apple 商店文案、隐私与提交材料
│   ├── images/                   # README等文档引用的图片
│   └── *.md                      # 已有功能、安装与发布说明
├── artifacts/                    # 本地安装包、截图和验证产物，不提交Git
└── .local/                       # 本地SDK与工具，不提交Git
```

### 源码与生成文件

- `dist/` 虽名为 dist，当前就是界面源码入口，可直接编辑；引入真正构建流水线前不改为生成目录。
- `ios/Board/`、Android 构建时复制的 assets、`ios/build*/` 和 Android build 目录是生成内容，不手工维护界面副本。
- 修改共用界面后，更新 `index.html` 资源版本和 `sw.js` 缓存版本，再通过原生构建同步资源。
- 新建模块时同步加载入口、Xcode工程/Gradle配置与相关测试，避免文件存在但未打入安装包。

## 模块边界与依赖方向

- 页面交互 → 存储/同步协调 → 原生桥接或 HTTP → 持久化。底层存储和传输不操作 DOM，不弹出产品对话框。
- `account.js` 负责用户授权意图及确认界面；`sync.js` 负责队列、版本、冲突与同步状态。认证密钥、签名验证和服务器信任判断不放在 UI 中。
- 原生授权与会话存储不继续堆进 `MainActivity.java` 或 `App.swift`；入口负责装配，平台模块负责各自能力。
- `routes.mjs` 不写散落 SQL，`store.mjs` 不解析 HTTP、不验证 Apple JWT；会话与授权通过明确函数组合。
- `server.mjs` 保持局域网单用户用途。禁止将其 `/api/state` 原样公开作为云端多用户服务。
- `sync-server` 不导入浏览器脚本或平台源码；跨端协议写入 `docs/spec/` 并以契约测试验证。
- 重复的业务规则只有在两个实际调用方出现后才提取纯函数；避免浏览器和服务端共用包含 DOM、网络或原生API的模块。

## 文件与数据规则

- 一个文件聚焦一个明确职责。复杂授权、存储、同步策略分别组织，避免 `utils`、`common`、`manager` 成为杂物文件。
- 当文件包含两个可独立测试的职责，或改动频繁影响无关功能时拆分；行数只作为提示，不能机械拆文件或提前搬动既有模块。
- 共用 UI 维持 ES5 和旧 Android WebView 兼容；服务端使用 `.mjs`，原生沿用 Java/Swift。新增依赖必须锁定并说明用途。
- 同步记录使用稳定 ID、服务端版本和删除标记；不能靠设备时钟决定冲突胜负，不能用整份状态覆盖另一设备的修改。
- 数据库、令牌、私钥、签名文件和运行配置不提交 Git。生产配置单独存放，仓库仅保留无敏感值模板。
- 日志记录请求ID、错误码和耗时，不记录授权码、会话令牌、私钥或真实喂奶记录正文。

## 测试与交付边界

- 共用 UI / 局域网服务：`node --test tests/*.test.mjs`。
- 同步服务：`node --test sync-server/tests/*.test.mjs`，数据库测试用临时真实 SQLite 文件，认证上游用受控模拟。
- Android测试放在 `android/app/src/test/`，iOS测试放在 `ios/Tests/`；平台桥接需分别验证，不以Web测试代替原生验证。
- 必测：账号隔离、旧数据上传确认、离线重试、幂等、并发冲突、删除传播、跨设备自动记录去重、退出换账号及注销。
- 模拟授权通过不代表真实 Apple 登录可用；本地测试、真机安装、线上同步、提交审核和商店发布分别报告。
- 按已确认的需求 → 计划 → 任务分步实现；每个可运行切片验证后更新任务状态。提交、推送、发布需用户授权，保留无关修改。

## Android 版本发布

- 将新版 Android APK 上传到 GitHub Release 时，必须同步上传一份到 [Gitee 下载仓库](https://gitee.com/AiLbai/baby-feeding-dashboard) 的同版本 Release。
- 两个平台使用相同版本标签（如 `v1.2.0`）和同一份签名 APK；Gitee 附件固定命名为 `baby-feeding-dashboard.apk`。
- Gitee 仅用于分发安装包和下载说明，不上传项目源码。
- 发布后核对两边的 APK 下载链接可用，并确认下载文件的 SHA-256 一致。两边均验证成功后，才能报告发布完成。
- 若 Gitee 上传或验证失败，应明确报告未同步完成及原因，继续完成同步；不得只完成 GitHub 上传就宣称发布完成。
