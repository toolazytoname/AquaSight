import Combine
import SwiftUI

@main
struct AquaSightApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .onOpenURL { url in
                    if let id = eventId(from: url) {
                        model.openEvent(id: id)
                    }
                }
        }
    }
}

func eventId(from url: URL) -> String? {
    // https://<host>/#/event/<id>
    if let fragment = url.fragment, fragment.hasPrefix("/event/") {
        return String(fragment.dropFirst("/event/".count))
    }
    let parts = url.path.split(separator: "/")
    if let idx = parts.firstIndex(of: "event"), parts.indices.contains(idx + 1) {
        return String(parts[idx + 1])
    }
    return nil
}

@MainActor
final class AppModel: ObservableObject {
    let api = AquaSightAPI(base: URL(string: "https://aquasight.lazywc.workers.dev")!, tokenStore: KeychainStore())
    let guest = GuestStore()
    @Published var view = "featured"
    @Published var query = ""
    @Published var items: [[String: Any]] = []
    @Published var empty = "正在打开…"
    @Published var detail: [String: Any]?
    @Published var notice = ""
    @Published var showLogin = false
    @Published var showSettings = false
    @Published var email = ""
    @Published var code = ""

    func load() async {
        do {
            if view == "saved" {
                items = guest.items()
            } else if view == "digest" {
                let data = try await api.digest()
                let digest = data["digest"] as? [String: Any]
                items = digest?["items"] as? [[String: Any]] ?? []
            } else {
                let data = try await api.events(view: view, q: query)
                items = data["items"] as? [[String: Any]] ?? []
            }
            if items.isEmpty {
                empty = view == "saved"
                    ? "还没有收藏，遇到想留着读的新闻可以点收藏。"
                    : view == "digest"
                        ? "今天的早报尚未生成。"
                        : query.isEmpty ? "暂时没有新闻，稍后刷新再看看。" : "没有符合条件的内容，请调整或清除筛选。"
            } else {
                empty = ""
            }
            notice = ""
        } catch {
            if view == "saved" {
                items = guest.items()
                empty = items.isEmpty ? "还没有收藏，遇到想留着读的新闻可以点收藏。" : ""
                notice = ""
            } else if items.isEmpty {
                notice = "暂时没有新闻，稍后刷新再看看。"
            }
        }
    }

    func openEvent(id: String) {
        Task {
            guest.markRead(id)
            if let local = guest.item(id: id) ?? items.first(where: { ($0["id"] as? String) == id }) {
                detail = local
            }
            do {
                let data = try await api.event(id: id)
                detail = data["item"] as? [String: Any] ?? detail
            } catch {
                if detail == nil { notice = "这条还不在本机收藏里。" }
            }
        }
    }

    func toggleSave(_ item: [String: Any]) {
        guard let id = item["id"] as? String else { return }
        let saved = guest.isSaved(id)
        if saved { guest.remove(id: id) } else { guest.save(id: id, snapshot: item) }
        Task {
            do {
                if saved { try await api.deleteFavorite(id: id) }
                else { try await api.saveFavorite(id: id, snapshot: item) }
                notice = saved ? "已取消收藏" : "已收藏"
            } catch {
                notice = saved ? "已在本机取消，待同步" : "已收藏到本机"
            }
            if view == "saved" { await load() }
        }
    }

    func sendCode() async {
        do {
            _ = try await api.requestCode(email: email)
            notice = "已提交。验证码 10 分钟内有效。"
        } catch {
            notice = "暂时发不出验证码"
        }
    }

    func verify() async {
        do {
            _ = try await api.verify(email: email, code: code)
            _ = try await api.merge(guest.mergeBody())
            showLogin = false
            notice = "已登录，本机收藏已合并"
            await load()
        } catch {
            notice = "验证码无效或已过期"
        }
    }
}
