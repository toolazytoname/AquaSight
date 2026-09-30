import Foundation

// MARK: - Event models
// Tolerant decoding: every field except id/title may be absent in real payloads
// (verified against /tmp/aquasight-ios-live production samples).

struct EventItem: Codable, Identifiable, Equatable, Hashable {
    var id: String
    var title: String
    var titleZh: String?
    var url: String?
    var source: String?
    var level: String?
    var summary: String?
    var summaryZh: String?
    var overviewZh: String?
    var body: String?
    var subject: String?
    var category: String?
    var kind: String?
    var role: String?
    var score: Double?
    var value: Double?
    var stars: Int?
    var publishedAt: String?
    var seenAt: String?
    var firstSeenAt: String?
    var occurredAt: String?
    var observedAt: String?
    var updatedAt: String?
    var facts: [String]?
    var impact: String?
    var evidence: [String]?
    var uncertainty: [String]?
    var attribution: [Attribution]?
    var memberIds: [String]?
    var aiState: String?
    var enrichInsufficient: Bool?
    var sources: [EventSourceRef]?
    var githubRepo: GitHubRepo?

    struct Attribution: Codable, Equatable, Hashable {
        var claim: String?
        var source: String?
    }

    var displayTitle: String {
        if let zh = titleZh, !zh.isEmpty { return zh }
        return title
    }

    /// AI-produced Chinese overview when enrichment finished; otherwise the raw
    /// (possibly English/queued) source summary, so callers can label honestly.
    var aiOverview: String? {
        guard let zh = overviewZh, !zh.isEmpty else { return nil }
        return zh
    }

    var isAIReady: Bool { aiOverview != nil && enrichInsufficient != true && (aiState == nil || aiState == "ready") }

    var overviewFallback: String {
        if let zh = summaryZh, !zh.isEmpty { return zh }
        if let s = summary, !s.isEmpty { return s }
        if let d = githubRepo?.description, !d.isEmpty { return d }
        return ""
    }

    var overviewText: String { aiOverview ?? overviewFallback }

    /// All safe source links for this event, primary first.
    var safeLinks: [SafeLink] {
        var out: [SafeLink] = []
        if let u = url, let link = SafeLink(urlString: u, title: displayTitle) { out.append(link) }
        for s in sources ?? [] {
            let label = s.title ?? s.source ?? ""
            guard let raw = s.url, !raw.isEmpty, let link = SafeLink(urlString: raw, title: label) else { continue }
            if !out.contains(where: { $0.url == link.url }) { out.append(link) }
        }
        return out
    }
}

struct EventSourceRef: Codable, Equatable, Hashable {
    var source: String?
    var url: String?
    var title: String?
    var summary: String?
    var role: String?
    var points: Int?
    var publishedAt: String?
}

/// Production shape (opensource.json): growth is an ARRAY of per-source rows
/// {source, window, stars}; signals is an array of {source, signal}.
/// stars/language/pushedAt are absent when the collector did not observe them.
struct GitHubRepo: Codable, Equatable, Hashable {
    var fullName: String?
    var description: String?
    var language: String?
    var stars: Int?
    var pushedAt: String?
    var observedAt: String?
    var license: String?
    var signal: String?
    var signals: [Signal]?
    var growth: [Growth]?

    struct Growth: Codable, Equatable, Hashable {
        var source: String?
        var window: String?
        var stars: Int?
    }

    struct Signal: Codable, Equatable, Hashable {
        var source: String?
        var signal: String?
    }

    var primaryGrowth: Growth? {
        growth?.first { ($0.stars ?? 0) > 0 } ?? growth?.first
    }
}

/// Only http(s) links without embedded credentials are opened.
struct SafeLink: Identifiable, Equatable, Hashable {
    var id: String { url.absoluteString }
    let url: URL
    let title: String

    init?(urlString: String, title: String) {
        guard let u = URL(string: urlString),
              let scheme = u.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              u.host != nil,
              u.user == nil, u.password == nil else { return nil }
        self.url = u
        self.title = title.isEmpty ? u.host ?? u.absoluteString : title
    }
}

// MARK: - API envelopes

struct EventsResponse: Codable {
    var reader: Bool?
    var items: [EventItem]?
    var cursor: String?
    var total: Int?
    var view: String?
    var windowed: Bool?
    var snapshotAt: String?
}

struct EventDetailResponse: Codable {
    var item: EventItem?
    var members: [EventItem]?
    var fromFavorite: Bool?
}

struct DigestPayload: Codable {
    var date: String?
    var items: [EventItem]?
    var tech: [EventItem]?
    var business: [EventItem]?
    var public_: [EventItem]?
    var missing: Bool?

    enum CodingKeys: String, CodingKey {
        case date, items, tech, business, missing
        case public_ = "public"
    }
}

struct DigestResponse: Codable {
    var digest: DigestPayload?
}

struct MeResponse: Codable {
    struct User: Codable, Equatable {
        var id: String?
        var email: String?
    }
    var user: User?
    var guest: Bool?
}

struct FavoriteRow: Codable {
    var id: String?
    var eventId: String?
    var snapshot: EventItem?
    var deleted: Bool?
    var rev: Int?
}

struct FavoritesResponse: Codable {
    var items: [EventItem]?
}

struct MergeFavorite: Codable {
    var id: String
    var deleted: Bool?
    var snapshot: EventItem?
}

struct MergeRequestBody: Codable {
    var reads: [String: String]
    var favorites: [MergeFavorite]
}

struct MergeResponse: Codable {
    var ok: Bool?
    var favorites: [FavoriteRow]?
    var reads: [String: String]?
}

struct OkEnvelope: Codable {
    var ok: Bool?
    var delivery: String?
    var retryAfterSec: Int?
}

struct VerifyResponse: Codable {
    var ok: Bool?
    var token: String?
    var user: MeResponse.User?
}

// MARK: - Errors

enum APIError: Error, Equatable {
    case invalidResponse
    case readerUnavailable
    case status(Int, code: String?)
    case network(String)

    var isUnauthorized: Bool {
        if case .status(let code, _) = self { return code == 401 }
        return false
    }

    var userMessage: String {
        switch self {
        case .readerUnavailable:
            return "订阅阅读暂时不可用，请稍后重试。已保存的收藏仍可阅读。"
        case .invalidResponse:
            return "服务器返回了无法理解的内容。"
        case .status(401, _):
            return "登录已过期，请重新登录。"
        case .status(let code, _) where code >= 500:
            return "服务暂时不可用（\(code)），请稍后重试。"
        case .status(429, _):
            return "请求太频繁，请稍等片刻再试。"
        case .status(let code, _):
            return "请求失败（\(code)）。"
        case .network:
            return "网络连接失败，请检查网络后重试。"
        }
    }
}

// MARK: - Dates

enum FlexDate {
    static let parsers: [ISO8601DateFormatter] = {
        let full = ISO8601DateFormatter()
        full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return [full, plain]
    }()

    static func parse(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        for p in parsers {
            if let d = p.date(from: s) { return d }
        }
        return nil
    }

    static func relative(_ s: String?) -> String? {
        guard let d = parse(s) else { return nil }
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.unitsStyle = .short
        return f.localizedString(for: d, relativeTo: Date())
    }

    static func shortDate(_ s: String?) -> String? {
        guard let d = parse(s) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateStyle = .medium
        return f.string(from: d)
    }
}

// MARK: - Source catalog labels (mirrors src/catalog.js)

enum SourceCatalog {
    static let labels: [String: String] = [
        "hn": "Hacker News",
        "github": "开源发现",
        "github-trending": "GitHub 热门",
        "github-trending-weekly": "GitHub 周榜",
        "github-maintained": "优质开源项目",
        "huggingface": "Hugging Face",
        "36kr": "36氪",
        "36kr-flash": "36氪快讯",
        "weibo": "微博",
        "openai": "OpenAI",
        "techcrunch": "TechCrunch",
    ]

    static func label(_ source: String?) -> String {
        guard let source, !source.isEmpty else { return "来源" }
        return labels[source] ?? source
    }

    /// growth window ("day"/"week"/...) → Chinese label.
    static func growthWindowLabel(_ window: String?) -> String {
        switch window {
        case "day", "daily": return "今日"
        case "week", "weekly": return "本周"
        case "month", "monthly": return "本月"
        default: return window.map { "近\($0)" } ?? "近期"
        }
    }
}
