import UIKit
import WebKit

enum WebPlayerFactory {
    static func makeWebView(handler: WKScriptMessageHandler & WKNavigationDelegate) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        config.userContentController.add(handler, name: "player")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = handler
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.allowsLinkPreview = false
        return webView
    }

    static func dismantle(_ webView: WKWebView) {
        webView.evaluateJavaScript("pause();", completionHandler: nil)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "player")
    }
}
