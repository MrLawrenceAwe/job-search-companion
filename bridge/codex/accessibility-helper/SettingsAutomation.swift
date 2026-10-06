import ApplicationServices
import Foundation

func findComposerModelPicker(
    in searchRoot: AXUIElement,
    composer: AXUIElement,
    deadline: Date
) -> AXUIElement {
    var sleepInterval = initialPollInterval
    while Date() < deadline {
        let ranked = findElements(
            in: searchRoot,
            deadline: deadline,
            matching: uiContract.isModelPicker
        )
            .compactMap { picker in
                ancestryDistance(from: picker, to: composer).map { (picker, $0) }
            }
        if let closestIndex = uniqueClosestIndex(ranked.map(\.1)) {
            return ranked[closestIndex].0
        }
        if !ranked.isEmpty {
            fail("Codex exposed multiple equally close model pickers")
        }
        Thread.sleep(forTimeInterval: sleepInterval)
        sleepInterval = min(maximumPollInterval, sleepInterval * 1.5)
    }
    fail("Codex model picker did not become ready")
}

struct SettingsMenuSnapshot {
    let selectedValuesByCategory: [String: String]
}

struct SettingsMenuAccumulator {
    let container: AXUIElement
    var selectedValuesByCategory: [String: String]
    var hasDuplicateCategory: Bool
}

func menuContainer(of element: AXUIElement) -> AXUIElement? {
    ancestorChain(of: element).first {
        stringAttributeOrEmpty($0, kAXRoleAttribute) == kAXMenuRole
    }
}

func settingsMenuSnapshots(
    in searchRoot: AXUIElement,
    deadline: Date
) -> [SettingsMenuSnapshot] {
    let settingItems = findElements(in: searchRoot, deadline: deadline) {
        uiContract.parseSettingMenuItem($0) != nil
    }
    var menus: [SettingsMenuAccumulator] = []
    for item in settingItems {
        guard let setting = uiContract.parseSettingMenuItem(item),
              let container = menuContainer(of: item) else {
            continue
        }
        let menuIndex: Int
        if let existingIndex = menus.firstIndex(where: { sameElement($0.container, container) }) {
            menuIndex = existingIndex
        } else {
            menus.append(SettingsMenuAccumulator(
                container: container,
                selectedValuesByCategory: [:],
                hasDuplicateCategory: false
            ))
            menuIndex = menus.count - 1
        }
        if menus[menuIndex].selectedValuesByCategory[setting.category] != nil {
            menus[menuIndex].hasDuplicateCategory = true
        } else {
            menus[menuIndex].selectedValuesByCategory[setting.category] = setting.value
        }
    }
    return menus.compactMap { menu in
        guard !menu.hasDuplicateCategory,
              menu.selectedValuesByCategory.count == uiContract.settingCategories.count else {
            return nil
        }
        return SettingsMenuSnapshot(selectedValuesByCategory: menu.selectedValuesByCategory)
    }
}

func openSettingsMenu(
    in searchRoot: AXUIElement,
    composer: AXUIElement,
    timeoutMs: Double
) -> SettingsMenuSnapshot? {
    let pickerDeadline = deadline(milliseconds: timeoutMs)
    let picker = findComposerModelPicker(in: searchRoot, composer: composer, deadline: pickerDeadline)
    focus(picker, failureMessage: "Codex model picker could not be focused")
    postKey(escapeKey)
    let closeMenuDeadline = deadline(milliseconds: timeoutMs)
    guard waitUntil(deadline: closeMenuDeadline, condition: {
        settingsMenuSnapshots(in: searchRoot, deadline: closeMenuDeadline).isEmpty
    }) else {
        fail("An existing Codex settings menu did not close")
    }
    press(picker, failureMessage: "Codex model picker could not be pressed")

    var openedMenu: SettingsMenuSnapshot?
    let openMenuDeadline = deadline(milliseconds: timeoutMs)
    guard waitUntil(deadline: openMenuDeadline, condition: {
        let menus = settingsMenuSnapshots(in: searchRoot, deadline: openMenuDeadline)
        if menus.count > 1 {
            fail("Codex exposed multiple settings menus for the prepared composer")
        }
        openedMenu = menus.first
        return openedMenu != nil
    }), let openedMenu else {
        return nil
    }
    return openedMenu
}
