import UIKit
import WebKit
import UniformTypeIdentifiers

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = BoardController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class BoardController: UIViewController, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate, UIDocumentPickerDelegate {
    private var webView: WKWebView!
    private var store: StateStore?
    private var storageError: String?
    private var fileOperation: String?
    private var exportURL: URL?

    override var prefersStatusBarHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.96, green: 0.95, blue: 0.91, alpha: 1)
        do {
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            store = try StateStore(directory: directory.appendingPathComponent("MilkBoard"))
        } catch { storageError = error.localizedDescription }
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "milkStore")
        config.userContentController.add(self, name: "milkFiles")
        config.userContentController.addUserScript(WKUserScript(source: """
        (function(){var callbacks={},sequence=0;
        window.IOSStore={request:function(method,payload,done){var id=++sequence;callbacks[id]=done;window.webkit.messageHandlers.milkStore.postMessage({id:id,method:method,payload:payload});}};
        window.IOSFiles={version:"\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")",exportCsv:function(text,name){window.webkit.messageHandlers.milkFiles.postMessage({operation:"export",text:text,name:name});},importCsv:function(){window.webkit.messageHandlers.milkFiles.postMessage({operation:"import"});}};
        window.milkStoreReply=function(id,result){var done=callbacks[id];delete callbacks[id];if(done)done(result);};
        }());
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self; webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        guard let root = Bundle.main.url(forResource: "Board", withExtension: nil) else { return }
        webView.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
    }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); UIApplication.shared.isIdleTimerDisabled = true }
    override func viewDidDisappear(_ animated: Bool) { super.viewDidDisappear(animated); UIApplication.shared.isIdleTimerDisabled = false }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "milkFiles" {
            guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true, let body = message.body as? [String: Any] else { return }
            handleFile(body); return
        }
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? [String: Any], let id = body["id"] as? Int,
              let method = body["method"] as? String else { return }
        let result = store?.request(method: method, payload: body["payload"] as? [String: Any])
            ?? ["status": 500, "body": ["error": storageError ?? "无法读取本机记录。"]]
        guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.milkStoreReply(\(id),\(json));", completionHandler: nil)
    }
    private func filesReply(_ operation: String, _ result: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.MilkFilesReply&&window.MilkFilesReply('\(operation)',\(json));", completionHandler: nil)
    }
    private func handleFile(_ body: [String: Any]) {
        guard let operation = body["operation"] as? String, operation == "export" || operation == "import" else { return }
        guard fileOperation == nil else { filesReply(operation, ["error": "请先关闭当前文件选择器"]); return }
        do {
            let picker: UIDocumentPickerViewController
            if operation == "export" {
                guard let text = body["text"] as? String, let data = text.data(using: .utf8), data.count <= 1048576 else {
                    filesReply(operation, ["error": "CSV 文件不能超过 1 MB"]); return
                }
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("baby-feeding-backup.csv")
                try data.write(to: url, options: .atomic); exportURL = url
                picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            } else { picker = UIDocumentPickerViewController(forOpeningContentTypes: [.commaSeparatedText, .plainText], asCopy: true) }
            fileOperation = operation; picker.delegate = self; picker.allowsMultipleSelection = false
            present(picker, animated: true)
        } catch { filesReply(operation, ["error": "无法打开 CSV 文件选择器"]); cleanFileOperation() }
    }
    private func cleanFileOperation() {
        fileOperation = nil
        if let exportURL { try? FileManager.default.removeItem(at: exportURL) }
        exportURL = nil
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let operation = fileOperation { filesReply(operation, ["cancelled": true]) }; cleanFileOperation()
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let operation = fileOperation else { return }
        defer { cleanFileOperation() }
        if operation == "export" { filesReply(operation, [:]); return }
        guard let url = urls.first else { filesReply(operation, ["cancelled": true]); return }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }
            var data = Data()
            while let chunk = try file.read(upToCount: min(65536, 1048577 - data.count)), !chunk.isEmpty {
                data.append(chunk)
                if data.count > 1048576 { break }
            }
            guard data.count <= 1048576, let text = String(data: data, encoding: .utf8) else {
                filesReply(operation, ["error": "请选择不超过 1 MB 的 UTF-8 CSV 文件"]); return
            }
            filesReply(operation, ["text": text, "name": url.lastPathComponent])
        } catch { filesReply(operation, ["error": "无法读取 CSV，原记录未改变"]) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("document.getElementById('fullscreenButton').style.display='none';document.querySelector('.footer span').textContent='记录仅保存到当前设备中';", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "喝奶看板", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "喝奶看板", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .destructive) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}
