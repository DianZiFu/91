import assert from "node:assert/strict";
import test from "node:test";
import { NavigationHistory } from "../src/lib/navigationHistory.ts";

test("returns to the original list across recommendations and sheet replacements", () => {
  const history = new NavigationHistory();
  history.record("list", "POP");
  history.record("a", "PUSH");
  assert.equal(history.backDelta("a", "list"), -1);
  history.record("b", "PUSH");
  history.record("sheet", "PUSH");
  history.record("c", "REPLACE");
  assert.equal(history.backDelta("c", "list"), -3);
  history.record("list", "POP");
  assert.equal(history.isCurrent("list"), true);
  assert.equal(history.backDelta("c", "list"), null);
});

test("closing a sheet and revisiting history preserves the actual distance", () => {
  const history = new NavigationHistory();
  history.record("home", "POP");
  history.record("a", "PUSH");
  history.record("sheet", "PUSH");
  history.record("a", "POP");
  history.record("b", "PUSH");
  assert.equal(history.backDelta("b", "home"), -2);
  assert.equal(history.backDelta("b", "sheet"), null);
  history.record("home", "POP");
  history.record("b", "POP");
  assert.equal(history.backDelta("b", "home"), -2);
});

test("duplicate commits do not add steps and replaced entries cannot be targets", () => {
  const history = new NavigationHistory();
  history.record("home", "POP");
  history.record("filtered", "REPLACE");
  history.record("filtered", "REPLACE");
  history.record("a", "PUSH");
  history.record("a", "PUSH");
  assert.equal(history.backDelta("a", "filtered"), -1);
  assert.equal(history.backDelta("a", "home"), null);
});

test("direct loads, unknown history and stale async handlers cannot guess a back step", () => {
  const history = new NavigationHistory();
  history.record("direct-detail", "POP");
  assert.equal(history.backDelta("direct-detail", "old-document-list"), null);
  history.record("list", "PUSH");
  assert.equal(history.backDelta("direct-detail", "list"), null);
  history.record("unknown", "POP");
  assert.equal(history.backDelta("unknown", "list"), null);
  assert.equal(history.backDelta("unknown", "unknown"), null);
});

test("native back is available only for the current entry with an observed predecessor", () => {
  const history = new NavigationHistory();
  assert.equal(history.canGoBack("home"), false);
  history.record("home", "POP");
  assert.equal(history.canGoBack("home"), false);
  history.record("video", "PUSH");
  assert.equal(history.canGoBack("video"), true);
  assert.equal(history.canGoBack("home"), false);
  history.record("replacement", "REPLACE");
  assert.equal(history.canGoBack("replacement"), true);
  assert.equal(history.canGoBack("video"), false);
  history.record("home", "POP");
  assert.equal(history.canGoBack("home"), false);
  history.record("replacement", "POP");
  assert.equal(history.canGoBack("replacement"), true);
  history.record("reloaded-video", "POP");
  assert.equal(history.canGoBack("reloaded-video"), false);
});
