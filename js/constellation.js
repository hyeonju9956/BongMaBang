const SHAPE = [
  [[.334,.045],[.226,.069],[.13,.12],[.063,.206],[.08,.31],[.128,.397],[.038,.461],[.001,.561],[.042,.66],[.125,.736],[.226,.774],[.338,.77],[.445,.743],[.471,.653],[.499,.547],[.523,.442],[.548,.335],[.569,.226],[.532,.127],[.446,.057]],
  [[.793,0],[.707,.013],[.63,.042],[.628,.127],[.611,.208],[.593,.292],[.577,.376],[.569,.462],[.62,.531],[.694,.567],[.783,.564],[.862,.538],[.931,.487],[.964,.411],[.93,.337],[.927,.278],[.987,.217],[.994,.136],[.946,.064],[.876,.017]],
  [[.378,.185],[.404,.277],[.338,.354],[.224,.321],[.262,.219]],
  [[.319,.464],[.337,.558],[.277,.656],[.16,.614],[.2,.503]],
  [[.777,.095],[.872,.121],[.853,.207],[.762,.243],[.738,.179]],
  [[.752,.328],[.837,.359],[.8,.436],[.711,.461],[.697,.385]]
];
const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 640;
const HEIGHT = 470;
const BASE_X = 70;
const BASE_Y = 40;
const BASE_WIDTH = 500;
export const constellationStarCount = SHAPE.reduce((total, group) => total + group.length, 0);

function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function createSvgElement(name, className, content) {
  const element = document.createElementNS(SVG_NS, name);
  if (className) element.setAttribute("class", className);
  if (content) element.innerHTML = content;
  return element;
}

export function createConstellation(episodes, { caption, onSelect }) {
  const ghost = document.getElementById("ghost");
  const lines = document.getElementById("clines");
  const stars = document.getElementById("stars");
  const captionElement = document.getElementById("caption");
  const points = SHAPE.flatMap(group => group.map(([x, y]) => ({
    x: BASE_X + x * BASE_WIDTH,
    y: BASE_Y + y * BASE_WIDTH
  })));
  let offset = 0;
  const outline = SHAPE.map(group => {
    const path = `M${group.map((_, index) =>
      `${points[offset + index].x.toFixed(1)} ${points[offset + index].y.toFixed(1)}`
    ).join(" L")} Z`;
    offset += group.length;
    return path;
  }).join(" ");
  ghost.appendChild(createSvgElement("path", "ghost", outline));
  ghost.firstElementChild.setAttribute("stroke-dasharray", "1 5");
  ghost.firstElementChild.setAttribute("stroke-linecap", "round");

  let path = "";
  offset = 0;
  SHAPE.forEach(group => {
    group.forEach((_, index) => {
      const start = offset + index;
      const end = offset + (index + 1) % group.length;
      if (start < episodes.length && end < episodes.length) {
        path += `M${points[start].x.toFixed(1)} ${points[start].y.toFixed(1)} L${points[end].x.toFixed(1)} ${points[end].y.toFixed(1)} `;
      }
    });
    offset += group.length;
  });
  lines.appendChild(createSvgElement("path", "cline", path));

  const insideShape = (x, y) =>
    x > BASE_X - 6 && x < BASE_X + BASE_WIDTH + 6 &&
    y > BASE_Y - 6 && y < BASE_Y + BASE_WIDTH * .78 + 6;
  const random = seededRandom(2015);
  const placed = [];
  episodes.forEach(episode => {
    if (episode.index < points.length) {
      episode.x = points[episode.index].x;
      episode.y = points[episode.index].y;
      episode.free = false;
      return;
    }

    let x;
    let y;
    let attempts = 0;
    do {
      x = 8 + random() * (WIDTH - 16);
      y = 8 + random() * (HEIGHT - 16);
      attempts++;
    } while ((insideShape(x, y) || placed.some(point => Math.hypot(point.x - x, point.y - y) < 26)) && attempts < 500);
    episode.x = x;
    episode.y = y;
    episode.free = true;
    placed.push(episode);
  });

  const starElements = episodes.map(episode => {
    const star = createSvgElement("g");
    star.setAttribute("class", `st${episode.free ? " free" : ""}${episode.bright ? " legend" : ""}`);
    star.setAttribute("transform", `translate(${episode.x.toFixed(1)} ${episode.y.toFixed(1)})`);
    star.setAttribute("role", "link");
    star.setAttribute("tabindex", "0");
    star.setAttribute("aria-label", `${episode.number}번, ${episode.era}, ${episode.title}`);
    const radius = episode.bright ? 4.2 : episode.free ? 2.6 : 3;
    star.innerHTML = `<circle class="halo" r="12"></circle><circle class="dot" r="${radius}"></circle><circle r="12" fill="transparent"></circle>`;
    star.addEventListener("mouseenter", () => showCaption(episode));
    star.addEventListener("focus", () => showCaption(episode));
    star.addEventListener("mouseleave", () => showCaption(null));
    star.addEventListener("click", () => onSelect(episode));
    star.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(episode);
      }
    });
    stars.appendChild(star);
    return star;
  });

  function showCaption(episode) {
    captionElement.innerHTML = episode
      ? `${episode.number}번 별, <b>${caption.escape(episode.title)}</b> (${caption.escape(episode.era)})`
      : (episodes.length ? "별을 누르면 그 이야기로 이동해요" : "");
  }

  showCaption(null);
  return {
    setQuery(query, matches) {
      episodes.forEach((episode, index) => {
        starElements[index].classList.toggle("dim", Boolean(query) && !matches(episode));
        starElements[index].classList.toggle("hit", Boolean(query) && matches(episode));
      });
    },
    select(episode) {
      starElements.forEach(star => star.classList.remove("on"));
      starElements[episode.index].classList.add("on");
    }
  };
}
