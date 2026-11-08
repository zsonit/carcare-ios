import UIKit
import WebKit

/// 把一段 HTML 离屏渲染成 PDF（对应网页版「导出 PDF / 打印」）
final class PDFExporter: NSObject, WKNavigationDelegate {

    static let shared = PDFExporter()

    private var webView: WKWebView?
    private var completion: ((Data?) -> Void)?

    func makePDF(html: String, host: UIView, completion: @escaping (Data?) -> Void) {
        self.completion = completion

        let config = WKWebViewConfiguration()
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 794, height: 1123), configuration: config)
        web.navigationDelegate = self
        web.alpha = 0.02
        web.isUserInteractionEnabled = false
        host.addSubview(web)
        webView = web

        web.loadHTMLString(html, baseURL: nil)

        DispatchQueue.main.asyncAfter(deadline: .now() + 9) { [weak self] in
            self?.finish(nil)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self, weak webView] in
            guard let webView = webView else { self?.finish(nil); return }
            let config = WKPDFConfiguration()
            webView.createPDF(configuration: config) { result in
                switch result {
                case .success(let data):
                    self?.finish(data)
                case .failure:
                    self?.finish(nil)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(nil)
    }

    private func finish(_ data: Data?) {
        guard let callback = completion else { return }
        completion = nil
        webView?.removeFromSuperview()
        webView = nil
        callback(data)
    }
}
