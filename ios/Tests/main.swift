import Foundation
let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: directory) }
let state: [String: Any] = ["intervalHours": 3.1, "intervalStartedAt": NSNull(), "entries": [["id": "test", "at": 1000, "amount": 120]]]
let store = try StateStore(directory: directory)
assert(store.request(method: "GET", payload: nil)["status"] as? Int == 200)
assert(store.request(method: "PUT", payload: ["revision": 0, "state": state])["status"] as? Int == 200)
assert(store.request(method: "PUT", payload: ["revision": 0, "state": state])["status"] as? Int == 409)
let reopened = try StateStore(directory: directory)
let body = reopened.request(method: "GET", payload: nil)["body"] as! [String: Any]
assert(body["revision"] as? Int == 1)
assert((body["state"] as! [String: Any])["intervalHours"] as? Double == 3.1)
var invalid = state
invalid["entries"] = [["id": "bad", "at": 1000, "amount": -1]]
assert(reopened.request(method: "PUT", payload: ["revision": 1, "state": invalid])["status"] as? Int == 400)
try Data("broken".utf8).write(to: directory.appendingPathComponent("state.json"))
do { _ = try StateStore(directory: directory); fatalError("Corrupt records were overwritten") } catch { }
print("PASS: save/reopen, conflict, invalid data, corrupt-file protection")
