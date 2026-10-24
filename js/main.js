import { loadSiteData } from "./data.js";
import { createSearch } from "./search.js";
import { createConstellation, constellationStarCount } from "./constellation.js";
import { createStoryView, escapeHtml } from "./stories.js";

const element = id => document.getElementById(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function start() {
  const { squad, eras, episodes } = await loadSiteData();
  const title = element("title");
  document.title = squad.name;
  title.textContent = squad.name;
  element("since").textContent = `SINCE ${squad.since}`;
  element("foot").textContent = `${squad.name}, ${squad.since}년부터`;

  const starsRemaining = Math.max(0, constellationStarCount - episodes.length);
  element("lede").innerHTML =
    `${squad.since}년부터 함께 쌓아 온 이야기 <b>${episodes.length}개</b>. 이야기 하나가 별 하나가 되어 BB 별자리를 채워요.` +
    (starsRemaining
      ? ` 완성까지 별 ${starsRemaining}개.`
      : " 별자리는 완성됐고, 그 뒤의 이야기는 주변 하늘에 떠 있어요.");

  const searchInput = element("q");
  const result = element("result");
  const book = element("book");
  if (episodes.length === 0) {
    book.innerHTML = '<p class="empty">아직 등록된 이야기가 없어요.</p>';
  }

  let search;
  let constellation;
  const storyView = createStoryView({
    episodes,
    eras,
    toc: element("toc"),
    book,
    onPersonSearch: person => search.set(person)
  });
  const matches = episode => !search.value || episode.searchText.includes(search.value.toLowerCase());

  function selectEpisode(episode) {
    if (!matches(episode)) search.set("");
    constellation.select(episode);
    episode.element.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start"
    });
    episode.element.classList.remove("flash");
    void episode.element.offsetWidth;
    episode.element.classList.add("flash");
  }

  constellation = createConstellation(episodes, {
    caption: { escape: escapeHtml },
    onSelect: selectEpisode
  });

  function render(query) {
    const { total } = storyView.render(query);
    constellation.setQuery(query, episode => episode.searchText.includes(query));
    result.hidden = !query;
    if (query) {
      result.innerHTML = total
        ? `‘${escapeHtml(search.value)}’ 이야기 <b>${total}개</b>`
        : `‘${escapeHtml(search.value)}’에 맞는 이야기가 없어요. 이름 한 글자만 적어 봐도 돼요.`;
    }
    storyView.syncScrollPosition();
  }

  search = createSearch(searchInput, element("clear"), render);
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        storyView.syncScrollPosition();
        ticking = false;
      });
    }
  }, { passive: true });

  render("");
  if (/^#s\d+$/.test(location.hash)) {
    const episode = storyView.find(Number(location.hash.slice(2)));
    if (episode) setTimeout(() => selectEpisode(episode), 300);
  }
}

start().catch(error => {
  const errorBox = element("err");
  errorBox.hidden = false;
  errorBox.textContent = `이야기를 불러오지 못했어요. API 서버와 사이트 설정을 확인해 주세요. (${error.message})`;
});
