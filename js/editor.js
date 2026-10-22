const element = id => document.getElementById(id);
const saveButton = element("save-file");
const fileStatus = element("file-status");
const saveStatus = element("save-status");
const notice = element("notice");
const searchInput = element("search");
const eraFilter = element("era-filter");
const storyList = element("story-list");
const form = element("story-form");
const fields = element("fields");
const emptyState = element("empty-state");

if (location.pathname.endsWith("/editor/")) {
  history.replaceState(history.state, "", `${location.pathname.slice(0, -1)}${location.search}${location.hash}`);
}

let episodes = [];
let savedEpisodes = [];
let selectedIndex = -1;
let draft = null;
let fileHandle = null;
let lastSavedAt = "";
let dirty = false;
let eras = [];
let eraLoadWarning = "";

const supportsDirectSave = "showOpenFilePicker" in window;

function showError(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function clearError() {
  notice.textContent = "";
  notice.hidden = true;
}

function setDirty(value) {
  dirty = value;
  saveButton.disabled = !dirty;
  saveStatus.textContent = dirty
    ? "저장하지 않은 변경 사항이 있습니다."
    : lastSavedAt
      ? lastSavedAt
      : "변경 사항은 저장 버튼을 눌러야 파일에 기록됩니다.";
}

function validateEpisodes(value) {
  if (!Array.isArray(value)) {
    throw new Error("JSON 최상위 값은 에피소드 배열이어야 합니다.");
  }
  value.forEach((episode, index) => {
    const label = `${index + 1}번째 이야기`;
    if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
      throw new Error(`${label}는 객체여야 합니다.`);
    }
    for (const key of ["era", "title", "text"]) {
      if (typeof episode[key] !== "string") {
        throw new Error(`${label}의 ${key} 값은 문자열이어야 합니다.`);
      }
    }
    if (!Array.isArray(episode.who) || episode.who.some(person => typeof person !== "string")) {
      throw new Error(`${label}의 who 값은 문자열 배열이어야 합니다.`);
    }
    if (episode.bright !== undefined && typeof episode.bright !== "boolean") {
      throw new Error(`${label}의 bright 값은 true 또는 false여야 합니다.`);
    }
  });
}

function cloneEpisode(episode) {
  return { ...episode, who: [...episode.who] };
}

function requestedEpisodeIndex(length) {
  const storedIndex = sessionStorage.getItem("bongmabang-edit-episode");
  sessionStorage.removeItem("bongmabang-edit-episode");
  const index = Number(storedIndex);
  return Number.isInteger(index) && index >= 0 && index < length ? index : 0;
}

function enableEditing() {
  for (const control of [searchInput, eraFilter, element("add-story")]) control.disabled = false;
}

function updateEraOptions() {
  const values = [...new Set([...eras, ...episodes.map(episode => episode.era).filter(Boolean), draft?.era].filter(Boolean))];
  element("era-options").replaceChildren(...values.map(era => {
    const option = document.createElement("option");
    option.value = era;
    return option;
  }));

  const current = eraFilter.value;
  eraFilter.replaceChildren(new Option("모든 시기", ""), ...values.map(era => new Option(era, era)));
  eraFilter.value = values.includes(current) ? current : "";
}

function renderList() {
  updateEraOptions();
  element("story-count").textContent = String(episodes.length);
  const query = searchInput.value.trim().toLocaleLowerCase();
  const era = eraFilter.value;
  const items = episodes.map((episode, index) => ({
    episode: index === selectedIndex && draft ? draft : episode,
    index
  })).filter(({ episode }) =>
    (!era || episode.era === era) &&
    (!query || [episode.title, episode.text, episode.era, episode.who.join(" ")].join(" ").toLocaleLowerCase().includes(query))
  );

  storyList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = episodes.length ? "검색 결과가 없습니다." : "이야기가 없습니다. + 추가를 눌러 시작하세요.";
    storyList.appendChild(empty);
    return;
  }

  items.forEach(({ episode, index }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `story-option${index === selectedIndex ? " selected" : ""}`;
    button.setAttribute("aria-current", index === selectedIndex ? "true" : "false");

    const number = document.createElement("span");
    number.className = "number";
    number.textContent = String(index + 1).padStart(2, "0");
    const summary = document.createElement("span");
    summary.className = "summary";
    const title = document.createElement("strong");
    title.textContent = episode.title || "(제목 없음)";
    const detail = document.createElement("small");
    detail.textContent = `${episode.era || "시기 없음"} · ${episode.who.join(", ")}`;
    summary.append(title, detail);
    button.append(number, summary);
    button.addEventListener("click", () => selectStory(index));
    storyList.appendChild(button);
  });
}

function showDraft() {
  const hasDraft = draft !== null;
  fields.hidden = !hasDraft;
  emptyState.hidden = hasDraft;
  if (!hasDraft) return;

  element("story-number").textContent = selectedIndex < 0 ? "새 이야기" : `${String(selectedIndex + 1).padStart(2, "0")} · ${draft.era}`;
  element("form-title").textContent = selectedIndex < 0 ? "이야기 추가" : "이야기 수정";
  element("era").value = draft.era;
  element("title").value = draft.title;
  element("who").value = draft.who.join("\n");
  element("text").value = draft.text;
  element("bright").checked = draft.bright === true;
  element("delete-story").hidden = selectedIndex < 0;
}

function confirmDiscard() {
  if (!dirty) return true;
  return window.confirm("저장하지 않은 변경 사항을 버리고 이동할까요?");
}

function selectStory(index) {
  if (index === selectedIndex || !confirmDiscard()) return;
  const target = episodes[index];
  if (dirty) {
    discardPendingChanges();
    index = episodes.indexOf(target);
  }
  if (index < 0) return;
  selectedIndex = index;
  draft = cloneEpisode(episodes[index]);
  setDirty(false);
  showDraft();
  renderList();
}

function readForm() {
  if (!draft) return;
  draft.era = element("era").value.trim();
  draft.title = element("title").value;
  draft.who = element("who").value.split(/\r?\n/).map(person => person.trim()).filter(Boolean);
  draft.text = element("text").value;
  if (element("bright").checked) draft.bright = true;
  else delete draft.bright;
}

function updateDraft() {
  readForm();
  setDirty(true);
  renderList();
}

function mergeDraft() {
  if (!draft) return [...episodes];
  const next = [...episodes];
  if (selectedIndex < 0) next.push({ ...draft, who: [...draft.who] });
  else next[selectedIndex] = { ...draft, who: [...draft.who] };
  return next;
}

function formatTime() {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

async function requestWritePermission(handle) {
  if (!handle) return false;
  const current = await handle.queryPermission({ mode: "readwrite" });
  if (current === "granted") return true;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

function databaseRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeFileHandle(handle) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("bongmabang-editor", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction("files", "readwrite");
  transaction.objectStore("files").put(handle, "episodes");
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

async function getStoredFileHandle() {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("bongmabang-editor", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const handle = await databaseRequest(database.transaction("files").objectStore("files").get("episodes"));
  database.close();
  return handle || null;
}

async function saveFile() {
  if (!dirty) return;
  readForm();
  if (!draft.era || !draft.title.trim() || !draft.text.trim()) {
    showError("시기, 제목, 이야기는 비워둘 수 없습니다.");
    return;
  }
  const nextEpisodes = mergeDraft();
  let handleRemembered = true;
  try {
    validateEpisodes(nextEpisodes);
    const contents = `${JSON.stringify(nextEpisodes, null, 2)}\n`;
    if (supportsDirectSave) {
      if (!fileHandle) {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          mode: "readwrite",
          types: [{ description: "episodes.json", accept: { "application/json": [".json"] } }]
        });
        if (handle.name !== "episodes.json") {
          throw new Error("프로젝트의 data/episodes.json 파일을 선택해 주세요.");
        }
        const selectedFile = await handle.getFile();
        const selectedEpisodes = JSON.parse(await selectedFile.text());
        validateEpisodes(selectedEpisodes);
        if (JSON.stringify(selectedEpisodes) !== JSON.stringify(savedEpisodes)) {
          throw new Error("선택한 파일이 편집기에 불러온 데이터와 다릅니다. 프로젝트의 data/episodes.json을 선택해 주세요.");
        }
        fileHandle = handle;
      }
      if (!(await requestWritePermission(fileHandle))) {
        throw new Error("파일 쓰기 권한이 허용되지 않았습니다.");
      }
      const currentFile = await fileHandle.getFile();
      const currentEpisodes = JSON.parse(await currentFile.text());
      validateEpisodes(currentEpisodes);
      if (JSON.stringify(currentEpisodes) !== JSON.stringify(savedEpisodes)) {
        throw new Error("episodes.json이 편집기에서 불러온 뒤 변경됐습니다. 새로고침하고 다시 편집해 주세요.");
      }
      const writable = await fileHandle.createWritable();
      await writable.write(contents);
      await writable.close();
      try {
        await storeFileHandle(fileHandle);
      } catch {
        handleRemembered = false;
      }
    } else {
      downloadJson(contents);
      return;
    }
    episodes = nextEpisodes;
    savedEpisodes = episodes.slice();
    if (selectedIndex < 0) selectedIndex = episodes.length - 1;
    draft = selectedIndex < 0 ? null : cloneEpisode(episodes[selectedIndex]);
    lastSavedAt = `저장 완료 · ${formatTime()}${handleRemembered ? "" : " · 다음 방문 시 파일 선택 필요"}`;
    setDirty(false);
    clearError();
    renderList();
    showDraft();
  } catch (error) {
    if (error.name !== "AbortError") showError(`저장하지 못했습니다. ${error.message}`);
  }
}

function downloadJson(contents = `${JSON.stringify(mergeDraft(), null, 2)}\n`) {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "episodes.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  episodes = mergeDraft();
  savedEpisodes = episodes.slice();
  if (selectedIndex < 0) selectedIndex = episodes.length - 1;
  draft = selectedIndex < 0 ? null : cloneEpisode(episodes[selectedIndex]);
  lastSavedAt = "JSON 다운로드 완료 · data/episodes.json을 교체해 주세요.";
  setDirty(false);
  clearError();
  renderList();
  showDraft();
}

function addStory() {
  if (!confirmDiscard()) return;
  discardPendingChanges();
  const defaultEra = eras.at(-1) || episodes.at(-1)?.era || "";
  selectedIndex = -1;
  draft = { era: defaultEra, title: "", who: [], text: "" };
  setDirty(true);
  showDraft();
  renderList();
  element("era").focus();
}

function deleteStory() {
  if (selectedIndex < 0 || !window.confirm("이 이야기를 삭제할까요? 저장 전의 수정 내용도 함께 버려집니다.")) return;
  episodes.splice(selectedIndex, 1);
  selectedIndex = episodes.length ? Math.min(selectedIndex, episodes.length - 1) : -1;
  draft = selectedIndex < 0 ? null : cloneEpisode(episodes[selectedIndex]);
  setDirty(true);
  clearError();
  renderList();
  showDraft();
}

function discardPendingChanges() {
  if (!dirty) return;
  episodes = savedEpisodes.slice();
  selectedIndex = -1;
  draft = null;
  setDirty(false);
  renderList();
  showDraft();
}

async function start() {
  try {
    const response = await fetch("../data/squad.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const squad = await response.json();
    if (!squad || !Array.isArray(squad.eras) || squad.eras.some(era => typeof era !== "string")) {
      throw new Error("squad.json의 eras 값이 올바르지 않습니다.");
    }
    eras = squad.eras;
  } catch (error) {
    eras = [];
    eraLoadWarning = `시기 추천을 불러오지 못했습니다. 시기는 직접 입력할 수 있습니다. (${error.message})`;
    showError(eraLoadWarning);
  }

  try {
    const response = await fetch("../data/episodes.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const loadedEpisodes = await response.json();
    validateEpisodes(loadedEpisodes);
    episodes = loadedEpisodes.map(cloneEpisode);
    savedEpisodes = episodes.slice();
    selectedIndex = episodes.length ? requestedEpisodeIndex(episodes.length) : -1;
    draft = selectedIndex < 0 ? null : cloneEpisode(episodes[selectedIndex]);
    fileStatus.textContent = `자동 불러옴 · data/episodes.json (${episodes.length}개)`;
    enableEditing();
    lastSavedAt = "";
    setDirty(false);
    renderList();
    showDraft();
    if (eraLoadWarning) showError(eraLoadWarning);
  } catch (error) {
    fileStatus.textContent = "episodes.json을 불러오지 못했습니다.";
    element("empty-state").querySelector("h2").textContent = "이야기를 불러오지 못했습니다";
    element("empty-state").querySelector("p").textContent = "Live Server로 열고 data/episodes.json의 경로와 JSON을 확인해 주세요.";
    showError(`데이터를 읽지 못했습니다. ${error.message}`);
    return;
  }

  if (supportsDirectSave) {
    try {
      const savedHandle = await getStoredFileHandle();
      if (savedHandle && savedHandle.name === "episodes.json" &&
          await savedHandle.queryPermission({ mode: "read" }) === "granted") {
        const file = await savedHandle.getFile();
        const storedEpisodes = JSON.parse(await file.text());
        validateEpisodes(storedEpisodes);
        if (JSON.stringify(storedEpisodes) === JSON.stringify(episodes)) {
          fileHandle = savedHandle;
        }
      }
    } catch {
      fileHandle = null;
    }
  }

  if (!supportsDirectSave) {
    saveButton.textContent = "JSON 다운로드";
    saveStatus.textContent = "저장하면 JSON을 다운로드합니다. 내려받은 파일로 data/episodes.json을 교체해 주세요.";
  }
}

saveButton.addEventListener("click", saveFile);
element("add-story").addEventListener("click", addStory);
element("delete-story").addEventListener("click", deleteStory);
searchInput.addEventListener("input", renderList);
eraFilter.addEventListener("change", renderList);
form.addEventListener("input", updateDraft);
form.addEventListener("submit", event => event.preventDefault());
window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveFile();
  }
});
window.addEventListener("beforeunload", event => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

start().catch(error => showError(`편집기를 초기화하지 못했습니다. ${error.message}`));
