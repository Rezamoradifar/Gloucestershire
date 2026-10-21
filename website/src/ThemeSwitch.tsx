import {useEffect,useState} from 'react';
type Theme='dark'|'light';
export default function ThemeSwitch(){
 const [theme,setTheme]=useState<Theme>(()=>{try{return localStorage.getItem('global-theme')==='dark'?'dark':'light';}catch{return 'light';}});
 useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('global-theme',theme);}catch{}},[theme]);
 return <button type="button" className="global-theme-toggle" aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>{theme==='dark'?'☀ Light':'☾ Dark'}</button>;
}
