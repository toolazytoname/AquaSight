# 鸭先知 AquaSight

个人新闻雷达：定时采集、聚类打分、中文整理、Bark 通知、Web 阅读。

当前仓库实现的是 T01–T23 的工程能力。 **还没有上线。** 缺 Cloudflare Access 身份、D1 数据库 ID、模型凭证。即时推送默认关闭，等 7 天影子运行（T24）后再开。

更细的交付对照见 `docs/delivery.md`。接口见 `docs/api.md`。部署与回滚见 `docs/deploy.md`。

## 本地

需要 Node 20+。

```bash
npm test
npm run db:migrate
cp .env.example .env   # 填自己的密钥，不要提交
npm start              # http://127.0.0.1:8765/
node src/run.js --once --dry-run
node src/run.js --once --fixture tests/fixtures/cards.json --dry-run
node src/digest.js --once --dry-run
```

- `npm start`：本地 Web + `/api/v1`（文件存储 `data/app-store.json`）
- `npm run db:migrate`：准备本地库，并打印 D1 schema 路径
- `npm run deploy`：需要已填写的 `worker/wrangler.toml` 和 wrangler 登录

`BARK_KEY`、`XAI_API_KEY`、`INGEST_TOKEN` 只放 `.env` 或 GitHub Actions / Worker secrets。

## 采集

GitHub Actions 每 20 分钟跑 `src/run.js`（Node，不是 Workers）。每天北京时间 08:05 出早报。

源：HN、GitHub（开源发现）、36氪文章、36氪快讯、微博/百度/头条热搜（线索）、IT之家、量子位、V2EX、华尔街见闻、TechCrunch、BBC、The Verge、OpenAI。

热搜不当主新闻。GitHub 不是趋势榜。银行等商业内容即使来自 36氪也不进科技栏。

## 阅读

Web 一级导航：精选、最新、早报、收藏。首页就是精选。API 不可用时，页面可以回退到 `events.json`。

## 通知

- 早报 08:05
- 即时每天最多 3 条，23:00–08:00 静默
- 普通讣告、事故、旧闻回顾不即时推
- 发送前重读偏好；成功才记已发送

即时推送开关 `instantNotifyEnabled` 默认 `false`。
