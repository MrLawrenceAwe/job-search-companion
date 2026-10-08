// This script runs in Indeed's MAIN world. It observes responses the page already
// requests; it never requests descriptions, reads cookies, or receives credentials.
(() => {
  const { indeedJobKeyPattern } = globalThis.jobSearchContracts.jobUrls;
  const MARKER = "jsc-indeed-description-v1";
  const emit = (model, fallbackKey) => {
    const html = model?.sanitizedJobDescription;
    const jobId = model?.jobKey || model?.jobkey || model?.jk || fallbackKey;
    if (
      typeof html !== "string" ||
      html.length > 160_000 ||
      !indeedJobKeyPattern.test(jobId || "")
    )
      return;
    window.postMessage({ type: MARKER, jobId, html }, window.location.origin);
  };
  const isDescriptionUrl = (raw) => {
    try {
      const url = new URL(raw, location.href);
      return (
        (url.origin === location.origin && url.pathname === "/viewjob") ||
        (url.protocol === "https:" &&
          url.hostname === "apis.indeed.com" &&
          url.pathname === "/graphql")
      );
    } catch {
      return false;
    }
  };
  const capture = (body, url) => {
    if (!isDescriptionUrl(url)) return;
    const parsed = new URL(url, location.href);
    if (parsed.pathname === "/viewjob") {
      emit(
        body?.body?.jobInfoWrapperModel?.jobInfoModel,
        parsed.searchParams.get("jk") || parsed.searchParams.get("vjk"),
      );
      return;
    }
    // The current React Native rollout requests selected-job descriptions through
    // GraphQL. Ignore search-card data; only accept an explicit viewjob identity.
    for (const response of Array.isArray(body) ? body : [body]) {
      const viewjob = response?.data?.viewjob;
      const job = viewjob?.job;
      const jobId = viewjob?.key || job?.key;
      if (viewjob?.key && job?.key && viewjob.key !== job.key) continue;
      const text = job?.description?.text;
      if (
        typeof text === "string" &&
        text.length <= 80_000 &&
        indeedJobKeyPattern.test(jobId || "")
      ) {
        window.postMessage({ type: MARKER, jobId, text }, window.location.origin);
      }
    }
  };
  const wrappedFetches = new WeakMap();
  const wrapFetch = (originalFetch) => {
    if (typeof originalFetch !== "function") return originalFetch;
    if (wrappedFetches.has(originalFetch)) return wrappedFetches.get(originalFetch);
    const wrapped = function (...args) {
      const response = Reflect.apply(originalFetch, this, args);
      const url =
        typeof args[0] === "string" || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
      response.then(
        (result) => {
          if (result.ok && isDescriptionUrl(url)) {
            void result
              .clone()
              .json()
              .then((body) => capture(body, result.url || url))
              .catch(() => {});
          }
        },
        () => {},
      );
      return response;
    };
    wrappedFetches.set(originalFetch, wrapped);
    wrappedFetches.set(wrapped, wrapped);
    return wrapped;
  };
  // Indeed installs its own fetch wrappers after startup. Preserve observation
  // across ordinary reassignment while retaining each wrapper's original call.
  const descriptor = Object.getOwnPropertyDescriptor(window, "fetch");
  let currentFetch = wrapFetch(window.fetch);
  if (descriptor?.configurable && descriptor.writable) {
    Object.defineProperty(window, "fetch", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: () => currentFetch,
      set: (value) => {
        currentFetch = wrapFetch(value);
      },
    });
  } else window.fetch = currentFetch;
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    urls.set(this, String(url));
    return Reflect.apply(open, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (isDescriptionUrl(urls.get(this)))
      this.addEventListener(
        "load",
        () => {
          try {
            if (this.status >= 200 && this.status < 300)
              capture(
                this.responseType === "json" ? this.response : JSON.parse(this.responseText),
                this.responseURL || urls.get(this),
              );
          } catch {
            /* Not a JSON description response. */
          }
        },
        { once: true },
      );
    return Reflect.apply(send, this, args);
  };
  const initial = () => {
    let budget = 2500;
    const visit = (value, inheritedKey, depth = 0) => {
      if (!value || typeof value !== "object" || --budget < 0 || depth > 12) return;
      const key = value.jobKey || value.jobkey || value.jk || inheritedKey;
      emit(value, key);
      for (const child of Object.values(value))
        if (child && typeof child === "object") visit(child, key, depth + 1);
    };
    // Indeed's initial selected description is embedded in page data.
    const data = window._initialData;
    if (data?.autoOpenTwoPaneViewjobResponse) {
      emit(
        data.autoOpenTwoPaneViewjobResponse.body?.jobInfoWrapperModel?.jobInfoModel,
        data.autoOpenTwoPaneJobKey,
      );
    }
    visit(data);
    for (const script of document.scripts) {
      const text = script.textContent || "";
      if (text.length > 2_000_000 || !text.includes("sanitizedJobDescription")) continue;
      try {
        visit(JSON.parse(text));
      } catch {
        /* Executable script data is read via _initialData, never eval. */
      }
    }
  };
  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.origin === location.origin &&
      event.data?.type === "jsc-request-initial-description-v1"
    )
      initial();
  });
  document.addEventListener("DOMContentLoaded", initial, { once: true });
})();
