import Darwin
import Foundation

enum AutomationLockError: LocalizedError {
    case lockDirectoryFailed
    case openFailed
    case alreadyRunning

    var errorDescription: String? {
        switch self {
        case .lockDirectoryFailed:
            return "Could not create the Accessibility helper lock directory"
        case .openFailed:
            return "Could not open the Accessibility helper for automation locking"
        case .alreadyRunning:
            return "Another CV Fit Advisor Accessibility operation is already running"
        }
    }
}

final class AutomationLock {
    private let descriptor: Int32

    init() throws {
        let supportDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Job Search Companion", isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: supportDirectory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
        } catch {
            throw AutomationLockError.lockDirectoryFailed
        }
        let lockPath = supportDirectory.appendingPathComponent("automation.lock").path
        descriptor = lockPath.withCString {
            Darwin.open($0, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
        }
        guard descriptor >= 0 else {
            throw AutomationLockError.openFailed
        }
        _ = fchmod(descriptor, 0o600)
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            throw AutomationLockError.alreadyRunning
        }
    }

    deinit {
        flock(descriptor, LOCK_UN)
        Darwin.close(descriptor)
    }
}
