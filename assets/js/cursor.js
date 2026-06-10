/* Cursor-following image preview for project list (desktop only) */

(function () {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const preview = document.getElementById('cursor-preview');
  const img     = preview ? preview.querySelector('img') : null;
  if (!preview || !img) return;

  const mouse = { x: 0, y: 0 };
  const pos   = { x: 0, y: 0 };

  document.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });

  function lerp(a, b, t) { return a + (b - a) * t; }

  function tick() {
    pos.x = lerp(pos.x, mouse.x, 0.1);
    pos.y = lerp(pos.y, mouse.y, 0.1);
    const scale = preview.classList.contains('visible') ? 1 : 0.92;
    preview.style.transform = `translate(calc(${pos.x}px - 50%), calc(${pos.y}px - 50%)) scale(${scale})`;
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  document.querySelectorAll('.project-list-item[data-thumb]').forEach(item => {
    item.addEventListener('mouseenter', () => {
      if (window.innerWidth > 900) return;
      if (img.src !== item.dataset.thumb) img.src = item.dataset.thumb;
      preview.classList.add('visible');
    });

    item.addEventListener('mouseleave', () => {
      preview.classList.remove('visible');
    });
  });
})();
