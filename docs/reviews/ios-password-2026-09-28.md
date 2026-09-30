# 邮箱密码、界面与跨端同步验收 · 2026-09-28

本轮由 Codex 负责原生端、后端、审查和集成，AO 的 OpenCode `litellm/glm-5.3` 单 worker 完成网页登录与布局实现及一次集中返工。保留工作区先前未提交的阅读器、品牌和 iOS 工作。本记录不代表生产已部署或 App Store 已提交。

## 已完成

- Web 与 iOS 默认邮箱＋密码登录；验证码仅用于注册、重设密码和旧账户首次设置密码，沿用既有账户数据。新增密码显示、自动填充、确认密码、错误反馈、发送成功判断、重发冷却和请求期间锁定。
- 密码使用随机盐 scrypt 慢哈希，校验采用恒定时间比较；不保存明文密码。邮箱/IP/全局限流，OTP 单次消费，邮件发送失败允许重试。密码重设撤销旧会话，凭据版本阻止旧登录请求重新生成有效旧会话。
- D1 新增表的迁移可重复执行；凭据更新与会话撤销在同一批事务内。文件存储也持久保存账户、凭据和私人同步数据。CI 使用 Node 24 执行真实 SQLite 迁移测试。
- iOS 登录、阅读、订阅、收藏统一层级、间距和色彩；补大字体竖排布局、深色显示与同步时间。Web 优化登录表单、移动端订阅保存栏、焦点与敏感字段清理。
- iOS 已读改为待发送队列与确认机制，避免旧缓存把网页标为未读的内容重新改回已读。
- 真正双端联测发现并修复：网页从订阅页登录后未启用收藏同步；收藏页渲染与状态更新递归，阻断取消收藏。退出/注销后清理网页账户本地记录，防止下一账户继承。

## 验证与证据

| 检查 | 结果 / 证据 |
| --- | --- |
| Node 全量测试 | 381 项通过；`/tmp/aquasight-password-node-final.log` |
| Worker 打包 | production 配置 dry-run 通过；`/tmp/aquasight-password-worker-build.log`，没有实际部署 |
| XR 完整原生测试 | 61 单元＋11 UI 通过，2 个 opt-in 跳过；`/tmp/aquasight-password-final-xr.xcresult` |
| 最后已读队列改动复测 | 全部 62 单元＋登录迁移退出 UI 通过；`/tmp/aquasight-sync-final-xr.xcresult` |
| Web ↔ iOS 真实 HTTP | 独立浏览器和 iOS 模拟器用同一内存后端，密码 UI 登录、双向收藏/订阅、网页取消收藏到手机、手机退出隔离通过；`/tmp/aquasight-cross-client-3.xcresult` 和 `/tmp/aquasight-cross-client-result.json` |
| Release | 最终归档成功，已装到连接的 iPhone XR 并正常启动；`/tmp/aquasight-password-final-release.xcarchive` |
| 元数据 | 中文元数据预检 PASS；`/tmp/aquasight-metadata-precheck.log` |

上述原生覆盖来自完整测试及最后变更后的针对性复测，不声称最后一次执行了全套 UI。真实 HTTP 联测使用本地专用账号，不发真实邮件、不写生产；测试入口仅 DEBUG 模拟器可用。前两轮跨端尝试失败并促成网页修复，第三轮双方通过；没有用直接服务端写入代替被测 UI 操作。

界面证据：

- [iOS 密码登录](ios-password-2026-09-28/login-password-polished.png)
- [注册界面](ios-password-2026-09-28/register-password-polished.png)
- [深色大字体](ios-password-2026-09-28/08-large-dark.png)
- [Web 登录](ios-password-2026-09-28/web-login.png)
- [双端联测：iOS](ios-password-2026-09-28/cross-client-native.png)、[Web](ios-password-2026-09-28/cross-client-web.png)

## 尚未完成的线上与提审项

1. 新后端、网页及 `/support.html`、`/privacy.html` 尚未发布；公网检查页面仍为 404，reader 接口仍是旧版鉴权行为。新 iOS 密码登录需配套后端。
2. 曾按授权向 `lazywc@gmail.com` 请求一次生产验证码，API 回报 sent；没有收到用户提供的验证码，不能确认收件或完成真实邮箱联测。没有替用户设置私人密码。
3. 本地 workerd 执行生成哈希＋正确/错误校验约 412 ms；已读到 standard 使用模式，但当前令牌无法读取付费订阅详情。上线时需确认实际 Worker CPU 配额并测密码端点，不能仅凭本地性能判断生产可用。
4. 当前 ASC 配置账户未查到 `com.aquasight.app` 应用记录。仍需正确团队的商店应用记录、分发构建、审核联系人及测试账号、隐私/分级/定价/地区资料。没有上传 TestFlight 或提交审核。
5. 全球包含中国大陆的目标未擅自改变；用户尚无备案/内容相关材料，不能声称已具备全球提审条件。更多来源设置已在审核说明中如实写明。

发布次序、隐私问卷与审核说明见 [提审材料草稿](../appstore/review-notes.md)。本次未提交或推送 Git；发布需按本轮授权执行。新增表不破坏已有账户收藏，回滚 Worker 时保留新增表。
