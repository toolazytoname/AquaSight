import SwiftUI

// MARK: - Event row

struct EventRowView: View {
    @EnvironmentObject private var app: AppModel
    let item: EventItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            NavigationLink(value: item.id) {
            VStack(alignment: .leading, spacing: 10) {
                Text([SourceCatalog.label(item.source), FlexDate.relative(item.publishedAt ?? item.observedAt ?? item.firstSeenAt)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if item.level == "breaking" { BadgeView(text: "快讯", color: .red) }
                else if item.githubRepo != nil { BadgeView(text: "开源", color: Color("AccentColor")) }
                Text(item.displayTitle)
                    .font(.system(.headline, design: .serif)).lineSpacing(3)
                    .foregroundStyle(Color.primary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !item.overviewText.isEmpty {
                    Text(item.overviewText)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .lineSpacing(3)
                }
                if let repo = item.githubRepo { RepoChips(repo: repo).font(.caption).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("event-\(item.id)")
            // Dedicated 44pt+ hit target, separate from the row navigation tap.
            Button {
                app.toggleSave(item)
            } label: {
                Image(systemName: app.isSaved(item.id) ? "bookmark.fill" : "bookmark")
                    .font(.title3)
                    .foregroundStyle(app.isSaved(item.id) ? Color("AccentColor") : Color.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(app.isSaved(item.id) ? "取消收藏 \(item.displayTitle)" : "收藏 \(item.displayTitle)")
        }
        .padding(.vertical, 18)
        .contentShape(Rectangle())
        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
        .contextMenu {
            Button {
                app.toggleSave(item)
            } label: {
                Label(app.isSaved(item.id) ? "取消收藏" : "收藏",
                      systemImage: app.isSaved(item.id) ? "bookmark.slash" : "bookmark")
            }
            if let link = item.safeLinks.first {
                ShareLink(item: link.url) {
                    Label("分享", systemImage: "square.and.arrow.up")
                }
            }
        }
    }

    /// Keep source/time and repository facts on separate lines; one Text per
    /// line wraps naturally without compressing individual labels into columns.
    private var metadata: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text([SourceCatalog.label(item.source),
                  FlexDate.relative(item.publishedAt ?? item.observedAt ?? item.firstSeenAt)]
                .compactMap { $0 }.joined(separator: " · "))
            if let repo = item.githubRepo { RepoChips(repo: repo) }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct RepoChips: View {
    let repo: GitHubRepo

    var body: some View {
        Text([repo.stars.map { "★ " + $0.formatted() }, repo.language]
            .compactMap { $0 }.joined(separator: " · "))
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct BadgeView: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }
}

// MARK: - States

struct EmptyStateView: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "water.waves")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .accessibilityElement(children: .combine)
    }
}

struct ErrorStateView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(action: retry) {
                Label("重试", systemImage: "arrow.clockwise")
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.teal.opacity(0.15), in: Capsule())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("重试加载")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

struct WarningBanner: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("重试", action: retry)
                .font(.footnote.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
        }
        .padding(10)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct NoticeBar: View {
    let text: String
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "info.circle.fill").foregroundStyle(Color("AccentColor"))
            Text(text).font(.footnote)
            Spacer()
            Button("知道了", action: dismiss)
                .font(.footnote.weight(.semibold))
                .frame(minWidth: 44, minHeight: 44)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 12)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
