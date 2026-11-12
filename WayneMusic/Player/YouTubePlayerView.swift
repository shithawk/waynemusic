import SwiftUI
import WebKit

struct YouTubePlayerView: UIViewRepresentable {
    let videoID: String
    @EnvironmentObject private var playback: PlaybackController

    func makeCoordinator() -> Coordinator {
        Coordinator(playback: playback)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WebPlayerFactory.makeWebView(handler: context.coordinator)
        load(videoID, into: webView, coordinator: context.coordinator)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.playback = playback
        if context.coordinator.loadedID != videoID {
            load(videoID, into: webView, coordinator: context.coordinator)
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

    private func load(_ videoID: String, into webView: WKWebView, coordinator: Coordinator) {
        coordinator.loadedID = videoID
        coordinator.lastToken = playback.webAction.token
        webView.loadHTMLString(Self.html(videoID: videoID), baseURL: URL(string: "https://www.youtube.com"))
    }

    private static func html(videoID: String) -> String {
        """
        <!DOCTYPE html>
        <html>
        <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        html, body { margin: 0; height: 100%; background: #000; }
        #player { width: 100%; height: 100%; }
        </style>
        </head>
        <body>
        <div id="player"></div>
        <script>
        var player;
        function onYouTubeIframeAPIReady() {
          player = new YT.Player('player', {
            videoId: '\(videoID)',
            playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, fs: 0, iv_load_policy: 3 },
            events: {
              onReady: function() { player.playVideo(); },
              onStateChange: function(event) {
                window.webkit.messageHandlers.player.postMessage(String(event.data));
              },
              onError: function() {
                window.webkit.messageHandlers.player.postMessage('error');
              }
            }
          });
        }
        function play() { if (player && player.playVideo) player.playVideo(); }
        function pause() { if (player && player.pauseVideo) player.pauseVideo(); }
        function restart() {
          if (player && player.seekTo) { player.seekTo(0, true); player.playVideo(); }
        }
        var tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.body.appendChild(tag);
        </script>
        </body>
        </html>
        """
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var playback: PlaybackController
        var loadedID: String?
        var lastToken = -1

        init(playback: PlaybackController) {
            self.playback = playback
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            let body = message.body as? String ?? ""
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                switch body {
                case "1":
                    self.playback.isPlaying = true
                case "2":
                    self.playback.isPlaying = false
                case "0":
                    self.playback.trackFinished()
                case "error":
                    self.playback.report("This video cannot be played here.")
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
