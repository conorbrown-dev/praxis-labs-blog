// Local browser audit of the real built portfolio at desktop and mobile widths.
// Called in CI after astro build and static résumé PDF generation.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const PORT = '44322';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const routes = [
  '/', '/work', '/writing', '/about', '/resume', '/projects',
  '/posts/distributed-dotnet-agent-platform',
  '/posts/modernizing-workflow-rules-with-ddd',
  '/posts/azure-modernization-without-big-bang-rewrite',
  '/posts/product-line-transition-system-design',
  '/projects/mega-desk', '/projects/career-desk', '/projects/pathway', '/projects/theoria',
  '/projects/mollys-learning-arcade', '/projects/praxis-studio'
];
const architecturePages = [
  '/projects/pathway', '/projects/theoria',
  '/projects/mollys-learning-arcade', '/projects/praxis-studio',
  '/posts/modernizing-workflow-rules-with-ddd',
  '/posts/azure-modernization-without-big-bang-rewrite'
];

// Resolve Astro's actual executable from the installed package rather than guessing its path.
const astroPackage = JSON.parse(await readFile(resolve('node_modules/astro/package.json'), 'utf8'));
const astroExecutable = resolve('node_modules/astro', astroPackage.bin.astro);
const preview = spawn(process.execPath, [astroExecutable, 'preview', '--host', '127.0.0.1', '--port', PORT], { stdio:['ignore','pipe','pipe'] });
preview.stdout.on('data', x=>process.stdout.write(x));
preview.stderr.on('data', x=>process.stderr.write(x));
let browser;
try {
  let ready = false;
  for(let i=0;i<50;i++){
    if(preview.exitCode!==null)throw new Error('Astro preview terminated');
    try{const x=await fetch(ORIGIN+'/');if(x.ok){ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  if(!ready)throw new Error('Could not reach Astro preview');
  browser=await chromium.launch({headless:true});
  const configurations=[
    {name:'desktop',options:{viewport:{width:1440,height:900}}},
    {name:'mobile',options:{viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:2,hasTouch:true}}
  ];
  let total=0;
  for(const cfg of configurations){
    const ctx=await browser.newContext(cfg.options);
    for(const route of routes){
      const page=await ctx.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      const response=await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded',timeout:15000});
      if(!response?.ok())throw new Error(`${cfg.name} ${route}: HTTP ${response?.status()}`);
      if(await page.locator('h1').count()===0)throw new Error(`${cfg.name} ${route}: Missing h1`);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
      if(overflow>10)throw new Error(`${cfg.name} ${route}: Horizontal overflow by ${overflow}px`);
      if(architecturePages.includes(route)){
        const svg=page.locator('.mermaid svg');
        await svg.first().waitFor({state:'visible',timeout:12000});
      }
      if(route.startsWith('/projects/')){
        const figure=page.locator('.project-capture');
        const img=figure.locator('img');
        if(await img.count()){
          if(!await figure.isVisible())throw new Error(`${cfg.name} ${route}: Screenshot figure is hidden`);
          const src=await img.getAttribute('src');
          if(!src)throw new Error(`${cfg.name} ${route}: Screenshot has no source`);
          // Check the actual served asset with a bounded request; lazy images may not load
          // until scrolled into view, so never await image.decode() offscreen.
          const screenshot=await page.request.get(new URL(src,ORIGIN).href,{timeout:8000});
          if(!screenshot.ok())throw new Error(`${cfg.name} ${route}: Screenshot HTTP ${screenshot.status()}`);
          const bytes=await screenshot.body();
          if(bytes.length<1000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'){
            throw new Error(`${cfg.name} ${route}: Invalid PNG image asset`);
          }
          await img.scrollIntoViewIfNeeded({timeout:5000});
          await page.waitForFunction(selector=>{
            const element=document.querySelector(selector);
            return element instanceof HTMLImageElement && element.complete && element.naturalWidth>200;
          },`.project-capture img[src="${src}"]`,{timeout:8000});
        }
      }
      if(errors.length)throw new Error(`${cfg.name} ${route}: JavaScript error: ${errors.join('; ')}`);
      console.log(`PASS ${cfg.name} ${route}`);
      total++;
      await page.close();
    }
    const page=await ctx.newPage();
    await page.goto(ORIGIN+'/work', { waitUntil: 'domcontentloaded' });
    for(const slug of ['distributed-dotnet-agent-platform','modernizing-workflow-rules-with-ddd','azure-modernization-without-big-bang-rewrite','product-line-transition-system-design']){
      if(await page.locator(`a[href="/posts/${slug}"]`).count()===0)throw new Error(`Work page missing article link: ${slug}`);
    }
    await page.goto(ORIGIN+'/resume', { waitUntil: 'domcontentloaded' });
    if(await page.locator('a[href="/conor-brown-resume.pdf"]').count()===0)throw new Error('Resume page missing PDF download');
    const pdf=await page.request.get(ORIGIN+'/conor-brown-resume.pdf');
    if(!pdf.ok()||!(pdf.headers()['content-type']??'').includes('pdf'))throw new Error('PDF download failed');
    console.log(`PASS ${cfg.name} recruiter deep links and PDF`);
    await ctx.close();
  }
  console.log(`Audited ${total} routes with no page errors or horizontal overflow`);
} finally {
  if(browser)await browser.close();
  preview.kill('SIGTERM');
  preview.stdout.destroy();
  preview.stderr.destroy();
  preview.unref();
}
