import ApplicationServices
import Foundation

struct SubmissionEvidence {
    let preparedPromptGone: Bool
    let freshClearedComposerCount: Int

    var isConfirmed: Bool {
        preparedPromptGone && freshClearedComposerCount == 1
    }
}

func readSubmissionEvidence(
    in searchRoot: AXUIElement,
    preparedComposer: AXUIElement,
    jobURL: String,
    preexistingClearedComposers: [AXUIElement],
    deadline: Date
) -> SubmissionEvidence {
    // The uniquely identified composer may be reused after Send. Reading it
    // directly avoids a tree scan while the conversation is being rendered.
    if let value = optionalStringAttribute(preparedComposer, kAXValueAttribute),
       value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return SubmissionEvidence(preparedPromptGone: true, freshClearedComposerCount: 1)
    }
    var preparedPromptPresent = false
    var freshClearedComposerCount = 0
    for composer in findElements(in: searchRoot, deadline: deadline, matching: {
        optionalStringAttribute($0, kAXRoleAttribute) == kAXTextAreaRole
    }) {
        guard let value = optionalStringAttribute(composer, kAXValueAttribute) else {
            continue
        }
        if value.contains(promptMarker) && value.contains(jobURL) {
            preparedPromptPresent = true
        } else if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !preexistingClearedComposers.contains(where: { sameElement($0, composer) }) {
            freshClearedComposerCount += 1
        }
    }
    return SubmissionEvidence(
        preparedPromptGone: !preparedPromptPresent,
        freshClearedComposerCount: freshClearedComposerCount
    )
}
