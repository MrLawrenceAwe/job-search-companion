import ApplicationServices
import Foundation

struct CodexUIContract {
    static let protocolVersion = 6
    static let contractVersion = "codex-desktop-en-v6"

    let settingCategories = ["Model", "Effort", "Speed"]
    private let reasoningEffortSuffixes = [
        "Light",
        "Medium",
        "High",
        "Extra High",
        "Max",
        "Ultra",
    ]

    func isModelPickerTitle(_ title: String) -> Bool {
        reasoningEffortSuffixes.contains { title.hasSuffix(" \($0)") }
    }

    func isModelPicker(_ element: AXUIElement) -> Bool {
        guard stringAttributeOrEmpty(element, kAXRoleAttribute) == kAXPopUpButtonRole else {
            return false
        }
        let title = stringAttributeOrEmpty(element, kAXTitleAttribute)
        return isModelPickerTitle(title)
    }

    func parseSettingMenuItem(_ element: AXUIElement) -> (category: String, value: String)? {
        guard stringAttributeOrEmpty(element, kAXRoleAttribute) == kAXMenuItemRole else {
            return nil
        }
        let description = stringAttributeOrEmpty(element, kAXDescriptionAttribute)
        for category in settingCategories where description.hasPrefix("\(category) ") {
            return (category, String(description.dropFirst(category.count + 1)))
        }
        return nil
    }
}
