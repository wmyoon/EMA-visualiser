// Regulatory Atlas for macOS: a native window around the web app.
//
// The page, its data and its vendored three.js and fonts are copied into the
// app bundle (Contents/Resources/web) by macos/build.sh, and served to a
// WKWebView from there through a private "atlas://" scheme. Nothing is
// fetched from the network; links to ema.europa.eu open in the default browser.
//
// Build with macos/build.sh (needs only Apple's Command Line Tools).

import Cocoa
import WebKit

let appName = "Regulatory Atlas"
let scheme = "atlas"
let startURL = URL(string: "\(scheme)://app/index.html")!

// MARK: - Serving the bundled page

/// Answers atlas://app/<path> with the file at Resources/web/<path>.
/// A custom scheme (rather than file://) gives the page a real origin, so
/// ES modules, fetch() and localStorage work as they do on a web server.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
  private let root: URL

  init(root: URL) {
    self.root = root.standardizedFileURL.resolvingSymlinksInPath()
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    let file = root.appendingPathComponent(String(path.dropFirst()))
      .standardizedFileURL.resolvingSymlinksInPath()

    // Serve only files inside the bundled web folder.
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      respond(task, url: url, status: 404, type: "text/plain; charset=utf-8", body: Data("Not found".utf8))
      return
    }
    respond(task, url: url, status: 200, type: Self.mimeType(for: file.pathExtension), body: data)
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
    // Responses are sent synchronously in start, so there is nothing to cancel.
  }

  private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, type: String, body: Data) {
    let headers = [
      "Content-Type": type,
      "Content-Length": String(body.count),
      "Cache-Control": "no-cache",
    ]
    guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
      task.didFailWithError(URLError(.cannotParseResponse))
      return
    }
    task.didReceive(response)
    task.didReceive(body)
    task.didFinish()
  }

  static func mimeType(for ext: String) -> String {
    switch ext.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json": return "application/json; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "woff2": return "font/woff2"
    case "txt": return "text/plain; charset=utf-8"
    default: return "application/octet-stream"
    }
  }
}

// MARK: - Window

@MainActor
final class AtlasWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate {
  let webView: WKWebView
  private let handler: BundleSchemeHandler

  init(webRoot: URL) {
    // Everything is set up in locals first: Swift allows no use of self before super.init.
    let handler = BundleSchemeHandler(root: webRoot)
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(handler, forURLScheme: scheme)
    config.websiteDataStore = .default() // keeps the page's saved preferences between launches

    let web = WKWebView(frame: .zero, configuration: config)
    web.allowsMagnification = true
    web.allowsBackForwardNavigationGestures = false
    web.setValue(false, forKey: "drawsBackground") // no white flash before the page paints
    if #available(macOS 13.3, *) {
      web.isInspectable = true // Safari ▸ Develop menu, for debugging
    }

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = appName
    window.minSize = NSSize(width: 760, height: 520)
    window.tabbingMode = .disallowed
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("RegulatoryAtlasMain")

    self.handler = handler
    self.webView = web
    super.init(window: window)
    web.navigationDelegate = self
    web.uiDelegate = self
    window.makeFirstResponder(web) // keys such as / reach the page without a click first
    web.load(URLRequest(url: startURL))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  private func isOwn(_ url: URL) -> Bool {
    url.scheme == scheme || url.scheme == "about"
  }

  // Links off the app (ema.europa.eu, licences) open in the default browser.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url, !isOwn(url) else {
      decisionHandler(.allow)
      return
    }
    if url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" {
      NSWorkspace.shared.open(url)
    }
    decisionHandler(.cancel)
  }

  // target="_blank" links ask for a new window: open them in the browser instead.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, !isOwn(url) {
      NSWorkspace.shared.open(url)
    }
    return nil
  }

  // If the web content process ends (memory pressure, GPU reset), reload rather than show a blank window.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
  }
}

// MARK: - App

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var controller: AtlasWindowController?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = makeMenu()
    guard let web = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true),
          FileManager.default.fileExists(atPath: web.appendingPathComponent("index.html").path) else {
      let alert = NSAlert()
      alert.messageText = "The app's page files are missing."
      alert.informativeText = "Rebuild the app with macos/build.sh."
      alert.runModal()
      NSApp.terminate(nil)
      return
    }
    let controller = AtlasWindowController(webRoot: web)
    controller.showWindow(nil)
    self.controller = controller
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

  // MARK: Menu actions

  private var webView: WKWebView? { controller?.webView }

  @objc func reloadPage(_ sender: Any?) { webView?.reload() }

  @objc func showGuidelines(_ sender: Any?) {
    webView?.evaluateJavaScript("location.hash = 'guidelines'", completionHandler: nil)
  }

  @objc func showMedicines(_ sender: Any?) {
    webView?.evaluateJavaScript("location.hash = 'medicines'", completionHandler: nil)
  }

  @objc func actualSize(_ sender: Any?) { webView?.pageZoom = 1 }

  @objc func zoomIn(_ sender: Any?) {
    guard let web = webView else { return }
    web.pageZoom = min(web.pageZoom + 0.1, 3)
  }

  @objc func zoomOut(_ sender: Any?) {
    guard let web = webView else { return }
    web.pageZoom = max(web.pageZoom - 0.1, 0.5)
  }

  @objc func openEMAData(_ sender: Any?) {
    NSWorkspace.shared.open(URL(string: "https://www.ema.europa.eu/en/about-us/about-website/download-website-data-json-data-format")!)
  }

  @objc func openProject(_ sender: Any?) {
    NSWorkspace.shared.open(URL(string: "https://github.com/wmyoon/EMA-visualiser")!)
  }

  // MARK: Menu bar

  private func makeMenu() -> NSMenu {
    let main = NSMenu()

    func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let menu = NSMenu(title: title)
      for i in items { menu.addItem(i) }
      let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      holder.submenu = menu
      main.addItem(holder)
      return menu
    }

    func item(_ title: String, _ action: Selector?, _ key: String = "",
              _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.keyEquivalentModifierMask = mods
      i.target = target
      return i
    }

    let hideOthers = item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
    _ = submenu(appName, [
      item("About \(appName)", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
      .separator(),
      item("Hide \(appName)", #selector(NSApplication.hide(_:)), "h"),
      hideOthers,
      item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Quit \(appName)", #selector(NSApplication.terminate(_:)), "q"),
    ])

    // Standard edit actions go to the web view through the responder chain,
    // so copy, paste and select all work in the search field.
    _ = submenu("Edit", [
      item("Undo", Selector(("undo:")), "z"),
      item("Redo", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"),
      item("Copy", #selector(NSText.copy(_:)), "c"),
      item("Paste", #selector(NSText.paste(_:)), "v"),
      item("Select All", #selector(NSText.selectAll(_:)), "a"),
    ])

    // ⌘1 and ⌘2 are left free: the page uses plain number keys for arrangements.
    _ = submenu("View", [
      item("Guidelines", #selector(showGuidelines(_:)), "g", [.command, .shift], target: self),
      item("Medicines", #selector(showMedicines(_:)), "m", [.command, .shift], target: self),
      .separator(),
      item("Reload", #selector(reloadPage(_:)), "r", target: self),
      .separator(),
      item("Actual Size", #selector(actualSize(_:)), "0", target: self),
      item("Zoom In", #selector(zoomIn(_:)), "=", target: self),
      item("Zoom Out", #selector(zoomOut(_:)), "-", target: self),
      .separator(),
      item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
    ])

    let windowMenu = submenu("Window", [
      item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Zoom", #selector(NSWindow.performZoom(_:))),
      .separator(),
      item("Close", #selector(NSWindow.performClose(_:)), "w"),
    ])
    NSApp.windowsMenu = windowMenu

    let helpMenu = submenu("Help", [
      item("EMA Open Data", #selector(openEMAData(_:)), target: self),
      item("Regulatory Atlas on GitHub", #selector(openProject(_:)), target: self),
    ])
    NSApp.helpMenu = helpMenu

    return main
  }
}

// MARK: - Entry point

// AppKit starts on the main thread; say so to the compiler, since the
// delegate and window types are main-actor isolated.
MainActor.assumeIsolated {
  let app = NSApplication.shared
  let delegate = AppDelegate()
  app.delegate = delegate // held for the app's lifetime: run() does not return
  app.setActivationPolicy(.regular)
  app.run()
}
