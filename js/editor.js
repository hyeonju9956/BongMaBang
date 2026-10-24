import { api, apiRequest, clearAuthToken, getAuthToken, setAuthToken } from "./api-client.js";

const element = id => document.getElementById(id);
const loginForm = element("login-form");
const loginPanel = element("login-panel");
const adminLink = element("admin-link");
const logoutButton = element("logout");
const exportButton = element("export-all");
const addButton = element("add-story");
const saveButton = element("save-episode");
const deleteButton = element("delete-story");
const moveUpButton = element("move-up");
const moveDownButton = element("move-down");
const fileStatus = element("file-status");
const saveStatus = element("save-status");
const statusDot = document.querySelector(".status-dot");
const notice = element("notice");
const searchInput = element("search");
const eraFilter = element("era-filter");
const storyList = element("story-list");
const form = element("story-form");
const fields = element("fields");

let currentUser = null;
let episodes = [];
let orderVersion = 0;
let selectedId = null;
let draft = null;
let dirty = false;
let lastSavedAt = "";

function showError(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function clearError() {
  notice.textContent = "";
  notice.hidden = true;
}

function setStatus(title, detail, connected = false) {
  fileStatus.lastChild.textContent = title;
  saveStatus.textContent = detail;
  statusDot.style.background = connected ? "#55845b" : "#c08a38";
}

function setDirty(value) {
  dirty = value;
  saveButton.disabled = !currentUser || !dirty;
  saveStatus.textContent = dirty
    ? "저장하지 않은 변경 사항이 있습니다."
    : lastSavedAt || "에피소드별로 저장됩니다.";
}

function cloneEpisode(episode) {
  return { ...episode, who: [...episode.who] };
}

function updateEraOptions() {
  const eras = [...new Set(episodes.map(episode => episode.era).filter(Boolean))];
  const current = eraFilter.value;
  eraFilter.replaceChildren(new Option("모든 시기", ""), ...eras.map(era => new Option(era, era)));
  eraFilter.value = eras.includes(current) ? current : "";
  element("era-options").replaceChildren(...eras.map(era => {
    const option = document.createElement("option");
    option.value = era;
    return option;
  }));
}

function renderList() {
  updateEraOptions();
  element("story-count").textContent = String(episodes.length);
  const query = searchInput.value.trim().toLocaleLowerCase();
  const era = eraFilter.value;
  const displayed = episodes.map(episode => episode.id === selectedId && draft ? draft : episode);
  const matches = displayed.filter(episode =>
    (!era || episode.era === era) &&
    (!query || [episode.title, episode.text, episode.era, episode.who.join(" ")]
      .join(" ").toLocaleLowerCase().includes(query))
  );
  storyList.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = episodes.length ? "검색 결과가 없습니다." : "DB에 에피소드가 없습니다. + 추가로 시작하세요.";
    storyList.appendChild(empty);
    return;
  }
  for (const episode of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `story-option${episode.id === selectedId ? " selected" : ""}`;
    button.setAttribute("aria-current", episode.id === selectedId ? "true" : "false");
    const number = document.createElement("span");
    number.className = "number";
    number.textContent = String(episode.order + 1).padStart(2, "0");
    const summary = document.createElement("span");
    summary.className = "summary";
    const title = document.createElement("strong");
    title.textContent = episode.title || "(제목 없음)";
    const detail = document.createElement("small");
    detail.textContent = `${episode.era} · ${episode.who.join(", ")}`;
    summary.append(title, detail);
    button.append(number, summary);
    button.addEventListener("click", () => selectEpisode(episode.id));
    storyList.appendChild(button);
  }
}

function showDraft() {
  fields.disabled = !currentUser || !draft;
  if (!draft) return;
  element("story-number").textContent = draft.id
    ? `${String(draft.order + 1).padStart(2, "0")} · ${draft.era}`
    : "새 에피소드";
  element("form-title").textContent = draft.id ? "에피소드 수정" : "에피소드 추가";
  element("era").value = draft.era;
  element("title").value = draft.title;
  element("who").value = draft.who.join("\n");
  element("text").value = draft.text;
  element("bright").checked = draft.bright === true;
  const isAdmin = currentUser?.role === "admin";
  const index = episodes.findIndex(episode => episode.id === draft.id);
  deleteButton.hidden = !draft.id || !currentUser;
  deleteButton.disabled = !currentUser || dirty;
  deleteButton.textContent = isAdmin ? "삭제" : "삭제 요청";
  moveUpButton.hidden = !draft.id;
  moveDownButton.hidden = !draft.id;
  moveUpButton.disabled = !currentUser || dirty || index <= 0;
  moveDownButton.disabled = !currentUser || dirty || index < 0 || index >= episodes.length - 1;
  saveButton.disabled = !currentUser || !dirty;
  saveButton.textContent = isAdmin ? "저장" : "승인 요청";
}

function readForm() {
  if (!draft) return;
  draft.era = element("era").value.trim();
  draft.title = element("title").value.trim();
  draft.who = element("who").value.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  draft.text = element("text").value;
  if (element("bright").checked) draft.bright = true;
  else delete draft.bright;
}

function selectEpisode(id) {
  if (id === selectedId || (dirty && !window.confirm("저장하지 않은 변경 사항을 버리고 이동할까요?"))) return;
  const episode = episodes.find(item => item.id === id);
  if (!episode) return;
  selectedId = id;
  draft = cloneEpisode(episode);
  lastSavedAt = "";
  setDirty(false);
  showDraft();
  renderList();
}

async function loadEpisodes(selectId = selectedId) {
  const result = await api("/episodes");
  episodes = result.episodes;
  orderVersion = result.orderVersion;
  const nextSelection = episodes.find(episode => episode.id === selectId) || episodes[0] || null;
  selectedId = nextSelection?.id || null;
  draft = nextSelection ? cloneEpisode(nextSelection) : null;
  setDirty(false);
  showDraft();
  renderList();
}

async function enableUserSession() {
  loginPanel.hidden = true;
  logoutButton.hidden = false;
  addButton.disabled = false;
  adminLink.hidden = currentUser.role !== "admin";
  const isAdmin = currentUser.role === "admin";
  element("connection-note").textContent = isAdmin
    ? "관리자 변경은 즉시 DB에 저장됩니다. 일반 사용자 변경 요청은 승인 관리 화면에서 검토할 수 있습니다."
    : "추가·수정·삭제·순서 변경은 승인 요청으로 등록되며, 관리자가 승인한 뒤 DB에 반영됩니다.";
  setStatus(
    `DB 연결됨 · ${currentUser.username} (${isAdmin ? "관리자" : "일반 사용자"})`,
    isAdmin ? "관리자 권한으로 편집 중입니다." : "변경 내용은 관리자 승인 전까지 공개 데이터에 반영되지 않습니다.",
    true
  );
  showDraft();
  setDirty(dirty);
}

async function authenticate(event) {
  event.preventDefault();
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: element("login-username").value.trim(),
        password: element("login-password").value
      })
    });
    currentUser = result.user;
    setAuthToken(result.token);
    await enableUserSession();
    clearError();
  } catch (error) {
    showError(error.message);
  } finally {
    submitButton.disabled = false;
  }
}

function logout() {
  currentUser = null;
  clearAuthToken();
  loginPanel.hidden = false;
  logoutButton.hidden = true;
  adminLink.hidden = true;
  addButton.disabled = true;
  fields.disabled = true;
  setDirty(false);
  showDraft();
  setStatus("DB 연결됨 · 로그아웃", "로그인하면 변경을 제출할 수 있습니다.", true);
}

function validateDraft() {
  readForm();
  const invalid = [];
  if (!draft.era) invalid.push("시기");
  if (!draft.title) invalid.push("제목");
  if (!draft.text.trim()) invalid.push("이야기");
  if (invalid.length) {
    showError(`${invalid.join(", ")} 항목을 입력해 주세요.`);
    return false;
  }
  return true;
}

function episodePayload() {
  return {
    era: draft.era,
    title: draft.title,
    who: draft.who,
    text: draft.text,
    ...(draft.bright ? { bright: true } : {})
  };
}

async function saveEpisode() {
  if (!currentUser || !draft || !dirty || !validateDraft()) return;
  saveButton.disabled = true;
  try {
    const isNew = !draft.id;
    const isAdmin = currentUser.role === "admin";
    if (!isAdmin) {
      const result = await api("/requests", {
        method: "POST",
        body: JSON.stringify({
          action: isNew ? "create" : "update",
          ...(isNew ? {} : { episodeId: draft.id, baseVersion: draft.version }),
          payload: episodePayload()
        })
      });
      lastSavedAt = `승인 요청 접수 · ${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
      if (isNew) {
        selectedId = null;
        draft = null;
      } else {
        const original = episodes.find(episode => episode.id === selectedId);
        draft = original ? cloneEpisode(original) : null;
      }
      setDirty(false);
      clearError();
      setStatus("승인 대기", `요청 #${result.request.id.slice(-6)}을 관리자에게 전달했습니다. 승인 전까지 공개 데이터에는 반영되지 않습니다.`, true);
      showDraft();
      renderList();
      return;
    }
    const result = await api(isNew ? "/admin/episodes" : `/admin/episodes/${encodeURIComponent(draft.id)}`, {
      method: isNew ? "POST" : "PATCH",
      ...(isNew ? {} : { headers: { "If-Match": `"${draft.version}"` } }),
      body: JSON.stringify(episodePayload())
    });
    const saved = result.episode;
    if (isNew) orderVersion = result.orderVersion;
    const index = episodes.findIndex(episode => episode.id === saved.id);
    if (index < 0) episodes.push(saved);
    else episodes[index] = saved;
    episodes.sort((a, b) => a.order - b.order);
    selectedId = saved.id;
    draft = cloneEpisode(saved);
    lastSavedAt = `에피소드 저장 완료 · ${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    setDirty(false);
    clearError();
    showDraft();
    renderList();
  } catch (error) {
    const fieldDetails = error.fields
      ? `\n${Object.entries(error.fields).map(([field, message]) => `${field}: ${message}`).join("\n")}`
      : "";
    showError(error.status === 409
      ? `${error.message} 현재 작성 내용은 유지했습니다.`
      : `저장하지 못했습니다. ${error.message}${fieldDetails}`);
    saveButton.disabled = false;
  }
}

function addEpisode() {
  if (dirty && !window.confirm("저장하지 않은 변경 사항을 버리고 새 에피소드를 만들까요?")) return;
  selectedId = null;
  draft = { era: episodes.at(-1)?.era || "", title: "", who: [], text: "" };
  setDirty(true);
  showDraft();
  renderList();
  element("era").focus();
}

async function deleteEpisode() {
  if (!currentUser || !draft?.id) return;
  const isAdmin = currentUser.role === "admin";
  if (!window.confirm(isAdmin ? "이 에피소드를 DB에서 삭제할까요?" : "삭제를 관리자에게 요청할까요?")) return;
  const removedId = draft.id;
  try {
    if (!isAdmin) {
      const result = await api("/requests", {
        method: "POST",
        body: JSON.stringify({ action: "delete", episodeId: removedId, baseVersion: draft.version })
      });
      lastSavedAt = "삭제 승인 요청을 접수했습니다.";
      setDirty(false);
      setStatus("승인 대기", `삭제 요청 #${result.request.id.slice(-6)}을 관리자에게 전달했습니다.`, true);
      return;
    }
    const result = await api(`/admin/episodes/${encodeURIComponent(removedId)}`, {
      method: "DELETE",
      headers: { "If-Match": `"${draft.version}"` }
    });
    orderVersion = result.orderVersion;
    const nextIndex = episodes.findIndex(episode => episode.id === removedId);
    episodes = episodes.filter(episode => episode.id !== removedId).map((episode, order) => ({ ...episode, order }));
    const nextEpisode = episodes[Math.min(nextIndex, episodes.length - 1)] || null;
    selectedId = nextEpisode?.id || null;
    draft = nextEpisode ? cloneEpisode(nextEpisode) : null;
    lastSavedAt = "에피소드를 삭제했습니다.";
    setDirty(false);
    showDraft();
    renderList();
    clearError();
  } catch (error) {
    showError(`삭제하지 못했습니다. ${error.message}`);
  }
}

async function moveEpisode(offset) {
  if (!currentUser || dirty || !selectedId) return;
  const from = episodes.findIndex(episode => episode.id === selectedId);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= episodes.length) return;
  const ids = episodes.map(episode => episode.id);
  [ids[from], ids[to]] = [ids[to], ids[from]];
  moveUpButton.disabled = true;
  moveDownButton.disabled = true;
  try {
    if (currentUser.role === "user") {
      const result = await api("/requests", {
        method: "POST",
        body: JSON.stringify({ action: "reorder", ids, orderVersion })
      });
      lastSavedAt = "순서 변경 승인 요청을 접수했습니다.";
      setStatus("승인 대기", `순서 변경 요청 #${result.request.id.slice(-6)}을 관리자에게 전달했습니다.`, true);
      showDraft();
      return;
    }
    const result = await api("/admin/episodes/reorder", {
      method: "POST",
      headers: { "If-Match": `"${orderVersion}"` },
      body: JSON.stringify({ ids })
    });
    orderVersion = result.orderVersion;
    episodes = ids.map((id, order) => ({ ...episodes.find(episode => episode.id === id), order }));
    draft = cloneEpisode(episodes.find(episode => episode.id === selectedId));
    lastSavedAt = "에피소드 순서를 저장했습니다.";
    clearError();
    showDraft();
    renderList();
  } catch (error) {
    showError(`순서를 저장하지 못했습니다. ${error.message}`);
    showDraft();
  }
}

async function exportAll() {
  exportButton.disabled = true;
  try {
    const response = await apiRequest("/export");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "episodes.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    clearError();
  } catch (error) {
    showError(`내보내지 못했습니다. ${error.message}`);
  } finally {
    exportButton.disabled = false;
  }
}

async function start() {
  setStatus("DB 서버 연결 중", "서버에서 에피소드 목록을 불러오는 중입니다.");
  try {
    const health = await api("/health");
    await loadEpisodes();
    exportButton.disabled = false;
    for (const control of [searchInput, eraFilter]) control.disabled = false;
    loginPanel.hidden = false;
    setStatus(`DB 연결됨 · ${health.database}`, "로그인하면 변경을 제출할 수 있습니다.", true);
  } catch (error) {
    setStatus("DB 서버에 연결할 수 없습니다", "API 주소와 서버 상태를 확인해 주세요.");
    showError(error.message);
    return;
  }

  try {
    const response = await fetch("../data/squad.json");
    if (response.ok) {
      const squad = await response.json();
      const eras = Array.isArray(squad.eras) ? squad.eras : [];
      element("era-options").replaceChildren(...eras.map(era => {
        const option = document.createElement("option");
        option.value = era;
        return option;
      }));
    }
  } catch {
    // Era suggestions are optional; free-form era input remains available.
  }

  const storedIndex = Number(sessionStorage.getItem("bongmabang-edit-episode"));
  sessionStorage.removeItem("bongmabang-edit-episode");
  if (Number.isInteger(storedIndex) && episodes[storedIndex]) selectEpisode(episodes[storedIndex].id);
  const storedToken = getAuthToken();
  if (storedToken) {
    try {
      const result = await api("/auth/me");
      currentUser = result.user;
      await enableUserSession();
    } catch {
      clearAuthToken();
    }
  }
}

loginForm.addEventListener("submit", authenticate);
logoutButton.addEventListener("click", logout);
exportButton.addEventListener("click", exportAll);
addButton.addEventListener("click", addEpisode);
saveButton.addEventListener("click", saveEpisode);
deleteButton.addEventListener("click", deleteEpisode);
moveUpButton.addEventListener("click", () => moveEpisode(-1));
moveDownButton.addEventListener("click", () => moveEpisode(1));
searchInput.addEventListener("input", renderList);
eraFilter.addEventListener("change", renderList);
form.addEventListener("input", () => {
  if (!draft || !currentUser) return;
  readForm();
  setDirty(true);
  renderList();
});
form.addEventListener("submit", event => event.preventDefault());
window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveEpisode();
  }
});
window.addEventListener("beforeunload", event => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

start().catch(error => {
  setStatus("편집기 초기화 실패", "화면을 새로고침하거나 API 서버 상태를 확인해 주세요.");
  showError(error.message);
});
