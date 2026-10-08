(() => {
  const { indeedJobKeyPattern } = globalThis.jobSearchContracts.jobUrls;
  globalThis.jobSearchCompanion.blockers.observeDescriptions = (onDescription) => {
    const descriptions = new Map();
    const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
    window.addEventListener("message", (event) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.type !== "jsc-indeed-description-v1"
      )
        return;
      const { jobId, html, text } = event.data;
      if (!indeedJobKeyPattern.test(jobId || "")) return;
      let extracted;
      if (typeof text === "string" && text.length <= 80_000) extracted = text;
      else if (typeof html === "string" && html.length <= 160_000) {
        // Parse inertly and extract text; never insert job-provided HTML into the UI.
        const parsed = new DOMParser().parseFromString(html, "text/html");
        for (const node of parsed.querySelectorAll("script,style")) node.remove();
        for (const node of parsed.querySelectorAll("br,p,li,div,h1,h2,h3,h4"))
          node.append(parsed.createTextNode(" "));
        extracted = parsed.body.textContent;
      } else return;
      descriptions.set(jobId, normalize(extracted));
      if (descriptions.size > 50) descriptions.delete(descriptions.keys().next().value);
      onDescription();
    });
    return descriptions;
  };
})();
