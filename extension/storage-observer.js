// Share snapshot ordering and notifications; features own record validation and writes.
(() => {
  globalThis.jobSearchStorage = Object.freeze({
    observe({ read, errorMessage }) {
      const listeners = new Set();
      const notify = (changes) => {
        for (const listener of listeners) listener(changes);
      };
      const ready = chrome.storage.local.get(null).then((stored) => {
        for (const [key, value] of Object.entries(stored)) read(key, value);
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        // Apply notifications after the initial snapshot so newer changes win.
        void ready.then(() => {
          const relevant = Object.entries(changes)
            .map(([key, { newValue }]) => read(key, newValue))
            .filter(Boolean);
          if (relevant.length) notify(relevant);
        }).catch((error) => console.debug(errorMessage, error));
      });
      return {
        ready,
        notify,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    },
  });
})();
