# AquaSight API v1

排序在服务端完成。响应都带 `apiVersion`、`snapshotAt`。列表带分页游标 `cursor`。

生产环境校验 Cloudflare Access JWT（`Cf-Access-Jwt-Assertion`），不信任可伪造的邮箱头。采集 `INGEST_TOKEN` 只能 `POST /api/v1/ingest` 和 `GET /api/v1/settings`。上传契约接受顶层 `items`（或 `events` / `events.items`），并写入事件表。

## 信封

```json
{
  "apiVersion": "v1",
  "snapshotAt": "2026-09-07T00:00:00.000Z",
  "cursor": "optional-base64url",
  "items": []
}
```

稳定 ID：文章 `art:` + 来源身份哈希，事件 `evt:` + UUID。不要用公司名当 ID。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/health` | 公开：源是否成功、用途、最后成功时间；X 是否接通 |
| GET | `/api/v1/status` | 私人：源健康、重复率相关诊断、整理失败、费用、通知结果。失败不会伪装成没有新闻 |
| GET | `/api/v1/events?view=featured\|latest\|digest&q=&cursor=&limit=` | 列表。默认精选，配额 18/9/3，单源 ≤6，同主体 ≤3 |
| GET | `/api/v1/events/:id` | 详情：中文要点、来源、不同报道。收藏快照可在原事件过期后仍读 |
| GET | `/api/v1/digest` | 早报 10 条，配额 6/3/1 |
| GET/PUT | `/api/v1/settings` | 偏好（隐藏事件、降权主题、屏蔽来源、通知政策） |
| GET/POST | `/api/v1/reads` | 已读 |
| GET/POST/DELETE | `/api/v1/favorites` | 收藏（独立快照） |
| POST | `/api/v1/feedback` | `hide` / `downweight-topic` / `block-source` / `like` / `dislike`；`undoId` 撤销 |
| POST | `/api/v1/import` | 手工导入链接或 X 状态。限制协议、大小、超时、重定向、目标地址 |
| POST | `/api/v1/ingest` | 采集端写入快照，需要 `Authorization: Bearer INGEST_TOKEN` |
| GET | `/api/v1/export` | 备份 |
| POST | `/api/v1/import-backup` | 恢复 |
| GET | `/api/v1/review` | 口味校准样本 |

Web 卡片不返回内部 `reason` 和裸分数。静态回退仍写 `events.json`，给页面在 API 不可用时使用。

## 通知政策

- 早报默认每天 08:05（北京）
- 即时每天最多 3 条，23:00–08:00 静默
- 发送前重新读偏好
- 即时推送默认关闭，等 7 天影子运行达标后再开
