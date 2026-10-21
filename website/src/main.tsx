import React from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';
import './landing.css';
import './international.css';
import './theme.css';
import ThemeSwitch from './ThemeSwitch';
import Root from './Root';
createRoot(document.getElementById('root')!).render(<React.StrictMode><><Root/><ThemeSwitch/></></React.StrictMode>);
