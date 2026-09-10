import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Auth travels via the httpOnly access_token cookie set by /auth/login —
// no token is ever readable from JS (XSS-safe). withCredentials sends it.

export const fmtHKD = (v) =>
  new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: "HKD",
    minimumFractionDigits: 0,
  }).format(v || 0);
