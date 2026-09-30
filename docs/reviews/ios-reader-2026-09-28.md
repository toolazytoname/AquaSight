> 后续登录与同步修复见 [邮箱密码验收](ios-password-2026-09-28.md)，本页为前一轮记录。

# 个人阅读器改版 · 2026-09-28

## 产品与交互

iOS 收敛为「阅读、订阅、收藏」三个入口。首启不自动订阅全站，提供选源引导及「从开源与技术更新开始」快捷选择；订阅页分组展示来源，明确保存/还原，固定操作区显示所选数量。阅读保留搜索、分页、原文、AI 摘要、收藏和离线快照，大屏限制内容宽度。

更多信息源通过网页 `/#/reader-settings` 的账户设置开启。默认关闭，开启后自行选源；关闭保留已选项与私人收藏，不改通知/早报任务。网站原有阅读入口和采集管线保留，个人阅读查询与旧网页偏好隔离。

## 数据边界

- 新增独立 reader 偏好及查询，沿用既有用户设置存储，无数据库迁移。D1 以单条 SQL 按字段合并，避免手机选源覆盖网页开关；内存及文件存储保持同样语义，文件重启可恢复个人偏好。
- 游客选择仅保存在本机，服务器仅允许游客查询基础来源；账户设置由当前已验证账户读写。
- 登录已有账户使用其服务器订阅；首次登录未配置订阅的新账户会带入游客基础来源。登录后的选择修改离线留存、联网重试，iOS 仅写所选来源，不覆盖网页的更多来源开关。
- 列表缓存按账户与有效来源集合隔离，切换账户或关闭来源会重建列表。私人收藏不因取消订阅而删除。
- 网页 Service Worker 不缓存 reader 设置、个人列表和个人详情，离线明确失败，避免使用旧账户缓存。
- 继续复用服务端已有 AI 整理，不新增客户端模型调用，不向客户端下发模型密钥。

## 已完成的原生验证

- iPhone XR / iOS 18.7.9：原有 50 项单元测试、新增 8 项订阅测试通过；10 项 UI 流程分批验证通过。
- 首次全套运行中，1 项新 UI 用例点击了固定保存栏下方的离屏来源，未选中而失败；根据截图修正测试的滚动定位，复测通过。另修复页面切换取消请求误报离线的问题，新增取消请求测试通过。
- 覆盖首次选源、取消订阅仍保留收藏、收藏重启、登录与游客迁移、退出隔离、搜索清除、失败重试、深色大字号及三个入口切换。
- 最终针对 API 编解码、订阅逻辑和完整选源流程复测 19 项通过：`/tmp/aquasight-reader-contract.log`、`/tmp/aquasight-reader-contract.xcresult`。新增接口能力标记检测，旧后端不会被误当作个人订阅服务。初轮及第一次修正记录为 `/tmp/aquasight-reader-tests.log`、`/tmp/aquasight-reader-recheck.log`。
- iPad Pro 11-inch (M5) 现有模拟器构建与深色订阅页截图检查完成；未新建模拟器，使用后已关闭。此项为布局验收，不代表最低 iOS 17 或 iPad 真机已验证。
- 开发签名 Release 归档成功：`/tmp/aquasight-reader-delivery.xcarchive`，日志 `/tmp/aquasight-reader-delivery.log`。已安装并以正常模式启动于真机（无 fixtures 参数）；它不是 App Store 分发包，未上传 TestFlight。
- 本轮真实生产 GET 用例主动跳过：新接口尚未部署。UI 数据来自 DEBUG 隔离 fixtures，未发送真实邮件或写生产收藏。

## 服务端和网页验证

- 最终完整 Node 测试：361 项通过，0 失败、0 跳过，日志 `/tmp/aquasight-reader-full-tests-final.log`。覆盖原有查询回归、新阅读范围、账户隔离、并发字段保存、文件重启与 SQLite 合并。
- 网页浏览器测试覆盖 390px 移动端和 1280px 深色桌面：显式选源、关闭后保留选择、保存期间锁定、失败重试、键盘切换后焦点保留、退出后另一账户不继承草稿；截图已人工检查。
- 最终审查修正排序：文章按发布时间，项目按观测时间，避免旧文章因重新采集置顶；补充仅用户名的嵌入凭据 URL 拒绝测试。
- Worker production 配置 dry-run 打包退出码 0；日志 `/tmp/aquasight-reader-worker-build.log`，未调用实际部署，调度配置未改。
- `git diff --check` 通过。主工作树已有未提交原生和品牌文件保留，GLM 仅合入六个约定文件；其余整合由 Codex 完成。

## 截图

- [首次使用](ios-reader-2026-09-28/reader-welcome.png)
- [订阅选择](ios-reader-2026-09-28/reader-subscriptions.png)
- [个人阅读](ios-reader-2026-09-28/reader-feed.png)
- [深色大字号](ios-reader-2026-09-28/08-large-dark.png)
- [iPad 订阅](ios-reader-2026-09-28/ipad-subscriptions.png)
- [网页移动端](ios-reader-2026-09-28/web-mobile.png)
- [网页桌面深色](ios-reader-2026-09-28/web-desktop-dark.png)

## 交付边界

本轮由 Codex 负责 iOS 实现、整合与验收，OpenCode `litellm/glm-5.3` 负责后端和网页设置。GLM 在明确同步的独立代码快照中工作，合入前检查本轮差异，保留原有未提交图标、支持页及账户删除修复。

未提交、推送、部署或提审。新版 iOS 与新增后端接口须一起交付；支持/隐私页同步更新订阅的数据说明。上架区域与材料仍见[上线前检查](ios-prelaunch-2026-09-28.md)，这次功能完成不代表已获得发行资质或审核通过。

存储实现参考：[Cloudflare D1 JSON 合并](https://developers.cloudflare.com/d1/sql-api/query-json/)、[预处理语句结果](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)。
