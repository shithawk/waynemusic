import SwiftUI
import WebKit

struct SoundCloudPlayerView: UIViewRepresentable {
    let pageURL: String
    @EnvironmentObject private var playback: PlaybackController

    func makeCoordinator() -> Coordinator {
        Coordinator(playback: playback)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WebPlayerFactory.makeWebView(handler: context.coordinator)
        load(pageURL, into: webView, coordinator: context.coordinator)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.playback = playback
        if context.coordinator.loadedURL != pageURL {
            load(pageURL, into: webView, coordinator: context.coordinator)
            return
        }
        if context.coordinator.lastToken != playback.webAction.token {
            context.coordinator.lastToken = playback.webAction.token
            webView.evaluateJavaScript("\(playback.webAction.name)();", completionHandler: nil)
        }
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        WebPlayerFactory.dismantle(uiView)
    }

    private func load(_ pageURL: String, into webView: WKWebView, coordinator: Coordinator) {
        coordinator.loadedURL = pageURL
        coordinator.lastToken = playback.webAction.token
        webView.loadHTMLString(Self.html(pageURL: pageURL), baseURL: URL(string: "https://w.soundcloud.com"))
    }

    private static func html(pageURL: String) -> String {
        """
        <!DOCTYPE html>
        <html>
        <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        html, body { margin: 0; height: 100%; background: #000; }
        iframe { width: 100%; height: 100%; border: 0; }
        </style>
        </head>
        <body>
        <iframe id="sc" allow="autoplay" scrolling="no"
          src="https://w.soundcloud.com/player/?url=\(percentEncode(pageURL))&amp;auto_play=true&amp;hide_related=true&amp;show_comments=false&amp;show_user=true&amp;show_reposts=false&amp;visual=true&amp;show_teaser=false"></iframe>
        <script src="https://w.soundcloud.com/player/api.js"></script>
        <script>
        var widget = SC.Widget(document.getElementById('sc'));
        widget.bind(SC.Widget.Events.READY, function() { widget.play(); });
        widget.bind(SC.Widget.Events.PLAY, function() {
          window.webkit.messageHandlers.player.postMessage('playing');
        });
        widget.bind(SC.Widget.Events.PAUSE, function() {
          window.webkit.messageHandlers.player.postMessage('paused');
        });
        widget.bind(SC.Widget.Events.FINISH, function() {
          window.webkit.messageHandlers.player.postMessage('ended');
        });
        function play() { widget.play(); }
        function pause() { widget.pause(); }
        function restart() { widget.seekTo(0); widget.play(); }
        </script>
        </body>
        </html>
        """
    }

    private static func percentEncode(_ value: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=?+")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var playback: PlaybackController
        var loadedURL: String?
        var lastToken = -1

        init(playback: PlaybackController) {
            self.playback = playback
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            let body = message.body as? String ?? ""
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                switch body {
                case "playing":
                    self.playback.isPlaying = true
                case "paused":
                    self.playback.isPlaying = false
                case "ended":
                    self.playback.trackFinished()
                default:
                    break
                }
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if navigationAction.navigationType == .linkActivated {
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }
    }
}
