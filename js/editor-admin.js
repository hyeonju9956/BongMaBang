import { api, clearAuthToken, getAuthToken, setAuthToken } from "./api-client.js";

const element = id => document.getElementById(id);
const loginPanel = element("admin-login");
const content = element("admin-content");
const loginForm = element("admin-login-form");
const logoutButton = element("admin-logout");
const requestList = element("request-list");
const accountList = element("account-list");
const notice = element("admin-notice");

let refreshTimer = null;
let selectedRequestId = null;

function showError(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function clearError() {
  notice.textContent = "";
  notice.hidden = true;
}

function addText(parent, tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

function episodeFields(episode = {}) {
  return [
    ["시기", episode.era || ""],
    ["제목", episode.title || ""],
    ["등장인물", Array.isArray(episode.who) ? episode.who.join("\n") : episode.who || ""],
    ["내용", episode.text || ""],
    ["레전드 표시", episode.bright ? "예" : "아니요"]
  ];
}

function appendHighlightedText(parent, before, after) {
  const oldText = String(before ?? "");
  const newText = String(after ?? "");
  if (oldText === newText) {
    parent.textContent = newText || "—";
    return;
  }

  let prefix = 0;
  while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldText.length - prefix &&
    suffix < newText.length - prefix &&
    oldText[oldText.length - suffix - 1] === newText[newText.length - suffix - 1]
  ) suffix++;

  parent.append(document.createTextNode(newText.slice(0, prefix)));
  const changed = document.createElement("mark");
  changed.textContent = newText.slice(prefix, newText.length - suffix) || "∅";
  parent.appendChild(changed);
  if (suffix) parent.append(document.createTextNode(newText.slice(newText.length - suffix)));
}

function renderRequestDetail(request) {
  const detail = element("request-detail");
  detail.replaceChildren();
  if (!request) {
    detail.hidden = true;
    return;
  }

  detail.hidden = false;
  const heading = document.createElement("div");
  heading.className = "request-detail-heading";
  addText(heading, "h3", `${request.action.toUpperCase()} · ${request.submittedBy}`);
  addText(heading, "p", new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(request.createdAt)));
  detail.appendChild(heading);

  const comparison = document.createElement("div");
  comparison.className = "comparison";
  const beforeColumn = document.createElement("div");
  const afterColumn = document.createElement("div");
  beforeColumn.className = "comparison-column";
  afterColumn.className = "comparison-column";
  addText(beforeColumn, "h4", "원문");
  addText(afterColumn, "h4", "수정 제안 · 변경 부분 표시");

  if (request.action === "reorder") {
    const titles = new Map((request.before || []).map(episode => [episode.id, episode.title]));
    const originalOrder = (request.before || []).map((episode, index) => `${index + 1}. ${episode.title}`);
    const revisedOrder = (request.ids || []).map((id, index) => `${index + 1}. ${titles.get(id) || "새 목록 항목"}`);
    const oldOrder = addText(beforeColumn, "p", originalOrder.join("\n") || "—", "comparison-value");
    const newOrder = addText(afterColumn, "p", "", "comparison-value");
    appendHighlightedText(newOrder, originalOrder.join("\n"), revisedOrder.join("\n"));
    if (oldOrder.textContent === newOrder.textContent) newOrder.classList.add("comparison-unchanged");
  } else {
    const original = request.action === "create" ? null : request.before;
    const revised = request.action === "delete" ? null : request.payload;
    const oldFields = episodeFields(original || {});
    const newFields = episodeFields(revised || {});
    for (let index = 0; index < oldFields.length; index++) {
      const oldRow = document.createElement("section");
      const newRow = document.createElement("section");
      oldRow.className = "comparison-field";
      newRow.className = "comparison-field";
      addText(oldRow, "h5", oldFields[index][0]);
      addText(newRow, "h5", newFields[index][0]);
      addText(oldRow, "p", original ? oldFields[index][1] || "—" : "원문 없음", "comparison-value");
      const newValue = addText(newRow, "p", "", "comparison-value");
      if (revised) appendHighlightedText(newValue, oldFields[index][1], newFields[index][1]);
      else newValue.textContent = "삭제 요청";
      if (revised && oldFields[index][1] === newFields[index][1]) {
        newValue.classList.add("comparison-unchanged");
      }
      beforeColumn.appendChild(oldRow);
      afterColumn.appendChild(newRow);
    }
  }
  comparison.append(beforeColumn, afterColumn);
  detail.appendChild(comparison);

  const actions = document.createElement("div");
  actions.className = "request-actions";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "button primary";
  approve.textContent = "승인";
  approve.addEventListener("click", () => decideRequest(request.id, "approve"));
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "button danger";
  reject.textContent = "거절";
  reject.addEventListener("click", () => decideRequest(request.id, "reject"));
  actions.append(approve, reject);
  detail.appendChild(actions);
}

function renderRequests(requests) {
  requestList.replaceChildren();
  const pending = requests.filter(request => request.status === "pending");
  element("pending-count").textContent = String(pending.length);
  if (!pending.length) {
    addText(requestList, "p", "현재 승인 대기 중인 요청이 없습니다.", "list-empty");
    selectedRequestId = null;
    renderRequestDetail(null);
    return;
  }
  if (!pending.some(request => request.id === selectedRequestId)) {
    selectedRequestId = null;
  }
  for (const request of pending) {
    const card = document.createElement("article");
    card.className = `request-card${request.id === selectedRequestId ? " selected" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "request-select";
    select.setAttribute("aria-pressed", String(request.id === selectedRequestId));
    addText(select, "h3", `${request.action.toUpperCase()} · ${request.submittedBy}`);
    addText(select, "p", new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(request.createdAt)), "request-date");
    card.appendChild(select);
    select.addEventListener("click", () => {
      selectedRequestId = selectedRequestId === request.id ? null : request.id;
      renderRequests(requests);
    });
    requestList.appendChild(card);
  }
  renderRequestDetail(pending.find(request => request.id === selectedRequestId));
}

async function loadRequests() {
  const result = await api("/admin/requests");
  renderRequests(result.requests);
  element("refresh-status").textContent =
    `자동 새로고침 중 · 마지막 확인 ${new Intl.DateTimeFormat("ko-KR", { timeStyle: "short" }).format(new Date())}`;
}

async function loadUsers() {
  const result = await api("/admin/users");
  accountList.replaceChildren();
  for (const user of result.users) {
    const card = document.createElement("article");
    card.className = "account-card";
    const status = user.active ? "활성" : "비활성";
    addText(card, "strong", `${user.username} · ${status}`);
    if (user.active) {
      const disable = document.createElement("button");
      disable.type = "button";
      disable.className = "button danger";
      disable.textContent = "계정 비활성화";
      disable.addEventListener("click", () => setUserActive(user.id, false));
      card.appendChild(disable);
    } else {
      const activate = document.createElement("button");
      activate.type = "button";
      activate.className = "button secondary";
      activate.textContent = "계정 활성화";
      activate.addEventListener("click", () => setUserActive(user.id, true));
      card.appendChild(activate);
    }
    accountList.appendChild(card);
  }
}

async function decideRequest(id, decision) {
  const label = decision === "approve" ? "승인" : "거절";
  if (!window.confirm(`이 변경 요청을 ${label}할까요?`)) return;
  try {
    await api(`/admin/requests/${encodeURIComponent(id)}/${decision}`, {
      method: "POST",
      body: decision === "reject" ? JSON.stringify({ reason: "관리자가 거절했습니다." }) : undefined
    });
    clearError();
    await loadRequests();
  } catch (error) {
    showError(error.message);
    if (error.message.includes("이미 변경") || error.message.includes("현재 에피소드")) {
      await loadRequests();
    }
  }
}

async function setUserActive(id, active) {
  const action = active ? "활성화" : "비활성화";
  if (!window.confirm(`이 사용자 계정을 ${action}할까요?`)) return;
  try {
    await api(`/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ active })
    });
    await loadUsers();
    clearError();
  } catch (error) {
    showError(error.message);
  }
}

async function createUser(event) {
  event.preventDefault();
  const submit = element("account-form").querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: element("new-username").value.trim(),
        password: element("new-password").value
      })
    });
    element("account-form").reset();
    clearError();
    await loadUsers();
  } catch (error) {
    showError(error.message);
  } finally {
    submit.disabled = false;
  }
}

function logout() {
  clearAuthToken();
  clearInterval(refreshTimer);
  refreshTimer = null;
  content.hidden = true;
  loginPanel.hidden = false;
  logoutButton.hidden = true;
}

async function showAdmin() {
  const result = await api("/auth/me");
  if (result.user.role !== "admin") {
    throw new Error("관리자 계정만 승인 관리 화면을 이용할 수 있습니다.");
  }
  loginPanel.hidden = true;
  content.hidden = false;
  logoutButton.hidden = false;
  await Promise.all([loadRequests(), loadUsers()]);
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    loadRequests().catch(error => showError(`요청 목록을 새로고침하지 못했습니다. ${error.message}`));
  }, 15000);
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = loginForm.querySelector('button[type=submit]');
  submit.disabled = true;
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: element("admin-username").value.trim(),
        password: element("admin-password").value
      })
    });
    if (result.user.role !== "admin") {
      throw new Error("관리자 계정만 승인 관리 화면을 이용할 수 있습니다.");
    }
    setAuthToken(result.token);
    await showAdmin();
    clearError();
  } catch (error) {
    showError(error.message);
  } finally {
    submit.disabled = false;
  }
});

element("account-form").addEventListener("submit", createUser);
logoutButton.addEventListener("click", logout);

if (getAuthToken()) {
  showAdmin().catch(error => {
    clearAuthToken();
    showError(error.message);
  });
}
