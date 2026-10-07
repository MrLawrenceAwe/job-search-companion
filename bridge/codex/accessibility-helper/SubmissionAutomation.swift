import AppKit
import ApplicationServices
import Foundation

enum AutoSubmitResult: String {
    case submitted
    case readyForReview = "ready_for_review"
}

func settingsMatch(
    selectedValuesByCategory: [String: String],
    requiredSettings: [AutoSubmitCommand.Setting]
) -> Bool {
    requiredSettings.allSatisfy {
        selectedValuesByCategory[$0.category].map($0.matches) == true
    }
}

func autoSubmitIfConfigured(_ request: AutoSubmitCommand) -> AutoSubmitResult {
    guard AXIsProcessTrusted() else {
        fail("Accessibility permission is required to inspect and submit CV Fit Advisor tasks")
    }

    automation.bundleIdentifier = request.bundleIdentifier
    let existingApps = NSRunningApplication.runningApplications(
        withBundleIdentifier: request.bundleIdentifier
    )
    guard existingApps.count <= 1 else {
        fail("Multiple Codex application processes are running")
    }
    let existingApp = existingApps.first
    let preexistingComposers: [AXUIElement]
    if let existingApp {
        let existingApplicationRoot = AXUIElementCreateApplication(existingApp.processIdentifier)
        let preexistingScanDeadline = deadline(milliseconds: request.timeouts.composerMs)
        preexistingComposers = matchingComposers(
            in: existingApplicationRoot,
            jobURL: request.jobUrl,
            deadline: preexistingScanDeadline
        )
    } else {
        preexistingComposers = []
    }

    guard NSWorkspace.shared.open(request.newTaskUrl) else {
        fail("Could not open the prepared CV Fit Advisor draft")
    }
    let app = waitForRunningApplication(
        bundleIdentifier: request.bundleIdentifier,
        deadline: Date().addingTimeInterval(3)
    )
    if let bundleURL = app.bundleURL,
       let version = Bundle(url: bundleURL)?.object(
           forInfoDictionaryKey: "CFBundleShortVersionString"
       ) as? String {
        automation.appVersion = version
    }
    app.activate(options: [])
    let activationDeadline = Date().addingTimeInterval(2)
    while !app.isActive && Date() < activationDeadline {
        Thread.sleep(forTimeInterval: initialPollInterval)
    }
    guard app.isActive else {
        fail("Codex did not become the active app")
    }

    let applicationRoot = AXUIElementCreateApplication(app.processIdentifier)
    let composerDeadline = deadline(milliseconds: request.timeouts.composerMs)
    var freshComposers: [AXUIElement] = []
    guard waitUntil(deadline: composerDeadline, condition: {
        freshComposers = matchingComposers(
            in: applicationRoot,
            jobURL: request.jobUrl,
            deadline: composerDeadline
        )
            .filter { candidate in
                !preexistingComposers.contains { sameElement(candidate, $0) }
            }
        if freshComposers.count > 1 {
            fail("Codex exposed multiple new matching CV Fit Advisor composers")
        }
        return freshComposers.count == 1
    }), let preparedComposer = freshComposers.first else {
        fail("The prepared CV Fit Advisor composer did not become ready")
    }
    let searchRoot = elementAttribute(preparedComposer, kAXWindowAttribute) ?? applicationRoot

    let settingsSnapshot = openSettingsMenu(
        in: searchRoot,
        composer: preparedComposer,
        timeoutMs: request.timeouts.settingsMs
    )
    postKey(escapeKey)
    guard let settingsSnapshot else {
        return .readyForReview
    }
    guard settingsMatch(
        selectedValuesByCategory: settingsSnapshot.selectedValuesByCategory,
        requiredSettings: request.settings
    ) else {
        return .readyForReview
    }

    let preSubmissionScanDeadline = deadline(milliseconds: request.timeouts.composerMs)
    let preparedComposers = matchingComposers(
        in: searchRoot,
        jobURL: request.jobUrl,
        deadline: preSubmissionScanDeadline
    )
    guard preparedComposers.count == 1, let composer = preparedComposers.first,
          sameElement(composer, preparedComposer) else {
        fail("Expected the original prepared CV Fit Advisor composer to remain unique")
    }
    // Keep confirmation local to the composer. The window also contains the
    // conversation, which can grow dramatically as soon as the task starts.
    guard let composerRoot = elementAttribute(composer, kAXParentAttribute),
          !sameElement(composerRoot, searchRoot) else {
        fail("Could not isolate the prepared CV Fit Advisor composer for confirmation")
    }
    let preexistingClearedComposers = findElements(
        in: composerRoot,
        deadline: preSubmissionScanDeadline,
        matching: {
        optionalStringAttribute($0, kAXRoleAttribute) == kAXTextAreaRole
            && optionalStringAttribute($0, kAXValueAttribute)?
                .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true
        }
    )
    focus(composer, failureMessage: "The prepared CV Fit Advisor composer could not be focused")
    postKey(returnKey)

    let submissionDeadline = deadline(milliseconds: request.timeouts.submissionMs)
    var consecutiveConfirmations = 0
    var sleepInterval = initialPollInterval
    var submissionState = SubmissionEvidence(
        preparedPromptGone: false,
        freshClearedComposerCount: 0
    )
    while Date() < submissionDeadline {
        if app.isTerminated {
            fail("Codex terminated before submission was confirmed")
        }
        submissionState = readSubmissionEvidence(
            in: composerRoot,
            jobURL: request.jobUrl,
            preexistingClearedComposers: preexistingClearedComposers,
            deadline: submissionDeadline
        )
        if submissionState.isConfirmed {
            consecutiveConfirmations += 1
            if consecutiveConfirmations >= 3 {
                return .submitted
            }
        } else {
            consecutiveConfirmations = 0
        }
        Thread.sleep(forTimeInterval: sleepInterval)
        sleepInterval = min(maximumPollInterval, sleepInterval * 1.5)
    }
    fail(
        "Codex did not provide positive evidence that the CV Fit Advisor task was submitted "
            + "(preparedPromptGone=\(submissionState.preparedPromptGone), "
            + "freshClearedComposerCount=\(submissionState.freshClearedComposerCount))"
    )
}
