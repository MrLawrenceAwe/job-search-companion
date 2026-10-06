import { fileURLToPath } from "node:url";

import { install, uninstall } from "../installer/lifecycle.js";
import { readRetiredArtifactPaths } from "../installer/install-state.js";

export const parseArguments = (argv) => {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (!flag?.startsWith("--") || rest[index + 1] === undefined) {
      throw new Error(`Invalid argument: ${flag ?? "<missing>"}`);
    }
    const name = flag.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    options[name] = rest[index + 1];
  }
  return { command, options };
};

const main = async () => {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "install") {
    await install(options);
    return;
  }
  if (command === "uninstall") {
    await uninstall(options);
    return;
  }
  if (command === "retired-artifact-paths") {
    if (!options.statePath) {
      throw new Error("--state-path is required");
    }
    for (const artifact of await readRetiredArtifactPaths(options.statePath)) {
      process.stdout.write(`${artifact.name}\t${artifact.path}\n`);
    }
    return;
  }
  throw new Error("Expected install or uninstall command");
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
