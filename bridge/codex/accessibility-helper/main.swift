import AppKit
import ApplicationServices
import Foundation

private func contractSelfTestPasses() -> Bool {
    let requiredSettings = [
        AutoSubmitCommand.Setting(category: "Model", expectedValue: "6.1 Sol", match: .exact),
        AutoSubmitCommand.Setting(category: "Effort", expectedValue: "Medium", match: .exact),
        AutoSubmitCommand.Setting(category: "Speed", expectedValue: "Fast", match: .prefix),
    ]
    return uiContract.isModelPickerTitle("6.1 Sol Max")
        && !uiContract.isModelPickerTitle("6.1 Sol")
        && uniqueClosestIndex([2, 5, 9]) == 0
        && uniqueClosestIndex([4, 1, 8]) == 1
        && uniqueClosestIndex([3, 3]) == nil
        && settingsMatch(
            selectedValuesByCategory: ["Model": "6.1 Sol", "Effort": "Medium", "Speed": "Fast"],
            requiredSettings: requiredSettings
        )
        && settingsMatch(
            selectedValuesByCategory: [
                "Model": "6.1 Sol", "Effort": "Medium", "Speed": "Fast (2x credits)",
            ],
            requiredSettings: requiredSettings
        )
        && !settingsMatch(
            selectedValuesByCategory: ["Model": "6.1 Sol", "Effort": "High", "Speed": "Fast"],
            requiredSettings: requiredSettings
        )
        && SubmissionEvidence(preparedPromptGone: true, freshClearedComposerCount: 1).isConfirmed
        && !SubmissionEvidence(preparedPromptGone: false, freshClearedComposerCount: 1).isConfirmed
        && !SubmissionEvidence(preparedPromptGone: true, freshClearedComposerCount: 0).isConfirmed
}

if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "metadata" {
    guard contractSelfTestPasses() else {
        fail("Accessibility contract self-test failed")
    }
    print(
        #"{"protocolVersion":\#(CodexUIContract.protocolVersion),"contractVersion":"\#(CodexUIContract.contractVersion)"}"#
    )
    exit(0)
}

if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "contract-self-test" {
    guard contractSelfTestPasses() else {
        fail("Accessibility contract self-test failed")
    }
    print("ok")
    exit(0)
}

guard CommandLine.arguments.count == 3,
      CommandLine.arguments[1] == "auto-submit-if-configured",
      let request = AutoSubmitCommand(json: CommandLine.arguments[2]) else {
    fail("Expected auto-submit-if-configured followed by a valid JSON command")
}

let automationLock: AutomationLock
do {
    automationLock = try AutomationLock()
} catch {
    fail(error.localizedDescription)
}
print(autoSubmitIfConfigured(request).rawValue)
withExtendedLifetime(automationLock) {}
