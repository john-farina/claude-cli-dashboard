import Cocoa
import WebKit
import UserNotifications

// MARK: - Hover Button

class HoverButton: NSButton {
    private var trackingArea: NSTrackingArea?
    private var isHovered = false
    private var isPressed = false

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let existing = trackingArea { removeTrackingArea(existing) }
        trackingArea = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(trackingArea!)
    }

    override func mouseEntered(with event: NSEvent) {
        isHovered = true
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        isHovered = false
        isPressed = false
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        isPressed = true
        needsDisplay = true
        super.mouseDown(with: event)
        isPressed = false
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        if isEnabled && (isHovered || isPressed) {
            let alpha: CGFloat = isPressed ? 0.2 : 0.1
            let bg = NSColor.white.withAlphaComponent(alpha)
            bg.setFill()
            let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), xRadius: 6, yRadius: 6)
            path.fill()
        }
        super.draw(dirtyRect)
    }

    override var isEnabled: Bool {
        didSet {
            alphaValue = isEnabled ? 1.0 : 0.35
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate, UNUserNotificationCenterDelegate {
    var window: NSWindow!
    var containerView: NSView!
    var webView: WKWebView!
    var popoutWindows: [NSWindow] = []

    // In-app browser overlay
    var browserOverlay: NSView?
    var browserWebView: WKWebView?
    var browserBar: NSView?
    var browserURLLabel: NSTextField?
    var browserBackButton: NSButton?
    var browserForwardButton: NSButton?
    var escapeMonitor: Any?
    var isForceQuitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenuBar()

        // Request notification permission
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.websiteDataStore = WKWebsiteDataStore.default()

        // Bridge: JS can call window.webkit.messageHandlers.ceoBridge.postMessage(...)
        config.userContentController.add(self, name: "ceoBridge")

        let windowRect = NSRect(x: 0, y: 0, width: 1400, height: 900)

        containerView = NSView(frame: windowRect)
        containerView.autoresizingMask = [.width, .height]

        webView = WKWebView(frame: windowRect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.customUserAgent = "CEODashboard/1.0"
        webView.uiDelegate = self
        containerView.addSubview(webView)

        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "CEO Dashboard"
        window.contentView = containerView
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.07, green: 0.07, blue: 0.07, alpha: 1.0)

        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(handleReload),
            name: NSNotification.Name("com.ceo-dashboard.reload"),
            object: nil
        )

        checkServerAndLoad()
    }

    // Handle messages from JS
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Browser overlay escape handler
        if message.name == "browserClose" {
            closeBrowserOverlay()
            return
        }

        guard let dict = message.body as? [String: Any],
              let action = dict["action"] as? String else { return }

        switch action {
        case "setBadge":
            let count = dict["count"] as? Int ?? 0
            DispatchQueue.main.async {
                NSApp.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
            }

        case "sendNotification":
            let title = dict["title"] as? String ?? "CEO Dashboard"
            let body = dict["body"] as? String ?? ""
            let tag = dict["tag"] as? String ?? "default"

            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default

            let request = UNNotificationRequest(identifier: tag, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request)

        case "clearBrowserData":
            let dataStore = WKWebsiteDataStore.default()
            let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
            dataStore.fetchDataRecords(ofTypes: dataTypes) { records in
                dataStore.removeData(ofTypes: dataTypes, for: records) {
                    print("[browser] Cleared all website data (\(records.count) records)")
                }
            }

        default:
            break
        }
    }

    // MARK: - WKUIDelegate

    // Handle window.open() — popout windows become native windows, external URLs open in overlay
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }

        // Links clicked inside the browser overlay → navigate in same overlay
        if webView === browserWebView {
            browserWebView?.load(URLRequest(url: url))
            return nil
        }

        // External URLs → open in-app browser overlay
        if url.host != "localhost" {
            showBrowserOverlay(url: url)
            return nil
        }

        // Local URLs (popout windows) → create native window with shared config
        let popoutWebView = WKWebView(frame: .zero, configuration: configuration)
        popoutWebView.uiDelegate = self

        let width = windowFeatures.width?.doubleValue ?? 800
        let height = windowFeatures.height?.doubleValue ?? 600
        let rect = NSRect(x: 0, y: 0, width: width, height: height)

        let popoutWindow = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        popoutWindow.contentView = popoutWebView
        popoutWindow.center()
        popoutWindow.makeKeyAndOrderFront(nil)
        popoutWindow.titlebarAppearsTransparent = true
        popoutWindow.backgroundColor = NSColor(red: 0.07, green: 0.07, blue: 0.07, alpha: 1.0)

        popoutWindows.append(popoutWindow)

        // Clean up when window is closed manually
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: popoutWindow, queue: .main) { [weak self] _ in
            self?.popoutWindows.removeAll { $0 === popoutWindow }
        }

        return popoutWebView
    }

    // Handle window.close() from JS
    func webViewDidClose(_ webView: WKWebView) {
        if let popoutWindow = popoutWindows.first(where: { ($0.contentView as? WKWebView) === webView }) {
            popoutWindow.close()
            popoutWindows.removeAll { $0 === popoutWindow }
        }
    }

    // Handle alert()
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        completionHandler()
    }

    // Handle confirm()
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    // Handle prompt()
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn {
            completionHandler(input.stringValue)
        } else {
            completionHandler(nil)
        }
    }

    // Show notifications even when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    // Clicking a notification brings the app to front
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        completionHandler()
    }

    // MARK: - In-App Browser Overlay

    func showBrowserOverlay(url: URL) {
        // If overlay already showing, just navigate
        if let existing = browserWebView {
            existing.load(URLRequest(url: url))
            return
        }

        // Dark backdrop
        let overlay = NSView(frame: containerView.bounds)
        overlay.autoresizingMask = [.width, .height]
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.6).cgColor
        containerView.addSubview(overlay)
        browserOverlay = overlay

        // Container for bar + webview (inset from edges)
        let inset: CGFloat = 30
        let topBarHeight: CGFloat = 44
        let containerFrame = overlay.bounds.insetBy(dx: inset, dy: inset)
        let container = NSView(frame: containerFrame)
        container.autoresizingMask = [.width, .height]
        container.wantsLayer = true
        container.layer?.cornerRadius = 16
        container.layer?.masksToBounds = true
        overlay.addSubview(container)

        // Top navigation bar
        let barFrame = NSRect(x: 0, y: container.bounds.height - topBarHeight, width: container.bounds.width, height: topBarHeight)
        let bar = NSView(frame: barFrame)
        bar.autoresizingMask = [.width, .minYMargin]
        bar.wantsLayer = true
        bar.layer?.backgroundColor = NSColor(red: 0.118, green: 0.118, blue: 0.118, alpha: 1.0).cgColor
        container.addSubview(bar)
        browserBar = bar

        // Back button
        let backBtn = HoverButton(frame: NSRect(x: 8, y: 7, width: 30, height: 30))
        backBtn.bezelStyle = .inline
        backBtn.isBordered = false
        backBtn.title = "\u{25C0}"
        backBtn.font = NSFont.systemFont(ofSize: 14)
        backBtn.contentTintColor = .white
        backBtn.target = self
        backBtn.action = #selector(browserGoBack)
        backBtn.isEnabled = false
        bar.addSubview(backBtn)
        browserBackButton = backBtn

        // Forward button
        let fwdBtn = HoverButton(frame: NSRect(x: 38, y: 7, width: 30, height: 30))
        fwdBtn.bezelStyle = .inline
        fwdBtn.isBordered = false
        fwdBtn.title = "\u{25B6}"
        fwdBtn.font = NSFont.systemFont(ofSize: 14)
        fwdBtn.contentTintColor = .white
        fwdBtn.target = self
        fwdBtn.action = #selector(browserGoForward)
        fwdBtn.isEnabled = false
        bar.addSubview(fwdBtn)
        browserForwardButton = fwdBtn

        // URL label (leave space for Reload + Safari + Close buttons)
        let urlLabel = NSTextField(frame: NSRect(x: 74, y: 10, width: bar.bounds.width - 74 - 114, height: 24))
        urlLabel.autoresizingMask = [.width]
        urlLabel.isEditable = false
        urlLabel.isSelectable = false
        urlLabel.isBezeled = false
        urlLabel.drawsBackground = false
        urlLabel.textColor = NSColor(white: 0.6, alpha: 1.0)
        urlLabel.font = NSFont.systemFont(ofSize: 12)
        urlLabel.lineBreakMode = .byTruncatingMiddle
        urlLabel.stringValue = url.absoluteString
        bar.addSubview(urlLabel)
        browserURLLabel = urlLabel

        // Reload button
        let reloadBtn = HoverButton(frame: NSRect(x: bar.bounds.width - 108, y: 7, width: 30, height: 30))
        reloadBtn.autoresizingMask = [.minXMargin]
        reloadBtn.bezelStyle = .inline
        reloadBtn.isBordered = false
        reloadBtn.title = "\u{21BB}"
        reloadBtn.font = NSFont.systemFont(ofSize: 16)
        reloadBtn.contentTintColor = .white
        reloadBtn.toolTip = "Reload (\u{2318}R)"
        reloadBtn.target = self
        reloadBtn.action = #selector(browserReload)
        bar.addSubview(reloadBtn)

        // Open in Safari button (fallback for passkey auth)
        let safariBtn = HoverButton(frame: NSRect(x: bar.bounds.width - 74, y: 7, width: 30, height: 30))
        safariBtn.autoresizingMask = [.minXMargin]
        safariBtn.bezelStyle = .inline
        safariBtn.isBordered = false
        safariBtn.title = "\u{1F310}"
        safariBtn.font = NSFont.systemFont(ofSize: 14)
        safariBtn.toolTip = "Open in Safari"
        safariBtn.target = self
        safariBtn.action = #selector(openInSafari)
        bar.addSubview(safariBtn)

        // Close button
        let closeBtn = HoverButton(frame: NSRect(x: bar.bounds.width - 40, y: 7, width: 30, height: 30))
        closeBtn.autoresizingMask = [.minXMargin]
        closeBtn.bezelStyle = .inline
        closeBtn.isBordered = false
        closeBtn.title = "\u{2715}"
        closeBtn.font = NSFont.systemFont(ofSize: 16, weight: .medium)
        closeBtn.contentTintColor = .white
        closeBtn.target = self
        closeBtn.action = #selector(closeBrowserOverlay)
        bar.addSubview(closeBtn)

        // Browser webview
        let webViewConfig = WKWebViewConfiguration()
        webViewConfig.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webViewConfig.websiteDataStore = WKWebsiteDataStore.default()
        webViewConfig.preferences.javaScriptCanOpenWindowsAutomatically = true

        // Inject capture-phase Escape handler so it fires before any page JS handlers
        let escapeScript = WKUserScript(
            source: """
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    window.webkit.messageHandlers.browserClose.postMessage('escape');
                }
            }, true);
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        webViewConfig.userContentController.addUserScript(escapeScript)
        webViewConfig.userContentController.add(self, name: "browserClose")

        let webViewFrame = NSRect(x: 0, y: 0, width: container.bounds.width, height: container.bounds.height - topBarHeight)
        let bWebView = WKWebView(frame: webViewFrame, configuration: webViewConfig)
        bWebView.autoresizingMask = [.width, .height]
        bWebView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15"
        bWebView.uiDelegate = self
        bWebView.navigationDelegate = self
        container.addSubview(bWebView)
        browserWebView = bWebView

        bWebView.load(URLRequest(url: url))

        // Give keyboard focus to the browser overlay
        window.makeFirstResponder(bWebView)

        // Key monitor — intercepts keys while browser overlay is open
        escapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard self?.browserOverlay != nil else { return event }
            if event.keyCode == 53 { // Escape
                self?.closeBrowserOverlay()
                return nil
            }
            // Command+R → reload browser overlay (swallow so menu item doesn't also fire)
            if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "r" {
                self?.browserReload()
                return nil
            }
            return event
        }
    }

    @objc func closeBrowserOverlay() {
        if let monitor = escapeMonitor {
            NSEvent.removeMonitor(monitor)
            escapeMonitor = nil
        }
        browserOverlay?.removeFromSuperview()
        browserOverlay = nil
        browserWebView = nil
        browserBar = nil
        browserURLLabel = nil
        browserBackButton = nil
        browserForwardButton = nil

        // Restore keyboard focus to the main webview
        window.makeFirstResponder(webView)
    }

    @objc func openInSafari() {
        if let url = browserWebView?.url {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func browserGoBack() {
        browserWebView?.goBack()
    }

    @objc func browserGoForward() {
        browserWebView?.goForward()
    }

    // MARK: - WKNavigationDelegate (browser overlay)

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === browserWebView else { return }
        browserURLLabel?.stringValue = webView.url?.absoluteString ?? ""
        browserBackButton?.isEnabled = webView.canGoBack
        browserForwardButton?.isEnabled = webView.canGoForward
        if let title = webView.title, !title.isEmpty {
            browserURLLabel?.stringValue = title
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard webView === browserWebView else { return }
        browserURLLabel?.stringValue = webView.url?.absoluteString ?? ""
        browserBackButton?.isEnabled = webView.canGoBack
        browserForwardButton?.isEnabled = webView.canGoForward
    }

    func setupMenuBar() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About CEO Dashboard", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let settingsMenuItem = NSMenuItem()
        let settingsMenu = NSMenu(title: "Settings")
        settingsMenu.addItem(withTitle: "Refresh", action: #selector(refreshPage), keyEquivalent: "r")
        settingsMenu.addItem(.separator())
        settingsMenu.addItem(withTitle: "Force Quit (Stop Server)", action: #selector(forceQuit), keyEquivalent: "")
        settingsMenuItem.submenu = settingsMenu
        mainMenu.addItem(settingsMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }

    @objc func refreshPage() {
        if browserWebView != nil {
            browserReload()
        } else {
            webView.reload()
        }
    }

    @objc func browserReload() {
        browserWebView?.reload()
    }

    @objc func forceQuit() {
        isForceQuitting = true
        // Kill the server
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-c", "lsof -ti :9145 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null"]
        try? process.run()
        process.waitUntilExit()
        // Safety net: if NSApp.terminate hangs, hard-exit after 2s
        DispatchQueue.global().asyncAfter(deadline: .now() + 2.0) { exit(0) }
        // Use proper terminate so RunningBoard deregisters the app cleanly
        NSApp.terminate(nil)
    }

    @objc func handleReload(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.webView.reload()
            self?.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func checkServerAndLoad() {
        let url = URL(string: "http://localhost:9145")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 2

        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                DispatchQueue.main.async {
                    self?.webView.load(URLRequest(url: url))
                }
            } else {
                self?.startServer {
                    DispatchQueue.main.async {
                        self?.webView.load(URLRequest(url: url))
                    }
                }
            }
        }.resume()
    }

    func startServer(completion: @escaping () -> Void) {
        DispatchQueue.global().async {
            let ceoDir = NSHomeDirectory() + "/ceo-dashboard"
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", ceoDir + "/server.js"]
            process.currentDirectoryURL = URL(fileURLWithPath: ceoDir)
            process.environment = ProcessInfo.processInfo.environment.filter { $0.key != "CLAUDECODE" }
            try? process.run()
            Thread.sleep(forTimeInterval: 1.5)
            completion()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        NSApp.dockTile.badgeLabel = nil
        window.makeKeyAndOrderFront(nil)
        if !flag {
            // Only reload if no windows were visible (app was fully hidden, not just minimized)
            webView.reload()
        }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        NSApp.dockTile.badgeLabel = nil
        if isForceQuitting {
            // Skip slow operations (JS eval, webview teardown) — just exit fast
            // so RunningBoard gets the clean termination signal without hanging
            return
        }
        closeBrowserOverlay()
        for popout in popoutWindows {
            popout.close()
        }
        popoutWindows.removeAll()
        webView.evaluateJavaScript("if(typeof buildReloadState==='function'){localStorage.setItem('ceo-reload-state',JSON.stringify(buildReloadState()))}", completionHandler: nil)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
