//
//  AIClient.swift
//  CarCare
//
//  网页里发不出跨域请求（CORS），大模型 API 一律由原生代发，
//  边收边把增量文本回吐给网页：ccAiChunk(id, text) / ccAiDone(id) / ccAiError(id, msg)。
//  网页自己解析 SSE 的 data: 行，逐字显示。
//

import Foundation
import WebKit

final class AIClient {

    static let shared = AIClient()
    private init() {}

    private let lock = NSLock()
    private var tasks: [String: Task<Void, Never>] = [:]
    private var buffers: [String: String] = [:]
    private var flushing: Set<String> = []

    // MARK: - 对外

    func start(id: String, url: String, headers: [String: String], body: String, webView: WKWebView) {
        guard !id.isEmpty else { return }
        guard let u = URL(string: url), let scheme = u.scheme?.lowercased(),
              scheme == "https" || scheme == "http" else {
            fail(id, "接口地址无效，请填完整的 https:// 地址", webView)
            return
        }

        var req = URLRequest(url: u)
        req.httpMethod = "POST"
        req.timeoutInterval = 90
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = body.data(using: .utf8)

        let task = Task { [weak self] in
            guard let self = self else { return }
            do {
                let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                guard let http = resp as? HTTPURLResponse else {
                    self.fail(id, "服务器没有返回有效响应", webView)
                    return
                }
                if http.statusCode != 200 {
                    var data = Data()
                    for try await b in bytes {
                        data.append(b)
                        if data.count > 6000 { break }
                    }
                    self.fail(id, Self.errorText(data, status: http.statusCode), webView)
                    return
                }

                // AsyncLineSequence 会处理跨包的多字节字符，不会把中文切坏
                for try await line in bytes.lines {
                    if Task.isCancelled { return }
                    self.emit(id, line + "\n", webView)
                }
                if Task.isCancelled { return }
                self.finish(id, webView)
            } catch {
                if Task.isCancelled { return }
                self.fail(id, Self.friendly(error), webView)
            }
        }

        lock.lock()
        tasks[id] = task
        lock.unlock()
    }

    func cancel(id: String) {
        lock.lock()
        let t = tasks.removeValue(forKey: id)
        buffers.removeValue(forKey: id)
        flushing.remove(id)
        lock.unlock()
        t?.cancel()
    }

    // MARK: - 增量回吐（60ms 合并一次，避免频繁 evaluateJavaScript）

    private func emit(_ id: String, _ piece: String, _ webView: WKWebView) {
        lock.lock()
        buffers[id, default: ""] += piece
        let needSchedule = !flushing.contains(id)
        if needSchedule { flushing.insert(id) }
        lock.unlock()
        guard needSchedule else { return }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            let text = self.buffers.removeValue(forKey: id) ?? ""
            self.flushing.remove(id)
            self.lock.unlock()
            guard !text.isEmpty else { return }
            Self.call(webView, "ccAiChunk(\(Self.jsLiteral(id)),\(Self.jsLiteral(text)))")
        }
    }

    private func finish(_ id: String, _ webView: WKWebView) {
        lock.lock()
        let rest = buffers.removeValue(forKey: id) ?? ""
        tasks.removeValue(forKey: id)
        flushing.remove(id)
        lock.unlock()
        if !rest.isEmpty {
            Self.call(webView, "ccAiChunk(\(Self.jsLiteral(id)),\(Self.jsLiteral(rest)))")
        }
        Self.call(webView, "ccAiDone(\(Self.jsLiteral(id)))")
    }

    private func fail(_ id: String, _ msg: String, _ webView: WKWebView) {
        lock.lock()
        tasks.removeValue(forKey: id)
        buffers.removeValue(forKey: id)
        flushing.remove(id)
        lock.unlock()
        Self.call(webView, "ccAiError(\(Self.jsLiteral(id)),\(Self.jsLiteral(msg)))")
    }

    // MARK: - 工具

    private static func call(_ webView: WKWebView, _ js: String) {
        DispatchQueue.main.async {
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    static func jsLiteral(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s], options: [])) ?? Data("[\"\"]".utf8)
        let json = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(json.dropFirst().dropLast())
    }

    private static func errorText(_ data: Data, status: Int) -> String {
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let err = obj["error"] as? [String: Any] {
                if let m = err["message"] as? String { return "HTTP \(status)：\(m)" }
            }
            if let m = obj["message"] as? String { return "HTTP \(status)：\(m)" }
            if let m = obj["error"] as? String { return "HTTP \(status)：\(m)" }
        }
        let raw = String(data: data, encoding: .utf8) ?? ""
        let brief = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return "HTTP \(status)" + (brief.isEmpty ? "" : "：" + String(brief.prefix(180)))
    }

    private static func friendly(_ error: Error) -> String {
        let ns = error as NSError
        switch ns.code {
        case NSURLErrorNotConnectedToInternet: return "手机没有联网"
        case NSURLErrorTimedOut: return "请求超时，网络太慢或服务无响应"
        case NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost:
            return "连不上这个地址，检查接口地址或网络"
        case NSURLErrorAppTransportSecurityRequiresSecureConnection:
            return "该地址要求 HTTPS"
        default:
            return ns.localizedDescription
        }
    }
}
