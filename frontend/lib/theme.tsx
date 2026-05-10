'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'chocolate' | 'white';

const STORAGE = 'stella-theme';

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeCtx = createContext<Ctx>({
  theme: 'chocolate',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('chocolate');

  // 마운트 시 localStorage에서 복원. SSR/하이드레이션 안전.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved === 'white' || saved === 'chocolate') {
        setThemeState(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  // theme 변경 시 <html> data-theme 속성 갱신.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE, t);
    } catch {
      // quota etc.
    }
  }

  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}
