(() => {
  const storageKey = 'morse-vband-theme';
  const stored = localStorage.getItem(storageKey);
  const initialTheme = stored === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = initialTheme;

  window.addEventListener('DOMContentLoaded', () => {
    const controls = document.querySelectorAll('.theme-toggle');
    const render = () => {
      const light = document.documentElement.dataset.theme === 'light';
      controls.forEach(control => {
        control.textContent = light ? 'Modo oscuro' : 'Modo claro';
        control.setAttribute('aria-pressed', String(light));
      });
    };
    controls.forEach(control => control.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem(storageKey, next);
      render();
    }));
    render();
  });
})();
