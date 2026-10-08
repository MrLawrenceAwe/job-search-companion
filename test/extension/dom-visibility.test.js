import assert from "node:assert/strict";
import { runScriptsInVm } from "../../test-support/extension-scripts.js";
import test from "node:test";
import vm from "node:vm";

const loadDomHelpers = async () => {
  const context = vm.createContext({
    jobSearchCompanion: { dom: {} },
    window: {
      innerHeight: 800,
      innerWidth: 1200,
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    },
  });
  await runScriptsInVm(context, ["dom-visibility.js"]);
  return context.jobSearchCompanion.dom;
};

test("getViewportRect rejects detached and off-screen elements", async () => {
  const { getViewportRect } = await loadDomHelpers();
  const rect = (overrides = {}) => ({
    bottom: 120,
    height: 20,
    left: 100,
    right: 200,
    top: 100,
    width: 100,
    ...overrides,
  });

  assert.equal(getViewportRect({
    isConnected: false,
    getBoundingClientRect: () => rect(),
  }), null);
  assert.equal(getViewportRect({
    isConnected: true,
    getBoundingClientRect: () => rect({ bottom: -1, top: -21 }),
  }), null);
  assert.equal(getViewportRect({
    isConnected: true,
    getBoundingClientRect: () => rect({ left: 1200, right: 1300 }),
  }), null);
});

test("getViewportRect accepts an element intersecting the viewport", async () => {
  const { getViewportRect } = await loadDomHelpers();
  const visibleRect = {
    bottom: 10,
    height: 20,
    left: -5,
    right: 5,
    top: -10,
    width: 10,
  };

  assert.deepEqual(
    getViewportRect({
      isConnected: true,
      getBoundingClientRect: () => visibleRect,
    }),
    visibleRect,
  );
});

test("getRenderedRect accepts a rendered element outside the viewport", async () => {
  const { getRenderedRect, getViewportRect } = await loadDomHelpers();
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
  assert.equal(getViewportRect(element), null);
});

test("getViewportRect rejects CSS-hidden and semantically hidden elements", async () => {
  const { getViewportRect } = await loadDomHelpers();
  const visibleRect = {
    bottom: 120,
    height: 20,
    left: 100,
    right: 200,
    top: 100,
    width: 100,
  };

  assert.equal(getViewportRect({
    isConnected: true,
    checkVisibility: () => false,
    closest: () => null,
    getBoundingClientRect: () => visibleRect,
  }), null);
  assert.equal(getViewportRect({
    isConnected: true,
    checkVisibility: () => true,
    closest: () => ({ getAttribute: () => "true" }),
    getBoundingClientRect: () => visibleRect,
  }), null);
});
