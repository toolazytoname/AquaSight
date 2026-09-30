import SwiftUI

struct EventDetailView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var reader: ReaderModel
    @StateObject private var model: DetailModel
    private let eventId: String
    private let fallback: EventItem?

    init(eventId: String, fallback: EventItem?) {
        self.eventId = eventId
        self.fallback = fallback
        _model = StateObject(wrappedValue: DetailModel(api: AppServices.shared.api))
    }

    var body: some View {
        Group {
            switch model.phase {
            case .loading:
                ProgressView("加载中…")
                    .frame(maxWidth: .infinity, minHeight: 240)
            case .failed(let message):
                ErrorStateView(message: message) {
                    Task { await reload() }
                }
            case .loaded, .offlineCopy:
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        detailBody
                    }
                    .padding(20)
                    // Readable measure on iPad; full-bleed on iPhone.
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .background(Color("LaunchBackground"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .overlay(alignment: .bottom) {
            if let notice = app.notice {
                NoticeBar(text: notice) { app.notice = nil }
                    .padding(.bottom, 8)
            }
        }
        .task(id: reader.scopeKey) { await reload() }
    }

    @ViewBuilder
    private var detailBody: some View {
        if let item = model.item {
            Text(item.displayTitle)
                .accessibilityIdentifier("detail-title")
                .font(.system(.title, design: .serif).weight(.semibold)).lineSpacing(5)
                .textSelection(.enabled)

            metaRow(item)

            if case .offlineCopy = model.phase {
                Label("暂未更新，正在展示本机副本", systemImage: "tray.full")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            overviewSection(item)

            if let facts = item.facts, !facts.isEmpty {
                SectionHeader("事实要点")
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "circle.fill")
                                .font(.system(size: 6))
                                .foregroundStyle(Color("AccentColor"))
                                .padding(.top, 6)
                            Text(fact).font(.body).lineSpacing(3)
                        }
                    }
                }
            }

            if let impact = item.impact, !impact.isEmpty {
                SectionHeader("潜在影响")
                Text(impact).font(.subheadline).foregroundStyle(.secondary)
            }

            if let repo = item.githubRepo {
                GitHubRepoSection(repo: repo)
            }

            let links = item.safeLinks
            if !links.isEmpty {
                SectionHeader("来源")
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(links) { link in
                        Link(destination: link.url) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.title)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.primary)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                HStack(spacing: 4) {
                                    Image(systemName: "link")
                                    Text(link.url.host ?? "")
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("打开来源链接 \(link.title)")
                    }
                }
            }
        }
    }

    /// Label AI output honestly: only overviewZh from finished enrichment is an
    /// AI Chinese overview; raw English/queued summaries are source summaries.
    @ViewBuilder
    private func overviewSection(_ item: EventItem) -> some View {
        if let ai = item.aiOverview, item.isAIReady {
            SectionHeader("AI 中文概述")
            Text(ai)
                .font(.body)
                .lineSpacing(5)
                .textSelection(.enabled)
        } else {
            SectionHeader(item.enrichInsufficient == true ? "来源摘要（信息尚待完善）" : "来源摘要")
            if item.overviewFallback.isEmpty {
                Text("暂无摘要。").font(.body).foregroundStyle(.secondary)
            } else {
                Text(item.overviewFallback)
                    .font(.body)
                    .textSelection(.enabled)
            }
        }
    }

    private func metaRow(_ item: EventItem) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text([SourceCatalog.label(item.source),
                  FlexDate.shortDate(item.publishedAt ?? item.occurredAt ?? item.firstSeenAt)]
                .compactMap { $0 }.joined(separator: " · "))
            if item.level == "breaking" { BadgeView(text: "快讯", color: .red) }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                if let item = model.item { app.toggleSave(item) }
            } label: {
                Image(systemName: saved ? "bookmark.fill" : "bookmark")
                    .foregroundStyle(Color("AccentColor"))
            }
            .disabled(model.item == nil)
            .accessibilityLabel(saved ? "取消收藏" : "收藏")
            .accessibilityIdentifier("detail-save")
        }
        ToolbarItem(placement: .topBarTrailing) {
            if let link = model.item?.safeLinks.first {
                ShareLink(item: link.url, subject: Text(model.item?.displayTitle ?? "")) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("分享")
            }
        }
    }

    private var saved: Bool {
        model.item.map { app.isSaved($0.id) } ?? false
    }

    private func reload() async {
        let saved = app.savedItems.first { $0.id == eventId }
        let safeFallback = saved ?? fallback.flatMap { reader.allows($0) ? $0 : nil }
        await model.open(id: eventId, fallback: safeFallback, readerSources: reader.effectiveSources, client: reader.client, allowSaved: saved != nil)
        if model.item != nil { app.markRead(eventId) }
    }
}

struct SectionHeader: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color("AccentColor"))
            .padding(.top, 8)
    }
}

// MARK: - GitHub repo facts
// Field semantics (from collectors): stars/language/license/pushedAt are point
// observations; growth[] is a trending window row (NOT a date); pushedAt is
// repo activity, never a publication date; observedAt is when we saw it.

struct GitHubRepoSection: View {
    let repo: GitHubRepo

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("GitHub 项目")
            stats
            ForEach(Array((repo.growth ?? []).enumerated()), id: \.offset) { _, growth in
                growthRow(growth)
            }
            if let pushed = FlexDate.relative(repo.pushedAt) {
                Label("最近维护：\(pushed)", systemImage: "hammer")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let observed = FlexDate.relative(repo.observedAt) {
                Label("数据观测：\(observed)", systemImage: "eye")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array((repo.signals ?? []).enumerated()), id: \.offset) { _, sig in
                if let text = sig.signal, !text.isEmpty {
                    Text(text.replacingOccurrences(of: " star", with: " 次星标")).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let name = repo.fullName,
               name.split(separator: "/").count == 2,
               name.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "-._/".contains($0)) }),
               let url = URL(string: "https://github.com/\(name)") {
                Link(destination: url) {
                    Label("在 GitHub 打开 \(name)", systemImage: "arrow.up.right.square")
                        .font(.subheadline)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    /// Stars/language/license flow into multiple lines under large type.
    private var stats: some View {
        VStack(alignment: .leading, spacing: 6) { statsContent }
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var statsContent: some View {
        if let stars = repo.stars {
            Label("\(stars.formatted()) 次星标", systemImage: "star.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
        }
        if let lang = repo.language {
            Text("· \(lang)").font(.subheadline).foregroundStyle(.secondary)
        }
        if let license = repo.license, !license.isEmpty {
            Text("· 许可证 \(license)").font(.subheadline).foregroundStyle(.secondary)
        }
        if repo.stars == nil {
            Text("星标数暂无数据").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private func growthRow(_ growth: GitHubRepo.Growth) -> some View {
        let window = SourceCatalog.growthWindowLabel(growth.window)
        return Group {
            if let stars = growth.stars, stars > 0 {
                Label("\(window)新增 \(stars.formatted()) 次星标", systemImage: "chart.line.uptrend.xyaxis")
                    .font(.subheadline)
                    .foregroundStyle(.green)
            } else {
                Label("\(window)进入 GitHub 趋势榜", systemImage: "chart.line.uptrend.xyaxis")
                    .font(.subheadline)
                    .foregroundStyle(.green)
            }
        }
    }
}
