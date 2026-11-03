'use strict';
// V2 shadows unqualified storage accesses in this page, leaving V1 untouched.
(function () {
 const p='tingxie-v2:';
 function wrap(native) {
  return {
   getItem: k => native.getItem(p+String(k)),
   setItem: (k,v) => native.setItem(p+String(k),String(v)),
   removeItem: k => native.removeItem(p+String(k)),
   clear: () => { const keys=[];for(let i=0;i<native.length;i++){const k=native.key(i);if(k&&k.startsWith(p))keys.push(k);}keys.forEach(k=>native.removeItem(k)); },
   key: i => {const keys=[];for(let j=0;j<native.length;j++){const k=native.key(j);if(k&&k.startsWith(p))keys.push(k.slice(p.length));}return keys[i]||null;},
   get length(){let n=0;for(let i=0;i<native.length;i++)if((native.key(i)||'').startsWith(p))n++;return n;}
  };
 }
 window.tx2LocalStorage=wrap(window.localStorage);
 window.tx2SessionStorage=wrap(window.sessionStorage);
})();
const localStorage=window.tx2LocalStorage;
const sessionStorage=window.tx2SessionStorage;
