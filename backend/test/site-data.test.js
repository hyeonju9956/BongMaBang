import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.window = { BONGMABANG_API_BASE: "https://api.example.test" };
globalThis.sessionStorage = {
  getItem: () => "",
  setItem: () => {},
  removeItem: () => {}
};

const { loadSiteData } = await import("../../js/data.js");

test("site episodes load from the API while squad settings remain file-backed", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requested.push(url);
    if (url === "https://api.example.test/api/episodes") {
      return new Response(JSON.stringify({
        episodes: [{
          id: "episode-1",
          order: 0,
          version: 1,
          era: "새 시기",
          title: "DB 이야기",
          who: [" 친구 "],
          text: "데이터베이스에서 가져온 내용",
          bright: true
        }]
      }));
    }
    if (url.endsWith("/data/squad.json")) {
      return new Response(JSON.stringify({ name: "방범대", since: 2020, eras: ["기존 시기"] }));
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const { eras, episodes } = await loadSiteData();
    assert.deepEqual(eras, ["기존 시기", "새 시기"]);
    assert.equal(episodes[0].title, "DB 이야기");
    assert.deepEqual(episodes[0].who, ["친구"]);
    assert.equal(episodes[0].number, 1);
    assert.equal(episodes[0].searchText, "db 이야기 데이터베이스에서 가져온 내용 친구 새 시기");
    assert.equal(requested.some(url => url.endsWith("/data/episodes.json")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
