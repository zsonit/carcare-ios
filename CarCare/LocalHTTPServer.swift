import Foundation
import Network

/// 极简本地 HTTP 服务：把 App 内置的 web 资源以 http://127.0.0.1:PORT 提供，
/// 这样 WKWebView 里的页面拥有正常同源环境（localStorage / fetch 全部可用），
/// 行为与安卓 WebView 版、浏览器版完全一致。
final class LocalHTTPServer {

    private let root: URL
    private let queue = DispatchQueue(label: "com.zsonit.carcare.http")
    private var listener: NWListener?
    private(set) var port: UInt16 = 0

    init(root: URL) {
        self.root = root
    }

    deinit {
        listener?.cancel()
    }

    /// 依次尝试候选端口，返回成功绑定的端口
    func start(candidates: [UInt16]) -> UInt16? {
        for candidate in candidates {
            guard let nwPort = NWEndpoint.Port(rawValue: candidate) else { continue }
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            if let port = attempt(port: nwPort, params: params) {
                self.port = port
                return port
            }
        }
        return nil
    }

    private func attempt(port nwPort: NWEndpoint.Port, params: NWParameters) -> UInt16? {
        do {
            let l = try NWListener(using: params, on: nwPort)
            let sem = DispatchSemaphore(value: 0)
            var ready = false
            l.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    ready = true
                    sem.signal()
                case .failed, .cancelled:
                    sem.signal()
                default:
                    break
                }
            }
            l.newConnectionHandler = { [weak self] connection in
                self?.handle(connection)
            }
            l.start(queue: queue)
            _ = sem.wait(timeout: .now() + 2.0)
            if ready, let bound = l.port?.rawValue {
                listener = l
                return bound
            }
            l.cancel()
            return nil
        } catch {
            return nil
        }
    }

    // MARK: - 请求处理

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        read(connection, buffer: Data())
    }

    private func read(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { connection.cancel(); return }
            var buf = buffer
            if let data = data, !data.isEmpty { buf.append(data) }
            if let headerEnd = buf.range(of: Data("\r\n\r\n".utf8)) {
                let header = String(data: buf.subdata(in: 0..<headerEnd.lowerBound), encoding: .utf8) ?? ""
                self.respond(connection, header: header)
                return
            }
            if error != nil || isComplete || buf.count > 64 * 1024 {
                connection.cancel()
                return
            }
            self.read(connection, buffer: buf)
        }
    }

    private func respond(_ connection: NWConnection, header: String) {
        let firstLine = header.components(separatedBy: "\r\n").first ?? ""
        let parts = firstLine.components(separatedBy: " ")
        guard parts.count >= 2 else {
            send(connection, status: 400, body: Data(), mime: "text/plain")
            return
        }
        var path = parts[1]
        if let q = path.firstIndex(of: "?") { path = String(path[path.startIndex..<q]) }
        if let h = path.firstIndex(of: "#") { path = String(path[path.startIndex..<h]) }
        path = path.removingPercentEncoding ?? path
        if path.isEmpty || path == "/" { path = "/index.html" }
        while path.hasPrefix("/") { path.removeFirst() }
        guard !path.contains("..") else {
            send(connection, status: 403, body: Data(), mime: "text/plain")
            return
        }

        var fileURL = root.appendingPathComponent(path)
        var mime = LocalHTTPServer.mimeType(for: path)
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            fileURL = root.appendingPathComponent("index.html")
            mime = "text/html; charset=utf-8"
        }
        guard let body = try? Data(contentsOf: fileURL) else {
            send(connection, status: 404, body: Data("Not Found".utf8), mime: "text/plain")
            return
        }
        send(connection, status: 200, body: body, mime: mime)
    }

    private func send(_ connection: NWConnection, status: Int, body: Data, mime: String) {
        let reason: String
        switch status {
        case 200: reason = "OK"
        case 400: reason = "Bad Request"
        case 403: reason = "Forbidden"
        case 404: reason = "Not Found"
        default: reason = "Error"
        }
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        head += "Content-Type: \(mime)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Cache-Control: no-cache\r\n"
        head += "Access-Control-Allow-Origin: *\r\n"
        head += "Connection: close\r\n\r\n"
        var payload = Data(head.utf8)
        payload.append(body)
        connection.send(content: payload, isComplete: true, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    static func mimeType(for path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
