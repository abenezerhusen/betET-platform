/**
 * Extremely small, dependency-free toast helper for confirming actions
 * (e.g. "Saved", "Exported"). Mounts itself on-demand so no app-wide
 * provider is needed and the rest of the system is untouched.
 */

type ToastType = 'success' | 'error' | 'info';

function ensureContainer(): HTMLElement {
  let c = document.getElementById('__v0_toast_container');
  if (!c) {
    c = document.createElement('div');
    c.id = '__v0_toast_container';
    c.style.position = 'fixed';
    c.style.top = '16px';
    c.style.right = '16px';
    c.style.zIndex = '9999';
    c.style.display = 'flex';
    c.style.flexDirection = 'column';
    c.style.gap = '8px';
    c.style.pointerEvents = 'none';
    document.body.appendChild(c);
  }
  return c;
}

export function toast(message: string, type: ToastType = 'success', durationMs = 2800) {
  const container = ensureContainer();
  const el = document.createElement('div');
  el.textContent = message;
  el.style.pointerEvents = 'auto';
  el.style.padding = '10px 14px';
  el.style.borderRadius = '8px';
  el.style.fontSize = '13px';
  el.style.fontWeight = '500';
  el.style.color = '#fff';
  el.style.boxShadow = '0 8px 20px rgba(0,0,0,0.15)';
  el.style.transition = 'transform 200ms ease, opacity 200ms ease';
  el.style.transform = 'translateY(-6px)';
  el.style.opacity = '0';
  el.style.maxWidth = '320px';
  el.style.wordBreak = 'break-word';
  el.style.background =
    type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#2563eb';

  container.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = 'translateY(0)';
    el.style.opacity = '1';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => {
      el.remove();
    }, 220);
  }, durationMs);
}
