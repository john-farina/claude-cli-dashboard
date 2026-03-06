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
        guard isEnabled else { return } // Consume click silently when disabled
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

    override func resetCursorRects() {
        super.resetCursorRects()
        if isEnabled {
            addCursorRect(bounds, cursor: .pointingHand)
        }
    }

    override var isEnabled: Bool {
        didSet {
            alphaValue = isEnabled ? 1.0 : 0.35
            window?.invalidateCursorRects(for: self)
        }
    }
}

// Transparent view that catches mouse clicks — used as backdrop behind the browser container
class BackdropClickView: NSView {
    var onMouseDown: (() -> Void)?

    override func mouseDown(with event: NSEvent) {
        onMouseDown?()
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
    var browserStarButton: NSButton?
    var currentBrowserFavId: String?
    var escapeMonitor: Any?

    // KVO observers for browser nav button state
    var canGoBackObserver: NSKeyValueObservation?
    var canGoForwardObserver: NSKeyValueObservation?
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
        // Restore saved window frame (position, size, monitor)
        if let saved = UserDefaults.standard.string(forKey: "CEOMainWindowFrame") {
            window.setFrame(NSRectFromString(saved), display: true)
        } else {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.07, green: 0.07, blue: 0.07, alpha: 1.0)

        fetchDashboardTitle()

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
            let title = dict["title"] as? String ?? (self.window.title)
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

        case "nativeRebuild":
            // Triggered by server update when native-app/ files changed — skip confirmation
            launchRebuild(title: "Update — Rebuilding App", step1Message: "Update detected native app changes...")

        case "startWindowDrag":
            // Popout header drag — find which popout window contains the sender WKWebView
            guard let event = NSApp.currentEvent else { break }
            if let senderWV = message.webView {
                for popout in popoutWindows {
                    if let blur = popout.contentView as? NSVisualEffectView,
                       blur.subviews.contains(where: { $0 === senderWV }) {
                        popout.performDrag(with: event)
                        break
                    }
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

        // Local URLs (popout windows) → create native window with translucent blur background
        let popoutWebView = WKWebView(frame: .zero, configuration: configuration)
        popoutWebView.uiDelegate = self
        popoutWebView.setValue(false, forKey: "drawsBackground") // transparent WKWebView

        let width = windowFeatures.width?.doubleValue ?? 800
        let height = windowFeatures.height?.doubleValue ?? 600
        let rect = NSRect(x: 0, y: 0, width: width, height: height)

        // NSVisualEffectView provides native macOS blur-behind-window
        let blurView = NSVisualEffectView(frame: rect)
        blurView.autoresizingMask = [.width, .height]
        blurView.material = .hudWindow
        blurView.blendingMode = .behindWindow
        blurView.state = .active
        blurView.appearance = NSAppearance(named: .darkAqua)

        popoutWebView.frame = blurView.bounds
        popoutWebView.autoresizingMask = [.width, .height]
        blurView.addSubview(popoutWebView)

        let popoutWindow = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        popoutWindow.contentView = blurView
        popoutWindow.center()
        popoutWindow.makeKeyAndOrderFront(nil)
        popoutWindow.titlebarAppearsTransparent = true
        popoutWindow.isOpaque = false
        popoutWindow.backgroundColor = .clear

        // Hide traffic light buttons — the HTML has its own back/close controls
        popoutWindow.standardWindowButton(.closeButton)?.isHidden = true
        popoutWindow.standardWindowButton(.miniaturizeButton)?.isHidden = true
        popoutWindow.standardWindowButton(.zoomButton)?.isHidden = true

        popoutWindows.append(popoutWindow)

        // Clean up when window is closed (macOS close or JS window.close)
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: popoutWindow, queue: .main) { [weak self] _ in
            // Notify dashboard that this agent is no longer popped out
            popoutWebView.evaluateJavaScript(
                "try { new BroadcastChannel('ceo-popout').postMessage({ type: 'popped-back', agent: new URLSearchParams(location.search).get('agent') }); } catch(e) {}",
                completionHandler: nil
            )
            self?.popoutWindows.removeAll { $0 === popoutWindow }
        }

        return popoutWebView
    }

    // Handle window.close() from JS
    func webViewDidClose(_ webView: WKWebView) {
        if let popoutWindow = popoutWindows.first(where: {
            // contentView may be the WKWebView directly or an NSVisualEffectView containing it
            if ($0.contentView as? WKWebView) === webView { return true }
            if let blur = $0.contentView as? NSVisualEffectView {
                return blur.subviews.contains(where: { $0 === webView })
            }
            return false
        }) {
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

        // Click-catcher covers entire overlay but sits behind the container
        // so only clicks outside the container reach it
        let backdropHit = BackdropClickView(frame: overlay.bounds)
        backdropHit.autoresizingMask = [.width, .height]
        backdropHit.onMouseDown = { [weak self] in self?.closeBrowserOverlay() }
        overlay.addSubview(backdropHit)

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

        // URL label (leave space for Reload + Star + Safari + Close buttons)
        let urlLabel = NSTextField(frame: NSRect(x: 74, y: 10, width: bar.bounds.width - 74 - 148, height: 24))
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
        let reloadBtn = HoverButton(frame: NSRect(x: bar.bounds.width - 142, y: 7, width: 30, height: 30))
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

        // Bookmark star button
        let starBtn = HoverButton(frame: NSRect(x: bar.bounds.width - 108, y: 7, width: 30, height: 30))
        starBtn.autoresizingMask = [.minXMargin]
        starBtn.bezelStyle = .inline
        starBtn.isBordered = false
        starBtn.title = "\u{2606}" // ☆ empty star
        starBtn.font = NSFont.systemFont(ofSize: 16)
        starBtn.contentTintColor = .white
        starBtn.toolTip = "Bookmark"
        starBtn.target = self
        starBtn.action = #selector(toggleBrowserFavorite)
        bar.addSubview(starBtn)
        browserStarButton = starBtn
        currentBrowserFavId = nil

        // Check if current URL is already favorited
        checkFavoriteState(for: url)

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

        // Observe canGoBack/canGoForward so buttons update in real-time
        canGoBackObserver = bWebView.observe(\.canGoBack, options: .new) { [weak self] wv, _ in
            self?.browserBackButton?.isEnabled = wv.canGoBack
        }
        canGoForwardObserver = bWebView.observe(\.canGoForward, options: .new) { [weak self] wv, _ in
            self?.browserForwardButton?.isEnabled = wv.canGoForward
        }

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
        browserStarButton = nil
        currentBrowserFavId = nil
        canGoBackObserver = nil
        canGoForwardObserver = nil

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
        if let title = webView.title, !title.isEmpty {
            browserURLLabel?.stringValue = title
        }
        if let url = webView.url { checkFavoriteState(for: url) }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard webView === browserWebView else { return }
        browserURLLabel?.stringValue = webView.url?.absoluteString ?? ""
        if let url = webView.url { checkFavoriteState(for: url) }
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
        let rebuildItem = NSMenuItem(title: "Rebuild & Relaunch — recompiles the native app after code changes", action: #selector(rebuildAndRelaunch), keyEquivalent: "B")
        settingsMenu.addItem(rebuildItem)
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

    @objc func toggleBrowserFavorite() {
        guard let bwv = browserWebView, let url = bwv.url else { return }
        let urlStr = url.absoluteString

        if let favId = currentBrowserFavId {
            // Already favorited — remove it
            let apiUrl = URL(string: "http://localhost:9145/api/favorites/\(favId)")!
            var req = URLRequest(url: apiUrl)
            req.httpMethod = "DELETE"
            URLSession.shared.dataTask(with: req) { [weak self] _, _, _ in
                DispatchQueue.main.async {
                    self?.browserStarButton?.title = "\u{2606}" // ☆
                    self?.browserStarButton?.contentTintColor = .white
                    self?.currentBrowserFavId = nil
                }
            }.resume()
        } else {
            // Not favorited — add it
            let title = bwv.title ?? urlStr
            let apiUrl = URL(string: "http://localhost:9145/api/favorites")!
            var req = URLRequest(url: apiUrl)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body: [String: String] = ["url": urlStr, "title": title]
            req.httpBody = try? JSONSerialization.data(withJSONObject: body)
            URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
                var newId: String?
                if let data = data,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let fav = json["favorite"] as? [String: Any] {
                    newId = fav["id"] as? String
                }
                DispatchQueue.main.async {
                    self?.browserStarButton?.title = "\u{2605}" // ★
                    self?.browserStarButton?.contentTintColor = NSColor(red: 0.788, green: 0.659, blue: 0.298, alpha: 1.0) // gold
                    self?.currentBrowserFavId = newId
                }
            }.resume()
        }
    }

    func checkFavoriteState(for url: URL) {
        guard let encoded = url.absoluteString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let apiUrl = URL(string: "http://localhost:9145/api/favorites/check?url=\(encoded)") else { return }
        URLSession.shared.dataTask(with: apiUrl) { [weak self] data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            let favorited = json["favorited"] as? Bool ?? false
            let favId = json["id"] as? String
            DispatchQueue.main.async {
                if favorited {
                    self?.browserStarButton?.title = "\u{2605}" // ★
                    self?.browserStarButton?.contentTintColor = NSColor(red: 0.788, green: 0.659, blue: 0.298, alpha: 1.0)
                    self?.currentBrowserFavId = favId
                } else {
                    self?.browserStarButton?.title = "\u{2606}" // ☆
                    self?.browserStarButton?.contentTintColor = .white
                    self?.currentBrowserFavId = nil
                }
            }
        }.resume()
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

    @objc func rebuildAndRelaunch() {
        let alert = NSAlert()
        alert.messageText = "Rebuild & Relaunch"
        alert.informativeText = "The app will close and a progress window will show the build status. The app reopens automatically when done.\n\nYour agents will keep running."
        alert.addButton(withTitle: "Rebuild")
        alert.addButton(withTitle: "Cancel")
        alert.alertStyle = .informational
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        launchRebuild(title: "Rebuilding CEO Dashboard...", step1Message: "Preparing progress window...")
    }

    func launchRebuild(title: String, step1Message: String) {
        let ceoDir = CEO_DASHBOARD_DIR
        // Read app name from config.json so rebuild reopens the correct (possibly renamed) app
        var appName = "CEO Dashboard"
        let configPath = ceoDir + "/config.json"
        if let data = try? Data(contentsOf: URL(fileURLWithPath: configPath)),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let cfgTitle = json["title"] as? String, !cfgTitle.isEmpty {
            appName = cfgTitle
        }
        let appPath = NSHomeDirectory() + "/Applications/" + appName + ".app"
        let statusFile = "/tmp/ceo-rebuild-status"
        let scriptPath = "/tmp/ceo-rebuild.sh"
        let progressSrc = ceoDir + "/native-app/rebuild-progress.swift"
        let progressBin = "/tmp/ceo-rebuild-progress"

        // Write the title so the progress window can pick it up
        let titleFile = "/tmp/ceo-rebuild-title"

        // Save the screen frame so the progress window appears on the same monitor
        if let screen = window.screen {
            try? NSStringFromRect(screen.visibleFrame).write(toFile: "/tmp/ceo-rebuild-screen", atomically: true, encoding: .utf8)
        }

        let script = """
        #!/bin/bash
        STATUS="\(statusFile)"
        rm -f "$STATUS"

        # Save window title for progress app
        echo "\(title)" > "\(titleFile)"

        # Step 1: Compile the progress window (tiny, ~2s)
        echo "PROGRESS:5:1:6:\(step1Message)" > "$STATUS"
        swiftc "\(progressSrc)" -o "\(progressBin)" -framework Cocoa -O 2>/tmp/ceo-rebuild.log
        if [ $? -ne 0 ]; then
            osascript -e 'display notification "Progress window failed to compile" with title "CEO Dashboard"'
        else
            "\(progressBin)" &
            PROGRESS_PID=$!
        fi

        # Wait for app to fully quit
        sleep 1
        echo "PROGRESS:15:2:6:Compiling Swift application..." > "$STATUS"

        # Step 2: Run the build
        cd "\(ceoDir)"
        bash "./native-app/build.sh" > /tmp/ceo-rebuild.log 2>&1 &
        BUILD_PID=$!

        # Monitor build.sh output for stage updates
        LAST_STAGE=""
        while kill -0 $BUILD_PID 2>/dev/null; do
            if [ -f /tmp/ceo-rebuild.log ]; then
                CURRENT=$(tail -1 /tmp/ceo-rebuild.log 2>/dev/null)
                if [ "$CURRENT" != "$LAST_STAGE" ] && [ -n "$CURRENT" ]; then
                    LAST_STAGE="$CURRENT"
                    case "$CURRENT" in
                        *"Compiled Swift"*)
                            echo "PROGRESS:50:3:6:Generating app icon..." > "$STATUS" ;;
                        *"Generated app icon"*)
                            echo "PROGRESS:70:4:6:Code signing..." > "$STATUS" ;;
                        *"Signed with"*|*"ad-hoc signing"*)
                            echo "PROGRESS:85:5:6:Registering with Launch Services..." > "$STATUS" ;;
                        *"Installed to"*)
                            echo "PROGRESS:95:6:6:Finalizing..." > "$STATUS" ;;
                    esac
                fi
            fi
            sleep 0.3
        done

        wait $BUILD_PID
        BUILD_EXIT=$?

        if [ $BUILD_EXIT -eq 0 ]; then
            echo "DONE:Build complete — reopening app" > "$STATUS"
            sleep 2
            open "\(appPath)"
        else
            echo "FAIL:Build failed — see /tmp/ceo-rebuild.log" > "$STATUS"
            sleep 5
        fi

        # Cleanup
        [ -n "$PROGRESS_PID" ] && kill $PROGRESS_PID 2>/dev/null
        rm -f "\(scriptPath)" "\(progressBin)" "$STATUS" "\(titleFile)" /tmp/ceo-rebuild-screen
        """

        do {
            try script.write(toFile: scriptPath, atomically: true, encoding: .utf8)
            let chmod = Process()
            chmod.executableURL = URL(fileURLWithPath: "/bin/chmod")
            chmod.arguments = ["+x", scriptPath]
            try chmod.run()
            chmod.waitUntilExit()

            let launcher = Process()
            launcher.executableURL = URL(fileURLWithPath: "/bin/bash")
            launcher.arguments = ["-c", "nohup \(scriptPath) &>/dev/null &"]
            launcher.currentDirectoryURL = URL(fileURLWithPath: ceoDir)
            try launcher.run()
            NSApp.terminate(nil)
        } catch {
            let errAlert = NSAlert()
            errAlert.messageText = "Rebuild Failed"
            errAlert.informativeText = "Could not start rebuild: \(error.localizedDescription)"
            errAlert.runModal()
        }
    }

    @objc func handleReload(_ notification: Notification) {
        DispatchQueue.main.async { [weak self] in
            self?.webView.reload()
            self?.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func fetchDashboardTitle() {
        guard let url = URL(string: "http://localhost:9145/api/config") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let title = json["title"] as? String, !title.isEmpty else { return }
            DispatchQueue.main.async {
                self?.window.title = title
            }
        }.resume()
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
            let ceoDir = CEO_DASHBOARD_DIR
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
        // Always save window frame — even on force quit (it's fast)
        UserDefaults.standard.set(NSStringFromRect(window.frame), forKey: "CEOMainWindowFrame")
        UserDefaults.standard.synchronize()

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
