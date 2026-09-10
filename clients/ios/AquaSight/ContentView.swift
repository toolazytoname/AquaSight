import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel
    private let tabs = [("featured", "精选"), ("latest", "最新"), ("digest", "早报"), ("saved", "收藏")]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("AQUASIGHT")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Color(red: 0.13, green: 0.39, blue: 0.28))
                        .tracking(2)
                    Text("鸭先知")
                        .font(.system(size: 22, weight: .semibold))
                }
                Spacer()
                Button("登录") { model.showLogin = true }
                    .frame(minHeight: 44)
                Button("设置") { model.showSettings = true }
                    .frame(minHeight: 44)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)

            TextField("搜索标题或概述", text: $model.query)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
                .frame(minHeight: 44)
                .onSubmit { Task { await model.load() } }

            if !model.notice.isEmpty {
                Text(model.notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
            }

            if let item = model.detail {
                detail(item)
            } else {
                list
            }

            HStack(spacing: 0) {
                ForEach(tabs, id: \.0) { id, label in
                    let current = model.view == id && model.detail == nil
                    Button(label) {
                        model.detail = nil
                        model.view = id
                        Task { await model.load() }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundStyle(current ? Color(red: 0.13, green: 0.39, blue: 0.28) : Color.primary)
                    .fontWeight(current ? .semibold : .regular)
                    .background(current ? Color(red: 0.90, green: 0.94, blue: 0.91) : Color.clear)
                }
            }
            .background(Color(red: 0.97, green: 0.98, blue: 0.97))
        }
        .background(Color(red: 0.96, green: 0.96, blue: 0.95))
        .task { await model.load() }
        .sheet(isPresented: $model.showLogin) { login }
        .sheet(isPresented: $model.showSettings) { settings }
    }

    var list: some View {
        ScrollView {
            if model.items.isEmpty {
                VStack(spacing: 8) {
                    Text(model.empty.split(separator: "，").first.map(String.init) ?? "暂时没有新闻")
                        .font(.headline)
                    Text(model.empty)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 48)
            }
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(model.items.indices, id: \.self) { i in
                    let item = model.items[i]
                    let id = item["id"] as? String ?? ""
                    VStack(alignment: .leading, spacing: 6) {
                        Text(displayTitle(item))
                            .font(.system(size: 17, weight: .semibold))
                        if !overviewText(item).isEmpty {
                            Text(overviewText(item))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                        Button(model.guest.isSaved(id) ? "取消收藏" : "收藏") {
                            model.toggleSave(item)
                        }
                        .frame(minHeight: 44)
                    }
                    .padding(.vertical, 16)
                    .contentShape(Rectangle())
                    .onTapGesture { model.openEvent(id: id) }
                }
            }
            .padding(.horizontal, 20)
        }
    }

    func detail(_ item: [String: Any]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Button("返回") { model.detail = nil }
                    .frame(minHeight: 44)
                Text(displayTitle(item))
                    .font(.system(size: 22, weight: .semibold))
                Text(overviewText(item).isEmpty ? "暂无摘要" : overviewText(item))
                    .font(.body)
                    .foregroundStyle(.secondary)
                let id = item["id"] as? String ?? ""
                Button(model.guest.isSaved(id) ? "取消收藏" : "收藏") {
                    model.toggleSave(item)
                }
                .frame(minHeight: 44)
            }
            .padding(20)
        }
    }

    var login: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("验证码登录。未登录也可阅读，收藏先留在这台设备上。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if !model.notice.isEmpty {
                    Text(model.notice)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                TextField("邮箱", text: $model.email)
                    .textContentType(.username)
                    .frame(minHeight: 44)
                Button("发送验证码") { Task { await model.sendCode() } }
                    .frame(minHeight: 44)
                TextField("验证码", text: $model.code)
                    .textContentType(.oneTimeCode)
                    .frame(minHeight: 44)
                Button("登录") { Task { await model.verify() } }
                    .frame(minHeight: 44)
                Spacer()
            }
            .padding(20)
            .navigationTitle("邮箱登录")
            .toolbar { Button("关闭") { model.showLogin = false } }
        }
    }

    var settings: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("未登录时收藏保存在这台设备上。登录后会合并到账户，删除过的收藏不会复活。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if !model.notice.isEmpty {
                    Text(model.notice)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button("退出当前设备") {
                    Task {
                        await model.api.logout()
                        model.notice = "已退出"
                        model.showSettings = false
                    }
                }
                .frame(minHeight: 44)
                Spacer()
            }
            .padding(20)
            .navigationTitle("设置")
            .toolbar { Button("关闭") { model.showSettings = false } }
        }
    }
}
