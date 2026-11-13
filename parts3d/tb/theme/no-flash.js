// Inline this in <head> before any stylesheet: applies the stored theme before first paint.
try{var t=localStorage.getItem('tb-theme');if(t==='light'||t==='dark'||t==='auto')document.documentElement.setAttribute('data-theme',t)}catch(e){/* storage blocked */}
