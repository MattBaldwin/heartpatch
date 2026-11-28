const { chromium } = require('playwright');
(async()=>{
 const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const [,, q, out] = process.argv;
 const c = await b.newContext({viewport:{width:+(process.argv[4]||393),height:+(process.argv[5]||852)},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const p = await c.newPage();
 p.on('console',m=>{ if(m.type()==='error') console.log('ERR',m.text().slice(0,200))});
 await p.goto('http://127.0.0.1:5199/island.html?'+q);
 await p.waitForTimeout(12000);
 await p.screenshot({path:out});
 await b.close();
})();
