import SwiftUI

struct LoginSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var sentEmail: String?
    @State private var code = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var showPassword = false
    @State private var mode: Mode = .login
    @State private var message: String?
    @State private var hasError = false
    @State private var sendingCode = false
    @State private var verifying = false
    @FocusState private var focus: Field?
    private enum Field { case email, password, code, confirmation }
    private enum Mode { case login, register, reset }
    private var busy: Bool { sendingCode || verifying }
    private var normalizedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    private var emailIsValid: Bool { normalizedEmail.range(of: #"^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"#, options: .regularExpression) != nil }
    private var codeIsValid: Bool { code.count == 6 && code.allSatisfy { "0123456789".contains($0) } }
    private var passwordIsValid: Bool { (12...128).contains(password.unicodeScalars.count) && password.utf8.count <= 512 }
    private var title: String { mode == .login ? "欢迎回来" : (mode == .register ? "开始你的阅读清单" : "重新设置密码") }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    VStack(alignment: .leading, spacing: 14) {
                        Image(systemName: sentEmail == nil ? "bookmark.square" : "envelope.open")
                            .font(.system(size: 32, weight: .light)).foregroundStyle(Color("AccentColor"))
                            .frame(width: 64, height: 64)
                            .background(Color("AccentColor").opacity(0.08), in: RoundedRectangle(cornerRadius: 20))
                        Text(sentEmail == nil ? title : "验证邮箱，设置密码")
                            .font(.system(.title, design: .serif).bold())
                        Text(mode == .login ? "用邮箱和密码登录，让订阅与收藏\n在网页和 App 之间同步。" : "用邮件验证码确认是你本人。设置完成后，使用邮箱和密码登录。")
                            .font(.subheadline).foregroundStyle(.secondary).lineSpacing(5)
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        if let address = sentEmail {
                            Text(address).font(.subheadline.weight(.medium)).textSelection(.enabled)
                            Button("更换邮箱") { sentEmail = nil; clearSecrets(); focus = .email }
                                .font(.subheadline).frame(minHeight: 44).disabled(busy).accessibilityIdentifier("login-change-email")
                            TextField("6 位数字验证码", text: $code)
                                .keyboardType(.numberPad).textContentType(.oneTimeCode)
                                .font(.title3.monospacedDigit()).tracking(4).focused($focus, equals: .code)
                                .onChange(of: code) { _, value in code = String(value.filter { "0123456789".contains($0) }.prefix(6)) }
                                .loginInput().accessibilityIdentifier("login-code").accessibilityLabel("验证码").disabled(busy)
                            passwordInput
                            SecureField("再次输入新密码", text: $confirmation)
                                .textContentType(.newPassword).focused($focus, equals: .confirmation)
                                .loginInput().accessibilityIdentifier("login-confirm-password").disabled(busy)
                            Text("密码需 12–128 个字符，建议使用密码管理器生成。")
                                .font(.caption).foregroundStyle(.secondary)
                            if !confirmation.isEmpty && confirmation != password {
                                Text("两次输入的密码不一致").font(.caption).foregroundStyle(.orange)
                            }
                            primaryButton(mode == .register ? "创建账户并登录" : "设置密码并登录", disabled: !codeIsValid || !passwordIsValid || confirmation != password, action: authenticate)
                            Button(action: sendCode) {
                                Text(app.resendCooldown > 0 ? "\(app.resendCooldown) 秒后可重新发送" : "重新发送验证码")
                                    .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44)
                            }.disabled(app.resendCooldown > 0 || busy).accessibilityIdentifier("login-resend")
                        } else {
                            Text("邮箱地址").font(.subheadline.weight(.medium))
                            TextField("name@example.com", text: $email)
                                .textContentType(.username).keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .focused($focus, equals: .email).submitLabel(.next)
                                .onSubmit { focus = .password }.loginInput()
                                .accessibilityLabel("邮箱地址").accessibilityIdentifier("login-email").disabled(busy)
                            if mode == .login {
                                passwordInput
                                primaryButton("登录", disabled: !emailIsValid || password.isEmpty, action: authenticate)
                                Button("忘记密码 / 首次设置密码") { changeMode(.reset) }
                                    .font(.subheadline).frame(minHeight: 44).disabled(busy).accessibilityIdentifier("login-reset")
                            } else {
                                primaryButton(app.resendCooldown > 0 ? "\(app.resendCooldown) 秒后可发送" : "发送验证码", disabled: !emailIsValid || app.resendCooldown > 0, action: sendCode)
                                    .accessibilityIdentifier("login-send")
                            }
                        }
                        if let message {
                            Label(message, systemImage: hasError ? "exclamationmark.circle" : "checkmark.circle")
                                .font(.footnote).foregroundStyle(hasError ? Color.orange : Color.secondary)
                                .fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("login-message")
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Button(mode == .login ? "还没有账户？注册" : "已有密码？返回登录") { changeMode(mode == .login ? .register : .login) }
                            .font(.subheadline.weight(.medium)).frame(minHeight: 44).disabled(busy).accessibilityIdentifier("login-mode")
                        Text("不登录也能阅读和收藏。你的本机内容会保留，登录不会自动开启推送。")
                            .font(.footnote).foregroundStyle(.secondary).lineSpacing(3)
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 20) { helpLinks }
                            VStack(alignment: .leading) { helpLinks }
                        }
                    }
                }.padding(24).frame(maxWidth: 520).frame(maxWidth: .infinity)
            }
            .background(Color("LaunchBackground")).scrollDismissesKeyboard(.interactively)
            .navigationTitle(mode == .login ? "账户登录" : (mode == .register ? "注册账户" : "设置密码"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { clearSecrets(); dismiss() }.disabled(busy) } }
            .interactiveDismissDisabled(busy)
        }.tint(Color("AccentColor"))
        .onDisappear { clearSecrets() }
    }
    private var passwordInput: some View {
        HStack {
            Group {
                if showPassword { TextField(mode == .login ? "密码" : "新密码", text: $password) }
                else { SecureField(mode == .login ? "密码" : "新密码", text: $password) }
            }
            .textContentType(mode == .login ? .password : .newPassword)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .focused($focus, equals: .password).submitLabel(.go)
            .onSubmit { if mode == .login && emailIsValid && !password.isEmpty { authenticate() } }
            .accessibilityIdentifier("login-password").disabled(busy)
            Button { showPassword.toggle() } label: { Image(systemName: showPassword ? "eye.slash" : "eye").frame(width: 44, height: 44) }
                .accessibilityLabel(showPassword ? "隐藏密码" : "显示密码").disabled(busy)
        }.padding(.leading, 18).padding(.trailing, 6).padding(.vertical, 4)
            .background(.background, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.primary.opacity(0.12)))
    }
    private func primaryButton(_ title: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { HStack { if busy { ProgressView() }; Text(busy ? "请稍候…" : title) }.font(.headline).frame(maxWidth: .infinity, minHeight: 44) }
            .buttonStyle(.borderedProminent).controlSize(.large).disabled(disabled || busy).accessibilityIdentifier("login-submit")
    }
    @ViewBuilder private var helpLinks: some View {
        Link("隐私政策", destination: URL(string: "https://quack.weichao.ren/privacy.html")!).frame(minHeight: 44)
        Link("登录遇到问题？", destination: URL(string: "https://quack.weichao.ren/support.html")!).frame(minHeight: 44)
    }
    private func clearSecrets() { code = ""; password = ""; confirmation = ""; showPassword = false; message = nil }
    private func changeMode(_ next: Mode) { mode = next; sentEmail = nil; clearSecrets(); focus = nil }
    private func sendCode() {
        guard !busy, app.resendCooldown == 0 else { return }
        let address = sentEmail ?? normalizedEmail
        sendingCode = true; message = nil
        Task {
            let result = await app.requestCode(email: address)
            sendingCode = false; message = result.message; hasError = !result.accepted
            if result.accepted { sentEmail = address; code = ""; focus = .code }
        }
    }
    private func authenticate() {
        guard !busy else { return }
        verifying = true; message = nil; focus = nil
        let address = sentEmail ?? normalizedEmail
        Task {
            let error = mode == .login ? await app.login(email: address, password: password) : await app.resetPassword(email: address, code: code, password: password)
            if let error { message = error; hasError = true; verifying = false }
            else { clearSecrets(); dismiss() }
        }
    }
}
private extension View {
    func loginInput() -> some View {
        padding(18).background(.background, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.primary.opacity(0.12)))
    }
}
