function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function highlight(value, query) {
  const safe = escapeHtml(value);
  if (!query) return safe;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(escapedQuery, "gi"), match => `<mark>${match}</mark>`);
}

export function createStoryView({ episodes, eras, toc, book, onPersonSearch }) {
  const chapters = eras.map((era, eraIndex) => {
    const list = episodes.filter(episode => episode.era === era);
    const section = document.createElement("section");
    section.className = "chapter";
    section.id = `era-${eraIndex}`;
    section.innerHTML = `<div class="ch-head"><h2>${escapeHtml(era)}</h2><span></span></div>`;

    list.forEach(episode => {
      const article = document.createElement("article");
      article.className = "story";
      article.id = `s${episode.number}`;
      article.innerHTML = `<div class="no">${String(episode.number).padStart(2, "0")}</div><div class="body"></div>`;
      section.appendChild(article);
      episode.element = article;
    });

    book.appendChild(section);
    return { era, eraIndex, list, section };
  });

  book.addEventListener("click", event => {
    const editLink = event.target.closest("[data-edit-episode]");
    if (editLink) {
      sessionStorage.setItem("bongmabang-edit-episode", editLink.dataset.editEpisode);
      return;
    }
    const button = event.target.closest("[data-who]");
    if (button) {
      onPersonSearch(button.dataset.who);
      book.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  });

  function paintEpisode(episode, query) {
    episode.element.querySelector(".body").innerHTML =
      `<h3><a href="editor/" data-edit-episode="${episode.index}">${highlight(episode.title, query)}</a>${episode.bright ? '<span class="tag">레전드</span>' : ""}</h3>` +
      (episode.who.length
        ? `<div class="who">${episode.who.map(person =>
          `<button type="button" class="${person === "불확실" ? "unk" : ""}" data-who="${escapeHtml(person)}">${highlight(person, query)}</button>`
        ).join("")}</div>`
        : "") +
      `<p>${highlight(episode.text, query)}</p>`;
  }

  function render(query) {
    let total = 0;
    toc.replaceChildren();

    chapters.forEach(chapter => {
      const hits = chapter.list.filter(episode => !query || episode.searchText.includes(query));
      total += hits.length;

      chapter.list.forEach(episode => {
        const visible = !query || episode.searchText.includes(query);
        episode.element.hidden = !visible;
        if (visible) paintEpisode(episode, query);
      });
      chapter.section.hidden = hits.length === 0;
      chapter.section.querySelector(".ch-head span").textContent =
        query ? `${hits.length}개 찾음` : `이야기 ${chapter.list.length}개`;

      const item = document.createElement("li");
      if (hits.length === 0) item.className = "zero";
      item.innerHTML =
        `<a href="#era-${chapter.eraIndex}" data-era="${escapeHtml(chapter.era)}">` +
        `<span>${escapeHtml(chapter.era)}</span><small>${hits.length}</small></a>`;
      toc.appendChild(item);
    });

    return { total };
  }

  function find(number) {
    return episodes[number - 1];
  }

  function syncScrollPosition() {
    const marker = window.innerHeight * 0.3;
    let currentEra = null;
    chapters.forEach(chapter => {
      if (!chapter.section.hidden && chapter.section.getBoundingClientRect().top < marker) {
        currentEra = chapter.era;
      }
    });

    toc.querySelectorAll("a").forEach(link => {
      const active = link.dataset.era === currentEra;
      link.classList.toggle("on", active);
      if (active && toc.scrollWidth > toc.clientWidth) {
        toc.scrollLeft = link.offsetLeft - toc.clientWidth / 2 + link.offsetWidth / 2;
      }
    });
  }

  return { render, find, syncScrollPosition };
}

export { escapeHtml };
