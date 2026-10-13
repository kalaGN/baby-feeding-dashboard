# App Store 上架准备

核对日期：2026-10-13。状态：准备中，未上传、未提交审核、未上架。

## 当前工程

- 应用：喝奶看板；iPad 专用，iPadOS 15 起，横屏。
- Bundle ID：`com.kalagn.babyfeeding.ipad`，待开发者账号中确认可注册。
- iOS 版本：1.0.0，构建号 1；与 Android 版本独立。
- UIKit + WKWebView，界面随包安装；原生本地存储、系统 CSV 文件选择器。
- 模拟器构建已通过；真机签名、Archive 上传、TestFlight 验证待完成。
- 2026-10-13：Release 真机平台无签名 Archive 构建通过，产物为 `ios/build/BabyFeedingDashboard.xcarchive`。它仅用于构建验证，不能直接提交 App Store；开通会员后须重新签名归档。
- 已准备 [iPad 隐私政策](privacy.md) 与 [支持页面](support.md) 文稿，尚未部署成公开网页。
- 已加入 `PrivacyInfo.xcprivacy`：无跟踪、无开发者数据收集。当前原生源码及发行二进制未发现所查的 Required Reason API 直接使用，API 声明暂为空；上传后仍须以 Apple 校验结果复核。
- 应用内 iPad 更新说明已兼容 App Store / Xcode 两种安装来源，补充卸载删除及系统备份说明。
- 已生成 13 英寸 iPad 主界面横屏截图：`artifacts/app-store/ipad13-dashboard.png`，2752×2064，无模拟器外框或黑边。该模拟器已有一条演示记录，截图不是首次启动画面；其余功能截图尚待完成。

## 账号与提交流程

1. 用户本人开通 Apple Developer Program，完成身份验证、协议签署及付款。
2. Xcode 登录已开通的账号，配置 Team，注册 Bundle ID。
3. 在 App Store Connect 创建应用，确认名称、SKU、地区和价格。
4. 核对隐私清单与 Required Reason API；检查归档中系统 WebView 使用的 API，不能仅凭源码未使用 SDK 判定无需清单。
5. 补齐公开的隐私政策 URL、支持 URL、审核联系资料、年龄分级和出口合规声明。
6. 生成正式签名 Archive，上传 App Store Connect，完成 TestFlight 和真实 iPad 功能验证。
7. 提交审核，跟进审核结果；只有商店公开页面可下载时才算上架完成。

## 商店文案草稿

### 名称

喝奶看板

### 副标题

大字号喂奶时间与奶量记录

### 描述

把 iPad 变成方便家人查看的喂奶看板。

大字号显示当前时间与下一次喂奶时间，横屏摆放，便于成年家长和照护者查看。

- 首次启动默认间隔 3 小时，可分别调整小时和分钟。
- 新增、编辑、删除喂奶记录，奶量默认 120 ml，可上下滚动选择。
- 查看今日奶量与次数，以及近 7 天、30 天的每日奶量和平均奶量。
- 支持夜间模式及 CSV 备份、预览后还原。
- 无需注册，日常记录可离线使用，记录保存在当前设备中。

自动记录只在应用前台运行时执行，到预定时间沿用上一笔奶量；没有历史记录时使用 120 ml。自动记录代表按计划生成的记录，不代表已实际完成喂养，请照护者核实并及时修改。应用关闭或后台期间不会补记。

喂奶间隔由照护者自行设置，本应用用于记录和展示，不提供医学建议。

### 关键词草稿

喂奶,喝奶,奶量,记录,看板,时钟,育儿,照护,统计,备份

### 审核备注草稿

应用供成年家长和照护者使用，无需账号登录，无付费功能。首次启动显示 3 小时间隔和添加第一条记录的提示。点击右下角加号新增记录，点击间隔调整计划；标题右侧齿轮进入 CSV 备份与还原、隐私政策和关于。所有日常记录本地保存，原生文件选择器支持 CSV 导出和导入。自动记录只在前台执行，可编辑或删除；不使用推送通知或后台任务。

## 待核实材料

- [ ] 会员已开通；Team 与 Bundle ID 已确认。
- [ ] 发行地区与免费价格确认；中国大陆地区所需备案资料在 App Store Connect 核对。
- [ ] 隐私政策提供稳定的公开 URL，内容准确覆盖 iPad 的数据保存、删除与 CSV 行为。
- [ ] 技术支持页面可访问，联系方式有效。
- [ ] App Privacy 申报按实际收集情况填写；源码未发现广告或分析 SDK，当前判断为开发者不收集记录，需发行包复核。
- [ ] 隐私清单与出口合规已核对。
- [ ] 正式 AppIcon 1024×1024 无透明通道，归档资源通过校验。
- [ ] 13 英寸 iPad 横屏截图，符合 Apple 当前规格；现有预览截图有黑边，不能直接当最终商店截图。
- [ ] 截图展示主界面、记录编辑、统计、备份与还原；使用模拟数据。
- [ ] 真机测试新增、编辑、删除、重启保留、夜间模式、CSV 往返及存储失败提示。
- [ ] 发行版更新说明与应用内更新方式一致（App Store 版本不再称仅通过 Xcode 更新）。
- [ ] TestFlight 构建通过验证；审核资料完整。

## Apple 官方参考

- [会员注册与费用](https://developer.apple.com/programs/enroll/)
- [提交应用](https://developer.apple.com/app-store/submitting/)
- [隐私申报](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [截图规格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [审核指南](https://developer.apple.com/app-store/review/guidelines/)
