const themeScript = `
  (() => {
    const storageKey = 'job-seeker-agent-theme';
    const legacyStorageKey = 'resume-os-theme';
    let stored = null;
    try {
      stored = localStorage.getItem(storageKey) || localStorage.getItem(legacyStorageKey);
      if (stored && !localStorage.getItem(storageKey)) localStorage.setItem(storageKey, stored);
    } catch {
      stored = null;
    }
    const theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
    document.documentElement.dataset.themeMode = theme;
  })();
`

export function ThemeScript() {
  return <script id="job-seeker-agent-theme" dangerouslySetInnerHTML={{ __html: themeScript }} />
}
