import AppKit
import ApplicationServices
import Foundation

let promptMarker = "$cv-fit-advisor"
let initialPollInterval = 0.05
let maximumPollInterval = 0.4
let maxTreeDepth = 100
let maxTreeNodeCount = 10_000
let returnKey: CGKeyCode = 36
let escapeKey: CGKeyCode = 53
final class AutomationContext {
    var bundleIdentifier = ""
    var appVersion = "unknown"

    func fail(_ message: String) -> Never {
        FileHandle.standardError.write(
            Data((
                "\(message) [Accessibility contract \(CodexUIContract.contractVersion), "
                    + "Codex \(appVersion)]\n"
            ).utf8)
        )
        exit(1)
    }

    func postKey(_ virtualKey: CGKeyCode) {
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleIdentifier else {
            fail("Codex lost focus before automation completed")
        }
        guard let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: virtualKey, keyDown: false) else {
            fail("Could not create a keyboard event")
        }
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }
}

let automation = AutomationContext()
let uiContract = CodexUIContract()

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

func stringAttributeOrEmpty(_ element: AXUIElement, _ name: String) -> String {
    optionalStringAttribute(element, name) ?? ""
}

func optionalStringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success,
          let value else {
        return nil
    }
    return String(describing: value)
}

func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name),
          CFGetTypeID(value) == AXUIElementGetTypeID() else {
        return nil
    }
    return unsafeDowncast(value, to: AXUIElement.self)
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}

func sameElement(_ left: AXUIElement, _ right: AXUIElement) -> Bool {
    CFEqual(left, right)
}

func fail(_ message: String) -> Never {
    automation.fail(message)
}

func postKey(_ virtualKey: CGKeyCode) {
    automation.postKey(virtualKey)
}

func findElements(
    in element: AXUIElement,
    deadline: Date,
    matching predicate: (AXUIElement) -> Bool
) -> [AXUIElement] {
    var matches: [AXUIElement] = []
    var stack: [(element: AXUIElement, depth: Int)] = [(element, 0)]
    var visitedElementCount = 0
    while let current = stack.popLast() {
        guard Date() < deadline else {
            fail("Codex Accessibility tree scan exceeded its deadline")
        }
        visitedElementCount += 1
        guard visitedElementCount <= maxTreeNodeCount else {
            fail("Codex Accessibility tree exceeded the \(maxTreeNodeCount)-element safety limit")
        }
        if predicate(current.element) {
            matches.append(current.element)
        }
        if current.depth < maxTreeDepth {
            for child in children(current.element).reversed() {
                stack.append((child, current.depth + 1))
            }
        }
    }
    return matches
}

func focus(_ element: AXUIElement, failureMessage: String) {
    guard AXUIElementSetAttributeValue(
        element,
        kAXFocusedAttribute as CFString,
        kCFBooleanTrue
    ) == .success else {
        fail(failureMessage)
    }
}

func press(_ element: AXUIElement, failureMessage: String) {
    guard AXUIElementPerformAction(element, kAXPressAction as CFString) == .success else {
        fail(failureMessage)
    }
}

func waitUntil(deadline: Date, condition: () -> Bool) -> Bool {
    var sleepInterval = initialPollInterval
    while Date() < deadline {
        if condition() {
            return true
        }
        Thread.sleep(forTimeInterval: sleepInterval)
        sleepInterval = min(maximumPollInterval, sleepInterval * 1.5)
    }
    return false
}

func deadline(milliseconds: Double) -> Date {
    Date().addingTimeInterval(milliseconds / 1000)
}

func waitForRunningApplication(
    bundleIdentifier: String,
    deadline: Date
) -> NSRunningApplication {
    while Date() < deadline {
        if let app = NSRunningApplication.runningApplications(
            withBundleIdentifier: bundleIdentifier
        ).first {
            return app
        }
        Thread.sleep(forTimeInterval: initialPollInterval)
    }
    fail("Codex did not start")
}

func isMatchingComposer(_ element: AXUIElement, jobURL: String) -> Bool {
    guard optionalStringAttribute(element, kAXRoleAttribute) == kAXTextAreaRole,
          let value = optionalStringAttribute(element, kAXValueAttribute) else {
        return false
    }
    return value.contains(promptMarker) && value.contains(jobURL)
}

func matchingComposers(
    in root: AXUIElement,
    jobURL: String,
    deadline: Date
) -> [AXUIElement] {
    findElements(in: root, deadline: deadline) { isMatchingComposer($0, jobURL: jobURL) }
}

func ancestorChain(of element: AXUIElement) -> [AXUIElement] {
    var chain = [element]
    var current = element
    while chain.count <= maxTreeDepth,
          let parent = elementAttribute(current, kAXParentAttribute) {
        if chain.contains(where: { sameElement($0, parent) }) {
            break
        }
        chain.append(parent)
        current = parent
    }
    return chain
}

func ancestryDistance(from element: AXUIElement, to target: AXUIElement) -> Int? {
    let elementChain = ancestorChain(of: element)
    let targetChain = ancestorChain(of: target)
    var bestDistance: Int?
    for (elementIndex, elementAncestor) in elementChain.enumerated() {
        for (targetIndex, targetAncestor) in targetChain.enumerated()
            where sameElement(elementAncestor, targetAncestor) {
            let distance = elementIndex + targetIndex
            bestDistance = min(bestDistance ?? distance, distance)
        }
    }
    return bestDistance
}

func uniqueClosestIndex(_ distances: [Int]) -> Int? {
    guard let minimum = distances.min(),
          distances.filter({ $0 == minimum }).count == 1 else {
        return nil
    }
    return distances.firstIndex(of: minimum)
}
