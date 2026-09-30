# 鸭先知 iOS 客户端交付记录 · 2026-09-26

## 实现范围

从已有 SwiftUI 骨架扩展为原生 iOS 17+ 客户端，版本 0.3.0（3）。工程见 [AquaSight.xcodeproj](../../clients/ios/AquaSight.xcodeproj)，运行说明见 [iOS README](../../clients/ios/README.md)。由 Codex 拆解与审查，OpenCode GLM（litellm/glm-5.3）完成初稿与一轮返工，Codex 完成集成、账户同步修复和验收。

- 五个入口：精选、最新、开源、早报、收藏。复用 `https://quack.weichao.ren` 正式 API。
- 搜索、清除、下拉刷新、分页、中文详情、原始来源、系统分享。开源项目展示语言、许可证、星标增长与维护信号。
- 游客收藏和离线快照；邮箱验证码登录；Keychain 保存会话；按账户隔离收藏缓存；游客收藏合并；退出与账户删除。
- 服务端统一生成 AI 内容，客户端展示结果与生成状态，不内置 LittleLLM / Free 密钥。

## UI / UE

采用原生导航和系统 Tab Bar，保留返回手势、系统分享和熟悉的邮箱表单。内容层级按栏目、标题、摘要、来源排列；来源标签位于标题上方，避免辅助功能字号下挤压标题。收藏按钮与进入详情的点击区域独立，触达区域至少 44 点。

浅色与深色使用独立的绿色强调色和自适应文字颜色，修正了深色模式未选中 Tab 图标不可见的问题。来源与时间、星标与语言按两行组织并自然换行，防止六位星标数字与长语言名被挤成竖排。详情限制最大阅读宽度，适配横屏；长标题与动态字体允许自然换行、滚动。提供空列表、搜索无结果、请求失败重试、离线缓存、同步失败与本地收藏反馈。

## 数据可靠性

- 登录恢复遇到网络问题时保留本地会话与缓存。
- 请求绑定发起时的 token；账户切换后忽略旧请求结果，防止跨账户污染。
- 收藏写操作先持久化，服务端确认后才清除；每次操作有独立标识，旧请求不能误删新改动。
- 同步只上传未确认的变化，不把整份旧收藏上传，避免重新创建其他设备已删除的收藏。
- 游客合并任务归属首次登录账户，重试不会转移到另一个账户。
- 搜索不会覆盖默认列表缓存；刷新、分页和搜索结果有过期请求隔离。自动刷新对失败请求同样限频，页面出现与激活不会瞬间重试并吞掉错误提示；手动重试不受此限制。
- 使用无 Cookie 的原生会话；外链仅允许 HTTP / HTTPS 且拒绝 URL 内嵌凭据。

## 验证结果

最终 58 项测试全部通过：50 项单元测试、8 项 XCUITest。覆盖五栏导航、搜索清除、详情阅读、收藏持久化、取消收藏不误入详情、错误重试、登录表单、游客收藏登录迁移与退出隔离、动态字体、深色外观、横屏和后台返回。深色通过模拟器系统外观设置启用。

- 真实长字段排版修正后，追加运行项目详情与大字号两项界面测试，均通过：`/tmp/aquasight-ios-layout-final.log`，结果包 `/tmp/aquasight-ios-layout-final.xcresult`。
- 完整测试：`/tmp/aquasight-ios-accepted-v2.log`，结果包 `/tmp/aquasight-ios-accepted-v2.xcresult`。
- 最终 Release 构建：`/tmp/aquasight-ios-device-final.log`，产物 `/tmp/aquasight-ios-device/Build/Products/Release-iphoneos/AquaSight.app`（未签名）。
- `git diff --check`、工程 / Info.plist / PrivacyInfo 校验和资产 JSON 解析通过。

## 截图

线上公开内容截图：

- [开源列表（浅色）](ios-client-2026-09-26/opensource-live.png)
- [项目详情（浅色）](ios-client-2026-09-26/detail-live.png)
- [精选列表（浅色）](ios-client-2026-09-26/featured-live.png)

以下是最终测试生成的本地固定样本，内容仅用于测试，不能作为真实新闻来源：

- [开源列表（深色）](ios-client-2026-09-26/opensource-dark-fixture.png)
- [辅助功能最大字号（深色）](ios-client-2026-09-26/large-dark-fixture.png)

## 验收环境与边界

Xcode 本机工具链、iOS 26.5 SDK，复用 iPhone 17e 模拟器。测试只使用本地 URLProtocol fixtures、独立 Keychain 和缓存，不发送真实验证码、通知或生产写入。实际内容预览仅访问公开读取 API。

模拟器执行登录测试时必须启用临时签名，否则 Keychain 缺少应用身份，保存登录凭据会失败。完整运行命令在 README；测试不得以明文存储绕过 Keychain。

Release 的 iPhone / iPad 架构编译通过（未签名），仅剩未使用 AppIntents 的元数据提示。未连接可用真机，尚未验证真机安装、真实邮箱验证码或 iPad 实机布局；没有上传 TestFlight / App Store。正式 APNs、Universal Links / AASA 尚未配置。最低 iOS 17 部署目标通过编译，不代表已在 iOS 17 设备运行。

隐私清单记录现有邮箱登录、账户标识、收藏 / 阅读同步和会话数据用途。发布前仍需按后端和托管服务实际处理方式复核商店隐私说明；类型字段参考 [Apple 隐私数据类型](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype)。

当前变更未提交、未推送、未部署；后端和生产采集配置未改动。
