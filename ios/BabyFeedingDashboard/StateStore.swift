import Foundation
import CoreFoundation

final class StateStore {
    private let url: URL
    private var stored: [String: Any]
    init(directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        url = directory.appendingPathComponent("state.json")
        if FileManager.default.fileExists(atPath: url.path) {
            guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
                  let revision = value["revision"] as? Int, revision >= 0,
                  let state = value["state"] as? [String: Any], Self.valid(state) else {
                throw NSError(domain: "StateStore", code: 1, userInfo: [NSLocalizedDescriptionKey: "本机记录文件损坏，请先保留文件并检查。"])
            }
            stored = value
        } else {
            stored = ["revision": 0, "state": ["intervalHours": NSNull(), "intervalStartedAt": NSNull(), "entries": []] as [String: Any]]
        }
    }
    func request(method: String, payload: [String: Any]?) -> [String: Any] {
        if method == "GET" { return response(200) }
        guard method == "PUT", let payload, let revision = payload["revision"] as? Int,
              let state = payload["state"] as? [String: Any], Self.valid(state) else {
            return ["status": 400, "body": ["error": "记录格式无效。"]]
        }
        guard revision == stored["revision"] as? Int else { return response(409) }
        let updated: [String: Any] = ["revision": revision + 1, "state": state]
        do {
            let data = try JSONSerialization.data(withJSONObject: updated, options: [.sortedKeys])
            try data.write(to: url, options: .atomic)
            stored = updated
            return response(200)
        } catch { return ["status": 500, "body": ["error": "无法保存记录，请检查设备存储空间。"]] }
    }
    private func response(_ status: Int) -> [String: Any] {
        var body = stored
        body["initialized"] = (stored["revision"] as? Int ?? 0) > 0
        return ["status": status, "body": body]
    }
    static func valid(_ state: [String: Any]) -> Bool {
        guard let hours = state["intervalHours"], let started = state["intervalStartedAt"],
              let entries = state["entries"] as? [[String: Any]], entries.count <= 10000 else { return false }
        func number(_ value: Any) -> Double? {
            guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
            return n.doubleValue.isFinite ? n.doubleValue : nil
        }
        if !(hours is NSNull) {
            guard let n = number(hours), n >= 0.5, n <= 24, abs(n * 10 - (n * 10).rounded()) < 1e-8 else { return false }
        }
        if !(started is NSNull) { guard let n = number(started), n > 0 else { return false } }
        var ids = Set<String>()
        for entry in entries {
            guard let id = entry["id"] as? String, !id.isEmpty, id.count <= 120, ids.insert(id).inserted,
                  let at = entry["at"].flatMap(number), at > 0,
                  let amount = entry["amount"].flatMap(number), amount >= 1, amount <= 2000, amount == amount.rounded() else { return false }
            if let auto = entry["auto"] { guard let n = auto as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return false } }
        }
        return true
    }
}
