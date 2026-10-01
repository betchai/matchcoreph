import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.js';
import { installDemoLogin } from './lib/demo.js';

installDemoLogin();

const path = window.location.pathname;
const LANDING_ONCE = 'landing-redirect-done';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((reg) => reg.update()));
}

// The server serves the landing page for these paths. Reaching this file
// here means a (stale) service worker intercepted the navigation and served
// the SPA shell instead of the landing page. Bounce at most once per session
// so a stale worker can never turn this into a redirect loop; the forced
// registration.update() above replaces the stale worker so the very next
// navigation is served by the server again.
if (path === '/' && !sessionStorage.getItem(LANDING_ONCE)) {
  sessionStorage.setItem(LANDING_ONCE, '1');
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