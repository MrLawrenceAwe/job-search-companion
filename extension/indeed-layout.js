(() => {
  const serverStyleSelector =
    'style[data-rn-viewjob-server-styles][id="react-native-stylesheet"]';
  const separateServerStyles = (root) => {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.matches?.(serverStyleSelector)) root.removeAttribute("id");
    for (const style of root.querySelectorAll(serverStyleSelector)) style.removeAttribute("id");
  };

  // Indeed renders this server style empty on the client. React Native otherwise
  // reuses its ID, so React's update erases the live client rules too. Remove only
  // the server ID before React Native starts; it creates its own style in <head>.
  // Keep observing for job panels inserted after navigation within the page.
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) separateServerStyles(node);
    }
  }).observe(document, { childList: true, subtree: true });
  separateServerStyles(document);
})();
