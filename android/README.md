# Android 独立版

从 [GitHub Releases](https://github.com/kalaGN/baby-feeding-dashboard/releases/latest) 下载 APK。支持 Android 6.0 及以上版本，默认横屏、全屏并保持屏幕常亮。

## 安装与使用

1. 将 APK 下载到平板，打开文件安装。系统提示时允许该下载工具或文件管理器安装应用。
2. 打开“喝奶看板”即可使用，不用启动电脑服务或填写服务器地址。
3. 页面内置于安装包，新增、编辑、删除及设置间隔都可离线完成。
4. “喝奶看板”右侧齿轮打开设置面板，包含“备份与还原”“检查更新”“关于”，关于位于最下面。服务地址在“备份与还原 → 从服务器还原”内配置。

记录保存在应用私有目录的 `state.json`，WebView 也保留暂存副本。应用重开后继续读取本地记录。卸载应用或清除应用数据会删除记录；请通过“备份与还原 → 导出 CSV”手动保存备份；从 CSV 还原需预览并确认。

应用在前台时自动记录，退出或切到后台后暂停计时，错过的时段不会补记。夜间模式会记住选择。

## 旧记录迁移

升级自 v1.0.x 后，首次启动会提示是否读取旧记录。也可点击标题右侧齿轮，选择“备份与还原 → 从服务器还原”：

1. 电脑暂时保持旧服务运行，平板与电脑连接同一 Wi-Fi。
2. 填写旧电脑服务地址，例如 `http://192.168.0.104:4173`，点击“读取”。升级安装会保留原先的服务器地址。
3. 页面显示待导入的记录条数。只有点击“确认还原”后才替换平板记录；点击取消不会导入。
4. 完成后可关闭电脑服务，后续记录仅保存在平板，与电脑记录不再同步。

电脑原记录不会被删除或修改。若平板已经有新记录，导入旧记录会替换它们，请先通过“导出 CSV”保留当前记录备份。首次迁移前，原浏览器中的记录需已同步到旧电脑服务。

## 应用更新

打开应用进入前台时检查 GitHub 最新正式 Release，自动检查每天最多一次（按平板本地日期），关闭或重启应用仍会记住检查日期。检查失败也计入当日自动检查，可从齿轮菜单选择“检查更新”随时手动重试。自动检查无新版或失败时不打断看板，离线记录功能继续使用。网络异常时同一轮内部最多重试两次，分别等待2秒和5秒。

发现新版后显示版本和更新说明，点击“立即更新”才下载。下载遇到网络异常同样自动重试两次，每次从头下载，支持取消。手动检查或下载重试耗尽后显示“重试/稍后”；HTTP永久错误、证书/签名/哈希错误、文件保存错误不自动重试。应用校验文件大小、SHA-256、包名、签名及更高 versionCode 后打开系统安装器。首次需允许本应用安装未知应用，系统安装仍需用户确认。覆盖更新保留本地记录，不要先卸载。

旧版本需要手动安装一次 v1.1.2 或以上版本，后续才能通过应用检查更新。更新仅访问 GitHub 发布信息和 APK，不发送喝奶记录。

发布时使用正式标签（如 v1.2.0），版本格式为三段数字，APK 附件命名 `baby-feeding-dashboard-1.2.0.apk`，提高 versionCode，并使用原签名。Release 附件必须有 GitHub 提供的 SHA-256 digest。

每次上传新版 APK 到 GitHub Release，必须同步上传同一份签名 APK 到 [Gitee 下载仓库](https://gitee.com/AiLbai/baby-feeding-dashboard) 的同版本 Release，Gitee 附件命名为 `baby-feeding-dashboard.apk`，不上传项目源码。核对两边下载链接可用且 APK 的 SHA-256 一致后，才算发布完成。项目发布规则见 [AGENTS.md](../AGENTS.md)。

## 构建

使用 JDK 17 或兼容版本、Android SDK Platform 35 和 Build Tools 35.0.0。项目使用 Gradle Wrapper 8.12.1 和 Android Gradle Plugin 8.10.1。

配置 `ANDROID_HOME`，或在本目录创建不入库的 `local.properties`：

```properties
sdk.dir=/absolute/path/to/android-sdk
```

```bash
./gradlew :app:assembleDebug
./gradlew :app:testReleaseUnitTest :app:assembleRelease :app:lintRelease
```

构建自动将项目根目录的 `dist/` 复制到 APK assets，无需单独维护网页副本。开发包位于 `app/build/outputs/apk/debug/app-debug.apk`；发布包位于 `app/build/outputs/apk/release/app-release.apk`。

## 发布签名

首次生成并备份签名密钥：

```bash
keytool -genkeypair -keystore board-release.jks -alias baby-feeding-dashboard -keyalg RSA -keysize 2048 -validity 10000
cp signing.properties.example signing.properties
```

在 `signing.properties` 中填写密码后打包。更新必须使用同一密钥并增加 `versionCode`，才能覆盖安装。密钥、密码和构建产物不提交到 GitHub。

将发布包放到项目根目录的 `artifacts/baby-feeding-dashboard-1.1.19.apk`，电脑服务即可提供 `/downloads/baby-feeding-dashboard.apk` 下载。

## 实现与权限

内置页面从受限内部 HTTPS 地址读取打包资源。原生存储桥接沿用网页状态协议，检查数据格式、revision 与写入结果；本地临时文件同步落盘后替换正式文件，失败不更新内存状态。

WebView 禁止外部页面、文件访问及远程资源。网络权限用于检查 GitHub 更新、下载 APK 和用户主动读取旧电脑记录，另申请安装更新权限，不申请外部存储、相机或联系人权限。正常启动与记录无需网络。

验证覆盖离线状态适配、本地保存后重开、旧版本冲突、无效数据、写入失败保护及确认迁移。实机安装结果另行确认。
