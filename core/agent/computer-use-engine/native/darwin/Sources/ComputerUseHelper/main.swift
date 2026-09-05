import AppKit
import ApplicationServices
import AXorcist
import CoreGraphics
import Foundation
import ScreenCaptureKit

struct FrameDTO: Codable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

struct ElementDTO: Codable {
    var ref: Int
    var role: String
    var title: String?
    var value: String?
    var description: String?
    var enabled: Bool
    var focused: Bool?
    var frame: FrameDTO?
    var actions: [String]?
}

struct LocatorDTO: Codable {
    var ref: Int
    var role: String
    var title: String?
    var value: String?
    var description: String?
    var frame: FrameDTO?
}

struct PermsDTO: Codable {
    var ax: Bool
    var screen: Bool
    var input: Bool
    var axHint: String?
    var screenHint: String?
}

struct AppDTO: Codable {
    var name: String
    var bundleId: String?
    var pid: Int
    var frontmost: Bool?
}

struct WindowDTO: Codable {
    var title: String
    var app: String?
    var pid: Int?
    var windowId: Int?
    var frame: FrameDTO?
}

struct Request: Codable {
    var op: String
    var mode: String? = nil
    var app: String? = nil
    var window: String? = nil
    var pid: Int32? = nil
    var includeImage: Bool? = nil
    var snapshotId: String? = nil
    var ref: Int? = nil
    var locator: LocatorDTO? = nil
    var x: Double? = nil
    var y: Double? = nil
    var kind: String? = nil
    var text: String? = nil
    var keys: [String]? = nil
    var amount: Double? = nil
    var durationMs: Int? = nil
    var path: String? = nil
}

struct Response: Codable {
    var ok: Bool
    var op: String? = nil
    var route: String? = nil
    var snapshotId: String? = nil
    var message: String? = nil
    var error: String? = nil
    var fallbackReason: String? = nil
    var permissions: PermsDTO? = nil
    var apps: [AppDTO]? = nil
    var windows: [WindowDTO]? = nil
    var elements: [ElementDTO]? = nil
    var imageBase64: String? = nil
    var frames: [String]? = nil
    var pid: Int32? = nil
    var app: String? = nil
    var window: String? = nil
}

let axHint = "打开 系统设置 → 隐私与安全性 → 辅助功能，勾选当前进程（maou / maou-app / computer-use-helper 的父进程）。"
let screenHint = "打开 系统设置 → 隐私与安全性 → 屏幕录制，勾选当前进程后重试。"

let interactiveRoles: Set<String> = [
    "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton",
    "AXMenuItem", "AXTextField", "AXTextArea", "AXComboBox", "AXSlider",
    "AXIncrementor", "AXLink", "AXTab", "AXDisclosureTriangle", "AXSwitch",
    "AXColorWell", "AXHandle", "AXSearchField", "AXScrollBar",
]

let treeDepth = 10
let treeCap = 80
let treeBranch = 40

let appAliasGroups: [[String]] = [
    ["safari", "safari浏览器", "com.apple.safari"],
    ["finder", "访达", "com.apple.finder"],
    ["textedit", "文本编辑", "com.apple.textedit"],
    ["calculator", "计算器", "com.apple.calculator"],
    ["terminal", "终端", "com.apple.terminal"],
    ["notes", "备忘录", "com.apple.notes"],
    ["system settings", "系统设置", "system preferences", "com.apple.systempreferences"],
    ["steam", "com.valvesoftware.steam"],
]

let buttonAliasGroups: [[String]] = [
    ["+", "加", "add", "plus"],
    ["-", "减", "subtract", "minus"],
    ["*", "×", "乘", "multiply"],
    ["/", "÷", "除", "divide"],
    ["=", "等于", "equals", "equal"],
]

func namesMatch(_ a: String, _ b: String) -> Bool {
    let x = a.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let y = b.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if x.isEmpty || y.isEmpty { return false }
    if x == y { return true }
    if x.contains(y) || y.contains(x) { return true }
    for group in appAliasGroups {
        let hitX = group.contains(where: { x == $0 || x.contains($0) || $0.contains(x) })
        let hitY = group.contains(where: { y == $0 || y.contains($0) || $0.contains(y) })
        if hitX && hitY { return true }
    }
    return false
}

func labelTokens(_ parts: [String?]) -> [String] {
    parts.compactMap { raw -> String? in
        guard let raw else { return nil }
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}

func labelsMatch(_ a: String, _ b: String) -> Bool {
    let x = a.lowercased()
    let y = b.lowercased()
    if x == y { return true }
    for group in buttonAliasGroups {
        if group.contains(x) && group.contains(y) { return true }
    }
    return false
}

func isHelperish(_ app: NSRunningApplication) -> Bool {
    let bid = (app.bundleIdentifier ?? "").lowercased()
    let name = (app.localizedName ?? "").lowercased()
    if bid.contains(".helper") || bid.contains("safariform") { return true }
    if bid.contains("findersync") || bid.hasSuffix(".webkit") { return true }
    if name.contains("helper") || name.contains("networking") || name.contains("自动填充") { return true }
    return false
}

func bundleAlias(_ query: String) -> String? {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let map: [(String, String)] = [
        ("safari", "com.apple.Safari"),
        ("safari浏览器", "com.apple.Safari"),
        ("finder", "com.apple.finder"),
        ("访达", "com.apple.finder"),
        ("textedit", "com.apple.TextEdit"),
        ("文本编辑", "com.apple.TextEdit"),
        ("calculator", "com.apple.calculator"),
        ("计算器", "com.apple.calculator"),
        ("terminal", "com.apple.Terminal"),
        ("终端", "com.apple.Terminal"),
        ("notes", "com.apple.Notes"),
        ("备忘录", "com.apple.Notes"),
        ("steam", "com.valvesoftware.steam"),
    ]
    for (key, bid) in map where namesMatch(q, key) {
        return bid
    }
    return nil
}

func findAppURL(_ query: String) -> URL? {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if let bid = bundleAlias(q), let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bid) {
        return url
    }
    if q.contains("."), let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: q) {
        return url
    }
    let dirs = ["/System/Applications", "/System/Applications/Utilities", "/Applications"]
    for dir in dirs {
        let direct = URL(fileURLWithPath: dir).appendingPathComponent("\(q).app")
        if FileManager.default.fileExists(atPath: direct.path) { return direct }
        guard let items = try? FileManager.default.contentsOfDirectory(atPath: dir) else { continue }
        for item in items where item.hasSuffix(".app") {
            let name = (item as NSString).deletingPathExtension
            if namesMatch(name, q) {
                return URL(fileURLWithPath: dir).appendingPathComponent(item)
            }
        }
    }
    return nil
}

@main
enum ComputerUseHelper {
    static func main() async {
        await MainActor.run { ensureAppKit() }
        do {
            let req = try readRequest()
            let res = await handle(req)
            write(res)
        } catch {
            write(Response(ok: false, error: error.localizedDescription))
        }
    }
}

@MainActor
func ensureAppKit() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
}

func readRequest() throws -> Request {
    let data: Data
    if CommandLine.arguments.contains("--json"), let stdin = readStdin() {
        data = stdin
    } else if CommandLine.arguments.count > 1, CommandLine.arguments[1] != "--json" {
        data = Data(CommandLine.arguments[1].utf8)
    } else if let stdin = readStdin() {
        data = stdin
    } else {
        return Request(op: "ping")
    }
    return try JSONDecoder().decode(Request.self, from: data)
}

func readStdin() -> Data? {
    let handle = FileHandle.standardInput
    let data = handle.availableData
    return data.isEmpty ? nil : data
}

func write(_ res: Response) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    guard let data = try? enc.encode(res), let line = String(data: data, encoding: .utf8) else {
        FileHandle.standardOutput.write(Data("{\"ok\":false,\"error\":\"encode\"}\n".utf8))
        return
    }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

@MainActor
func handle(_ req: Request) async -> Response {
    let op = req.op.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if op == "ping" {
        return Response(ok: true, op: "ping", message: "computer-use-helper")
    }
    switch op {
    case "permissions":
        return Response(ok: true, op: op, permissions: currentPerms())
    case "apps":
        return Response(ok: true, op: op, apps: listApps())
    case "windows":
        return Response(ok: true, op: op, windows: listWindows(app: req.app, pid: req.pid))
    case "snapshot":
        return await snapshot(req)
    case "act":
        return await act(req)
    case "observe":
        return await observe(req)
    case "activate", "launch":
        return await activateApp(req)
    default:
        return Response(ok: false, op: op, error: "未知操作: \(op)")
    }
}

@MainActor
func currentPerms() -> PermsDTO {
    let ax = AXPermissionHelpers.hasAccessibilityPermissions()
    let screen = CGPreflightScreenCaptureAccess()
    return PermsDTO(
        ax: ax,
        screen: screen,
        input: ax,
        axHint: ax ? nil : axHint,
        screenHint: screen ? nil : screenHint
    )
}

@MainActor
func listApps() -> [AppDTO] {
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
    return RunningApplicationHelper.allApplications().compactMap { app in
        guard let name = app.localizedName, !name.isEmpty else { return nil }
        return AppDTO(
            name: name,
            bundleId: app.bundleIdentifier,
            pid: Int(app.processIdentifier),
            frontmost: app.processIdentifier == front
        )
    }
}

@MainActor
func listWindows(app: String?, pid: Int32?) -> [WindowDTO] {
    let fromCG = listWindowsCG(app: app, pid: pid)
    if fromCG.contains(where: { !$0.title.isEmpty }) { return fromCG }
    let fromAX = listWindowsAX(app: app, pid: pid)
    if !fromAX.isEmpty { return fromAX }
    return fromCG
}

func listWindowsCG(app: String?, pid: Int32?) -> [WindowDTO] {
    let onScreen = listWindowsCG(app: app, pid: pid, onScreenOnly: true)
    if !onScreen.isEmpty { return onScreen }
    return listWindowsCG(app: app, pid: pid, onScreenOnly: false)
}

func listWindowsCG(app: String?, pid: Int32?, onScreenOnly: Bool) -> [WindowDTO] {
    var opts: CGWindowListOption = [.excludeDesktopElements]
    if onScreenOnly { opts.insert(.optionOnScreenOnly) }
    guard let raw = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    return raw.compactMap { info -> WindowDTO? in
        let owner = info[kCGWindowOwnerName as String] as? String ?? ""
        let ownerPid = info[kCGWindowOwnerPID as String] as? Int32
        if let pid, ownerPid != pid {
            let hint = app ?? NSRunningApplication(processIdentifier: pid)?.localizedName
            if let hint, namesMatch(owner, hint) {
                // 同名应用的其他进程窗口
            } else {
                return nil
            }
        }
        if let app, !namesMatch(owner, app) { return nil }
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        if layer > 25 { return nil }
        let title = info[kCGWindowName as String] as? String ?? ""
        let bounds = info[kCGWindowBounds as String] as? [String: Double]
        let frame = bounds.flatMap { b -> FrameDTO? in
            guard let x = b["X"], let y = b["Y"], let w = b["Width"], let h = b["Height"] else { return nil }
            return FrameDTO(x: x, y: y, w: w, h: h)
        }
        return WindowDTO(
            title: title,
            app: owner,
            pid: ownerPid.map(Int.init),
            windowId: info[kCGWindowNumber as String] as? Int,
            frame: frame
        )
    }
}

@MainActor
func listWindowsAX(app: String?, pid: Int32?) -> [WindowDTO] {
    guard let running = resolveApp(app: app, pid: pid) else { return [] }
    guard let root = Element.application(for: running.processIdentifier) else { return [] }
    let wins = root.windows() ?? root.children()?.filter { $0.role() == "AXWindow" } ?? []
    return wins.map { win in
        let frame = win.frame().map { FrameDTO(x: $0.minX, y: $0.minY, w: $0.width, h: $0.height) }
        return WindowDTO(
            title: stringify(win.title()) ?? "",
            app: running.localizedName,
            pid: Int(running.processIdentifier),
            windowId: nil,
            frame: frame
        )
    }
}

@MainActor
func resolveApp(app: String?, pid: Int32?) -> NSRunningApplication? {
    if let pid, let found = NSRunningApplication(processIdentifier: pid) { return found }
    if let app, !app.isEmpty {
        let all = NSWorkspace.shared.runningApplications
        let primary = all.filter { $0.activationPolicy == .regular && !isHelperish($0) }
        let rest = all.filter { !isHelperish($0) }
        if let hit = pickRunning(primary, query: app, exact: true)
            ?? pickRunning(primary, query: app, exact: false)
            ?? pickRunning(rest, query: app, exact: true)
            ?? pickRunning(rest, query: app, exact: false) {
            return hit
        }
    }
    return NSWorkspace.shared.frontmostApplication
}

func pickRunning(_ list: [NSRunningApplication], query: String, exact: Bool) -> NSRunningApplication? {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return list.first { running in
        let name = running.localizedName ?? ""
        let bid = running.bundleIdentifier ?? ""
        if exact {
            return name.caseInsensitiveCompare(q) == .orderedSame
                || bid.caseInsensitiveCompare(q) == .orderedSame
        }
        return namesMatch(name, q) || namesMatch(bid, q)
    }
}

func stringify(_ value: Any?) -> String? {
    guard let value else { return nil }
    if let s = value as? String {
        return clipText(s)
    }
    if let n = value as? NSNumber { return n.stringValue }
    if let a = value as? NSAttributedString {
        return clipText(a.string)
    }
    if let arr = value as? [Any] {
        let joined = arr.compactMap(stringify).joined(separator: " ")
        return clipText(joined)
    }
    return nil
}

func stripBidi(_ s: String) -> String {
    let marks = ["\u{200E}", "\u{200F}", "\u{202A}", "\u{202B}", "\u{202C}", "\u{202D}", "\u{202E}"]
    var out = s
    for m in marks {
        out = out.replacingOccurrences(of: m, with: "")
    }
    return out
}

func clipText(_ s: String, max: Int = 4000) -> String? {
    let t = stripBidi(s).trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return nil }
    if t.count <= max { return t }
    return String(t.suffix(max))
}

@MainActor
func readElementText(_ el: Element) -> String? {
    if let v = stringify(el.value()) { return v }
    if let v = stringify(el.stringValue()) { return v }
    let role = el.role() ?? ""
    let isText = role == "AXTextArea" || role == "AXTextField" || role == "AXComboBox"
        || role == "AXSearchField" || role == "AXStaticText"
    if isText, let n = el.numberOfCharacters(), n > 0 {
        let start = max(0, n - 4000)
        let range = CFRange(location: start, length: n - start)
        if let s = el.string(forRange: range) { return clipText(s) }
        if let a = el.attributedString(forRange: range) { return clipText(a.string) }
    }
    if let v = stringify(el.title()) { return v }
    if let v = stringify(el.descriptionText()) { return v }
    if let v = stringify(el.label()) { return v }
    return nil
}

func runAppleScript(_ source: String) -> String? {
    var err: NSDictionary?
    guard let script = NSAppleScript(source: source) else { return nil }
    let result = script.executeAndReturnError(&err)
    return clipText(result.stringValue ?? "")
}

@MainActor
func attachAppText(running: NSRunningApplication, elements: inout [ElementDTO]) {
    let bid = (running.bundleIdentifier ?? "").lowercased()
    var text: String?
    if bid == "com.apple.terminal" {
        text = runAppleScript("tell application \"Terminal\" to get history of selected tab of front window")
            ?? runAppleScript("tell application \"Terminal\" to get contents of selected tab of front window")
    }
    guard let text, !text.isEmpty else { return }
    if elements.contains(where: { ($0.value ?? "").contains(String(text.suffix(24))) }) { return }
    elements.append(ElementDTO(
        ref: elements.count + 1,
        role: "AXTextArea",
        title: "history",
        value: text,
        description: nil,
        enabled: true,
        focused: nil,
        frame: nil,
        actions: ["AXSetValue"]
    ))
}

func contentPoint(running: NSRunningApplication, dto: ElementDTO?) -> CGPoint? {
    if let f = dto?.frame, f.w >= 80, f.h >= 40 {
        return CGPoint(x: f.x + f.w / 2, y: f.y + f.h / 2)
    }
    if let win = listWindowsCG(app: nil, pid: running.processIdentifier).first(where: { ($0.frame?.w ?? 0) > 200 }),
       let f = win.frame {
        return CGPoint(x: f.x + f.w / 2, y: f.y + f.h * 0.62)
    }
    if let f = dto?.frame {
        return CGPoint(x: f.x + f.w / 2, y: f.y + f.h / 2)
    }
    return nil
}

func isInteractive(role: String, actions: [String]) -> Bool {
    if interactiveRoles.contains(role) { return true }
    return actions.contains { $0.range(of: "press|setvalue|showmenu|pick", options: .regularExpression) != nil }
}

func shouldCollect(role: String, actions: [String], title: String?, value: String?, description: String?) -> Bool {
    if role == "AXApplication" || role == "AXWindow" { return false }
    if isInteractive(role: role, actions: actions) { return true }
    if role == "AXStaticText" {
        let t = [title, value, description].compactMap { $0 }.joined()
        return !t.isEmpty && t.count <= 24
    }
    return false
}

func decorateLabels(title: String?, description: String?) -> (String?, String?) {
    var desc = description
    let keys = labelTokens([title, description])
    for key in keys {
        for group in buttonAliasGroups where group.contains(key.lowercased()) {
            if let symbol = group.first, desc == nil || desc?.isEmpty == true {
                desc = symbol
            }
        }
    }
    return (title, desc)
}

@MainActor
func collectPairs(root: Element) -> [(ElementDTO, Element)] {
    var out: [(ElementDTO, Element)] = []
    var seen = Set<Element>()
    var queue: [(Element, Int)] = [(root, 0)]
    while let (el, depth) = queue.first {
        queue.removeFirst()
        if !seen.insert(el).inserted { continue }
        if depth > treeDepth { continue }
        let role = el.role() ?? "AXUnknown"
        let known = interactiveRoles.contains(role)
        let actions = known ? [] : (el.supportedActions() ?? []).filter { $0.hasPrefix("AX") }
        let title = stringify(el.title()) ?? stringify(el.label())
        let description = stringify(el.descriptionText())
        let isText = role == "AXTextArea" || role == "AXTextField" || role == "AXComboBox"
            || role == "AXSearchField" || role == "AXStaticText"
        let value = isText ? readElementText(el) : stringify(el.value())
        if shouldCollect(role: role, actions: actions, title: title, value: value, description: description) {
            let frame = el.frame().map { FrameDTO(x: $0.minX, y: $0.minY, w: $0.width, h: $0.height) }
            let collapsed = frame.map { $0.w < 2 || $0.h < 2 } ?? false
            if !collapsed {
                let labels = decorateLabels(title: title, description: description)
                let dto = ElementDTO(
                    ref: out.count + 1,
                    role: role,
                    title: labels.0,
                    value: value,
                    description: labels.1,
                    enabled: el.isEnabled() ?? true,
                    focused: el.isFocused(),
                    frame: frame,
                    actions: actions.isEmpty ? nil : actions
                )
                out.append((dto, el))
                if out.count >= treeCap { break }
            }
        }
        if let kids = el.children(strict: true) {
            for kid in kids.prefix(treeBranch) {
                queue.append((kid, depth + 1))
            }
        }
    }
    return out
}

@MainActor
func collectElements(root: Element) -> [ElementDTO] {
    collectPairs(root: root).map { $0.0 }
}

@MainActor
func snapshot(_ req: Request) async -> Response {
    let mode = (req.mode ?? "auto").lowercased()
    let perms = currentPerms()
    guard let running = resolveApp(app: req.app, pid: req.pid) else {
        return Response(ok: false, op: "snapshot", error: "找不到应用", permissions: perms)
    }
    activateRunning(running)
    var elements: [ElementDTO] = []
    if perms.ax, let root = Element.application(for: running.processIdentifier) {
        elements = collectElements(root: root)
    }
    attachAppText(running: running, elements: &elements)
    let axUsable = !elements.isEmpty
    let (route, reason, error) = decideRoute(
        mode: mode,
        axTrusted: perms.ax,
        axUsable: axUsable,
        screenAllowed: perms.screen
    )
    if let error {
        return Response(ok: false, op: "snapshot", error: error, permissions: perms)
    }
    let wantImage = req.includeImage == true || route == "pixels"
    var image: String?
    if wantImage {
        if !perms.screen {
            if route == "pixels" {
                return Response(ok: false, op: "snapshot", error: "需要屏幕录制权限才能走像素降级。\(screenHint)", permissions: perms)
            }
        } else {
            image = await capturePNG(app: running, windowTitle: req.window)
        }
    }
    return Response(
        ok: true,
        op: "snapshot",
        route: route,
        snapshotId: newSnapshotId(),
        fallbackReason: reason,
        permissions: perms,
        elements: route == "ax" ? elements : (elements.isEmpty ? [] : elements),
        imageBase64: image,
        pid: running.processIdentifier,
        app: running.localizedName,
        window: req.window
    )
}

func decideRoute(mode: String, axTrusted: Bool, axUsable: Bool, screenAllowed: Bool) -> (String?, String?, String?) {
    if mode == "ax" {
        if !axTrusted { return (nil, nil, "ax 模式需要辅助功能权限，且不允许降级到像素。") }
        if !axUsable { return (nil, nil, "ax 模式未读到可交互控件，且不允许降级到像素。") }
        return ("ax", nil, nil)
    }
    if mode == "pixels" {
        if !screenAllowed { return (nil, nil, "pixels 模式需要屏幕录制权限。") }
        return ("pixels", nil, nil)
    }
    if axTrusted && axUsable { return ("ax", nil, nil) }
    if screenAllowed {
        let reason = axTrusted ? "控件树为空或不可用，降级到截图/坐标。" : "辅助功能未授权，降级到截图/坐标。"
        return ("pixels", reason, nil)
    }
    if !axTrusted && !screenAllowed {
        return (nil, nil, "辅助功能与屏幕录制都未授权，无法观察桌面。")
    }
    return (nil, nil, "auto 模式无法使用控件树，且没有屏幕录制权限可降级。")
}

func newSnapshotId() -> String {
    "cu1_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
}

@MainActor
func findTarget(req: Request, running: NSRunningApplication) -> (ElementDTO?, Element?) {
    guard let root = Element.application(for: running.processIdentifier) else { return (nil, nil) }
    let pairs = collectPairs(root: root)
    if let loc = req.locator, let hit = pairs.first(where: { dtoMatchesLocator($0.0, loc) }) {
        return hit
    }
    if let ref = req.ref, let hit = pairs.first(where: { $0.0.ref == ref }) {
        return hit
    }
    return (nil, nil)
}

func dtoMatchesLocator(_ dto: ElementDTO, _ loc: LocatorDTO) -> Bool {
    if dto.role != loc.role { return false }
    let a = labelTokens([dto.title, dto.value, dto.description])
    let b = labelTokens([loc.title, loc.value, loc.description])
    if a.isEmpty && b.isEmpty { return true }
    for x in a {
        for y in b where labelsMatch(x, y) {
            return true
        }
    }
    return false
}

@MainActor
func activateRunning(_ running: NSRunningApplication) {
    running.activate(from: NSRunningApplication.current)
    _ = running.activate(options: [.activateAllWindows])
    usleep(150_000)
}

@MainActor
func activateApp(_ req: Request) async -> Response {
    if let running = resolveApp(app: req.app, pid: req.pid), req.app != nil || req.pid != nil {
        let matched = req.pid != nil
            || namesMatch(running.localizedName ?? "", req.app ?? "")
            || (running.bundleIdentifier?.caseInsensitiveCompare(req.app ?? "") == .orderedSame)
        if matched {
            activateRunning(running)
            return Response(
                ok: true,
                op: "activate",
                message: "activated \(running.localizedName ?? "")",
                pid: running.processIdentifier,
                app: running.localizedName
            )
        }
    }
    guard let query = req.app, let url = findAppURL(query) else {
        return Response(ok: false, op: "activate", error: "找不到应用")
    }
    do {
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        let running = try await NSWorkspace.shared.openApplication(at: url, configuration: cfg)
        return Response(
            ok: true,
            op: "activate",
            message: "launched \(running.localizedName ?? query)",
            pid: running.processIdentifier,
            app: running.localizedName
        )
    } catch {
        return Response(ok: false, op: "activate", error: error.localizedDescription)
    }
}

@MainActor
func act(_ req: Request) async -> Response {
    let mode = (req.mode ?? "auto").lowercased()
    let perms = currentPerms()
    let kind = (req.kind ?? "click").lowercased()
    guard let running = resolveApp(app: req.app, pid: req.pid) else {
        return Response(ok: false, op: "act", error: "找不到应用", permissions: perms)
    }
    activateRunning(running)
    var used = "ax"
    var message = ""
    do {
        if kind == "hotkey" {
            let keys = req.keys ?? []
            if keys.isEmpty { return Response(ok: false, op: "act", error: "hotkey 需要 keys") }
            try InputDriver.hotkey(keys: keys)
            used = "pixels"
            message = "hotkey \(keys.joined(separator: "+"))"
        } else if kind == "press", req.ref == nil, req.locator == nil {
            let key = req.text ?? req.keys?.first ?? "return"
            if let special = SpecialKey(rawValue: key.lowercased()) {
                try InputDriver.tapKey(special)
            } else {
                try InputDriver.type(key)
            }
            used = "pixels"
            message = "press \(key)"
        } else {
            let (dto, el) = findTarget(req: req, running: running)
            let point: CGPoint? = {
                if let x = req.x, let y = req.y { return CGPoint(x: x, y: y) }
                if let f = dto?.frame { return CGPoint(x: f.x + f.w / 2, y: f.y + f.h / 2) }
                return nil
            }()
            if kind == "type" || kind == "set-value" || kind == "set_value" {
                let text = req.text ?? ""
                var typed = false
                if mode != "pixels", let el {
                    if let _ = try? el.setValue(text) {
                        let now = readElementText(el) ?? stringify(el.value()) ?? ""
                        if text.isEmpty || now.contains(text) {
                            typed = true
                            used = "ax"
                            message = "AXSetValue"
                        }
                    }
                    if !typed, el.press() {
                        try InputDriver.type(text, delayPerCharacter: 0.015)
                        typed = true
                        used = "ax"
                        message = "AXPress+type"
                    }
                }
                if !typed {
                    if mode == "ax" { return Response(ok: false, op: "act", error: "ax 模式无法写入该控件。") }
                    let dest = contentPoint(running: running, dto: dto) ?? point
                    if let dest { try InputDriver.click(at: dest) }
                    usleep(80_000)
                    try InputDriver.type(text, delayPerCharacter: 0.015)
                    usleep(80_000)
                    used = "pixels"
                    message = "CGEvent type"
                }
            } else if kind == "scroll" {
                let amount = req.amount ?? 3
                if mode != "pixels", let el, el.press() {
                    try InputDriver.scroll(deltaY: amount, at: point)
                    used = "ax"
                    message = "scroll"
                } else {
                    if mode == "ax" { return Response(ok: false, op: "act", error: "ax 模式无法滚动。") }
                    try InputDriver.scroll(deltaY: amount, at: point)
                    used = "pixels"
                    message = "CGEvent scroll"
                }
            } else {
                var pressed = false
                if mode != "pixels", let el {
                    pressed = el.press()
                    if pressed {
                        used = "ax"
                        message = "AXPress"
                    }
                }
                if !pressed {
                    if mode == "ax" { return Response(ok: false, op: "act", error: "AXPress 失败，ax 模式不降级。") }
                    guard let point else { return Response(ok: false, op: "act", error: "没有可点的控件或坐标。先 snapshot。") }
                    try InputDriver.click(at: point)
                    used = "pixels"
                    message = "CGEvent click"
                }
            }
        }
    } catch {
        return Response(ok: false, op: "act", error: error.localizedDescription, permissions: perms)
    }
    return Response(
        ok: true,
        op: "act",
        route: used,
        snapshotId: req.snapshotId,
        message: message,
        permissions: perms,
        pid: running.processIdentifier,
        app: running.localizedName
    )
}

@MainActor
func observe(_ req: Request) async -> Response {
    let perms = currentPerms()
    if !perms.screen {
        return Response(ok: false, op: "observe", error: "需要屏幕录制权限。\(screenHint)", permissions: perms)
    }
    let kind = (req.kind ?? "screenshot").lowercased()
    let running = resolveApp(app: req.app, pid: req.pid)
    if kind == "record" {
        let ms = max(400, req.durationMs ?? 2000)
        let steps = 5
        let gap = UInt32((ms / steps) * 1000)
        var frames: [String] = []
        for i in 0..<steps {
            if let png = await capturePNG(app: running, windowTitle: req.window) {
                frames.append(png)
            }
            if i + 1 < steps { usleep(gap) }
        }
        if let path = req.path, let last = frames.last, let data = Data(base64Encoded: last) {
            try? data.write(to: URL(fileURLWithPath: path))
        }
        return Response(
            ok: !frames.isEmpty,
            op: "observe",
            route: "pixels",
            message: "record \(frames.count) frames / \(ms)ms",
            permissions: perms,
            imageBase64: frames.last,
            frames: frames,
            pid: running?.processIdentifier,
            app: running?.localizedName
        )
    }
    guard let png = await capturePNG(app: running, windowTitle: req.window) else {
        return Response(ok: false, op: "observe", error: "截图失败", permissions: perms)
    }
    if let path = req.path, let data = Data(base64Encoded: png) {
        try? data.write(to: URL(fileURLWithPath: path))
    }
    return Response(
        ok: true,
        op: "observe",
        route: "pixels",
        message: "screenshot",
        permissions: perms,
        imageBase64: png,
        pid: running?.processIdentifier,
        app: running?.localizedName
    )
}

@MainActor
func capturePNG(app: NSRunningApplication?, windowTitle: String?) async -> String? {
    do {
        let image = try await captureCGImage(pid: app?.processIdentifier, windowTitle: windowTitle)
        return encodePNG(image)
    } catch {
        return nil
    }
}

@MainActor
func captureCGImage(pid: pid_t?, windowTitle: String?) async throws -> CGImage {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    if let pid {
        if let win = content.windows.first(where: { window in
            window.owningApplication?.processID == pid
                && (windowTitle == nil || windowTitle?.isEmpty == true || (window.title?.localizedCaseInsensitiveContains(windowTitle!) ?? false))
        }) {
            let filter = SCContentFilter(desktopIndependentWindow: win)
            let cfg = SCStreamConfiguration()
            cfg.width = max(2, Int(win.frame.width))
            cfg.height = max(2, Int(win.frame.height))
            cfg.showsCursor = false
            return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
        }
    }
    guard let display = content.displays.first else {
        throw NSError(domain: "computer-use", code: 1, userInfo: [NSLocalizedDescriptionKey: "没有可截的屏幕"])
    }
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let cfg = SCStreamConfiguration()
    cfg.width = display.width
    cfg.height = display.height
    cfg.showsCursor = false
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
}

func encodePNG(_ image: CGImage, maxWidth: Int = 1280) -> String? {
    var cg = image
    if image.width > maxWidth {
        let scale = Double(maxWidth) / Double(image.width)
        let h = Int(Double(image.height) * scale)
        let ctx = CGContext(
            data: nil,
            width: maxWidth,
            height: max(1, h),
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
        if let ctx {
            ctx.interpolationQuality = .medium
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: maxWidth, height: max(1, h)))
            if let scaled = ctx.makeImage() { cg = scaled }
        }
    }
    let rep = NSBitmapImageRep(cgImage: cg)
    guard let data = rep.representation(using: .png, properties: [:]) else { return nil }
    return data.base64EncodedString()
}
