import axios from "axios";
import { TOKEN_KEY } from "./client";

// The browser talks to the AI service directly, using the same JWT the backend issued.
export const AI_BASE_URL = import.meta.env.VITE_AI_BASE_URL || "http://localhost:8000";

const aiApi = axios.create({ baseURL: AI_BASE_URL });

aiApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

aiApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new Event("eduai:logout"));
    }
    return Promise.reject(err);
  }
);

/** FastAPI errors arrive as {detail: "..."} or, for validation, {detail: [{msg}, ...]}. */
export function aiErrorMessage(err, fallback = "Something went wrong") {
  const detail = err.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join(" · ");
  if (err.code === "ERR_NETWORK") return "Cannot reach the AI service. Is it running?";
  return fallback;
}

export default aiApi;
