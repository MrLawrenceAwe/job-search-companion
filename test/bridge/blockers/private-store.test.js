import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openPrivateStore } from "../../../bridge/blockers/private-store.js";

const createStoreFixture = async (context) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-private-store-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "private", "settings.json");
  return { directory, path, store: await openPrivateStore(path, { model: "initial" }) };
};

test("queued private-store writes retain the snapshot captured by each save", async (context) => {
  const { path, store } = await createStoreFixture(context);
  store.value.model = "first";
  const first = store.save();
  store.value.model = "second";
  const second = store.save();
  store.value.model = "unsaved";
  await Promise.all([first, second]);

  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { model: "second" });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(path, ".."))).mode & 0o777, 0o700);
});

test("a failed private-store replacement cleans up and permits a later save", async (context) => {
  const { path, store } = await createStoreFixture(context);
  await mkdir(path);
  await assert.rejects(store.save());
  assert.deepEqual(await readdir(join(path, "..")), ["settings.json"]);
  await rm(path, { recursive: true });

  store.value.model = "recovered";
  await store.save();
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { model: "recovered" });
});
