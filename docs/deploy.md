# 部署与回滚

当前**不能宣称已上线**。缺 Cloudflare 配置、Access 允许身份、模型凭证。

## 本地

```bash
npm test
npm run db:migrate
cp .env.example .env   # 不要提交
npm start              # http://127.0.0.1:8765/
node src/run.js --once --dry-run
node src/run.js --once --fixture tests/fixtures/cards.json --dry-run
```

采集和模型整理只在 Node（本机或 GitHub Actions）跑，不要塞进 Workers 免费版 CPU。

## 还缺的密钥（部署待办）

在 GitHub Actions secrets 和 Cloudflare 里配置，仓库里不要出现真值：

| 名称 | 用途 |
|---|---|
| `BARK_KEY` | Bark 设备 key |
| `XAI_API_KEY` | SpaceXAI / xAI，中文整理。没有则自动降级 |
| `ACCESS_EMAIL` | Cloudflare Access 允许的个人邮箱 |
| `ACCESS_TEAM` | Access team 名，用于拉 JWKS |
| `ACCESS_AUD` | Access application AUD |
| `API_BASE_URL` | Worker 根地址，采集用来拉偏好 |
| `INGEST_TOKEN` | 采集写入 Worker 的服务凭证 |
| `INGEST_URL` | Worker `/api/v1/ingest` |
| `AUTH_TOKEN` | 本地或备用私人访问 |
| `X_BEARER_TOKEN` | 可选。没有则 X 订阅显示未接通 |
| D1 `database_id` | 写入 `worker/wrangler.toml` |

Cloudflare Access 必须只允许指定个人身份。未认证不能读私人数据。

## Cloudflare

1. 建 D1：`npx wrangler d1 create aquasight`
2. 把 `database_id` 填进 `worker/wrangler.toml`（不要把别的密钥写进该文件）
3. `npx wrangler d1 execute aquasight --file=worker/schema.sql`
4. `npm run deploy`
5. 用 Cloudflare Access 包住 Worker 路由，允许 `ACCESS_EMAIL`
6. 配置 `INGEST_TOKEN`、`ACCESS_EMAIL` 为 Worker secrets
7. GitHub Actions 增加 `INGEST_URL` / `INGEST_TOKEN` / `XAI_API_KEY`

国内访问要在切换前用实际网络打开一次 Web。本环境未做国内拨测。

## 兼容

采集仍写 `data/events.json` 和 `web/events.json`，给静态页回退。  
运行状态（`sent.json` 等）不再作为站点根资源发布。  
旧 `card:` 公司名 ID 不强行映射到新 `evt:` ID。第一轮采集静默建基线，不推送。

## 回滚

1. GitHub Pages：把 `gh-pages` 回到上一笔仍含可用 `events.json` 的 commit
2. Worker：`npx wrangler rollback` 或重新部署上一 tag
3. 数据：`GET /api/v1/export` 的备份用 `POST /api/v1/import-backup` 恢复
4. 通知：把 `instantNotifyEnabled` 保持 `false`

失败时站点应继续展示上次有效快照，不能显示成“没有新闻”。
