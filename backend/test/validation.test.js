import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { toExportEpisode, ValidationError, validateEpisode } from "../validation.js";

test("normalizes required strings, names, and optional values", () => {
  assert.deepEqual(validateEpisode({
    era: " 고1 ",
    title: " 첫 이야기 ",
    who: [" 유신 ", "", "호주"],
    text: " 내용 "
  }), {
    era: "고1",
    title: "첫 이야기",
    who: ["유신", "호주"],
    text: "내용",
    bright: false
  });
});

test("rejects missing required values and unexpected fields", () => {
  assert.throws(() => validateEpisode({ era: "", title: "제목", text: "내용", id: "forged" }), error => {
    assert.ok(error instanceof ValidationError);
    assert.ok(error.fields.era);
    assert.ok(error.fields.id);
    return true;
  });
});

test("exports bright only when true", () => {
  assert.deepEqual(toExportEpisode({
    era: "고1", title: "제목", who: [], text: "내용", bright: false, order: 4
  }), {
    era: "고1", title: "제목", who: [], text: "내용"
  });
  assert.equal(toExportEpisode({
    era: "고1", title: "제목", who: [], text: "내용", bright: true
  }).bright, true);
});

test("existing static episodes satisfy import and export contracts", () => {
  const episodes = JSON.parse(fs.readFileSync(new URL("../../data/episodes.json", import.meta.url), "utf8"));
  const exported = episodes.map(toExportEpisode);
  assert.equal(exported.length, episodes.length);
  assert.deepEqual(exported[0], {
    era: episodes[0].era,
    title: episodes[0].title,
    who: episodes[0].who,
    text: episodes[0].text,
    bright: true
  });
  for (const episode of exported) {
    assert.equal(Object.hasOwn(episode, "order"), false);
    assert.equal(Object.hasOwn(episode, "_id"), false);
    assert.equal(Object.hasOwn(episode, "bright"), episode.bright === true);
  }
});
