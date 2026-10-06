import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const loadDomHelpers = async () => {
  const context = vm.createContext({
    cvFitBridge: { dom: {} },
    window: {
      innerHeight: 800,
      innerWidth: 1200,
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    },
  });
  const source = await readFile(new URL("../extension/dom-visibility.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "dom-visibility.js" });
  return context.cvFitBridge.dom;
};

test("getVisibleRect rejects detached and off-screen elements", async () => {
  const { getVisibleRect } = await loadDomHelpers();
  const rect = (overrides = {}) => ({
    bottom: 120,
    height: 20,
    left: 100,
    right: 200,
    top: 100,
    width: 100,
    ...overrides,
  });

  assert.equal(getVisibleRect({
    isConnected: false,
    getBoundingClientRect: () => rect(),
  }), null);
  assert.equal(getVisibleRect({
    isConnected: true,
    getBoundingClientRect: () => rect({ bottom: -1, top: -21 }),
  }), null);
  assert.equal(getVisibleRect({
    isConnected: true,
    getBoundingClientRect: () => rect({ left: 1200, right: 1300 }),
  }), null);
});

test("getVisibleRect accepts an element intersecting the viewport", async () => {
  const { getVisibleRect } = await loadDomHelpers();
  const visibleRect = {
    bottom: 10,
    height: 20,
    left: -5,
    right: 5,
    top: -10,
    width: 10,
  };

  assert.deepEqual(
    getVisibleRect({
      isConnected: true,
      getBoundingClientRect: () => visibleRect,
    }),
    visibleRect,
  );
});

test("getRenderedRect accepts a rendered element outside the viewport", async () => {
  const { getRenderedRect, getVisibleRect } = await loadDomHelpers();
  const offscreenRect = {
    bottom: 1020,
    height: 100,
    left: 100,
    right: 600,
    top: 920,
    width: 500,
  };
  const element = {
    isConnected: true,
    getBoundingClientRect: () => offscreenRect,
  };

  assert.deepEqual(getRenderedRect(element), offscreenRect);
  assert.equal(getVisibleRect(element), null);
});

test("getVisibleRect rejects CSS-hidden and semantically hidden elements", async () => {
  const { getVisibleRect } = await loadDomHelpers();
  const visibleRect = {
    bottom: 120,
    height: 20,
    left: 100,
    right: 200,
    top: 100,
    width: 100,
  };

  assert.equal(getVisibleRect({
    isConnected: true,
    checkVisibility: () => false,
    closest: () => null,
    getBoundingClientRect: () => visibleRect,
  }), null);
  assert.equal(getVisibleRect({
    isConnected: true,
    checkVisibility: () => true,
    closest: () => ({ getAttribute: () => "true" }),
    getBoundingClientRect: () => visibleRect,
  }), null);
});
