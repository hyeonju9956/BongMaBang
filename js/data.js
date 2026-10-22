async function readJson(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) {
    throw new Error(`${path}를 불러오지 못했습니다 (HTTP ${response.status}).`);
  }
  return response.json();
}

function requireString(value, location) {
  if (typeof value !== "string") {
    throw new Error(`${location} 값은 문자열이어야 합니다.`);
  }
  return value;
}

export async function loadSiteData() {
  const [squad, episodes] = await Promise.all([
    readJson("../data/squad.json"),
    readJson("../data/episodes.json")
  ]);

  if (!squad || typeof squad !== "object" || Array.isArray(squad)) {
    throw new Error("data/squad.json은 설정 객체여야 합니다.");
  }
  requireString(squad.name, "squad.name");
  if (!Number.isInteger(squad.since)) {
    throw new Error("squad.since 값은 정수 연도여야 합니다.");
  }
  if (!Array.isArray(squad.eras) || squad.eras.some(era => typeof era !== "string")) {
    throw new Error("squad.eras 값은 문자열 배열이어야 합니다.");
  }
  if (!Array.isArray(episodes)) {
    throw new Error("data/episodes.json은 이야기 객체의 배열이어야 합니다.");
  }

  const eras = [...squad.eras];
  const normalizedEpisodes = episodes.map((episode, index) => {
    const location = `episodes.json의 ${index + 1}번째 이야기`;
    if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
      throw new Error(`${location}는 객체여야 합니다.`);
    }

    const era = requireString(episode.era, `${location}.era`).trim();
    const title = requireString(episode.title, `${location}.title`);
    const text = requireString(episode.text, `${location}.text`);
    if (!Array.isArray(episode.who) || episode.who.some(person => typeof person !== "string")) {
      throw new Error(`${location}.who 값은 문자열 배열이어야 합니다.`);
    }
    if (episode.bright !== undefined && typeof episode.bright !== "boolean") {
      throw new Error(`${location}.bright 값은 true 또는 false여야 합니다.`);
    }
    if (!eras.includes(era)) eras.push(era);

    return {
      ...episode,
      era,
      title,
      text,
      who: episode.who.map(person => person.trim()).filter(Boolean),
      bright: episode.bright === true,
      index,
      number: index + 1,
      searchText: [title, text, episode.who.join(" "), era].join(" ").toLowerCase()
    };
  });

  return { squad, eras, episodes: normalizedEpisodes };
}
