import Foundation

/// Detail loading with an open-generation guard: opening item A then quickly
/// item B (or popping back) must never let a late A response replace B.
@MainActor
final class DetailModel: ObservableObject {
    enum Phase: Equatable {
        case loading
        case loaded
        case offlineCopy   // showing a local snapshot; network unavailable
        case failed(String)
    }

    @Published private(set) var item: EventItem?
    @Published private(set) var phase: Phase = .loading

    private let api: APIClient
    private var openGeneration = 0

    init(api: APIClient) {
        self.api = api
    }

    func open(id: String, fallback: EventItem?, readerSources: [String]? = nil, client: APIClient? = nil, allowSaved: Bool = false) async {
        openGeneration += 1
        let gen = openGeneration
        if let fallback {
            item = fallback
            phase = .loaded
        } else {
            item = nil
            phase = .loading
        }
        do {
            let captured = client ?? api
            let resp: EventDetailResponse
            if let readerSources { resp = try await captured.readerEvent(id: id, sources: readerSources) }
            else { resp = try await captured.event(id: id) }
            guard gen == openGeneration else { return }
            if let fresh = resp.item {
                if let sources = readerSources, !allowSaved, !sources.contains(fresh.source ?? "") {
                    item = nil; phase = .failed("这条内容不在当前订阅中，可前往「订阅」管理来源。"); return
                }
                item = fresh
                phase = .loaded
            } else {
                phase = item != nil ? .offlineCopy : .failed("这条内容暂时无法打开。")
            }
        } catch {
            guard gen == openGeneration else { return }
            if item != nil {
                phase = .offlineCopy   // cached snapshot remains readable offline
            } else {
                phase = .failed((error as? APIError)?.userMessage ?? "加载失败，请重试。")
            }
        }
    }
}
