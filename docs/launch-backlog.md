# 鸭先知上线待办

日期：2026-08-25  
对照线上：https://toolazytoname.github.io/AquaSight/  
对照快照：`events.json` 更新于 `2026-08-25T08:00:10Z`，14 源全绿，215 条，破圈 2 条，早报科技栏被财报超级卡占满。

实现状态（2026-08-25）：P0 / P1 已在代码落地，`npm test` 91 项通过。用线上 `events.json` 回放聚类后：破圈只剩灾难类（山洪遇难），财报不再糊成超级卡，一般栏混有 36kr/IT之家/热搜/BBC，娱乐热搜不进一般。P2 仍不做。上线后还要用一次真实 collect（约 20 分钟）勾 P0-10 人工清单。

本文是上线 backlog，不是灵感列表。每条都按「上了线之后用户会不会觉得这页能看、推送敢开」来写。没写进这里的事，默认不做。

---

## 上线标准

用户打开页面、打开 Bark，应同时成立：

1. **破圈值得推。** 推到手机上的是硬新闻或跨源热事件，不是「去世」八卦、不是半年报拼盘。同一件事 20 分钟后再采，不得再推一次。
2. **首页能扫。** 「破圈」少而准。「一般」能看到中文科技/热搜/世界，不被 HN 前 20 + 昨天新建的 GitHub 仓库挤掉。娱乐热搜默认不占「一般」。
3. **早报能当早报。** 早报三栏各最多 5 条，是过去 24 小时真正高分的独立事件，不是同一财报模板糊成的一张卡。
4. **中文可读。** 英文标题有中文；摘要没有 HTML 标签；仓库名、用户名不被拆着译；失败时宁可不译，不要译成「前沿车型」这种明显错译还当正文。
5. **时间是真的。** 衰减按发布时间，不按本次采集时刻。过了窗口的旧闻不得因为 `seenAt` 被刷新而重新当新事件。
6. **采集挂了站点还在。** 单源失败记 `sourceErrors`，页面照出；workflow 互踩不得丢掉 `sent.json` / `archive.json`。
7. **规则有护栏。** 主分支 push / PR 跑测试。分类、聚类、展示、推送的验收用测试钉死，不靠手工扫一眼。

未达 1–6，不算上线。7 是上线当天必须带上的工程底线。

---

## 现状对照（为何还没到线）

| 标准 | 线上实际 |
|---|---|
| 破圈值得推 | 本轮破圈是「蛋烘糕奶奶儿子已因病去世」「二婚夫妇意外去世」。`HARD_IMPACT_RE` 单字命中「去世」。 |
| 同一事件不重推 | 卡片 id 是成员 id 用 `\|` 拼的。多一个源，id 就变，`sent.json` 认新 id。 |
| 首页能扫 | 「一般」30 条上限 + 分数几乎全是 4 + 源顺序 hn→github→… → 首页一般栏基本是 HN 和新建仓库。 |
| GitHub 有信息量 | `created:>昨天` 按 star 排。线上混着钓鱼外挂、越狱、钱包破解、挖矿僵尸网络、AI 女友。 |
| 早报是独立事件 | 财报标题共享「上半年/净利润/同比增长」，Jaccard 0.5 链式合并，再被打成 breaking。早报科技 Top 是石头科技/中矿资源/晶丰明源超级卡。 |
| 衰减生效 | 源不写 `publishedAt`，`stampSeenAt` 每次写成现在。decay 在生产里恒为 1。 |
| 翻译可读 | MyMemory 串行 15 条。HN `story_text` 是 HTML 链接当摘要再拿去译。Frontier Model →「前沿车型」。 |
| 状态不丢 | collect `*/20` 和 digest `0 0 * * *` 整点对撞，两个 job 都全量写 gh-pages，无 `concurrency`。 |
| 规则有护栏 | 只有 collect / digest 两个 workflow。没有 `npm test` CI。`classify()` 已不在采集路径上，测试还在测它。 |

未合入：`origin/t24-cluster-split`（停用词 + 公司前缀，拆 36kr 半年报误合并）。可作 P0-1 起点，不能当已上线。

---

## 批次

- **P0 上线阻断：** 不改完，页面和推送都不好意思给人用。
- **P1 上线应有：** 不改也能打开，但质量、可靠性和可维护性不够「长期开着」。
- **P2 上线后：** 明确延后。写在这里是为了避免做的时候顺手膨胀。

建议顺序就是编号顺序。P0 做完再碰 P1。每一条自己可合、可测、可对照验收。

---

## P0 上线阻断

### P0-1 拆开财报 / 模板新闻的假合并

**问题**  
`src/cluster.js` 的 `shouldMerge` 用中文二字切 + Jaccard ≥ 0.5。  
「多氟多：上半年净利润…同比增长…」和「学大教育：上半年净利润…同比增长…」会并成一张卡。贪婪链式合并后，36kr + 华尔街见闻 + IT之家 很容易 heat≥3 且跨家族，被打成 breaking。

线上早报科技栏已被这个规则绑架。

**已有起点**  
`origin/t24-cluster-split`：

- 标题里的「上半年 / 净利润 / 同比 / 增长 / 下降 / 亿元 / 万元 / 半年报 / 拟10 / 派」不参与 Jaccard。
- 冒号前公司名不同 → 不合并。
- 测试：六条不同公司半年报保持六张卡；同标题微博+百度仍并一张。

合入前要核对：T24 只挡了「公司名: 财报」这种。没有冒号的快讯、IT之家转写、见闻短讯仍可能糊。合入后用线上那组石头科技/中矿资源/晶丰明源标题回归一次。

**要做**

- 以 T24 为底合入或重写 `shouldMerge`。
- 补回归夹具：至少包含
  - 6 家公司半年报 → 6 卡
  - 同一公司两条快讯（标题近似）→ 允许 1 卡
  - 同事件中文热搜（微博+百度，无公司冒号）→ 1 卡
  - 线上真实标题：石头科技 / 中矿资源 / 晶丰明源 不得并到一张卡
- 评估要不要加「禁止跨主实体合并」：数字不同 + 公司名不同 → 永不并。不要只靠停用词。

**验收**

- `node --test tests/cluster.test.js` 绿。
- 用当前 `events.json` 思路做一组静态夹具，跑完后财报各是各的卡。
- 早报科技栏不再出现「一张卡 sources 里塞 6 条 36kr 快讯、标题却是另一家公司」。

**文件**  
`src/cluster.js`，`tests/cluster.test.js`，必要时 `tests/fixtures/`。

---

### P0-2 收紧破圈：硬冲击不再单字命中「去世」

**问题**  
`HARD_IMPACT_RE` 现为：

```
去世|逝世|病逝|遇难|空难|地震|宣战|开战|崩盘|火化|遗体|追悼会
```

任意热搜带「去世」即 breaking，走 Bark `timeSensitive`。  
本轮破圈两条都是这个口子。早报热搜里「印度去世乞丐家中有30多个麻袋现金」也是。

`classify.js` 的 `classify()` 已不在 `run.js` 采集路径上，真正生效的是 `cluster.js` 的 `classifyCard`。两套正则必须一起改，否则测试绿、线上红。

**要做**

- 硬冲击白名单改为事件类型，而不是单字：
  - 保留：空难、地震、宣战、开战、崩盘、遇难（需和事故/灾难搭配，不要单独「去世」）。
  - 「去世 / 逝世 / 病逝」升格为：命中 **且**（多源 heat≥2 **或** 标题带可识别公众人物/职务，如院士、总设计师、主席、创始人）。否则 normal。
  - 火化 / 遗体 / 追悼会：只在已经是死亡事件的上下文里加分，不单独当 breaking。
- 娱乐/社会八卦即使带去世，也不得破圈（可与 P0-6 的娱乐过滤共用词表）。
- 同步改 `classify()` 与 `classifyCard()`，测试两边都钉。
- Bark 文案：`buildPayload` 的 `body` 现在用 `reason`（英文规则名，如 `hard impact keyword`）。上线时应推中文标题 + 一句可读摘要，不要把内部 reason 推到手机上。

**验收夹具（必须）**

| 标题 | 期望 |
|---|---|
| 朱镕基去世 | breaking |
| 歼轰7飞机总设计师陈一坚逝世 | breaking |
| 成都蛋烘糕奶奶儿子已因病去世 | normal |
| 二婚夫妇意外去世 4个子女争遗产 | normal |
| 印度去世乞丐家中有30多个麻袋现金 | normal |
| 四川宜宾市长宁县发生4.7级地震 | breaking |
| 股市崩盘 | breaking |
| 某某公司市值蒸发 | normal（T23 已定，不要回退） |

**文件**  
`src/classify.js`，`src/cluster.js`，`src/bark.js`，`tests/classify.test.js`，`tests/cluster.test.js`，`tests/bark.test.js`。

---

### P0-3 一般栏按源家族配额，停止被 HN+GitHub 占满

**问题**  
`normalListForPage`：去掉 breaking、去掉热搜娱乐，按分数排序，切 30 条。  
未合并卡片分数几乎全是 4（`2*familyCount + 2*heat`，单源就是 4）。稳定排序保原顺序。采集顺序是 hn → github → 36kr → weibo → …  
结果：30 条配额先被 20 条 HN + 10 条新建仓库吃掉。IT之家、量子位、36kr 单条出不了「一般」。

`web/app.js` 把 `display.js` 复制了一份。只改后端列表、不改前端，线上页面不变。

**要做**

- 「一般」改为按家族配额后再拼，例如 30 条里：
  - tech 12
  - hot 10（已去掉娱乐）
  - world/other 8
- 家族内仍按分数、同分保序。
- 某族不够，空位给其他族，不要留白。
- `src/display.js` 与 `web/app.js` 行为必须一致。能抽就抽；静态页不能 import 的话，用测试同时锁两边的函数签名和数字。
- 破圈栏仍是全部 breaking，不受 30 和配额限制。

**验收**

- 用线上结构造夹具：20 HN + 20 GitHub + 20 36kr + 20 微博娱乐 + 若干 IT之家。
- 「一般」30 条里必须同时出现中文科技和热搜（非娱乐），HN 不得独占前 20。
- 娱乐热搜仍不出现在「一般」（T20 行为保留）。
- `tests/display.test.js` 与 `tests/page.test.js` 覆盖配额数字，避免以后只改了一边。

**文件**  
`src/display.js`，`web/app.js`，`tests/display.test.js`，`tests/page.test.js`。

---

### P0-4 GitHub 源改成有信号，或先从首页拿掉

**问题**  
`src/sources/github.js` 搜 `created:>昨天`，按 star 排。这是「昨天新建的仓库」，不是趋势，更不是新闻。  
线上标题包括：How-To-Fish-Trainer、JAILBREAK-ULTIMATE、BITCOIN-WALLET-CRACKER、MONERO-MINING-BOTNET、wenai（AI 女友）、TXCaptcha。

这些项 `sourceFamily=tech`，分数 4，和 HN 并列，直接占「一般」。

**要做（选一条，不要两头做）**

推荐 A，信号不够就 B：

- **A. 换成趋势。** GitHub Trending（日/周）或 Search API `stars:>N` + 最近有 push，丢掉 star<某阈值、名称/描述命中 cracker/jailbreak/botnet/cheat 的。标题用 `owner/repo — description` 或只展示 repo 名 + 中文描述，不要把 `owner/repo` 送去翻译。
- **B. 上线前暂时不采 GitHub。** `SOURCES` 里拿掉，digest 的 tech 桶不再依赖它。文档里写明是主动关掉。

无论 A 还是 B：

- 描述里的 HTML/Markdown 要剥掉。
- 仓库全名不得走 MyMemory（见 P0-7）。
- `tests/sources.test.js` 锁新 URL 和过滤行为。

**验收**

- 再跑一轮采集，github 条要么没有，要么是 star 趋势/有描述的正经项目。
- 「一般」里不再出现 cracker / botnet / jailbreak 这类标题。

**文件**  
`src/sources/github.js`，`src/run.js`（若下线该源），`tests/sources.test.js`，`src/classify.js`（TECH_SOURCES 是否仍含 github）。

---

### P0-5 卡片用稳定 id，Bark 和 archive 不再因多一个源就换号

**问题**  
`toCard`：

```js
id = members.map(id).sort().join("|")
```

第一轮只有 HN → id `hn:123`，写入 `sent.json`。  
第二轮 36kr 并进来 → id `36kr:url|hn:123`，Bark 当成新破圈。  
`mergeArchive` 按 id 存，同一事件在 archive 里碎成多条，早报窗口统计也会歪。

**要做**

- 卡片增加稳定键 `canonicalId`（或直接让 `id` 稳定）：
  - 优先：规范化标题（`normalizeTitle`）+ 主实体（公司前缀或 lab 名）。
  - 成员源 id 放 `memberIds`，不要拼进主键。
- Bark 去重用 `canonicalId`，不是拼出来的成员列表。
- archive 合并用 `canonicalId`。已存在的条目更新 sources / score / level，保留最早 `archivedAt`。
- 兼容：读旧 `sent.json` 时，若旧 id 是 `a|b|c` 这种，拆开后任一成员命中即视为已推。做一轮即可，不必永久双写。
- `MAX_SENT=300` 在稳定 id 后仍然够用；不要在没去重的情况下靠加大窗口藏问题。

**验收**

- 测试：同一 breaking 先单源再双源，第二次 `pushBreaking` attempted=0。
- 测试：archive 两条不同成员、同一 canonicalId → 1 条，`archivedAt` 不刷新成现在。
- 不得改变「每轮最多推 3 条破圈」(`MAX_PER_ROUND`)。

**文件**  
`src/cluster.js`，`src/bark.js`，`src/archive.js`，`tests/cluster.test.js`，`tests/bark.test.js`，新增 archive 测试（现在没有独立 `archive.test.js`）。

---

### P0-6 娱乐热搜继续滚出「一般」，词表收到一处

**问题**  
T20 已做：热搜源 + 娱乐词 → 不进一般。  
但词表有三份：

- `classify.js` `VETO_RE`：胖东来|你好星期六|跑男|恋综|综艺|晚会
- `display.js` `ENT_DISPLAY_RE`：明星|演唱会|票房|剧集|追剧|短剧|综艺|晚会
- `web/app.js` 又各写了一份

「金鹰奖」「杨幂掉提」「双世宠妃男女主现状」这种线上热搜，不一定命中现词表，仍可能进一般（P0-3 配额后更明显）。

**要做**

- 词表只在 `classify.js`（或单独 `src/rules.js`）维护一份。display / app 引用同一语义。静态页不能 import 的话：生成或测试断言 app.js 里的正则源字符串 === 后端导出的 source。
- 扩充娱乐：奖项晚会、明星姓名不是目标；用「奖 / 提名 / 剧 / 综艺 / 演唱会 / 票房 / 掉提 / 官宣」这类结构，加上现有 veto。不要上无界的明星人名库。
- 娱乐不得升 breaking，除非 P0-2 的硬冲击（地震级）命中。去世八卦走 P0-2，不走这里。

**验收**

- 夹具：金鹰奖提名名单、杨幂掉提、双世宠妃男女主现状、某明星演唱会 → 不进 `normalListForPage`。
- 胖东来、你好星期六 仍 normal、仍不进一般。
- 前端刷新后行为与 `display.js` 一致。

**文件**  
`src/classify.js`，`src/display.js`，`web/app.js`，`tests/display.test.js`。

---

### P0-7 翻译前先洗，失败就留原文

**问题**  
线上能直接看到：

- HN summary 是 `<a href="https://xcancel.com/...">` 然后被译成另一段还带着标签。
- `Thomson Reuters Launches Its Own Frontier Model` →「前沿车型」。
- GitHub `marcus-wilsonx2093r2/BITCOIN-WALLET-CRACKER` → `mARCUS-WILSONX2093R2/...`。

`applyTitleZh` / `applySummaryZh` 串行打 MyMemory，预算 15，标题先吃完，摘要经常译不到。失败时标题会把英文写进 `titleZh`（看起来像译过）。

**要做**

- 进翻译前：`stripHtml`、去掉 URL、解码 `&amp;`。HN 的 `story_text` 若只是链接，当作无摘要。
- 不译：`owner/repo`、纯标识符、已是中文、和原文相比几乎没变的「译」。
- `titleZh` 只在真正得到中文时写入。失败或跳过 → 不要把英文塞进 `titleZh`（前端已有「无 titleZh 就用 title」）。
- 明显错译无法在免费 API 上根治。上线底线是：**脏输入不进翻译**、**失败不伪装成功**。不要为了译质量在上线前接新的 LLM。
- 预算 15 保留。可先译 breaking 和即将上首页的高分卡，再译剩余标题。现在是数组顺序（HN 优先），和 P0-3 同一原因。

**验收**

- 摘要含 `<a href` 的 HN 条目：无 HTML 摘要，不发起对该摘要的翻译。
- `owner/repo` 无 `titleZh` 或 titleZh===title。
- 翻译失败：无 `titleZh` 字段，页面显示英文原文。
- `tests/translate.test.js` 覆盖以上。现有「失败则 titleZh=英文」的测试要改掉，那是旧行为。

**文件**  
`src/translate.js`，`src/run.js`（decorate 顺序/优先级），`src/sources/hn.js`，`tests/translate.test.js`，`tests/sources.test.js`。

---

### P0-8 源写入 `publishedAt`，衰减在生产里生效

**问题**  
`decayOf` / `eventDecay` 读 `publishedAt || seenAt`。  
所有 adapter 都不写 `publishedAt`。`stampSeenAt` 在缺这两个字段时写成这次采集的 ISO 时间。  
于是 decay 恒为 1。T21 的「80 小时前跨源热度降为 normal」只在测试里人为塞 `seenAt` 时成立。

archive 覆盖写入时也会带上新的 `seenAt`，旧卡重新参与打分会像新的。

**要做**

- RSS/Atom 解析 `pubDate` / `published` / `updated`，写入条目。
- HN Algolia：`created_at`。
- GitHub：`created_at` 或 `pushed_at`（与 P0-4 方案一致）。
- 微博/百度/头条：没有可靠发布时间就不要编。热搜用本次 `seenAt` 可以，但 **archive 合并时不得刷新 `seenAt`**，只允许补 `publishedAt`。
- `stampSeenAt`：只在两者都缺时写；已有 `seenAt` 的条目（从 archive 回放、测试夹具）不覆盖。
- `mergeArchive`：保留更早的 `seenAt` / `archivedAt` / `publishedAt`。

**验收**

- RSS 夹具带 `<pubDate>` → 卡片能算到非 1 的 decay。
- 80 小时前的跨源热事件 → normal（现有 cluster 测试应在「源带 publishedAt」的路径下仍绿）。
- 连续两次 collect，同一 HN 的 `seenAt` 不变。

**文件**  
`src/rss.js`，各 `src/sources/*.js`，`src/run.js`，`src/archive.js`，`src/cluster.js`，`tests/rss.test.js`，`tests/sources.test.js`，新增 archive 测试。

---

### P0-9 采集与早报不得互踩 gh-pages

**问题**  
`collect.yml`：`*/20 * * * *`  
`digest.yml`：`0 0 * * *`  
整点重叠。两者都 checkout、从 gh-pages 拉状态、再 `peaceiris/actions-gh-pages` 全量发布 `public/`。无 `concurrency`。后结束的 job 可能用过期的 `sent.json` / `archive.json` 盖掉先结束的。

digest 还会把 `web/digest.json` 再拷一次，覆盖顺序依赖文件是否存在，脆弱。

**要做**

- 两个 workflow 加同一 `concurrency` group（例如 `pages-publish`），`cancel-in-progress: false`（不要取消正在跑的采集，排队即可）。
- digest cron 错开整点，例如 `5 0 * * *`（北京时间 08:05），避开 `*/20` 的 :00。
- 发布前必须重新拉取最新 gh-pages 状态，或改为「只更新自己产生的文件」：
  - collect 写 `events.json` + `sent.json` + `archive.json` + `title-zh.json`，保留已有 `digest.json`。
  - digest 写 `digest.json`，保留已有 `events.json` 等。
- `force_orphan: false` 保持。不要 orphan，否则历史状态更易丢。
- 失败的 publish 必须让 job 红，不能静默。

**验收**

- workflow 文件里看得到 concurrency 和错开的 cron。
- 手工 `workflow_dispatch` 连续跑 collect 再 digest，页面上 `events.json` 与 `digest.json` 都在，没有被空文件或旧文件换掉。
- `sent.json` 在 digest 发布后仍然是 collect 写下的那份（digest 不应重置已推列表）。

**文件**  
`.github/workflows/collect.yml`，`.github/workflows/digest.yml`。

---

### P0-10 上线验收清单（做完 P0-1～P0-9 后勾）

人工对照线上，不要只看测试：

- [ ] 破圈 0–3 条，条条能解释「为什么值得推」；没有去世八卦、没有财报拼盘。
- [ ] 打开 Bark 测试推一条（或看最近一次 collect 日志 `bark.attempted`），文案是中文标题，不是 `hard impact keyword`。
- [ ] 同一破圈事件连续两次 collect，第二次 `attempted=0`。
- [ ] 「一般」同时能看到中文科技和热搜；HN 不是整页。
- [ ] 无 GitHub 垃圾仓库标题。
- [ ] 早报三栏是独立事件，sources 数量合理（同事件 2–4 源可以，6 家公司财报不行）。
- [ ] 页面无 HTML 标签泄漏；英文卡有中文或干净原文，没有「车型」类明显错译当标题。
- [ ] 页脚/页头更新时间是北京时间，和 `events.json` 对得上。
- [ ] `sourceErrors` 若非空，页上能看到失败数，列表仍能渲染。
- [ ] digest 与 collect 错开跑一次，两份 JSON 都还在。

---

## P1 上线应有

### P1-1 主分支 CI 跑测试

**问题**  
没有 test workflow。分类规则全靠本地 `npm test`。merge 可以直接把破圈口子推到每 20 分钟的线上采集。

**要做**

- `.github/workflows/test.yml`：pull_request + push `main`，Node 20，`npm test`。
- collect / digest job 开头加 `npm test` 也可以，但独立 test workflow 更清楚；失败不得发布 gh-pages。
- 测试保持零依赖、不打外网。现有 `tests/sources.test.js` 已 mock fetch，不要改成直播请求。

**验收**  
故意改坏一条 classify 测试，PR 必须红。

---

### P1-2 停掉采集路径上的死规则，避免双轨漂移

**问题**  
`classify()` 只被测试调用。生产是 `cluster` → `classifyCard`。  
`classify` 的 breaking 文案还写着 `"tech source hit lab + strong event"`，cluster 里是 `"lab + strong event"`。schema 示例仍是 `"hot rank=2<=3"`（排序破圈早已删除）。

**要做**

- 生产只留一套：`classifyCard` + 共享正则/家族表。
- `classify()` 要么删并改测试，要么改成对单条事件包一层 `classifyCard([event])`，禁止两套 if。
- `schema/events.schema.json` / `schema/events.example.json` / 仓库里那份过时 `data/events.json` 更新到现结构：`score`、`sources`、`titleZh`、`summary`、`reason` 新文案。`data/events.json` 已在 gitignore，但目前仍被 track，要决定：跟踪一份真实示例，或 `git rm --cached` 只留 schema。

**验收**  
改 `HARD_IMPACT_RE` 一处，所有相关测试一起红或一起绿。grep 不到 `hot rank=`。

---

### P1-3 前端展示规则与后端单一来源

**问题**  
`web/app.js` 复制了 `sortByScore`、`breakingListForPage`、`normalListForPage`、娱乐正则。P0-3 / P0-6 若只改了一边，线上会和测试各说各话。

**要做**  
上线后仍要有机制防再漂：

- 优先：小构建或把纯函数放到 `web/rules.js`，Node 测试和页面都加载它（`web/app.js` 已是无构建，多一个 script 标签可以接受）。
- 或：`tests/page.test.js` 解析 app.js 源码，断言配额数字、正则源字符串与 `display.js` 导出值相同。

P0 可以先用测试锁；P1 把复制删掉。

---

### P1-4 状态文件不要当站点资源公开挂着

**问题**  
gh-pages 上有 `sent.json`、`archive.json`、`title-zh.json`。不是密钥，但是推送去重和翻译缓存。谁都能下，也增大误用（digest/collect 互相覆盖）的面积。

**要做**

- 页面只需要 `events.json`、`digest.json` 和静态资源。
- 状态改放到 gh-pages 的隐藏路径仍是公开 git 历史；更干净的是 GitHub Actions cache / artifact，或独立 branch 的未发布目录。选改动最小、不容易丢的：
  - 继续存在 gh-pages，但 `public/` 不拷 `sent.json` 等到站点根；用 `keep_files` + 私有前缀仍会进 git。
  - 现实约束：现在整套状态恢复靠 `git show origin/gh-pages:sent.json`。P1 允许仍存在 gh-pages，但 **index 不链接、不在根路径文档里当 API**。若有余力再迁 artifact。
- README 写清：这些文件不是产品 API。

上线不阻断。P0-9 先保证不丢；P1-4 再收口。

---

### P1-5 HTTP 采集的超时、UA、失败信息

**问题**  
`getText` 15s abort，无重试。热搜源用浏览器 UA，HN/GitHub 用 `AquaSight/0.1`。现在 14 源全绿不代表 Actions IP 一直不被微博/头条拦。失败只记 `{source, message}`，页面只显示「N 个源失败」。

**要做**

- 保持单源失败不拖死整轮（已有 `Promise.allSettled`）。
- 对 429/403 记清 HTTP 状态，meta 里可点开或至少列出源名。
- 不要为了「看起来成功」对空列表静默。空仍当该源失败（现逻辑如此，保留）。
- 36kr 四个 feed 串行试，失败时很慢。P1 可并行第一个成功即停，或只留一个能用的 feed。

**验收**  
mock 一个源 403：`sourceErrors` 含该源，其余源的卡片仍在，workflow 退出码 0（整轮成功、部分源失败是预期）。全部源失败才非 0——这点要在 `run.js` 里明确，现在全失败仍会写空 items 并 exit 0，P1 应改成至少 warn 且页面有空态文案（已有）。

---

### P1-6 Bark 推送内容达到「能点、能懂」

P0-2 已要求 body 不用内部 reason。P1 补齐产品细节：

- title：`[破圈] ` + titleZh 或 title，≤80 字。
- body：中文摘要，没有则标题本身；不要英文 reason。
- url：优先卡片主 url；热搜是搜索页也可以，但不要空。
- group 仍「鸭先知」，level `timeSensitive` 仅真正 breaking。
- digest 早报：已有独立推送，检查 title 是「鸭先知 · M月D日早报」，url 指向 Pages。确认与破圈不会在同一分钟抢（P0-9 错开后自然满足）。

`BARK_KEY` 仍只在 env / Actions secret。README 已写，保持。

---

### P1-7 README 按实际上线方式重写

现 README 是本地命令碎片，且 `data/events.json` 仍被说成「不要用内嵌样例」——对，但缺：

- 产品是什么（个人新闻雷达 + Bark + Pages）
- 如何设 `BARK_KEY`、Pages、workflow
- 源列表与更新频率
- 破圈规则一句话
- 本地 `--dry-run` / `--fixture`
- 指向本 backlog

上线当天 README 应能让另一个人按文档把同样的流水线拉起来。

---

## P2 上线后，明确不做（除非单开）

这些不是上线条件。做 P0/P1 时不要顺手膨胀。

| 项 | 为什么延后 |
|---|---|
| 自建 Bark 服务端 / 自己做 iOS 客户端 | 公共 `api.day.app` 对这个量足够。见此前讨论。 |
| 换 LLM 翻译 / 换 SpaceXAI | 先把脏输入和失败伪装砍掉。上线不依赖新供应商。 |
| 新源（Twitter/X、Reddit、Telegram、RSSHub） | 现有 14 源全绿，问题在排序和聚类，不是源不够。 |
| 登录、多用户、多 Bark key | 这是个人工具。 |
| 搜索、历史时间轴、无限 archive | archive 只留 36h，早报 24h，有意的。 |
| 复杂 NLP / embedding 聚类 | T24 级规则先用到头。embedding 会引入依赖和费用。 |
| 移动端独立视觉改版 | 现版单栏 720px 够用。P0 不改视觉语言。 |
| GitHub Pages 换成自己的域名/Vercel | 无必要。 |
| 把 Actions 迁到自建 cron | 20 分钟一次、零服务器，先稳住。 |

---

## 实施约定

1. **一次一条 P0。** 每条带测试，合 main 后再下一条。不要一条 PR 里同时改聚类、GitHub 源和 workflow。
2. **先规则后源。** P0-1、P0-2 会改变什么叫 breaking。P0-4 换 GitHub 源会改变输入分布。先锁规则。
3. **前端和后端一起改展示。** 只改 `display.js` 等于没改。
4. **不新增依赖。** 继续 Node 20 内置 `fetch` + `node:test`。
5. **不打生产 API 做测试。** 源测试继续 mock。
6. **T23 / T20 / T21 行为默认保留：** 市值蒸发单独不成 hard impact；一般栏过滤热搜娱乐；heat×decay。回退必须在 PR 里写明。
7. **线上回归用夹具，不要改 secret。** 把当前有问题的标题抄进 `tests/fixtures/`，不要为了调规则对 Bark 真推。

建议合入顺序：

```
P0-1 聚类拆分
P0-2 破圈收紧 + Bark 文案
P0-5 稳定 id（避免收紧后仍重推）
P0-3 一般栏配额
P0-6 娱乐词表
P0-4 GitHub 源
P0-7 翻译清洗
P0-8 publishedAt
P0-9 workflow 互斥
P0-10 人工验收
P1-1 CI
其余 P1
```

P0-5 放在 P0-2 后：破圈变少之后，更要保证剩下的不重推。  
P0-4 放在 P0-3 后：先让配额挡住垃圾，再决定 GitHub 改趋势还是下线。

---

## 完成定义（整包）

当且仅当：

- P0-1～P0-9 的验收都勾上
- P0-10 人工清单勾上
- P1-1 CI 绿
- main 已部署，连续两个 collect 周期（约 40 分钟）页面与 Bark 无回退

才把本文顶部的「对照快照」换成新的线上快照，并把本文件里已完成的条目标成 done。未完成的 P1 留在文件里，不要另开一份新的待办平行生长。
