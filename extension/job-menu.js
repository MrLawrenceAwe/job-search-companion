(() => {
  const companion = globalThis.jobSearchCompanion;

  const createCvFitAction = (jobUrl) => {
    const shortcutLabel = globalThis.jobSearchContracts.shortcuts.submitCvFit.toUpperCase();
    const button = document.createElement("button");
    button.type = "button";
    button.className = companion.ui.menuItemClass;
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-keyshortcuts", shortcutLabel);
    button.title = `${companion.ui.cvFitActionLabel} (${shortcutLabel})`;

    const label = document.createElement("span");
    label.className = "jsc-menu-item-label";
    label.textContent = companion.ui.cvFitActionLabel;
    button.append(label);

    const status = document.createElement("span");
    status.className = "jsc-menu-item-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    button.append(status);

    const shortcut = document.createElement("kbd");
    shortcut.className = "jsc-menu-item-shortcut";
    shortcut.setAttribute("aria-hidden", "true");
    shortcut.textContent = shortcutLabel;
    button.append(shortcut);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void companion.cvFitSubmissions.submit(jobUrl, button);
    });

    const icon = document.createElement("span");
    icon.className = "jsc-menu-item-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z"></path>
        <path d="M14 2v5h5"></path>
        <path d="M9 14h6"></path>
        <path d="M9 18h4"></path>
      </svg>
    `;
    button.prepend(icon);
    return button;
  };

  const createMenuItems = (source) => {
    // Capture the menu's job once, even if the selected detail pane changes.
    const jobUrl = companion.jobs.consumeMenuJobUrl(source);
    return [
      createCvFitAction(jobUrl),
      companion.jobMarks.createButton(jobUrl, "applied", true),
      companion.jobMarks.createButton(jobUrl, "unsuitable", true),
    ];
  };

  const MENU_ROW_SELECTOR = 'button, a, [role="menuitem"], li';

  const removeHiddenItems = () => {
    for (const item of document.querySelectorAll(`.${companion.ui.menuItemClass}`)) {
      if (!companion.dom.getViewportRect(item)) {
        item.remove();
      }
    }
  };

  const hasVisibleItem = (root) => {
    const selector = `.${companion.ui.menuItemClass}`;
    const items = companion.dom.queryIncludingRoot(root, selector);
    return items.some((item) => companion.dom.getViewportRect(item));
  };

  const resolveMenuRow = (element) => {
    const actionableRow = element.closest?.(MENU_ROW_SELECTOR);
    if (actionableRow) {
      return actionableRow;
    }

    let row = element;

    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const text = parent.textContent?.trim() || "";
      const rect = companion.dom.getViewportRect(parent);

      if (!/^WhatsApp$/i.test(text) || !rect || rect.width > 420 || rect.height > 80) {
        break;
      }

      row = parent;
    }

    return row;
  };

  const findWhatsAppRow = (root) => {
    const menuRows = [];

    for (const element of companion.dom.queryIncludingRoot(
      root,
      `${MENU_ROW_SELECTOR}, div, span`,
    )) {
      const text = element.textContent?.trim() || "";
      if (!/^WhatsApp$/i.test(text)) {
        continue;
      }

      const row = resolveMenuRow(element);
      const rect = companion.dom.getViewportRect(row);
      if (!rect || rect.width > 420 || rect.height > 80) {
        continue;
      }

      menuRows.push({ element: row, area: rect.width * rect.height });
    }

    return menuRows.sort((left, right) => right.area - left.area)[0]?.element;
  };

  const findLinkedInShareRow = (root) => {
    if (companion.platform !== "linkedin") {
      return null;
    }
    for (const element of companion.dom.queryIncludingRoot(root, MENU_ROW_SELECTOR)) {
      if (
        /^Share$/i.test(element.textContent?.trim() || "") &&
        companion.dom.getViewportRect(element)
      ) {
        return resolveMenuRow(element);
      }
    }
    return null;
  };

  const readCompactMenuText = (element) => {
    if (element.childElementCount > 80) {
      return "";
    }

    const text = element.textContent || "";
    return text.length <= 1200 ? text : "";
  };

  const toJobMenuCandidate = (element) => {
    const text = readCompactMenuText(element);
    if (
      !companion.jobMenuDetection.textPattern.test(text) ||
      element.querySelector(`.${companion.ui.menuItemClass}`)
    ) {
      return null;
    }

    const rect = companion.dom.getViewportRect(element);
    if (!rect || rect.width > 420 || rect.height > 420) {
      return null;
    }

    return { element, area: rect.width * rect.height };
  };

  const findJobMenus = (root) => {
    const candidates = [];

    for (const element of companion.dom.queryIncludingRoot(
      root,
      '[role="menu"], [role="dialog"], div, ul',
    )) {
      const candidate = toJobMenuCandidate(element);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    return candidates
      .sort((left, right) => left.area - right.area)
      .map((candidate) => candidate.element);
  };

  const findLastVisibleItem = (menu) => {
    const items = [];

    for (const element of menu.querySelectorAll('button, a, [role="menuitem"]')) {
      const rect = companion.dom.getViewportRect(element);
      if (rect) {
        items.push({ element, top: rect.top, left: rect.left });
      }
    }

    return items.sort((left, right) => left.top - right.top || left.left - right.left).at(-1)
      ?.element;
  };

  const mightContainMenu = (element) => {
    return companion.jobMenuDetection.textPattern.test(readCompactMenuText(element));
  };

  const findMenuRoot = (element) => {
    if (element.matches?.(companion.selectors.menuContext)) {
      return element;
    }

    return element.closest?.(companion.selectors.menuContext) || null;
  };

  const insertJobMenuActions = (root = document.body) => {
    removeHiddenItems();
    if (hasVisibleItem(root)) {
      return true;
    }

    const insertionRow = findWhatsAppRow(root) || findLinkedInShareRow(root);
    if (insertionRow) {
      insertionRow.after(...createMenuItems(insertionRow));
      return true;
    }

    const menu = findJobMenus(root)[0];

    if (!menu) {
      return false;
    }

    const menuItems = createMenuItems(menu);
    const lastMenuItem = findLastVisibleItem(menu);

    if (lastMenuItem?.parentElement && lastMenuItem.parentElement !== menu) {
      lastMenuItem.parentElement.after(...menuItems);
      return true;
    }

    for (const menuItem of menuItems) menu.appendChild(menuItem);
    return true;
  };

  Object.assign(companion.jobMenu, {
    insertJobMenuActions,
    mightContainMenu,
    findMenuRoot,
  });
})();
