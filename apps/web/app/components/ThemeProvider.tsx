"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

type Theme = "light" | "dark";
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
  theme: "light",
  setTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  const hasLoadedPreference = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("lumix-theme");
    const next = saved === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    hasLoadedPreference.current = true;
  }, []);

  useEffect(() => {
    if (!hasLoadedPreference.current) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("lumix-theme", theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
