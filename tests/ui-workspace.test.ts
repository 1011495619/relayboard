import test from "node:test";
import assert from "node:assert/strict";
import {
  readProjectPreferences,
  visitProject,
  toggleProjectPreference,
} from "../web/src/lib/project-preferences.ts";

test("project preferences survive corrupt storage and normalize legacy values", () => {
  for (const raw of [null, "{broken", "null", "42", "[]"]) {
    assert.deepEqual(readProjectPreferences(raw), {
      favorites: [],
      recent: [],
      hidden: [],
    });
  }
  assert.deepEqual(
    readProjectPreferences(
      JSON.stringify({
        favorites: ["a", "a", null, 9, ""],
        recent: ["a", "b", "c", "d", "e", "f"],
        hidden: "bad",
      }),
    ),
    { favorites: ["a"], recent: ["a", "b", "c", "d", "e"], hidden: [] },
  );
});

test("switching projects restores a hidden target, preserves favorites and bounds recents", () => {
  const initial = {
    favorites: ["a"],
    recent: ["b", "c", "d", "e", "f"],
    hidden: ["a", "z"],
  };
  const next = visitProject(initial, "a");
  assert.deepEqual(next, {
    favorites: ["a"],
    recent: ["a", "b", "c", "d", "e"],
    hidden: ["z"],
  });
  assert.deepEqual(initial.hidden, ["a", "z"]);
  assert.equal(visitProject(next, "a"), next);
  assert.deepEqual(visitProject(next, "c").recent, ["c", "a", "b", "d", "e"]);
});

test("favorite and local collection preferences remain independent and reversible", () => {
  const initial = readProjectPreferences(null);
  const favorite = toggleProjectPreference(initial, "favorites", "a");
  const hidden = toggleProjectPreference(favorite, "hidden", "a");
  assert.deepEqual(hidden, { favorites: ["a"], recent: [], hidden: ["a"] });
  assert.deepEqual(toggleProjectPreference(hidden, "hidden", "a"), favorite);
  assert.deepEqual(
    toggleProjectPreference(favorite, "favorites", "a"),
    initial,
  );
});
