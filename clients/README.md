# 客户端

不使用 Flutter。Web 继续是现有静态页 + Worker。安卓用 Kotlin，iOS 用 Swift。三端共用 `schema/client-contract.json` 与 `/api/v1`。

## 共同行为

- 精选 / 最新 / 早报 / 收藏 / 搜索 / 详情
- 邮箱验证码登录；Web 用 Cookie，App 用系统安全存储里的 Bearer
- 未登录可阅读，收藏先留在本机；登录后 `POST /api/v1/sync/merge`
- 删除收藏走墓碑，合并时不得复活
- 通知深链：`https://<host>/#/event/<id>`，未安装 App 时网页可打开

## 安卓

`clients/android`：Kotlin + Compose，系统 HTTP。凭证放 EncryptedSharedPreferences。四栏阅读、搜索、详情、本机收藏、邮箱验证码、`#/event/<id>` 深链。通知通道单独选国内厂商方案，不在此预设 FCM。

## iOS

`clients/ios`：原生 SwiftUI，iOS 17+。精选 / 最新 / 开源 / 早报 / 收藏，搜索分页、详情、离线快照和邮箱登录同步。凭证放 Keychain，按账户隔离本机收藏。运行、测试和发布前待验项见 [iOS 说明](ios/README.md)。正式 APNs 与 Universal Links 尚未配置；Bark 仍是现有个人推送通道。

## 真机

模拟器不算完成。安卓要测进程被杀和厂商后台；iOS 要测安全区、动态字体、后台切换。
