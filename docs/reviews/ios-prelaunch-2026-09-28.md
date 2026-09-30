# iOS 上线前检查 · 2026-09-28

> 后续三入口订阅改版及最新测试见[个人阅读器改版验收](ios-reader-2026-09-28.md)。本文的五入口 UI 记录属于改版前版本。

结论：已完成 iPhone XR 真机运行与关键流程验收，修复了一组上线前缺口；目前尚未达到直接提交 App Store 的状态。下面区分本地已完成的工作与仍需发布/验证的工作。

## 首版方向调整（用户确认）

用户同意尽量简化，朝个人信息订阅与阅读工具收敛。首版默认以用户自选技术/开源来源、AI 辅助阅读、收藏为核心；用户随后要求保留账户级「更多信息源」开关，由网页个人设置自行开启，不永久裁剪。所有可开启能力仍需如实纳入上架材料和地区适用性判断。此处是产品范围决定，尚不代表代码已完成改造；既有真机与测试证据对应改造前版本。具体范围与缺口见 [首版阅读工具范围](../design/ios-reader-v1-scope.md)。

个人自然人不符合互联网新闻信息服务许可要求的“境内依法设立的法人”申请主体条件；采编发布还要求新闻单位或新闻宣传部门主管单位。依据 [网信办服务指南](https://www.cac.gov.cn/2019-07/23/c_1565410775838394.htm)。工具定位不自动豁免大陆备案或适用的内容要求，当前没有相关材料、全球目标仍保留。

## 真机与构建证据

- 设备：用户连接的 iPhone XR，iOS 18.7.9，USB 配对且 Developer Mode 已开启。
- 使用现有开发签名完成 Debug 构建、真机安装与测试；没有新建证书、注册设备或修改 Apple 后台记录。
- 真机基础套件 58 项通过：50 项单元测试 + 8 项界面测试。
- 新增“关于与帮助”后，关于/隐私入口、登录校验、游客收藏登录迁移与退出隔离 3 项专项复测通过（其中 2 项属于原有测试，不能重复累计）。
- 独立开启的生产只读检查通过：游客会话加载线上开源列表并进入详情，未请求验证码、未登录生产账户、未发送通知、未写生产收藏。
- Release 使用开发签名完成归档、安装和启动。它是设备验收产物，不是已经上传的 App Store / TestFlight 分发包。
- 最低部署目标仍是 iOS 17；本轮实际验证的是 iOS 18.7.9，不代表已验证所有受支持系统或 iPad。

截图：[线上开源列表](ios-prelaunch-2026-09-28/iphone-xr-live-opensource.png)、[线上项目详情](ios-prelaunch-2026-09-28/iphone-xr-live-detail.png)、[关于与隐私入口](ios-prelaunch-2026-09-28/iphone-xr-about.png)。关于页截图之后仅简化了本机收藏保留说明，未改变结构。

## 本轮修复

1. **隐私和支持入口**：五个栏目的左上角均可打开“关于与帮助”，游客也能访问；登录页提供隐私和验证码帮助链接。支持邮箱由用户确定为 `lazywc@gmail.com`。
2. **公开页面**：新增 `web/support.html` 和 `web/privacy.html`，目标地址是 `https://quack.weichao.ren/support.html` 与 `/privacy.html`；首页页尾也加入入口。页面描述现有代码的数据处理，明确第三方托管/邮件、登录同步、本机缓存与账户删除边界。
3. **账户删除**：`src/store/d1.js` 以一个事务批次删除账户记录、个人收藏/阅读/设置/反馈、同步版本、会话与该邮箱的待用验证码；中途出错时回滚，允许重试。内存存储同步实现。其他账户不受影响。短期防滥用计数按原维护策略清理，未删除相关安全限制。
4. **回归覆盖**：新增真实 SQLite 清理范围/失败回滚测试，以及删除后旧会话失效、同邮箱创建新身份的内存测试。修复旧 Node 测试仍引用已移除 `ContentView.swift` 的问题；原生行为由真实 XCTest/XCUITest 覆盖，共享 scheme 的单元/UI 套件仍有自动检查。
5. **出口合规配置**：当前客户端使用系统 HTTPS、Keychain 和系统哈希功能，没有自研加密协议或第三方加密 SDK，补上 `ITSAppUsesNonExemptEncryption=false`。新增能力时需重新核对；依据 [Apple 加密出口说明](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)。

后端/API 和页面改动均未部署；手机上安装的客户端会访问现有生产 API。因此新删除语义与公开链接必须在后端发布后再做联合验收。

## 上线前剩余事项（按顺序）

| 优先级 | 事项 | 证据与下一步 |
| --- | --- | --- |
| P0 | 发布隐私/支持页及删除清理修复 | 线上两页当前返回 404；本地页面和后端修复准备好后，需要提交并部署，再从真机打开链接检查。Apple 要求 App 内及商店元数据可访问隐私政策。 |
| P0 | 正式标识和 App Store Connect 记录 | 当前 Bundle ID 为 `com.aquasight.app`；在当前已配置 ASC 账户按该 ID 查询，没有匹配应用记录。开发签名可用不等于已有商店记录。需确定最终 Bundle ID、注册相应 App ID、建 ASC 应用，然后配置分发签名。未核实该 ID 在所有开发者账户的注册归属。 |
| P0 | 生产邮件与审核登录 | 本次未发送真实邮件。需用允许接收验证码的测试邮箱完成发送、登录、同步和删除，确认邮件投递；准备审核员实际可用的登录方式，不能使用 DEBUG 固定验证码或生产绕过。 |
| P0 | 商店材料与首发地区 | 用户已确定全球首发（包含中国大陆），按所有可供发行地区准备，不擅自缩减。隐私问卷、类别/年龄分级、内容权利说明、审核联系方式、价格与供应范围、商店规格截图尚未在 ASC 配置。用户已明确目前没有 APP/ICP 备案号，也没有新闻内容许可或授权材料：中国大陆发行目前受阻，不能标记为全球上线就绪；保留全球首发目标，不自动排除大陆。欧盟 DSA 商家身份/联系方式仍需核实。 |
| P1 | AI 中文处理覆盖率 | 本次生产开源列表 20 条样本只有 3 条有 `titleZh` / `overviewZh`，17 条没有 `aiState`。客户端正确回退到来源内容，但中文产品体验不完整。发布前检查采集后的补全队列、失败重试与 Free 模型处理预算，补齐中文内容。样本是时点观测，不是历史总体统计。 |
| P1 | iPad 和最低版本验收 | 工程支持 iPhone/iPad；本轮连接的是 XR。iPad 布局、多任务，以及 iOS 17 兼容运行仍未补齐；商店截图不能拿 XR 截图充当其他规格。 |
| P1 | 内容权利与纠错流程 | 已有原始来源和联系渠道；上线前确认来源使用方式及申诉处理责任。摘要和来源链接不自动证明拥有转载权。 |
| 非本版承诺 | 原生推送 / Universal Links | 尚未接 APNs 和 AASA；不在首版宣传中承诺原生推送或 HTTPS 自动唤起。已有自定义 scheme 可以继续保留。 |

全球发行的地区依据：[Apple App 信息（含中国大陆 ICP / 新闻内容要求）](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)、[欧盟 DSA 商家要求](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements)。新闻许可的具体适用性须按本产品内容及发行主体确认，不能仅通过换商店类别规避。

政策依据：[Apple App Review](https://developer.apple.com/app-store/review/)、[App 内账户删除](https://developer.apple.com/support/offering-account-deletion-in-your-app/)。审核结论由 Apple 决定，本记录不把未验证项表述为已通过。

## 检查记录

- 基础真机测试：`/tmp/aquasight-ios-xr-tests.log`、`/tmp/aquasight-ios-xr-baseline.xcresult`。
- 生产只读用例：`AquaSightLiveReadOnlyTests.testGuestCanReadLiveFeed`，通过记录 `/tmp/aquasight-ios-xr-live.log`。该结果包中的首次关于页断言失败是把 SwiftUI Link 当成 AX Link，而真机呈现为 AX Button；已按真实层级修正并复测通过，不掩盖该次失败。
- 新增页面入口/登录专项：`/tmp/aquasight-ios-xr-prelaunch-ui.log`、`/tmp/aquasight-ios-xr-prelaunch-ui.xcresult`，3 项通过。
- 项目测试：`/tmp/aquasight-prelaunch-node-final.log`，336 项通过，0 失败/跳过。
- 公开页面本地验证：支持/隐私页在 390px 浅色与 1280px 深色下均返回 200，无横向溢出；联系邮箱、互相跳转及 FAQ 键盘操作通过。截图保存在本报告同名目录。
- Worker 打包：使用本地已有 Wrangler 4.136.3 执行 `deploy --config worker/wrangler.toml --dry-run`，退出码 0；记录 `/tmp/aquasight-prelaunch-worker.log`。未部署。
- 最终 Release 归档：`/tmp/aquasight-ios-xr-release-delivery.log`、`/tmp/aquasight-ios-prelaunch-delivery.xcarchive`。
- 生产只读测试默认跳过；显式验证时在本地 `.xctestrun` 的测试 Target `EnvironmentVariables` 设置 `AQUASIGHT_LIVE_READONLY=1`，仅选择该测试运行。不要对已有真实登录会话运行；不把网络依赖并入普通 fixture 回归。

协作：Codex 总控、真机/后端实现与审查；OpenCode `litellm/glm-5.3` 在独立工作树只读审计实际未提交代码、生成两个网页，经过一次集中返工后由 Codex 验收。未提交、推送、部署、上传或提审。
