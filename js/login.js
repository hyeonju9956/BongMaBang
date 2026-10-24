import { api, clearAuthToken, getAuthToken, setAuthToken } from "./api-client.js";

const form = document.getElementById("login-form");
const errorMessage = document.getElementById("login-error");

function returnTo() {
  const requested = new URLSearchParams(location.search).get("next") || "index.html";
  const destination = new URL(requested, location.href);
  if (destination.origin !== location.origin || destination.pathname.endsWith("/login.html")) {
    return new URL("index.html", location.href).href;
  }
  return destination.href;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

const requestedError = new URLSearchParams(location.search).get("error");
if (requestedError) showError(requestedError);

async function validateExistingSession() {
  if (!getAuthToken()) return;
  try {
    await api("/auth/me");
    location.replace(returnTo());
  } catch (error) {
    if (error.status === 0) {
      showError("API 서버에 연결할 수 없습니다. 서버 상태를 확인해 주세요.");
      return;
    }
    clearAuthToken();
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  const fields = new FormData(form);
  submit.disabled = true;
  errorMessage.hidden = true;
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: String(fields.get("username")).trim(),
        password: String(fields.get("password"))
      })
    });
    setAuthToken(result.token);
    location.replace(returnTo());
  } catch (error) {
    showError(error.status === 0
      ? "API 서버에 연결할 수 없습니다. 서버 상태를 확인해 주세요."
      : error.message);
  } finally {
    submit.disabled = false;
  }
});

validateExistingSession();
