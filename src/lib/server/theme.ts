/** Validated runtime theme; changing APP_PRIMARY_COLOR never requires rebuilding. */
const DEFAULT = '#1D7F46';
const hex = /^#[0-9a-fA-F]{6}$/;
function rgb(s: string): number[] {
  return [1,3,5].map(i => Number.parseInt(s.slice(i,i+2),16));
}
function asHex(c: number[]): string {
  return '#' + c.map(x => Math.round(Math.min(255,Math.max(0,x))).toString(16).padStart(2,'0')).join('');
}
function mix(a: string,b: string,t: number): string {
  const x=rgb(a), y=rgb(b);
  return asHex(x.map((n,i)=>n*(1-t)+y[i]*t));
}
function luminance(h: string): number {
  const v=rgb(h).map(x=>{const n=x/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4});
  return v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;
}
function contrast(a:string,b:string):number {
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
function accessible(base:string,ground:string):string {
  const target=contrast('#ffffff',ground)>contrast('#000000',ground)?'#ffffff':'#000000';
  let c=base;
  for(let i=0;i<40 && contrast(c,ground)<4.5;i++) c=mix(c,target,0.12);
  return c;
}
export function readTheme(value: string|undefined=process.env.APP_PRIMARY_COLOR) {
  const raw=value?.trim() || DEFAULT;
  if(!hex.test(raw)) console.warn('[8star] Invalid APP_PRIMARY_COLOR; using '+DEFAULT);
  const primary=hex.test(raw)?raw.toUpperCase():DEFAULT;
  const light=accessible(primary,'#ffffff');
  const dark=accessible(primary,'#151a16');
  return {
    primary,
    light: {
      accent: light, strong: mix(light,'#000000',0.13), contrast: '#ffffff',
      soft: mix(light,'#ffffff',0.88)
    },
    dark: {
      accent: dark, strong: mix(dark,'#ffffff',0.14), contrast: '#151a16',
      soft: mix(dark,'#151a16',0.79)
    }
  };
}
