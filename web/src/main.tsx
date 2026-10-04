import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { initTheme } from './store/theme';
import { initUiStyle } from './store/uiStyle';

initTheme();
initUiStyle();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
