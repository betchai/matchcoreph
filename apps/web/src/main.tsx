import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.js';

const path = window.location.pathname;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((reg) => reg.update()));
}

if (path === '/' || path === '/landing') {
  // The server serves the landing page for these paths. Reaching this file
  // here means a (stale) service worker intercepted the navigation and served
  // the SPA shell instead; send the browser to the real landing page over the
  // network.
  window.location.replace('/landing');
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}