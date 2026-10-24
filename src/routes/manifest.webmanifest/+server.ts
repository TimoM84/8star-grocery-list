import { readTheme } from '$lib/server/theme';
export const GET = () => {
  const theme=readTheme();
  return new Response(JSON.stringify({
    id:'/',name:'8star Boodschappen',short_name:'Boodschappen',
    description:'Gedeelde boodschappenlijst voor het hele huishouden — ook offline.',
    lang:'nl',dir:'ltr',start_url:'/',scope:'/',display:'standalone',
    display_override:['standalone'],orientation:'any',
    background_color:'#f4f5f2',theme_color:theme.primary,
    categories:['food','shopping','lifestyle'],
    icons:[
      {src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
      {src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
      {src:'/icons/maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
      {src:'/icons/maskable-192.png',sizes:'192x192',type:'image/png',purpose:'maskable'}
    ],
    shortcuts:[
      {name:'Suggesties',short_name:'Suggesties',url:'/suggesties',icons:[{src:'/icons/icon-192.png',sizes:'192x192'}]},
      {name:'Historie',short_name:'Historie',url:'/historie',icons:[{src:'/icons/icon-192.png',sizes:'192x192'}]}
    ]
  }),{headers:{'Content-Type':'application/manifest+json; charset=utf-8','Cache-Control':'no-store'}});
};
