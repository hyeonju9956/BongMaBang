import { api, clearAuthToken, getAuthToken } from "./api-client.js";

function showLogin() {
  clearAuthToken();
  const next = `${location.pathname}${location.search}${location.hash}`;
  location.replace(`login.html?next=${encodeURIComponent(next)}`);
}

async function start() {
  if (!getAuthToken()) {
    showLogin();
    return;
  }

  try {
    await api("/auth/me");
    document.getElementById("logout").addEventListener("click", () => {
      clearAuthToken();
      location.replace("login.html");
    });
    document.documentElement.classList.remove("auth-pending");
    await import("./main.js");
  } catch (error) {
    if (error.status === 0) {
      location.replace(`login.html?error=${encodeURIComponent("API 서버에 연결할 수 없습니다. 잠시 후 다시 로그인해 주세요.")}`);
      return;
    }
    showLogin();
  }
}

start();
