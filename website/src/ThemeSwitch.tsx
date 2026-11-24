import {createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode} from 'react';
import {Moon, Sun} from 'lucide-react';

type Theme = 'dark' | 'light';
const ThemeContext = createContext<{theme: Theme; toggle: () => void} | null>(null);

function savedTheme(): Theme {
  try { return localStorage.getItem('global-theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const toggle = useCallback(() => setTheme(current => current === 'dark' ? 'light' : 'dark'), []);
  useEffect(() => {
    window.addEventListener('global-theme-toggle', toggle);
    return () => window.removeEventListener('global-theme-toggle', toggle);
  }, [toggle]);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b1720' : '#eaf3f5');
    try { localStorage.setItem('global-theme', theme); } catch { /* Storage can be disabled. */ }
  }, [theme]);
  return <ThemeContext.Provider value={{theme, toggle}}>{children}</ThemeContext.Provider>;
}

export default function ThemeSwitch({inline = false}: {inline?: boolean}) {
  const preference = useContext(ThemeContext);
  if (!preference) return null;
  const {theme, toggle} = preference;
  const nextMode = theme === 'dark' ? (inline ? 'Day' : 'Light') : (inline ? 'Night' : 'Dark');
  const label = 'Switch to ' + nextMode.toLowerCase() + ' mode';
  return <button type="button" className={inline ? 'gv3-theme-switch' : 'global-theme-toggle'}
    onClick={toggle} aria-label={label} aria-pressed={inline ? undefined : theme==='dark'} title={label}>
    {theme === 'dark' ? <Sun size={18} aria-hidden="true"/> : <Moon size={18} aria-hidden="true"/>}
    <span>{nextMode} mode</span>
  </button>;
}
