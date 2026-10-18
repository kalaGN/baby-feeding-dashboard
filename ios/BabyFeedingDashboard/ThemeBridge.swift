import UIKit
import WebKit

final class ThemeBridge: NSObject, WKScriptMessageHandler {
    private weak var hostView: UIView?
    private weak var webView: WKWebView?

    init(hostView: UIView) {
        self.hostView = hostView
        super.init()
    }

    func attach(_ webView: WKWebView) {
        self.webView = webView
        webView.isOpaque = false
        apply(night: false)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              let night = message.body as? Bool else { return }
        apply(night: night)
    }

    private func apply(night: Bool) {
        let color = night
            ? UIColor(red: 14/255, green: 23/255, blue: 20/255, alpha: 1)
            : UIColor(red: 245/255, green: 242/255, blue: 233/255, alpha: 1)
        hostView?.backgroundColor = color
        hostView?.window?.overrideUserInterfaceStyle = night ? .dark : .light
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color
    }
}
