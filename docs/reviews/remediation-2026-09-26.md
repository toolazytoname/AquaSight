---
type: remediation
date: 2026-09-26
sources:
  - ./global-quality-2026-09-25.md
  - reviewer-rework-2026-09-26 (Codex, merged constraints)
scope: 跨日去重 / 调度可靠性 / 质量门禁 / 用量与成稿率统计 / 有证据的严重缺陷
test-log: /tmp/aquasight-codex-tests.log
---

# AquaSight 可靠性与信息质量修复（2026-09-26）

由 OpenCode `litellm/glm-5.3` 在 AO 独立 worktree（`ao/aquasight-1/root`）实现，Codex 独立审查、补充修复后合入当前工作区，基于 `main`（f7fb368）。未提交、未推送、未部署、未发送任何通知、未改动远程数据与依赖锁文件。生产模型保持统一 LittleLM free 路径，未切换付费模型，未读取或打印任何密钥。

## 一、问题与证据（修复前）

| # | 问题 | 证据 |
|---|------|------|
| P0-1 | 早报跨日重复：9 月 26 日 10 条中 7 条与 25 日重复 | `src/pipeline.js` 旧 `digestOnce` 完全不引用前几日 digest 快照；`selectDigest` 24h 窗口必然重选昨日高分条目 |
| P0-2 | 调度不可靠：08:05 北京的早报 12:27 才启动；15:00 采集 20:23 才跑 | GitHub `schedule` 是触发配置非送达保证；无任何兜底触发器（global-quality-2026-09-25 已记录延迟） |
| P0-3 | Free 综述经常被门禁剔除后无可观测原因 | 旧 `prepareDigest` 静默丢弃不合格综述，无 reason 记录 |
| P1-4 | 状态持久化依赖 Actions cache，cache 丢失会重复通知 | `digestOnce` 只查本地 `digest-sent:` 标记 |
| P1-5 | `aqs_session=%` 使公开 GET /api/v1/events 返回 500 | `src/auth.js` `parseCookies` 中 `decodeURIComponent("%")` 抛 URIError（Codex 已复现） |
| P1-6 | `web/app.js` `primaryUrl` 对 `sources[0].url` 回退不校验协议，可渲染 `javascript:` 链接 | 旧代码 `(/https?.../.test(item.url) && item.url) || (sources[0] && sources[0].url)` |
| P1-7 | workflow `inputs.date` 直接插值进 shell | 旧 digest.yml `--date "${{ inputs.date }}"`；deploy-worker.yml `ENV="${{ github.event.inputs.environment }}"` |
| P1-8 | `2026-02-31` 类非法日历日期被 CLI/API 接受 | 各入口只查正则或不查 |
| P1-9 | run.js 丢弃 `maybeCatchUpDigest` 返回值，补发早报与发布 payload 不一致 | 旧代码 `.catch(() => {})`，只写 `data/digest.json`，不更新 `web/`、budget |
| P1-10 | memory/file/d1 锁实现缺陷 | d1 `acquireLock` SELECT 再 INSERT OR REPLACE 非原子；memory 锁不兼容历史 string 行；file release 有 TOCTOU 且读错时盲删 |
| P1-11 | digest.yml 发布校验把合法 0 条新稿误报失败 | 旧校验要求 `(j.items||[]).length` 非空 |
| P1-12 | 用量统计把 HTTP 成功当成稿成功 | 旧 `modelOutcomes.httpOk` 以 `!degraded`/缓存近似 |

## 二、修改内容

### 1. 跨日严格去重（P0-1，按审查定稿）
- 新增 `src/digest-history.js`：
  - 匹配键：事件 id、成员 articleId 重合、规范化 URL 重合（去 utm/www/hash，复用 `canonicalizeUrl`）。
  - **严格排除，无自动放行**：按 Codex 审查意见，删除了初版"新增成员/发布时间推进 12h 即视为实质更新"的绕过路径——转载、重抓会误触发。过去 3 天内命中任一键的候选一律排除；没有可靠事实变更证据不放行；**空位不以旧稿填充**。
  - 历史来源：本地 store `digest:<date>` 快照；缺失时回退 Worker `GET /api/v1/digest?date=`（公开只读）。**远端读取失败抛 `HISTORY_FETCH`，fail closed**，绝不静默当历史为空后重复通知。
- `src/select.js` `selectByQuota`/`selectDigest` 增加 `excludeIds`；`src/pipeline.js` `digestOnce`/`buildDigestFromItems` 接线，digest 载荷新增 `dedup` 统计。
- 同日防重复发送双重保障：`digestOnce` 在本地 sent 标记缺失时先查远端当日已发布 digest，存在则返回该稿并 `skipNotify`（`reason: "remote-already-published"`），同时补写 sent 标记。

### 2. 可靠调度（P0-2，Cloudflare Worker cron 兜底触发现有 workflow）
- 新增 `src/scheduler.js` + `worker/src/index.js` `scheduled` handler：
  - **幂等**：digest 以 D1 `digest:<date>` 快照判定已发布（**明确空版（items 为数组）也算已发布**，不循环重试）；collect 按 UTC 1/7/13/19 独立 slot，以 events 载荷的 `snapshotAt`（非入库时间）判定该 slot 是否已有产物。
  - **时间门禁**：digest 仅在北京时间 ≥08:05 才可能触发（复核者场景 2026-09-26T16:15Z＝北京 27 日 00:15，实测 0 次 dispatch）。
  - **临界区加锁**：读 slot/检查/dispatch/写 slot 全程在 owner-token 锁内；并发双触发实测恰一次 POST。
  - **attempting 状态**：dispatch 前先持久化 `attempting`（计入尝试数），进程中断不留静默空档。
  - **in-progress 检查**：dispatch 前查 GitHub queued/in_progress runs，有则跳过，避免每 20 分钟叠加一轮可能跑 24 分钟的 collect。
  - **有界重试**：digest 每日 16 次、collect 每 slot 3 次上限 + 20 分钟 cooldown。
  - **凭据缺失≠健康**：缺 `GITHUB_DISPATCH_TOKEN`/`GITHUB_REPO` 记 `no-token` 并打日志，**不消耗当日尝试数**；固定 `ref=main` 并先校验仓库 default_branch；请求带 `User-Agent: aquasight-scheduler`。
  - **默认关闭**：需 `SCHEDULER_ENABLE=1` 才运行；cron 只配置在 `[env.production.triggers]`（5 分钟粒度），无顶层 trigger，dev/staging 不触发。
  - 可观测：`GET /api/v1/scheduler/status`（鉴权，非公开路由）返回配置健康、slot 状态、当日 digest 是否已发布。
- GitHub 原有 schedule 保留为 fallback：workflow 侧 `digest-sent:<date>` 幂等 + Worker 侧 in-progress 检查，降低重复推送风险；发送后、远端入库前的进程崩溃窗口仍不能提供严格 exactly-once 保证。

### 3. 来源链接/时间/正文与 AI 输出校验（P0-3）
- `src/digest-editor.js` `digestItemQuality`：条目必须有可用 http(s) 链接（item 或任一来源）、可解析时间字段、≥6 字符标题；`aiState=ready` 的条目必须有 ≥1 条 fact 或 evidence（no-grounding 拒绝）。
- **明确边界**：仅做 shape 校验，不做链接存活探测——复核者证据表明 wallstreetcn `/livenews/3170742` HEAD 404 但 GET 200 正文正常，403/付费墙更不能判死链。**本修复不做事实真伪证明；HTTP 成功、文字通过校验都不等于事实核查通过**（见"遗留"）。
- 综述校验保留数字/实体/URL grounding（digest-check.js），拒绝原因现被记录进 `aiSummaryOutcome.reason`（style / ungrounded-numbers / ungrounded-sentence / truncated 等）。
- 综述 prompt 明确"120–180 字、最多 3 句、只返回综述正文"，与既有 240 字/3 句门禁一致。

### 4. 用量与有效成稿率统计（P0-3/P1-12）
- `src/enrich.js` 新增 `createFetchStats`/`statsWrappedFetch`：包裹**实际 fetch 调用**统计 `requests/httpOk/httpError/transportError`，含重试，缓存命中为 0 请求；HTTP ok 仅为传输成功，不代表成稿。
- `prepareDigest` 汇总 `aiEditing = {selected, included, ready, rejected[], fetch}`；综述结果 `aiSummaryOutcome = {attempted, accepted, reason, model}`（无 key/不足 3 条时 `attempted=false` 并记原因；成功记录实际 `data.model`）。
- `digestOnce` 写入 `digest.stats`：候选数、去重排除数、AI 选择/ready/收录、综述结果、当日预算用量（CNY/token/calls）。`src/digest.js` CLI 输出 `dedup` 与 `stats`。

### 5. 其他有证据的严重问题
- **auth cookie 500**（P1-5）：`parseCookies` 对无法解码的值保留原文；端到端测试：带 `aqs_session=%` 的公开 GET `/api/v1/events` 返回 200。
- **javascript: 链接**（P1-6）：`primaryUrl` 对 item 与 sources[0] 回退统一走 `safeUrl`（仅有效 http(s)）；Chromium 真实渲染回归测试断言详情页无 `javascript:` href 且无"阅读来源"锚点；SW 缓存版本 v17→v18（配套更新 page/browser 测试断言）。
- **workflow 输入注入**（P1-7）：digest `--date` 改 env 传递 + 共享严格日历校验；deploy-worker environment 改 env + 白名单（dev/staging/production）。
- **严格日历日期**（P1-8）：`src/time.js` `isValidCalendarDate`（拒绝 2026-02-31）统一覆盖 CLI `--date`、API `?date=`、远端历史读取、workflow 输入。
- **预算记账时间分离**（复核要求）：历史 refresh 选稿用钉住时钟、预算用真实时钟（`budgetNow`），今天的调用不再记到昨天导致 day counters 回滚。
- **collect 补发一致性**（P1-9）：补发结果同步写 `data/digest.json` 与 `web/digest.json`（collect.yml 也 stage 到 Pages）；`payload.budget` 取补发后最新值；旧 payload digest 不得覆盖更新版本（按 generatedAt 比较）。
- **digest.yml 校验**（P1-11）：接受日期匹配且 `items` 为数组的明确空版。
- **锁修复**（P1-10）：d1 `acquireLock` 改单条条件 UPSERT（`ON CONFLICT DO UPDATE ... WHERE lock_until IS NULL OR <= ?`）+ `meta.changes===1` 判定，release 按 owner token（真实 SQLite 语义已由 Codex 独立验证，fake-d1 同步实现该 SQL 形状并测试）；memory 兼容历史 string 行、错误 owner 不能释放；file release 的检查与删除移入同一写锁，读错时拒绝删除而非盲删。
- `fetchRemoteDigest` 改为无鉴权公开 GET（旧版发送 INGEST_TOKEN 到该公开路由必 403），10s 超时，响应 date/shape 严格校验，失败 throw（fail closed）。

## 三、验收结果

- 完整测试：`npm test > /tmp/aquasight-glm-tests.log 2>&1`，**exit code 0，302 通过 / 0 失败 / 0 跳过**（日志保留于 `/tmp/aquasight-glm-tests.log`）。
- 新增测试文件：
  - `tests/digest-dedup.test.js`（8）：id/成员/规范 URL 匹配；转载+新成员+新时间戳仍严格排除、不填充旧稿；digestOnce 不复播昨日 7 条且只出 3 条新稿；远端历史失败 fail closed；远端当日已发布→skipNotify 不重复发送。
  - `tests/scheduler.test.js`（17）：08:05 门禁（含复核者 16:15Z 场景 0 dispatch）；并发双触发恰一次 POST（锁）；attempting 先行持久化；in-progress 抑制；cooldown；有界重试；缺 token 不耗尝试数；ref 不匹配中止；未 enable 时整体 inert；collect slot 以 payload snapshotAt 判定；memory/file/d1 锁并发与过期接管。
  - `tests/digest-quality.test.js`（6）：cookie 容错（单元+端到端 200）；http(s) 判定；质量门禁各分支；**真实合法缓存**构造的 prepareDigest 集成（无 key、零请求、拒绝原因记录）。
  - `tests/browser-flow.test.js` 追加：Chromium 真实渲染断言无 `javascript:` 链接。
- 手动验证：`node --check` 通过；`git status` 确认无意外文件；diff 统计 25 处修改 + 5 个新文件（见下）。

## 四、仍需外部配置的项目（代码不做、待发布和凭据配置）

1. **Worker cron 部署**：`[env.production.triggers] crons=["*/5 * * * *"]` 需 `wrangler deploy` 生效（当前尚未部署）。
2. **Worker secrets/vars**：`SCHEDULER_ENABLE=1`（修改受版本控制的 production vars；不要只改面板，否则下次部署覆盖）、`GITHUB_DISPATCH_TOKEN`（secret，fine-grained PAT，仅需该仓库 Actions:write）、`GITHUB_REPO="toolazytoname/AquaSight"`（var）。默认 enable=0 时整体 disabled；启用后缺 token/repo 时报告 misconfigured 且不耗尝试数，`/api/v1/scheduler/status` 可查。
3. **PAT 属于新凭据**：按约束未创建、未读取、未打印任何凭据；需人工在 GitHub 生成后注入 Cloudflare。
4. 生产验证路径：部署后观察 `/api/v1/scheduler/status`，并核对次日早报实际 `snapshotAt`/完成时间（验收标准以实际完成时间为准，不以 dispatch 204 为准——204 只代表接受不代表发布）。

## 五、明确不做 / 边界声明

- **未做事实真伪核查**：所有门禁（数字 grounding、实体共现、URL 白名单、shape 校验）只验证"输出可由输入支撑且形态合规"，**不能证明新闻内容为真**；模型 HTTP 成功、成稿通过校验都不等于事实核查。生产继续统一 LittleLM free，未触碰付费路由与任何密钥。
- Codex 抽查了线上早报 10 个来源地址；受限响应不能判定为死链，WallStreetcn HEAD 404 经 GET 200 和正文标题确认可读。未加入对所有链接持续探测的自动任务。
- 未升级依赖（npm audit 0 漏洞）、未改公共数据库契约（scheduler 状态走既有 `snapshots` 通道，无 schema 变更）、未动 `worker/schema.sql`。
- Free 综述被剔除时的行为不变（不发布不合格综述），但原因现已持久化可查。

## 六、变更清单

修改：`.github/workflows/{collect,digest,deploy-worker}.yml`、`src/{api/handlers,auth,digest-editor,digest,enrich,lock,pipeline,remote,run,select,time}.js`、`src/store/{d1,file,memory}.js`、`tests/{ai-integration,browser-flow,page}.test.js`、`tests/helpers/fake-d1.js`、`web/{app,sw}.js`、`worker/src/index.js`、`worker/wrangler.toml`。
新增：`src/digest-history.js`、`src/scheduler.js`、`tests/{digest-dedup,digest-quality,scheduler}.test.js`、本报告。


## 七、Codex 独立复核补充

- 修复真实 Worker 环境未注入 fetchImpl 时无法派发的问题，并用默认全局 fetch 回归覆盖。
- GitHub 活跃任务按 main 分支和 active 状态查询；等待已有任务不消耗派发次数，真正 POST 前仍持久化 attempting。状态页按 UTC 日期/小时读取实际 collect slot。
- `missing:true` 空占位不再当作发布成功；只有明确合法的空版可以通过。远端历史响应缺字段或日期错误一律失败，不当作“没有历史”。
- 远端已发布不代表推送已送达：本地抑制标记为 unknown/remotePublished，不虚报发送成功。
- 自动正文提取复用已有 URL/DNS/重定向限制，最多 500 KB，保留并发 4 和原顺序。新增私网原始目标、私网重定向、超大正文回归；不声称消除 DNS rebinding 等所有 SSRF 风险。
- 采集新增 `diagnostics.ai` 的实际 fetch 请求/HTTP/传输错误和 ready 数；经过 ingest 裁剪脚本、D1 快照保存，在鉴权状态 API 可查。它是本轮统计，不是服务商配额余额，也不是跨天永久账本。
- File acquire/release 使用同一写锁，避免仅 release 加锁却与 acquire 竞争的缺口。
- README 更新正式入口和调度说明；生产配置显式保留原域名，调度开关默认关闭，避免部署后误触发。

最终验收：完整 `npm test` **307 通过、0 失败、0 跳过，实际进程退出码 0**；包括 Chromium 真实浏览器回归。Wrangler 4.136.3 生产配置 dry-run 打包成功（不部署、不写远端）；真实 SQLite 锁竞争/过期接管/错误 owner 释放检查通过。npm 官方 registry audit：生产依赖 0 已知漏洞。真实两日早报回放：10 条中匹配出 7 条重复，剩余 3 条，不拿旧稿凑满。

仍需完成的上线验收：发布代码；配置仅本仓库 Actions:write 的专用调度凭据后启用；观察至少连续数日的完成时间、429/超时、请求量与成稿率。Free/FreeSmart 的质量排序及全日上游额度是否稳定充足，不能用本地测试或一次小样本宣称已经证明。

## 八、授权发布记录

用户随后明确授权提交、推送并部署到生产，调度兜底保持关闭。以上“未提交/未部署”描述为实现验收阶段状态，以本节发布记录为准。

- 修复提交：`8925436e074db9ab33c917d60e6bb5c2cd6745ac`，已推送 `origin/main`。
- 生产流水线：[deploy-worker 36272494214](https://github.com/toolazytoname/AquaSight/actions/runs/36272494214)，2026-09-26 21:19:56 UTC 发布成功；CI 再次运行 307 项测试，0 失败。
- Worker 版本：`4d8e7df6-4daa-4e26-b228-402c526e96fa`。部署日志确认 `SCHEDULER_ENABLE="0"`，未注入新的调度凭据。
- 正式域名 `https://quack.weichao.ren` 上线核验：主页 200，`sw.js` 200 且 v18；health 200/ok；带异常 `aqs_session=%` 的精选 API 200；非法日期 `2026-02-31` 返回 400；未鉴权调度状态 API 返回 401。
- 本次发布未手动触发采集、早报或发送测试通知；新增采集和早报行为将在后续计划任务运行时生效。专用调度凭据配置、启用兜底及连续数日的 Free 容量观察仍待完成。
