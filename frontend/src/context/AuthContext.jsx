import { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/me"); // session via httpOnly cookie
        setUser(data);
      } catch {
        setUser(null); // no/expired cookie — show login
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data.user); // token lives only in the httpOnly cookie
    return data.user;
  }, []);

  const pinLogin = useCallback(async (pin) => {
    const { data } = await api.post("/auth/pin-login", { pin });
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      // Non-blocking — server may be offline; we still clear local state below.
      console.warn("[auth/logout] server call failed:", err);
    }
    setUser(null);
  }, []);

  // Memoize context value so consumers don't re-render every parent tick.
  const value = useMemo(
    () => ({ user, loading, login, pinLogin, logout }),
    [user, loading, login, pinLogin, logout]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
