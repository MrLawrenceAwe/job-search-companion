import { readFile } from "node:fs/promises";
import vm from "node:vm";

export const readExtensionScript = (filename) =>
  readFile(new URL(`../extension/${filename}`, import.meta.url), "utf8");

export const runScriptsInVm = async (context, filenames) => {
  for (const filename of filenames) {
    vm.runInContext(await readExtensionScript(filename), context, { filename });
  }
};

export const runScriptsInDom = async (window, filenames) => {
  for (const filename of filenames) {
    window.eval(await readExtensionScript(filename));
  }
};
