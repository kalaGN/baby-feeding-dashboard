# Android 安装版

原生 Android WebView 应用，连接同一局域网中运行的喝奶看板服务器。支持 Android 6.0 及以上版本，默认横屏、全屏并保持屏幕常亮。

## 安装与连接

1. 在电脑上启动项目根目录的 `node server.mjs`。
2. 将 APK 复制到平板，打开文件安装；系统提示时，允许该文件管理器安装此 APK。
3. 打开“喝奶看板”，填写电脑服务器地址，例如 `http://192.168.0.104:4173`。
4. 平板和电脑连接同一个 Wi-Fi。右下角“设置”可修改服务器地址。

如果电脑的 `artifacts/` 目录中已放入 `baby-feeding-dashboard-1.0.0.apk`，也可以在平板浏览器打开 `http://<电脑的局域网 IP>:4173/downloads/baby-feeding-dashboard.apk` 直接下载安装包。

这是服务器连接版，网页和记录由电脑服务提供。启动应用需要能访问服务器；应用在前台时自动记录，退出或切到后台后暂停计时。

应用与原浏览器的存储相互独立。安装前，请在原来有记录的平板浏览器打开新版网页，确认旧记录已迁移到服务器；应用随后会读取同一份服务器记录。

## 构建

使用 JDK 17 或兼容版本、Android SDK Platform 35 和 Build Tools 35.0.0。项目使用 Gradle Wrapper 8.12.1 和 Android Gradle Plugin 8.10.1。

配置 `ANDROID_HOME`，或在本目录创建不入库的 `local.properties`，填写 SDK 路径：

```properties
sdk.dir=/absolute/path/to/android-sdk
```

生成开发安装包：

```bash
./gradlew :app:assembleDebug
```

输出文件：`app/build/outputs/apk/debug/app-debug.apk`。

## 发布签名

在本目录生成并妥善备份签名密钥，按照命令提示输入密码：

```bash
keytool -genkeypair -keystore board-release.jks -alias baby-feeding-dashboard -keyalg RSA -keysize 2048 -validity 10000
cp signing.properties.example signing.properties
```

在 `signing.properties` 中填写密钥密码，然后执行：

```bash
./gradlew :app:assembleRelease
```

输出文件：`app/build/outputs/apk/release/app-release.apk`。后续更新需要使用同一签名密钥，并增加 `versionCode`。密钥、密码和构建产物均不提交到 GitHub。

将发布 APK 复制到项目根目录下的 `artifacts/baby-feeding-dashboard-1.0.0.apk`，服务器即可提供上述局域网下载地址。

## 权限

仅申请网络权限，用于读取页面和同步记录。服务器地址保存在应用中，记录仍由服务器保存。应用允许局域网 HTTP 连接，没有原生 JavaScript 桥接接口，也不申请文件、相机或联系人权限。
