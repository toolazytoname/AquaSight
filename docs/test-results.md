# T23 测试结果

日期：2026-09-07

```
npm test
# tests 125
# pass 125
# fail 0
```

覆盖：身份、聚类、旧闻、跨语言、过滤一致性、预算、异常模型返回、采集失败、通知失败与重启、保留策略、静默基线、本地 HTTP 阅读流。

浏览器阅读流（无图形浏览器，用本机 HTTP 客户端）：`tests/browser-flow.test.js`  
结果：`docs/test-results-browser.json`

```json
{ "ok": true, "featured": 1, "detail": true, "favorite": 1 }
```

未跑：真实 Chromium 390px/1440px 截图（环境无 Chrome）。
