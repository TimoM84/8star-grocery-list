/** Server-authoritative runtime theme. Local storage only caches the last server value for offline display. */
type Palette = { accent:string; strong:string; contrast:string; soft:string };
type Theme = { primary:string; light:Palette; dark:Palette };
const CACHE='8star.runtimeTheme';
function apply(theme:Theme) {
  if (!/^#[A-Fa-f0-9]{6}$/.test(theme.primary)) return;
  const root=document.documentElement;
  for(const mode of ['light','dark'] as const) {
    const pal=theme[mode];
    for(const [key,value] of Object.entries(pal)) {
      if(!/^#[A-Fa-f0-9]{6}$/.test(value)) return;
      root.style.setProperty('--runtime-'+mode+'-'+key,value);
    }
  }
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta=>meta.setAttribute('content',theme.primary));
}
export async function initializeTheme() {
  try { const raw=localStorage.getItem(CACHE); if(raw) apply(JSON.parse(raw) as Theme); } catch { /* unavailable */ }
  try {
    const response=await fetch('/api/theme',{cache:'no-store'});
    if(!response.ok) return;
    const theme=await response.json() as Theme;
    apply(theme);
    try {localStorage.setItem(CACHE,JSON.stringify(theme))}catch { /* unavailable */ }
  } catch { /* offline: use cached theme */ }
}
