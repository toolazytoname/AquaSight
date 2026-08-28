# AquaSight 阅读壳

Flutter 3 时间线客户端（iOS / Android 同一套 `lib/`）。运行中只读

`https://toolazytoname.github.io/AquaSight/events.json`

失败则回退到仓库里的 `web/events.json`（若存在）。测试只加载 `test/fixtures/events.json`，不访问网络。

```
flutter pub get
flutter test
# 可选
flutter run
```
