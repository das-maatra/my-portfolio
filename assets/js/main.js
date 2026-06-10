/* Pause off-screen videos to save resources */
(function () {
  const videos = document.querySelectorAll('video');
  if (!videos.length) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const v = entry.target;
      if (entry.isIntersecting) {
        if (v.paused && v.hasAttribute('autoplay')) v.play().catch(() => {});
      } else {
        if (!v.paused) v.pause();
      }
    });
  }, { threshold: 0.15 });

  videos.forEach(v => observer.observe(v));
})();

/* Tile entrance animations */
(function () {
  const tiles = document.querySelectorAll('.project-list-item');
  if (!tiles.length) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  tiles.forEach(tile => observer.observe(tile));
})();

/* Subtle header background after scrolling past the fold */
(function () {
  const header = document.querySelector('.site-header');
  if (!header) return;

  window.addEventListener('scroll', () => {
    header.style.setProperty(
      '--header-bg',
      window.scrollY > 40 ? 'rgba(8,8,8,0.95)' : 'transparent'
    );
  }, { passive: true });
})();
