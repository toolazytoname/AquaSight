import Foundation

enum LoadPhase: Equatable { case idle, loading, loaded(reachedEnd: Bool), failed(String) }

@MainActor
final class EventFeedModel: ObservableObject {
    let view: String
    let api: APIClient
    private let readerSources: [String]?
    @Published private(set) var items: [EventItem] = []
    @Published private(set) var phase: LoadPhase = .idle
    @Published private(set) var warning: String?
    @Published private(set) var digestMissing = false
    @Published private(set) var digestDate: String?
    @Published private(set) var refreshing = false
    @Published private(set) var loadingMore = false
    @Published var query = ""
    private(set) var cursor: String?
    private var generation = 0
    private var lastAttemptAt: Date?
    private var searchDebounce: Task<Void, Never>?
    private let cacheFile: URL
    private var digestAllItems: [EventItem] = []
    private var failedPagination = false

    static func beijingDay(_ date: Date = Date()) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Shanghai"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
    init(view: String, api: APIClient, cacheDirectory: URL? = nil, readerSources: [String]? = nil, cacheKey: String? = nil) {
        self.view = view; self.api = api; self.readerSources = readerSources
        let dir = cacheDirectory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("AquaSightFeeds", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        cacheFile = dir.appendingPathComponent((cacheKey ?? view) + ".json")
        loadCache()
    }
    func refreshIfStale() {
        guard !refreshing, lastAttemptAt.map({ Date().timeIntervalSince($0) > 60 }) ?? true else { return }
        refreshing = true
        let gen = generation
        Task { guard gen == generation else { return }; await refresh() }
    }
    func refresh() async { searchDebounce?.cancel(); await load(reset: true) }
    func retry() async {
        if failedPagination { await retryLoadMore() } else { await refresh() }
    }
    func retryLoadMore() async {
        guard cursor != nil, !loadingMore, !refreshing else { return }
        await load(reset: false)
    }
    func loadMoreIfNeeded(current item: EventItem) async {
        guard !refreshing, !loadingMore, warning == nil, cursor != nil,
              case .loaded(false) = phase, item.id == items.last?.id else { return }
        await load(reset: false)
    }
    func setQuery(_ value: String) {
        guard value != query else { return }
        query = value; generation += 1; searchDebounce?.cancel()
        refreshing = false; loadingMore = false; cursor = nil; warning = nil
        if view == "digest", digestDate == Self.beijingDay() {
            items = filtered(digestAllItems); phase = .loaded(reachedEnd: true); return
        }
        items = []; phase = .loading
        searchDebounce = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 350_000_000) } catch { return }
            guard let self, !Task.isCancelled else { return }
            await self.load(reset: true)
        }
    }
    private func load(reset: Bool) async {
        if reset { generation += 1; refreshing = true; loadingMore = false; cursor = nil; lastAttemptAt = Date() }
        else { guard !loadingMore, !refreshing, cursor != nil else { return }; loadingMore = true }
        let gen = generation
        let requestedCursor = reset ? nil : cursor
        let requestedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        warning = nil; failedPagination = false
        if items.isEmpty { phase = .loading }
        defer { if gen == generation { refreshing = false; loadingMore = false } }
        do {
            if view == "digest" {
                let response = try await api.digest()
                guard gen == generation else { return }
                let payload = response.digest
                digestDate = payload?.date
                digestMissing = payload?.missing == true || payload == nil
                var all = payload?.items ?? []
                for section in [payload?.tech, payload?.business, payload?.public_] { all += section ?? [] }
                digestAllItems = digestMissing ? [] : dedupe(all)
                items = filtered(digestAllItems)
                cursor = nil; phase = .loaded(reachedEnd: true)
                writeCache(digestAllItems)
            } else {
                let response: EventsResponse
                if let sources = readerSources {
                    response = try await api.readerEvents(sources: sources, q: requestedQuery, cursor: requestedCursor)
                } else { response = try await api.events(view: view, q: requestedQuery, cursor: requestedCursor) }
                guard gen == generation else { return }
                items = scoped(dedupe((reset ? [] : items) + (response.items ?? [])))
                // A broken/repeated cursor must not cause an endless pagination loop.
                cursor = response.cursor?.isEmpty == false && response.cursor != requestedCursor ? response.cursor : nil
                phase = .loaded(reachedEnd: cursor == nil)
                if requestedQuery.isEmpty { writeCache(items) }
            }
        } catch {
            guard gen == generation else { return }
            let message = (error as? APIError)?.userMessage ?? "加载失败，请重试。"
            failedPagination = !reset
            if items.isEmpty { phase = .failed(message) }
            else {
                phase = .loaded(reachedEnd: reset || cursor == nil)
                warning = reset ? "暂未更新，正在显示本机内容。\(message)" : "加载更多失败。\(message)"
            }
        }
    }
    private func scoped(_ items: [EventItem]) -> [EventItem] {
        guard let sources = readerSources else { return items }
        return items.filter { sources.contains($0.source ?? "") && $0.url.flatMap { SafeLink(urlString: $0, title: "") } != nil }
    }
    private func filtered(_ list: [EventItem]) -> [EventItem] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? list : list.filter { ($0.displayTitle + " " + $0.overviewText).localizedCaseInsensitiveContains(q) }
    }
    private func dedupe(_ list: [EventItem]) -> [EventItem] {
        var ids = Set<String>(); return list.filter { ids.insert($0.id).inserted }
    }
    private struct Cache: Codable { var items: [EventItem]; var savedAt: Date; var digestDate: String?; var digestMissing: Bool? }
    private func loadCache() {
        guard let data = try? Data(contentsOf: cacheFile), let cache = try? JSONDecoder().decode(Cache.self, from: data) else { return }
        if view == "digest" {
            guard cache.digestDate == Self.beijingDay() else { return }
            digestDate = cache.digestDate; digestMissing = cache.digestMissing ?? false
            digestAllItems = cache.items
        }
        items = scoped(dedupe(cache.items))
    }
    private func writeCache(_ items: [EventItem]) {
        let cache = Cache(items: items, savedAt: Date(), digestDate: digestDate, digestMissing: view == "digest" ? digestMissing : nil)
        if let data = try? JSONEncoder().encode(cache) { try? data.write(to: cacheFile, options: .atomic) }
    }
}
