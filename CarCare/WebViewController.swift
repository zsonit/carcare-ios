import UIKit
import WebKit
import UserNotifications
import Speech
import AVFoundation
import PhotosUI

/// 车管家 iOS 版：原生外壳 + WKWebView（内置同一套页面）+ 原生能力桥接
final class WebViewController: UIViewController {

    private var webView: WKWebView!
    private var server: LocalHTTPServer?

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

    // MARK: - 系统级定时提醒

    /// 网页把「待办事项」算好后整批交给原生，原生按日期排成本地通知。
    /// 这样即使几个月不打开 App，到期当天也会准时响。
    private func scheduleNotifications(_ items: [[String: Any]]) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            center.getPendingNotificationRequests { pending in
                let mine = pending.map { $0.identifier }.filter { $0.hasPrefix("cc_") }
                if !mine.isEmpty {
                    center.removePendingNotificationRequests(withIdentifiers: mine)
                }
                for item in items {
                    guard let id = item["id"] as? String, let ts = item["ts"] as? Double else { continue }
                    let date = Date(timeIntervalSince1970: ts / 1000.0)
                    guard date > Date() else { continue }
                    let content = UNMutableNotificationContent()
                    content.title = (item["title"] as? String) ?? "车管家"
                    content.body = (item["body"] as? String) ?? ""
                    content.sound = .default
                    var comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
                    comps.second = 0
                    let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
                    let req = UNNotificationRequest(identifier: "cc_" + id,
                                                    content: content, trigger: trigger)
                    center.add(req, withCompletionHandler: nil)
                }
            }
        }
    }

    private func setBadge(_ n: Int) {
        DispatchQueue.main.async {
            let v = max(0, n)
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(v, withCompletionHandler: nil)
            } else {
                UIApplication.shared.applicationIconBadgeNumber = v
            }
        }
    }

    // MARK: - 语音记账（系统语音识别，离线可用）

    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var voiceTimer: DispatchWorkItem?

    private func startVoice() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            guard let self = self else { return }
            guard status == .authorized else {
                DispatchQueue.main.async { self.presentToast("请在系统设置里允许「语音识别」") }
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { ok in
                guard ok else {
                    DispatchQueue.main.async { self.presentToast("请在系统设置里允许「麦克风」") }
                    return
                }
                DispatchQueue.main.async { self.beginRecognition() }
            }
        }
    }

    private func beginRecognition() {
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            presentToast("语音识别暂不可用")
            return
        }
        stopVoice()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            recognitionRequest = request

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }
            audioEngine.prepare()
            try audioEngine.start()

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self = self else { return }
                if let result = result, result.isFinal || error != nil {
                    let text = result.bestTranscription.formattedString
                    self.stopVoice()
                    self.deliverVoice(text)
                } else if error != nil {
                    self.stopVoice()
                }
            }
            presentToast("请说出内容，如「加油 300 块」")

            let work = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                if self.audioEngine.isRunning {
                    self.recognitionRequest?.endAudio()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.stopVoice() }
                }
            }
            voiceTimer = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 9, execute: work)
        } catch {
            stopVoice()
            presentToast("语音启动失败，请重试")
        }
    }

    private func stopVoice() {
        voiceTimer?.cancel()
        voiceTimer = nil
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func deliverVoice(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            presentToast("没听清，请再说一次")
            return
        }
        let js = "ccVoiceResult(\(WebViewController.jsLiteral(trimmed)));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private static func jsLiteral(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s], options: [])) ?? Data("[\"\"]".utf8)
        let json = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(json.dropFirst().dropLast())
    }

    // MARK: - AI 对话按住说话（按住识别、松开把文字交给网页发问）

    private var holdActive = false
    private var holdAwaitingFinal = false
    private var holdLastText = ""
    private var holdTimer: DispatchWorkItem?
    private var holdFinalTimer: DispatchWorkItem?

    private static func callHold(_ webView: WKWebView?, _ js: String) {
        DispatchQueue.main.async {
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func startVoiceHold() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            guard let self = self else { return }
            guard status == .authorized else {
                DispatchQueue.main.async { self.failVoiceHold("请在系统设置里允许「语音识别」") }
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { ok in
                guard ok else {
                    DispatchQueue.main.async { self.failVoiceHold("请在系统设置里允许「麦克风」") }
                    return
                }
                DispatchQueue.main.async { self.beginVoiceHold() }
            }
        }
    }

    private func beginVoiceHold() {
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            failVoiceHold("语音识别暂不可用")
            return
        }
        stopVoice()
        holdActive = true
        holdAwaitingFinal = false
        holdLastText = ""
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            recognitionRequest = request

            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }
            audioEngine.prepare()
            try audioEngine.start()

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self = self else { return }
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    if !text.isEmpty {
                        self.holdLastText = text
                        if self.holdActive {
                            Self.callHold(self.webView, "ccAiVoicePartial(\(WebViewController.jsLiteral(text)))")
                        }
                    }
                    if result.isFinal {
                        self.finishVoiceHold(text: text)
                        return
                    }
                }
                if error != nil {
                    if self.holdAwaitingFinal {
                        self.finishVoiceHold(text: self.holdLastText)
                    } else if self.holdActive {
                        self.failVoiceHold("识别出错，请再试一次")
                    }
                }
            }

            // 最长 30 秒自动收尾（当作正常松开）
            let work = DispatchWorkItem { [weak self] in
                guard let self = self, self.holdActive else { return }
                self.releaseVoiceHold(cancel: false)
            }
            holdTimer = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: work)
        } catch {
            failVoiceHold("语音启动失败，请重试")
        }
    }

    private func releaseVoiceHold(cancel: Bool) {
        holdTimer?.cancel()
        holdTimer = nil
        guard holdActive else {
            if cancel { Self.callHold(webView, "ccAiVoiceCancel()") }
            return
        }
        if cancel {
            holdActive = false
            stopVoice()
            Self.callHold(webView, "ccAiVoiceCancel()")
            return
        }
        holdActive = false
        holdAwaitingFinal = true
        recognitionRequest?.endAudio()
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        // 3 秒兜底：final 迟迟不返回就用最后的部分结果
        let fb = DispatchWorkItem { [weak self] in
            guard let self = self, self.holdAwaitingFinal else { return }
            self.finishVoiceHold(text: self.holdLastText)
        }
        holdFinalTimer = fb
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: fb)
    }

    private func finishVoiceHold(text: String) {
        holdFinalTimer?.cancel()
        holdFinalTimer = nil
        guard holdActive || holdAwaitingFinal else { return }
        holdActive = false
        holdAwaitingFinal = false
        stopVoice()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        Self.callHold(webView, "ccAiVoiceResult(\(WebViewController.jsLiteral(trimmed)))")
    }

    private func failVoiceHold(_ reason: String) {
        holdTimer?.cancel()
        holdTimer = nil
        holdFinalTimer?.cancel()
        holdFinalTimer = nil
        holdActive = false
        holdAwaitingFinal = false
        stopVoice()
        DispatchQueue.main.async { self.presentToast(reason) }
        Self.callHold(webView, "ccAiVoiceCancel()")
    }

    private func makePDF(html: String, name: String) {        PDFExporter.shared.makePDF(html: html, host: view) { [weak self] data in
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

        case "schedule":
            // 网页算好的到期事项，整批交给系统排程
            let items = body["items"] as? [[String: Any]] ?? []
            scheduleNotifications(items)

        case "badge":
            setBadge((body["count"] as? NSNumber)?.intValue ?? 0)

        case "voice":
            startVoice()

        case "aiVoiceStart":
            // AI 对话：按住开始说话
            startVoiceHold()

        case "aiVoiceEnd":
            // 松开结束；cancel=true 表示上滑取消
            releaseVoiceHold(cancel: (body["cancel"] as? NSNumber)?.boolValue ?? false)

        case "ai":
            // 大模型请求由原生代发（WebView 直连会被 CORS 拦），流式回吐给网页
            let id = body["id"] as? String ?? ""
            let url = body["url"] as? String ?? ""
            let payload = body["body"] as? String ?? "{}"
            let headers = body["headers"] as? [String: String] ?? [:]
            AIClient.shared.start(id: id, url: url, headers: headers,
                                  body: payload, webView: self.webView)

        case "aiAbort":
            AIClient.shared.cancel(id: body["id"] as? String ?? "")

        case "pickImage":
            // 拍照问AI / 报告解读：拍照或从相册选图，压缩后回传网页
            presentImagePicker()

        default:
            break
        }
    }
}

// MARK: - 选图（拍照问AI / 报告解读）

extension WebViewController: UIImagePickerControllerDelegate, UINavigationControllerDelegate, PHPickerViewControllerDelegate {

    /// WebView 的 <input type=file> 在 iOS 里不生效，原生弹「拍照 / 相册」选择
    func presentImagePicker() {
        let alert = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            alert.addAction(UIAlertAction(title: "拍照", style: .default) { [weak self] _ in
                self?.openCameraPicker()
            })
        }
        alert.addAction(UIAlertAction(title: "从相册选择", style: .default) { [weak self] _ in
            self?.openLibraryPicker()
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { [weak self] _ in
            self?.returnPickedImage(nil)
        })
        present(alert, animated: true)
    }

    private func openCameraPicker() {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = self
        present(picker, animated: true)
    }

    private func openLibraryPicker() {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        present(picker, animated: true)
    }

    func imagePickerController(_ picker: UIImagePickerController,
                               didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        let image = (info[.editedImage] ?? info[.originalImage]) as? UIImage
        returnPickedImage(image)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        returnPickedImage(nil)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let item = results.first?.itemProvider, item.canLoadObject(ofClass: UIImage.self) else {
            returnPickedImage(nil)
            return
        }
        item.loadObject(ofClass: UIImage.self) { [weak self] obj, _ in
            DispatchQueue.main.async {
                self?.returnPickedImage(obj as? UIImage)
            }
        }
    }

    /// 压到最长边 1280、JPEG 0.8，以 data URL 回传网页（window.ccPickImageResult）
    private func returnPickedImage(_ image: UIImage?) {
        guard let image = image else {
            evaluateJS("window.ccPickImageResult && window.ccPickImageResult(null)")
            return
        }
        let maxSide: CGFloat = 1280
        var target = image
        let longSide = max(image.size.width, image.size.height)
        if longSide > maxSide {
            let k = maxSide / longSide
            let size = CGSize(width: image.size.width * k, height: image.size.height * k)
            UIGraphicsBeginImageContextWithOptions(size, true, 1)
            image.draw(in: CGRect(origin: .zero, size: size))
            if let scaled = UIGraphicsGetImageFromCurrentImageContext() { target = scaled }
            UIGraphicsEndImageContext()
        }
        guard let data = target.jpegData(compressionQuality: 0.8) else {
            evaluateJS("window.ccPickImageResult && window.ccPickImageResult(null)")
            return
        }
        let b64 = data.base64EncodedString()
        evaluateJS("window.ccPickImageResult && window.ccPickImageResult('data:image/jpeg;base64,\(b64)')")
    }

    private func evaluateJS(_ js: String) {
        webView.evaluateJavaScript(js, completionHandler: nil)
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
        } else if url.scheme == "tel" || url.scheme == "mailto" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            decisionHandler(.cancel)
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
