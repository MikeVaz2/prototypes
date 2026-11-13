// Inline this in <head> before any stylesheet: applies the stored size before first paint.
try{var s=localStorage.getItem('tb-space');if(/^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large)$/.test(s))document.documentElement.setAttribute('data-space',s)}catch(e){/* storage blocked */}
