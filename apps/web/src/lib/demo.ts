export const DEMO_ORG = 'eddad4c4-6229-47da-a244-68b1f894335b';

type DemoButton = HTMLElement & {
  textContent: string | null;
  style: CSSStyleDeclaration;
};

function demoLogin(btn?: DemoButton | null): void {
  const orig = btn ? btn.textContent : null;
  if (btn) {
    btn.textContent = 'Signing in…';
    btn.style.opacity = '0.65';
    btn.style.pointerEvents = 'none';
  }
  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usernameOrEmail: 'demo.admin', password: 'demo-admin' }),
    credentials: 'same-origin',
  })
    .then((r) => {
      if (!r.ok) throw new Error('login failed');
      window.location.href = `/orgs/${DEMO_ORG}`;
    })
    .catch(() => {
      if (btn) {
        btn.textContent = orig;
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      }
      window.location.href = '/login';
    });
}

export function installDemoLogin(): void {
  (window as unknown as { demoLogin: typeof demoLogin }).demoLogin = demoLogin;
}