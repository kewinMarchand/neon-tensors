/**
 * particle-button.js — a tiny, dependency-free particle burst for buttons.
 *
 * Original implementation inspired by the visual idea of Codrops'
 * "Particle Effects for Buttons" (codrops/ParticleEffectsButtons), not a copy
 * of its code: no anime.js, no DOM disintegration, one canvas per element.
 *
 * Usage:
 *   <a class="button" data-particles href="#jeux">Découvrir</a>
 *   <script type="module" src="particle-button.js"></script>
 *
 * Options can be set per element with data-particles-color and
 * data-particles-count. Honours prefers-reduced-motion and keyboard input.
 */

const ATTACHED = new WeakSet();
const PAD = 40;
const DEFAULTS = { count: 28, color: null, duration: 700, hover: false };

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function accentFor(el) {
  const css = getComputedStyle(el);
  const explicit = el.dataset.particlesColor;
  if (explicit) return explicit;
  const token = css.getPropertyValue('--lime').trim()
    || css.getPropertyValue('--bui-accent').trim()
    || css.getPropertyValue('--accent').trim();
  return token || css.color || '#c8ff4d';
}

function makeCanvas(el) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    left: `-${PAD}px`,
    top: `-${PAD}px`,
    width: `calc(100% + ${PAD * 2}px)`,
    height: `calc(100% + ${PAD * 2}px)`,
    pointerEvents: 'none',
    zIndex: '3',
  });
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(canvas);
  return canvas;
}

function burst(el, canvas, state, options) {
  if (prefersReducedMotion() || state.running) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width + PAD * 2, h = rect.height + PAD * 2;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const color = accentFor(el);
  const count = Number(el.dataset.particlesCount) || options.count;
  const particles = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.8 + Math.random() * 4.8;
    const edge = Math.floor(Math.random() * 4);
    const x = edge === 0 ? 0 : edge === 1 ? rect.width : Math.random() * rect.width;
    const y = edge === 2 ? 0 : edge === 3 ? rect.height : Math.random() * rect.height;
    return {
      x: PAD + x,
      y: PAD + y,
      vx: Math.cos(angle) * speed + (x - rect.width / 2) / rect.width * 1.2,
      vy: Math.sin(angle) * speed + (y - rect.height / 2) / rect.height * 1.2 - 0.8,
      size: 2.2 + Math.random() * 5.2,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.25,
      shape: Math.random() < 0.35 ? 'circle' : 'rect',
    };
  });

  state.running = true;
  const start = performance.now();
  function frame(now) {
    const t = (now - start) / options.duration;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      p.vx *= 0.985;
      p.rot += p.spin;
      const alpha = Math.max(0, 1 - t);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const s = p.size * (1 - t * 0.3);
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-s / 2, -s / 2, s, s * 0.55);
      }
      ctx.restore();
    }
    ctx.restore();
    if (t < 1) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, w, h); state.running = false; }
  }
  requestAnimationFrame(frame);
}

/** Attach particle bursts to every [data-particles] element under `root`. */
export function attachParticleButtons(root = document, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const attached = [];
  root.querySelectorAll('[data-particles]').forEach((el) => {
    if (ATTACHED.has(el)) return;
    ATTACHED.add(el);
    const canvas = makeCanvas(el);
    const state = { running: false };
    const run = () => burst(el, canvas, state, opts);

    el.addEventListener('click', run);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') run();
    });
    if (opts.hover || el.dataset.particles === 'hover' || el.dataset.particles === '' || el.hasAttribute('data-particles')) {
      el.addEventListener('pointerenter', run);
    }
    attached.push(el);
  });
  return attached;
}

export function initParticleButtons() {
  return attachParticleButtons(document);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initParticleButtons, { once: true });
  else initParticleButtons();
}
