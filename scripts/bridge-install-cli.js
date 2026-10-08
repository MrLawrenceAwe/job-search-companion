import { migrateInstallation } from "../installer/legacy-installation.js";
import { fileURLToPath } from "node:url";

import { install, uninstall } from "../installer/lifecycle.js";
import { readManagedArtifactPaths } from "../installer/install-state.js";

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
  if (command === "migrate-installation") {
    if (!options.homePath) throw new Error("--home-path is required");
    await migrateInstallation(options);
    return;
  }
  if (command === "install") {
    await install(options);
    return;
  }
  if (command === "uninstall") {
    await uninstall(options);
    return;
  }
  if (command === "managed-artifact-paths") {
    if (!options.statePath) {
      throw new Error("--state-path is required");
    }
    for (const { name, path } of await readManagedArtifactPaths(options.statePath)) {
      process.stdout.write(`${name}\t${path}\n`);
    }
    return;
  }
  throw new Error(
    "Expected install, uninstall, migrate-installation or managed-artifact-paths command",
  );
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
