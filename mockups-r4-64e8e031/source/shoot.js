const { chromium } = require('playwright');
(async()=>{
 const jobs = JSON.parse(process.argv[2]); // [{f,out,w,h}]
 const b = await chromium.launch();
 for (const j of jobs){
  const c = await b.newContext({viewport:{width:j.w,height:j.h},deviceScaleFactor:j.dsf||3});
  const p = await c.newPage();
  p.on('pageerror',e=>console.log('PAGEERR',e.message)); p.on('console',m=>{if(m.type()==='error')console.log('ERR',m.text().slice(0,200))});
  await p.goto('file://'+__dirname+'/page.html?f='+j.f);
  await p.waitForTimeout(400);
  await p.screenshot({path:j.out}); await c.close();
 }
 await b.close();
})();
