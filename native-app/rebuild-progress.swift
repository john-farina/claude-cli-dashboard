import Cocoa

let STATUS_FILE = "/tmp/ceo-rebuild-status"
let TITLE_FILE = "/tmp/ceo-rebuild-title"

class ProgressDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var statusLabel: NSTextField!
    var stepLabel: NSTextField!
    var progressBar: NSProgressIndicator!
    var timer: Timer?

    func applicationDidFinishLaunching(_ n: Notification) {
        let w: CGFloat = 440, h: CGFloat = 150

        // Read dynamic title from file (set by the caller)
        let windowTitle = (try? String(contentsOfFile: TITLE_FILE, encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "Rebuilding..."

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: w, height: h),
            styleMask: [.titled],
            backing: .buffered, defer: false
        )
        window.title = windowTitle
        window.level = .floating
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .darkAqua)
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.11, green: 0.11, blue: 0.11, alpha: 1)

        let cv = window.contentView!

        // Title
        let title = NSTextField(frame: NSRect(x: 24, y: h - 48, width: w - 48, height: 24))
        title.isEditable = false
        title.isBezeled = false
        title.drawsBackground = false
        title.font = NSFont.systemFont(ofSize: 16, weight: .semibold)
        title.textColor = .white
        title.stringValue = windowTitle
        cv.addSubview(title)

        // Step label
        stepLabel = NSTextField(frame: NSRect(x: 24, y: h - 76, width: w - 48, height: 18))
        stepLabel.isEditable = false
        stepLabel.isBezeled = false
        stepLabel.drawsBackground = false
        stepLabel.font = NSFont.systemFont(ofSize: 12)
        stepLabel.textColor = NSColor(white: 0.55, alpha: 1)
        stepLabel.stringValue = "Starting..."
        cv.addSubview(stepLabel)

        // Progress bar
        progressBar = NSProgressIndicator(frame: NSRect(x: 24, y: 24, width: w - 48, height: 20))
        progressBar.style = .bar
        progressBar.isIndeterminate = false
        progressBar.minValue = 0
        progressBar.maxValue = 100
        progressBar.doubleValue = 0
        cv.addSubview(progressBar)

        // Status (bottom-right, e.g. "Step 1/5")
        statusLabel = NSTextField(frame: NSRect(x: w - 120, y: 2, width: 96, height: 16))
        statusLabel.isEditable = false
        statusLabel.isBezeled = false
        statusLabel.drawsBackground = false
        statusLabel.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        statusLabel.textColor = NSColor(white: 0.4, alpha: 1)
        statusLabel.alignment = .right
        statusLabel.stringValue = ""
        cv.addSubview(statusLabel)

        // Position on the same screen as the main app window was
        let screenFile = "/tmp/ceo-rebuild-screen"
        if let screenData = try? String(contentsOfFile: screenFile, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
           !screenData.isEmpty {
            let screenFrame = NSRectFromString(screenData)
            // Center the progress window within that screen's visible area
            let x = screenFrame.midX - w / 2
            let y = screenFrame.midY - h / 2
            window.setFrameOrigin(NSPoint(x: x, y: y))
        } else {
            window.center()
        }

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            self?.pollStatus()
        }
    }

    func pollStatus() {
        guard let raw = try? String(contentsOfFile: STATUS_FILE, encoding: .utf8) else { return }
        let lines = raw.components(separatedBy: "\n").filter { !$0.isEmpty }
        guard let last = lines.last else { return }

        // Format: "PROGRESS:percent:step_num:total_steps:message"
        // or "DONE:message" / "FAIL:message"
        if last.hasPrefix("DONE:") {
            let msg = String(last.dropFirst(5))
            stepLabel.stringValue = msg
            progressBar.doubleValue = 100
            statusLabel.stringValue = ""
            timer?.invalidate()
            // Brief pause so user sees "complete", then auto-close
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                NSApp.terminate(nil)
            }
        } else if last.hasPrefix("FAIL:") {
            let msg = String(last.dropFirst(5))
            stepLabel.stringValue = msg
            stepLabel.textColor = NSColor(red: 1, green: 0.4, blue: 0.4, alpha: 1)
            progressBar.doubleValue = 100
            statusLabel.stringValue = ""
            timer?.invalidate()
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                NSApp.terminate(nil)
            }
        } else if last.hasPrefix("PROGRESS:") {
            let parts = last.split(separator: ":", maxSplits: 4).map(String.init)
            if parts.count >= 5 {
                let pct = Double(parts[1]) ?? 0
                let step = parts[2]
                let total = parts[3]
                let msg = parts[4]
                progressBar.doubleValue = pct
                stepLabel.stringValue = msg
                statusLabel.stringValue = "Step \(step)/\(total)"
            }
        }
    }
}

let app = NSApplication.shared
let del = ProgressDelegate()
app.delegate = del
app.setActivationPolicy(.accessory)  // no Dock icon — floating utility window
app.activate(ignoringOtherApps: true)
app.run()
