# 鸭先知 iOS

原生 SwiftUI 客户端，最低 iOS 17，支持 iPhone / iPad。工程：`AquaSight.xcodeproj`，Scheme：`AquaSight`。API 使用正式域名 `https://quack.weichao.ren`。

## 功能

- 阅读、订阅、收藏三栏；中文摘要、事实要点、来源阅读与系统分享。
- 开源项目展示语言、许可证、总星标、日/周新增星标及最近维护时间。
- 搜索、清除搜索、下拉刷新、游标分页；未选来源、空内容、网络失败均有明确反馈。
- 游客可在「订阅」页选择基础来源，无需登录即可阅读与收藏；收藏快照、已缓存列表支持离线阅读。列表缓存重新打开后会刷新，搜索结果不覆盖正常列表缓存。
- 更多来源由网页 `/#/reader-settings` 的个人开关启用；开关默认关闭，开启后自行选源，不自动订阅或开启通知。关闭保留选择及收藏，设置跨设备同步。
- 邮箱＋密码登录；验证码用于注册、找回密码和旧账户首次设置密码，会话凭据保存在 Keychain。登录后合并游客收藏，支持多设备收藏同步和取消收藏。
- 收藏立即反馈；未成功发送的改动留在本机，重新同步时重试。账户分别存储，旧请求不能影响新账户。账户删除有二次确认，服务端删除失败时保留本机内容并提示失败。
- 浅色 / 深色、动态字体、横屏、原生返回手势、独立收藏按钮与 VoiceOver 标签。

AI 摘要来自服务端现有采集和整理流程。客户端不保存 LittleLLM / Free 模型密钥，也不在每次阅读时重新请求模型。

## 运行

1. 用 Xcode 打开 `clients/ios/AquaSight.xcodeproj`。
2. 选择 `AquaSight` Scheme 和一台 iPhone 模拟器，运行。
3. 在自己的 iPhone 上运行时，连接设备，在 Signing & Capabilities 中选择自己的开发团队；需要该团队可用的 Bundle ID 和签名配置。

命令行模拟器构建（从仓库根目录执行）：

```sh
xcodebuild -project clients/ios/AquaSight.xcodeproj -scheme AquaSight \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/aquasight-ios-build CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
```

## 测试

选择已有模拟器，避免创建大量设备。以下变量填入 `xcrun simctl list devices available` 中的 UDID：

```sh
AQUASIGHT_SIM_ID='<模拟器 UDID>'
xcodebuild -project clients/ios/AquaSight.xcodeproj -scheme AquaSight \
  -destination "platform=iOS Simulator,id=$AQUASIGHT_SIM_ID" \
  -derivedDataPath /tmp/aquasight-ios-tests \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- -parallel-testing-enabled NO test
```

模拟器也需要临时签名（上述 `CODE_SIGN_IDENTITY=-`），以提供 Keychain 所需的应用身份；禁用签名的包只能用于编译检查，登录存储会失败。

单元测试覆盖真实 API 样本、URL 转义、Cookie 隔离、离线恢复、账户切换、游客转移、收藏重试、删除失败、搜索竞争与分页。UI 测试使用 DEBUG 下的本地 URLProtocol 数据、独立 Keychain 和独立缓存目录，不发送真实验证码或生产写请求。

UI 测试参数：`-uiTestFixtures`、`-uiTestResetStore`、`-uiTestError`。DEBUG 可用 `--preview-tab=subscriptions` 直接预览指定栏目的真实数据，`--preview-event=<事件 ID>` 预览详情。Release 不启用这些测试行为。深色外观可用模拟器系统设置切换；大字体测试使用辅助功能字号。

## 数据与链接

- 本机账户文件位于 Application Support 下 `AquaSight/accounts`；游客迁移兼容旧版 `aquasight.guest` UserDefaults。
- 账户同步仅上传待发送改动，不把全部旧收藏重新写回服务器，避免恢复其他设备已删除的记录。
- 支持 `aquasight://event/<经过 URL 编码的事件 ID>`。HTTPS 分享链接仍打开网页；尚未配置 Associated Domains / AASA，不能当作已完成的 Universal Links。
- 正式 APNs 推送、App Store / TestFlight 发布不包含在当前客户端实现中。

真实邮箱验证码链路、最低版本运行，以及 App Store 隐私页面、供应商数据保留说明，仍需发布前验收。模拟器通过不替代真机验收。隐私清单已按现有邮箱登录、账户标识、收藏 / 阅读同步和服务端会话信息声明；发布时需与服务端及托管服务的实际数据处理方式一起复核。

## 2026-09-28 首轮真机验收（改版前）

iPhone XR / iOS 18.7.9 已通过基础 58 项测试、新增关于页与登录专项复测和线上游客只读检查；带开发签名的 Release 已安装启动。支持邮箱为 `lazywc@gmail.com`，公开页面目标为 `/support.html` 与 `/privacy.html`，须与后端修复一起部署后再验收。完整证据与商店待办见 [上线前检查](../../docs/reviews/ios-prelaunch-2026-09-28.md)。真机开发签名通过不等于 TestFlight 或 App Store 已发布。

## 个人阅读器改版

本轮实现独立 `/api/v1/reader/catalog`、`/api/v1/reader/settings` 和 `view=reader` 查询，复用现有存储，无数据库迁移。登录账户以服务器订阅为准；游客仅能通过查询参数读取基础来源。取消订阅不删除私人收藏。来源选择与更多来源开关分开同步，iOS 保存选择不会覆盖网页开关。

新版客户端应与后端接口一起交付；本地测试通过不表示生产接口已部署。验收与截图见 [阅读器改版记录](../../docs/reviews/ios-reader-2026-09-28.md)。

## 邮箱密码与双端联测

本轮改动与验收见 [密码登录及同步记录](../../docs/reviews/ios-password-2026-09-28.md)。密码接口需先执行新增表迁移 `worker/migrations/20260928_password_auth.sql`，再部署后端与网页。旧账户使用“忘记密码 / 首次设置”保留原账户设置密码，不需重新注册。

可选跨端联测使用 `tests/helpers/cross-client-server.mjs` 和 `cross-client-web.mjs`：仅监听本机 8798，测试账户与内容留在内存。模拟器 UI 测试 `AquaSightCrossClientTests` 通过 `AQUASIGHT_INTEGRATION_BASE=http://127.0.0.1:8798` 启用，真实 HTTP 连接本地后端，无 URLProtocol 数据替身；未设置时跳过。此入口只编译进 DEBUG 模拟器，物理设备与 Release 不接受后端覆盖。
