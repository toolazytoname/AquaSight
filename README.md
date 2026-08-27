# 鸭先知 AquaSight

个人新闻雷达：定时采集、聚类打分、破圈推 iPhone（Bark）、页面出早报和列表。

线上：https://toolazytoname.github.io/AquaSight/

## 做什么

- 每天两次采集（北京时间 09:00 / 21:00）HN、GitHub、36kr、微博/百度/头条热搜、IT之家、量子位、V2EX、华尔街见闻、TechCrunch、BBC、The Verge、OpenAI。
- 相近标题合成一张卡，跨源热度、实验室事件、灾难/公众人物去世才进「破圈」。
- 破圈走 Bark `timeSensitive`，每轮最多 3 条，同一事件不重推。
- 每天北京时间 08:05（UTC 00:05）出早报：科技 / 热搜 / 其它各最多 5 条。
- 页面只把 `events.json` 和 `digest.json` 当产品数据。`sent.json` / `archive.json` / `title-zh.json` 是流水线状态，不是 API。

## 本地

需要 Node 20+。

```
npm test
cp .env.example .env   # 填 BARK_KEY，不要提交
node src/run.js --once --dry-run
node src/run.js --once --fixture tests/fixtures/cards.json --dry-run
node src/digest.js --once --dry-run
python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/web/
```

`BARK_KEY` 只放在 `.env` 或 GitHub Actions secret 里。仓库里不要出现设备 key。

## GitHub Actions 与 Pages

1. Settings → Secrets：`BARK_KEY`（Bark 设备 key）。`GITHUB_TOKEN` 由 Actions 自带，给 GitHub Search 用。
2. 跑一次 `collect` workflow（`workflow_dispatch` 或等到下次定时）。
3. Settings → Pages → Deploy from a branch → `gh-pages` / `/`。
4. `collect` 每天 UTC 01:00 / 13:00（北京时间 09:00 / 21:00）写 `events.json` 并推破圈。`digest` 每天 UTC 00:05 写 `digest.json`。两者共用 `pages-publish` 队列，不会互相覆盖。

`npm test` 在 PR、push `main`、以及每次采集/早报发布前都会跑。

## 破圈（一句话）

灾难（地震/空难/开战/崩盘/遇难）、可识别的公众人物去世、实验室名+发布/开源等强事件、或 24 小时内跨家族且至少 3 个源。热搜娱乐和「去世」八卦不推。

更细的上线标准见 `docs/launch-backlog.md`。
