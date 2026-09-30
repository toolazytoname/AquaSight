import Foundation
import CryptoKit

struct ReaderSource: Codable, Identifiable, Equatable {
    var id: String
    var label: String
    var description: String
    var group: String
    var extended: Bool
    static let basics: [ReaderSource] = [
        .init(id: "github", label: "开源发现", description: "发现新的 GitHub 项目", group: "开源项目", extended: false),
        .init(id: "github-trending", label: "GitHub 今日热门", description: "今天受到关注的仓库", group: "开源项目", extended: false),
        .init(id: "github-trending-weekly", label: "GitHub 本周热门", description: "观察一周的项目趋势", group: "开源项目", extended: false),
        .init(id: "github-maintained", label: "持续维护的项目", description: "近期仍在积极维护的开源项目", group: "开源项目", extended: false),
        .init(id: "openai", label: "OpenAI 官方", description: "产品发布与技术更新", group: "技术与研究", extended: false),
        .init(id: "huggingface", label: "Hugging Face", description: "论文与热门模型", group: "技术与研究", extended: false)
    ]
}
struct ReaderSettings: Codable, Equatable {
    var selectedSources: [String] = []
    var moreSourcesEnabled = false
    var configured = false
}
struct ReaderSettingsResponse: Decodable { var reader: ReaderSettings }
struct ReaderCatalogResponse: Decodable { var sources: [ReaderSource] }

/// Account-scoped subscription state. Pending changes survive offline restarts;
/// writes only contain source selection, never the website's expansion switch.
@MainActor
final class ReaderModel: ObservableObject {
    @Published private(set) var settings = ReaderSettings()
    @Published private(set) var catalog = ReaderSource.basics
    @Published private(set) var isRefreshing = false
    @Published private(set) var isSaving = false
    @Published private(set) var message: String?
    @Published private(set) var accountKey = "guest"
    private let api: APIClient
    private let directory: URL
    private(set) var client: APIClient
    private var generation = 0
    private var revision = 0
    private var pending = false
    private var signedIn = false
    private var guestSeed: [String]?
    private struct Record: Codable { var settings: ReaderSettings; var catalog: [ReaderSource]; var pending: Bool }

    init(api: APIClient, directory: URL? = nil) {
        self.api = api; self.client = api.authenticated(token: nil)
        self.directory = (directory ?? LocalStore.defaultDirectory()).appendingPathComponent("subscriptions", isDirectory: true)
        load()
    }
    var effectiveSources: [String] {
        let allowed = Set(catalog.filter { !$0.extended || (signedIn && settings.moreSourcesEnabled) }.map(\.id))
        return Array(Set(settings.selectedSources).intersection(allowed)).sorted()
    }
    var scopeKey: String {
        let raw = accountKey + ":" + effectiveSources.joined(separator: ",")
        return SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    var groups: [String] { var seen = Set<String>(); return catalog.map(\.group).filter { seen.insert($0).inserted } }
    var hasPendingChanges: Bool { pending }
    var canUseMore: Bool { signedIn && settings.moreSourcesEnabled }
    private var file: URL { directory.appendingPathComponent(accountKey + ".json") }
    func allows(_ item: EventItem) -> Bool {
        effectiveSources.contains(item.source ?? "") && item.url.flatMap { SafeLink(urlString: $0, title: "") } != nil
    }
    func activate(email: String?, token: String?) {
        let oldGuest = accountKey == "guest" ? settings.selectedSources : []
        generation += 1; revision += 1
        accountKey = LocalStore.accountKey(for: email); signedIn = email != nil && token != nil
        client = api.authenticated(token: signedIn ? token : nil)
        isRefreshing = false; isSaving = false; message = nil
        load()
        guestSeed = signedIn && !oldGuest.isEmpty ? oldGuest : nil
    }
    private func load() {
        settings = ReaderSettings(); catalog = ReaderSource.basics; pending = false
        if let data = try? Data(contentsOf: file), let record = try? JSONDecoder().decode(Record.self, from: data) {
            settings = record.settings; catalog = record.catalog; pending = record.pending
        }
        if !signedIn { settings.moreSourcesEnabled = false }
    }
    private func persist() {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(Record(settings: settings, catalog: catalog, pending: pending))
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch { message = "设置尚未写入本机，请检查设备存储空间。" }
    }
    func select(_ ids: [String]) async {
        guard !isSaving else { return }
        revision += 1
        let known = Set(catalog.map(\.id))
        // Keep disabled extended selections for when the user re-enables them.
        let retained = settings.selectedSources.filter { id in catalog.contains { $0.id == id && $0.extended } && !canUseMore }
        settings.selectedSources = Array(Set(ids + retained).intersection(known)).sorted()
        settings.configured = true; pending = signedIn; message = nil
        persist()
        if signedIn { await savePending() }
    }
    private func savePending() async {
        guard signedIn, pending, !isSaving else { return }
        isSaving = true
        let gen = generation, rev = revision, captured = client
        let sources = settings.selectedSources
        defer { if gen == generation { isSaving = false } }
        do {
            let result = try await captured.saveReaderSources(sources)
            guard gen == generation, rev == revision else { return }
            settings = result.reader; pending = false; message = nil; persist()
        } catch {
            guard gen == generation else { return }
            message = "订阅已保存在本机，尚未同步。联网后点重试。"
        }
    }
    func refresh() async {
        guard !isRefreshing, !isSaving else { return }
        isRefreshing = true
        let gen = generation, rev = revision, captured = client
        defer { if gen == generation { isRefreshing = false } }
        do {
            let result = try await captured.readerCatalog()
            guard gen == generation else { return }
            catalog = result.sources
            if signedIn {
                let remote = try await captured.readerSettings()
                guard gen == generation, rev == revision else { return }
                if pending { settings.moreSourcesEnabled = remote.reader.moreSourcesEnabled }
                else if !remote.reader.configured, let seed = guestSeed {
                    settings = remote.reader; settings.selectedSources = seed; settings.configured = true; pending = true
                } else { settings = remote.reader }
                guestSeed = nil
                message = nil
                persist()
                if pending { await savePending() }
            } else { message = nil; persist() }
        } catch {
            guard gen == generation, rev == revision, !Task.isCancelled else { return }
            message = "暂时无法更新订阅设置，正在使用本机设置。"
        }
    }
    func wipeCurrent() {
        try? FileManager.default.removeItem(at: file)
        settings = ReaderSettings(); pending = false
    }
}
