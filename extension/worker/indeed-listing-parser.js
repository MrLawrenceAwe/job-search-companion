(() => {
  globalThis.jobSearchWorkerModules ??= {};
  const jobPostingsFromHtml = function* (html) {
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue;
      let nodes;
      try { nodes = [JSON.parse(script[2])]; }
      catch { continue; }
      while (nodes.length) {
        const node = nodes.pop();
        if (Array.isArray(node)) { nodes.push(...node); continue; }
        if (!node || typeof node !== "object") continue;
        if (Array.isArray(node["@graph"])) nodes.push(...node["@graph"]);
        const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
        if (!types.includes("JobPosting") || typeof node.title !== "string") continue;
        yield node;
      }
    }
  };
  const titleFromIndeedHtml = (html, postings) => {
    for (const node of postings) {
      const title = node.title.replace(/\s+/g, " ").trim();
      if (title && title.length <= 300) return title;
    }
    // Some listings omit JobPosting data but retain the job/location page title.
    // Require Indeed's complete listing-title format so login and error pages
    // cannot become job names. Preserve hyphens within the job title itself.
    const pageTitle = html.match(/<title\b[^>]*>([^<]*)<\/title\s*>/i)?.[1];
    const rawTitle = pageTitle?.match(/^(.+)\s+-\s+.+?\s+-\s+Indeed\.(?:com|co\.uk)\s*$/i)?.[1];
    if (rawTitle) {
      const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
      const title = rawTitle.replace(/&(?:#(x[0-9a-f]+|\d+)|(amp|quot|apos|lt|gt|nbsp));/gi, (match, numeric, named) => {
        if (named) return entities[named.toLowerCase()];
        const point = numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : Number(numeric);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
      }).replace(/\s+/g, " ").trim();
      if (title && title.length <= 300) return title;
    }
    throw new Error("Job title unavailable");
  };
  const availabilityFromIndeedHtml = (html, postings) => {
    const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    for (const heading of markup.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi)) {
      if (heading[1].replace(/<[^>]*>/g, "").trim() === "This job has expired on Indeed") return "expired";
    }
    for (const node of postings) {
      const until = Date.parse(node.validThrough);
      if (Number.isFinite(until)) return until < Date.now() ? "expired" : "active";
    }
    // A retained title alone is not evidence that applications are still open.
    if (/\bhref\s*=\s*["'][^"']*\/applystart\?/i.test(markup)) {
      titleFromIndeedHtml(html, postings);
      return "active";
    }
    throw new Error("Job availability could not be confirmed");
  };
  globalThis.jobSearchWorkerModules.parseIndeedListing = (html) => {
    const postings = [...jobPostingsFromHtml(html)];
    // A listing can provide a title without confirming availability, or vice versa.
    const read = (extract) => { try { return extract(html, postings); } catch { return null; } };
    return { title: read(titleFromIndeedHtml), availability: read(availabilityFromIndeedHtml) };
  };
})();
