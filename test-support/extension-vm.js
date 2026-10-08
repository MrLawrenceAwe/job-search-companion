import { readFile } from "node:fs/promises";
import vm from "node:vm";

export const runExtensionScripts = async (context, filenames) => {
  for (const filename of filenames) {
    const source = await readFile(new URL(`../extension/${filename}`, import.meta.url), "utf8");
    vm.runInContext(source, context, { filename });
  }
};
