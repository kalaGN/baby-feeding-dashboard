# iPad 安装版

原生 UIKit + WKWebView 外壳，随应用打包现有看板，无需电脑服务器或网络。

- iPadOS 15 及以上，横屏、全屏、前台保持常亮。
- 新增、编辑、删除、自动记录、夜间模式、7/30天奶量统计。
- 本机记录保存在 Application Support/MilkBoard/state.json，原子写入，升级保留；卸载会删除数据。
- 自动记录仅在前台运行时执行，后台或关闭期间不补记。
- iOS 版本暂不包含 Android 的服务器导入菜单及 APK 自动更新；更新需通过 Xcode 安装，或后续配置 TestFlight/App Store。

## 安装到自己的 iPad

1. 打开 `BabyFeedingDashboard.xcodeproj`。
2. Xcode → Settings → Accounts，登录你的 Apple ID。
3. 选中项目的 BabyFeedingDashboard target → Signing & Capabilities，选择自己的 Team，开启 Automatically manage signing。必要时修改 Bundle Identifier 为自己的唯一标识。
4. 用 USB 连接 iPad，信任电脑；按设备提示启用开发者模式（如适用）。
5. Xcode 顶部选择 iPad，点击 Run。

普通 Apple ID 的 Personal Team 签名有效期通常7天，到期需重新构建安装。不要卸载应用后重装，以免删除记录。Apple 官方说明：https://developer.apple.com/support/compare-memberships/

## 构建与验证

```sh
xcodebuild -project ios/BabyFeedingDashboard.xcodeproj -scheme BabyFeedingDashboard \
  -sdk iphonesimulator -configuration Debug -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO build
swiftc ios/BabyFeedingDashboard/StateStore.swift ios/Tests/main.swift -o /tmp/milk-ios-store-test
/tmp/milk-ios-store-test
node --test tests/auto-record.test.mjs
```

Xcode 每次构建自动从 `dist/` 复制界面到 `ios/Board/`，无需手工同步。模拟器产物 `.app` 不能直接安装到真实 iPad；真机包必须签名。

## CSV 备份与还原

点击标题右侧齿轮 → 备份与还原。导出 CSV 后由系统“文件”选择保存位置；从 CSV 还原时选择备份文件，预览并确认后替换本机记录。取消或校验失败保留原记录，沿用当前喝奶间隔。iPad 目前不提供服务器还原和应用内自动更新；设置页面会说明更新方式。
