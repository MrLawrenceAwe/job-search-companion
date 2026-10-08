import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { install } from "../installer/lifecycle.js";
import { sha256 } from "../shared/sha256.js";

export { sha256 };

export const makeInstallFixture = async (context) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "indeed-cv-fit-install-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    rootPath: join(directory, "checkout with & chars"),
    workspacePath: join(directory, "CV Fit & Review"),
    logPath: join(directory, "Application Support", "bridge", "bridge & log.log"),
    extensionConfigPath: join(directory, "extension", "local-config.js"),
    plistSource: join(directory, "source.plist"),
    plistTarget: join(directory, "LaunchAgents", "bridge.plist"),
    accessibilityHelperSource: join(directory, "accessibility-helper-source"),
    accessibilityHelperTarget: join(directory, "Application Support", "bridge", "accessibility-helper"),
    statePath: join(directory, "Application Support", "bridge", "install-state.json"),
  };
  await Promise.all([
    mkdir(join(directory, "extension"), { recursive: true }),
    mkdir(join(directory, "LaunchAgents"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(paths.plistSource, "node=__INDEED_CV_FIT_NODE_EXECUTABLE__ root=__INDEED_CV_FIT_BRIDGE_ROOT__ workspace=__INDEED_CV_FIT_WORKSPACE__ log=__INDEED_CV_FIT_LOG_PATH__ token=__INDEED_CV_FIT_BRIDGE_TOKEN__ origin=__INDEED_CV_FIT_EXTENSION_ORIGIN__ instance=__INDEED_CV_FIT_BRIDGE_INSTANCE_ID__\n"),
    writeFile(paths.accessibilityHelperSource, Buffer.from([0, 255, 1, 254, 2])),
  ]);
  return paths;
};

export const installFixture = (paths, dependencies) => install({
  ...paths,
  token: "test-token",
  rootPath: paths.rootPath,
  workspacePath: paths.workspacePath,
  allowedExtensionOrigin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
  instanceId: "test-instance-id",
}, dependencies);
