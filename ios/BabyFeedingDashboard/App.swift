import UIKit
import WebKit

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

final class BoardController: UIViewController, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    private var webView: WKWebView!
    private var store: StateStore?
    private var storageError: String?
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
        config.userContentController.addUserScript(WKUserScript(source: """
        (function(){var callbacks={},sequence=0;
        window.IOSStore={request:function(method,payload,done){var id=++sequence;callbacks[id]=done;window.webkit.messageHandlers.milkStore.postMessage({id:id,method:method,payload:payload});}};
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
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? [String: Any], let id = body["id"] as? Int,
              let method = body["method"] as? String else { return }
        let result = store?.request(method: method, payload: body["payload"] as? [String: Any])
            ?? ["status": 500, "body": ["error": storageError ?? "无法读取本机记录。"]]
        guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.milkStoreReply(\(id),\(json));", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("document.getElementById('fullscreenButton').style.display='none';document.querySelector('.footer span').textContent='记录保存在这台iPad，无需电脑或网络';", completionHandler: nil)
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
