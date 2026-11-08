import UIKit
import WebKit
import PhotosUI
import UniformTypeIdentifiers
import UserNotifications

/// 车管家 iOS 版：原生外壳 + WKWebView（内置同一套页面）+ 原生能力桥接
final class WebViewController: UIViewController {

    private var webView: WKWebView!
    private var server: LocalHTTPServer?
    private var uploadCompletion: (([URL]?) -> Void)?

    private static let portKey = "carcare_local_port"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.957, green: 0.965, blue: 0.976, alpha: 1)
        setupWebView()
        startServerAndLoad()
        observeKeyboard()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        UIDevice.current.userInterfaceIdiom == .pad ? .all : .portrait
    }

    // MARK: - WebView

    private func setupWebView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = WKUserContentController()
        controller.add(self, name: "carcare")
        if let jsURL = Bundle.main.url(forResource: "bridge", withExtension: "js", subdirectory: "web"),
           let js = try? String(contentsOf: jsURL, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: js,
                                                  injectionTime: .atDocumentStart,
                                                  forMainFrameOnly: false))
        }
        config.userContentController = controller

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.scrollView.showsVerticalScrollIndicator = false
        web.isOpaque = false
        web.backgroundColor = .clear
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        webView = web
    }

    private func startServerAndLoad() {
        guard let root = Bundle.main.url(forResource: "web", withExtension: nil) else {
            showFatal("内置页面资源缺失")
            return
        }
        let saved = UInt16(truncatingIfNeeded: UserDefaults.standard.integer(forKey: Self.portKey))
        var candidates: [UInt16] = []
        if saved > 1024 { candidates.append(saved) }
        candidates.append(contentsOf: [48700, 48701, 48702, 48703, 48704, 48705])

        let srv = LocalHTTPServer(root: root)
        guard let port = srv.start(candidates: candidates) else {
            showFatal("本地服务启动失败，请重启应用")
            return
        }
        UserDefaults.standard.set(Int(port), forKey: Self.portKey)
        server = srv

        guard let url = URL(string: "http://127.0.0.1:\(port)/index.html") else {
            showFatal("页面地址无效")
            return
        }
        webView.load(URLRequest(url: url))
    }

    private func showFatal(_ message: String) {
        let label = UILabel()
        label.text = message
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .darkGray
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48)
        ])
    }

    // MARK: - 键盘

    private func observeKeyboard() {
        NotificationCenter.default.addObserver(self,
                                              selector: #selector(keyboardChanged(_:)),
                                              name: UIResponder.keyboardWillChangeFrameNotification,
                                              object: nil)
        NotificationCenter.default.addObserver(self,
                                              selector: #selector(keyboardChanged(_:)),
                                              name: UIResponder.keyboardWillHideNotification,
                                              object: nil)
    }

    @objc private func keyboardChanged(_ note: Notification) {
        guard let webView = webView else { return }
        if note.name == UIResponder.keyboardWillHideNotification {
            webView.scrollView.contentInset = .zero
            webView.scrollView.scrollIndicatorInsets = .zero
            return
        }
        guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let converted = view.convert(frame, from: nil)
        let overlap = max(0, view.bounds.maxY - converted.minY)
        let inset = UIEdgeInsets(top: 0, left: 0, bottom: overlap, right: 0)
        webView.scrollView.contentInset = inset
        webView.scrollView.scrollIndicatorInsets = inset
    }

    // MARK: - 原生能力

    private func notify(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title.isEmpty ? "车管家" : title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    private func shareFile(text: String, name: String) {
        let safeName = name.replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
        do {
            try text.data(using: .utf8)?.write(to: url, options: .atomic)
        } catch {
            presentToast("导出失败：\(error.localizedDescription)")
            return
        }
        share(urls: [url])
    }

    private func share(urls: [URL]) {
        let activity = UIActivityViewController(activityItems: urls, applicationActivities: nil)
        if let pop = activity.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        if let presented = presentedViewController {
            presented.dismiss(animated: false) { [weak self] in
                self?.present(activity, animated: true, completion: nil)
            }
        } else {
            present(activity, animated: true, completion: nil)
        }
    }

    private func presentToast(_ text: String) {
        let alert = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        present(alert, animated: true, completion: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            alert.dismiss(animated: true, completion: nil)
        }
    }

    private func previewImage(dataURL: String) {
        guard let range = dataURL.range(of: "base64,") else { return }
        let base64 = String(dataURL[range.upperBound...])
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data) else { return }
        present(ImagePreviewController(image: image), animated: true, completion: nil)
    }

    private func makePDF(html: String, name: String) {
        PDFExporter.shared.makePDF(html: html, host: view) { [weak self] data in
            guard let self = self else { return }
            guard let data = data else {
                self.presentToast("PDF 生成失败，请重试")
                return
            }
            let safeName = name.replacingOccurrences(of: "/", with: "_")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
            do {
                try data.write(to: url, options: .atomic)
                self.share(urls: [url])
            } catch {
                self.presentToast("PDF 保存失败")
            }
        }
    }

    private func saveTempImage(_ image: UIImage) -> URL? {
        guard let data = image.jpegData(compressionQuality: 0.92) else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("upload_\(UUID().uuidString).jpg")
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    private func finishUpload(_ urls: [URL]?) {
        let callback = uploadCompletion
        uploadCompletion = nil
        callback?(urls)
    }

    private func showImageSourceOptions() {
        let sheet = UIAlertController(title: "选择凭证图片", message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "从相册选择", style: .default) { [weak self] _ in
            self?.presentPhotoLibrary()
        })
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            sheet.addAction(UIAlertAction(title: "拍照", style: .default) { [weak self] _ in
                self?.presentCamera()
            })
        }
        sheet.addAction(UIAlertAction(title: "从「文件」选择", style: .default) { [weak self] _ in
            self?.presentDocumentPicker()
        })
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in
            self?.finishUpload(nil)
        })
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 60, width: 1, height: 1)
        }
        present(sheet, animated: true, completion: nil)
    }

    private func presentPhotoLibrary() {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true, completion: nil)
    }

    private func presentCamera() {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = self
        present(picker, animated: true, completion: nil)
    }

    private func presentDocumentPicker() {
        let types: [UTType] = [.json, .image, .data]
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true, completion: nil)
    }
}

// MARK: - 网页桥接

extension WebViewController: WKScriptMessageHandler {

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        switch type {
        case "notify":
            notify(title: body["title"] as? String ?? "车管家",
                   body: body["body"] as? String ?? "")

        case "shareFile":
            let name = body["name"] as? String ?? "export.csv"
            let text = body["text"] as? String ?? ""
            shareFile(text: text, name: name)

        case "sharePDF":
            let html = body["html"] as? String ?? ""
            let name = body["name"] as? String ?? "维保记录.pdf"
            makePDF(html: html, name: name)

        case "previewImage":
            if let dataURL = body["dataURL"] as? String {
                previewImage(dataURL: dataURL)
            }

        default:
            break
        }
    }
}

// MARK: - 导航策略

extension WebViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if url.scheme == "http" || url.scheme == "https" {
            let host = url.host ?? ""
            if host == "127.0.0.1" || host == "localhost" {
                decisionHandler(.allow)
            } else {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                decisionHandler(.cancel)
            }
        } else if url.scheme == "about" || url.scheme == "data" || url.scheme == "blob" {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadError(error)
    }

    private func showLoadError(_ error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self, self.presentedViewController == nil else { return }
            let alert = UIAlertController(title: "页面加载失败",
                                          message: error.localizedDescription,
                                          preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "重试", style: .default) { _ in
                if let url = self.webView.url {
                    self.webView.load(URLRequest(url: url))
                } else {
                    self.startServerAndLoad()
                }
            })
            self.present(alert, animated: true, completion: nil)
        }
    }
}

// MARK: - 弹窗 / 文件选择

extension WebViewController: WKUIDelegate {

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "车管家", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(alert, animated: true, completion: nil)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "车管家", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true, completion: nil)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: "车管家", message: prompt, preferredStyle: .alert)
        alert.addTextField { field in field.text = defaultText }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        present(alert, animated: true, completion: nil)
    }

    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        if uploadCompletion != nil {
            completionHandler(nil)
            return
        }
        uploadCompletion = completionHandler

        let acceptsImage = parameters.allowedMIMETypes.isEmpty
            || parameters.allowedMIMETypes.contains { $0.lowercased().hasPrefix("image") }

        if acceptsImage {
            showImageSourceOptions()
        } else {
            presentDocumentPicker()
        }
    }

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url,
           url.absoluteString != "about:blank",
           url.scheme != "about" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        return nil
    }
}

// MARK: - 图片选择

extension WebViewController: PHPickerViewControllerDelegate {

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true, completion: nil)
        guard let provider = results.first?.itemProvider,
              provider.canLoadObject(ofClass: UIImage.self) else {
            finishUpload(nil)
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            guard let self = self else { return }
            let image = object as? UIImage
            DispatchQueue.main.async {
                if let image = image, let url = self.saveTempImage(image) {
                    self.finishUpload([url])
                } else {
                    self.finishUpload(nil)
                }
            }
        }
    }
}

extension WebViewController: UIImagePickerControllerDelegate, UINavigationControllerDelegate {

    func imagePickerController(_ picker: UIImagePickerController,
                               didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true, completion: nil)
        if let image = info[.originalImage] as? UIImage, let url = saveTempImage(image) {
            finishUpload([url])
        } else {
            finishUpload(nil)
        }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true, completion: nil)
        finishUpload(nil)
    }
}

extension WebViewController: UIDocumentPickerDelegate {

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishUpload(urls.isEmpty ? nil : urls)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishUpload(nil)
    }
}
