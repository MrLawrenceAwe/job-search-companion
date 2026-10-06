import Foundation

struct AutoSubmitCommand: Decodable {
    struct Timeouts: Decodable {
        let composerMs: Double
        let settingsMs: Double
        let submissionMs: Double
    }

    struct Setting: Decodable {
        enum Match: String, Decodable {
            case exact
            case prefix
        }

        let category: String
        let expectedValue: String
        let match: Match

        func matches(_ title: String) -> Bool {
            switch match {
            case .exact:
                return title == expectedValue
            case .prefix:
                return title == expectedValue || title.hasPrefix("\(expectedValue) ")
            }
        }
    }

    let jobUrl: String
    let newTaskUrl: URL
    let bundleIdentifier: String
    let settings: [Setting]
    let timeouts: Timeouts

    init?(json: String) {
        guard let data = json.data(using: .utf8),
              let command = try? JSONDecoder().decode(Self.self, from: data),
              command.newTaskUrl.scheme == "codex",
              command.newTaskUrl.host == "threads",
              command.newTaskUrl.path == "/new",
              command.settings.count == 3,
              command.timeouts.composerMs > 0,
              command.timeouts.settingsMs > 0,
              command.timeouts.submissionMs > 0 else {
            return nil
        }
        self = command
    }
}
