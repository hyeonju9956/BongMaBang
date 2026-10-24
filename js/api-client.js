const apiBase = (window.BONGMABANG_API_BASE || "").replace(/\/+$/, "");
const tokenKey = "bongmabang-auth-token";

export class ApiError extends Error {
  constructor(message, status, fields = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

export function getAuthToken() {
  return sessionStorage.getItem(tokenKey) || "";
}

export function setAuthToken(token) {
  sessionStorage.setItem(tokenKey, token);
}

export function clearAuthToken() {
  sessionStorage.removeItem(tokenKey);
}

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response;
  try {
    response = await fetch(`${apiBase}/api${path}`, { ...options, headers });
  } catch {
    throw new ApiError("API 서버에 연결할 수 없습니다. 서버 주소와 실행 상태를 확인해 주세요.", 0);
  }

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new ApiError(
      result.error || `요청 실패 (HTTP ${response.status})`,
      response.status,
      result.fields || null
    );
  }
  return response;
}

export async function api(path, options = {}) {
  const response = await apiRequest(path, options);
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new ApiError("서버 응답을 읽을 수 없습니다.", response.status);
  }
}
