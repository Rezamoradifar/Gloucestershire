import {useEffect,useState} from 'react';
type Theme='dark'|'light';
const readTheme=():Theme=>{
 try {const stored=localStorage.getItem('global-theme');if(stored==='dark'||stored==='light')return stored;}catch{}
 return typeof window!=='undefined'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
};
export default function ThemeSwitch(){
 const [theme,setTheme]=useState<Theme>(readTheme);
 useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;const meta=document.querySelector('meta[name="theme-color"]');meta?.setAttribute('content',theme==='dark'?'#0b0d0e':'#edf5fb');try{localStorage.setItem('global-theme',theme);}catch{}},[theme]);
 return <button type="button" className="global-theme-toggle" aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} aria-pressed={theme==='dark'} onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}><span aria-hidden="true">{theme==='dark'?'☀':'☾'}</span>{theme==='dark'?'Light mode':'Dark mode'}</button>;
}
