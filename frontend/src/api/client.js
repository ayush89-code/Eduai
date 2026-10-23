import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
export const TOKEN_KEY = "eduai.token";

const api = axios.create({ baseURL: API_BASE_URL });

// Attach the JWT to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// An expired/invalid token on a protected call logs the user out everywhere.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || "";
    if (err.response?.status === 401 && !url.startsWith("/api/auth/login") && !url.startsWith("/api/auth/register")) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new Event("eduai:logout"));
    }
    return Promise.reject(err);
  }
);

/** Pull a human-readable message out of the backend's error JSON. */
export function errorMessage(err, fallback = "Something went wrong") {
  const data = err.response?.data;
  if (data?.fieldErrors) {
    return Object.entries(data.fieldErrors).map(([f, m]) => `${f}: ${m}`).join(" · ");
  }
  if (data?.message) return data.message;
  if (err.code === "ERR_NETWORK") return "Cannot reach the server. Is the backend running?";
  return fallback;
}

export default api;
