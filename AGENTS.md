# 项目规则

## Android 版本发布

- 将新版 Android APK 上传到 GitHub Release 时，必须同步上传一份到 [Gitee 下载仓库](https://gitee.com/AiLbai/baby-feeding-dashboard) 的同版本 Release。
- 两个平台使用相同版本标签（如 `v1.2.0`）和同一份签名 APK；Gitee 附件固定命名为 `baby-feeding-dashboard.apk`。
- Gitee 仅用于分发安装包和下载说明，不上传项目源码。
- 发布后核对两边的 APK 下载链接可用，并确认下载文件的 SHA-256 一致。两边均验证成功后，才能报告发布完成。
- 若 Gitee 上传或验证失败，应明确报告未同步完成及原因，继续完成同步；不得只完成 GitHub 上传就宣称发布完成。
