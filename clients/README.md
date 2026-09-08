# 客户端

不使用 Flutter。Web 继续是现有静态页 + Worker。安卓用 Kotlin，iOS 用 Swift。三端共用 `schema/client-contract.json` 与 `/api/v1`。

## 共同行为

- 精选 / 最新 / 早报 / 收藏 / 搜索 / 详情
- 邮箱验证码登录；Web 用 Cookie，App 用系统安全存储里的 Bearer
- 未登录可阅读，收藏先留在本机；登录后 `POST /api/v1/sync/merge`
- 删除收藏走墓碑，合并时不得复活
- 通知深链：`https://<host>/#/event/<id>`，未安装 App 时网页可打开

## 安卓

`clients/android`：Kotlin + 系统 HTTP。凭证放 EncryptedSharedPreferences。通知通道单独选国内厂商方案，不在此预设 FCM。

## iOS

`clients/ios`：Swift。凭证放 Keychain。正式推送用 APNs；Bark 仍是个人可选通道。

## 真机

模拟器不算完成。安卓要测进程被杀和厂商后台；iOS 要测安全区、动态字体、后台切换。
