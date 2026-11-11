#!/usr/bin/env node
// Live read-only UI smoke test. Never connects a wallet, signs, or sends a transaction.
import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.GLOBAL_PLAYWRIGHT_MODULE;
if(!modulePath)throw Error('GLOBAL_PLAYWRIGHT_MODULE_REQUIRED');
const {chromium}=await import(pathToFileURL(modulePath).href);
const base=(process.env.GLOBAL_SMOKE_BASE||'https://globaldroptrade.com').replace(/\/$/,'');
const localPreview=base.startsWith('http://127.0.0.1:');
const out=path.resolve('smoke-artifacts');
fs.mkdirSync(out,{recursive:true});
const errors=[],checks=[];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function capture(page,name){
 await page.screenshot({path:path.join(out,name+'.png'),fullPage:false,animations:'disabled'});
 checks.push(name);
}
async function visit(page,label){
 await page.getByRole('button',{name:label,exact:true}).click();
 await page.waitForTimeout(400);
 console.log('GLOBAL_UI_NAV_OK '+label);
}
function attach(page){
 page.on('pageerror',error=>errors.push('JS '+error.message));
 page.on('response',response=>{
  if(response.url().startsWith(base)&&response.status()>=500)errors.push('HTTP '+response.status()+' '+response.url());
 });
 page.on('requestfailed',request=>{
  if(request.url().startsWith(base)&&/\.(?:js|css|png|webp)(?:\?|$)/.test(request.url()))
   errors.push('ASSET '+request.url()+' '+request.failure()?.errorText);
 });
}
try{
 const desktop=await browser.newPage({viewport:{width:1440,height:900}});
 attach(desktop);
 await desktop.goto(base+'/',{waitUntil:'domcontentloaded',timeout:30000});
 await desktop.locator('.gdt-page').waitFor({timeout:20000});
 if(localPreview&&process.env.GLOBAL_EXPECT_LANDING_V3==='1'){
  const hero=desktop.locator('[data-landing-release="global-immersive-v3"]');
  await hero.waitFor({timeout:10000});
  const headline=await desktop.locator('#hero-title').innerText();
  if(!headline.includes('possibility.'))throw Error('GLOBAL_LANDING_V3_NEW_HEADLINE_MISSING');
  const cards=await desktop.locator('.v3-capability-card').count();
  if(cards!==3)throw Error('GLOBAL_LANDING_V3_THREE_CARDS_REQUIRED found='+cards);
  await desktop.locator('.v3-world-figure img').evaluate(image=>{
   if(!(image instanceof HTMLImageElement)||!image.complete||image.naturalWidth===0)
    throw Error('GLOBAL_LANDING_V3_EARTH_IMAGE_MISSING');
  });
  const floating=await desktop.locator('.global-theme-toggle').evaluate(el=>getComputedStyle(el).display);
  if(floating!=='none')throw Error('GLOBAL_LANDING_V3_FLOATING_THEME_OBSCURES_HERO');
  await desktop.locator('.v3-header-theme').click();
  await desktop.waitForFunction(()=>document.documentElement.dataset.theme==='light',{timeout:4000});
  await desktop.locator('.v3-header-theme').click();
  await desktop.waitForFunction(()=>document.documentElement.dataset.theme==='dark',{timeout:4000});
  console.log('GLOBAL_LANDING_V3_THEME_SWITCH_OK');
  console.log('GLOBAL_LANDING_V3_VISUAL_ELEMENTS_OK');
  await desktop.locator('#capabilities').scrollIntoViewIfNeeded();
  await capture(desktop,'desktop-capabilities');
  await desktop.evaluate(()=>window.scrollTo(0,0));
  await desktop.waitForTimeout(120);
 }
 await capture(desktop,'desktop-landing');
 console.log('GLOBAL_UI_LANDING_OK');
 await desktop.goto(base+'/#dashboard',{waitUntil:'domcontentloaded',timeout:30000});
 await desktop.locator('.shell .page-title h1').waitFor({timeout:20000});
 await capture(desktop,'desktop-dashboard');
 console.log('GLOBAL_UI_DASHBOARD_OK');
 for(const page of ['My positions','Referral network','Profit & deposits','My profile','Announcements']){
  await visit(desktop,page);
  if(page==='Profit & deposits'){
   if(localPreview){
    await desktop.getByRole('heading',{name:'Complete history center'}).waitFor({timeout:10000});
    await desktop.getByRole('heading',{name:'Withdrawal request history'}).waitFor({timeout:10000});
    const coverage=await desktop.locator('.history-coverage').innerText();
    if(coverage.includes('Scanned back to genesis'))throw Error('GLOBAL_HISTORY_DISCONNECTED_FALSE_GENESIS_COVERAGE');
    if(await desktop.getByRole('button',{name:'Export loaded CSV'}).isEnabled())
     throw Error('GLOBAL_HISTORY_DISCONNECTED_EXPORT_MUST_BE_DISABLED');
   }
   await capture(desktop,'desktop-history');
   console.log('GLOBAL_HISTORY_COMPLETE_UI_OK');
  }
  if(page==='Referral network')await capture(desktop,'desktop-network');
 }
 await desktop.getByRole('button',{name:/^Notifications/}).click();
 await desktop.getByRole('dialog',{name:'Verified notifications'}).waitFor({timeout:8000});
 await capture(desktop,'desktop-notifications');
 console.log('GLOBAL_UI_NOTIFICATIONS_OK');
 await desktop.close();
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 attach(mobile);
 if(localPreview&&process.env.GLOBAL_EXPECT_LANDING_V3==='1'){
  await mobile.goto(base+'/',{waitUntil:'domcontentloaded',timeout:30000});
  await mobile.locator('[data-landing-release="global-immersive-v3"]').waitFor({timeout:15000});
  const floating=await mobile.locator('.global-theme-toggle').evaluate(el=>getComputedStyle(el).display);
  if(floating!=='none')throw Error('GLOBAL_LANDING_V3_MOBILE_FLOATING_THEME');
  await mobile.locator('.v3-header-theme').click();
  await mobile.waitForFunction(()=>document.documentElement.dataset.theme==='light',{timeout:4000});
  await mobile.locator('.v3-header-theme').click();
  await mobile.waitForFunction(()=>document.documentElement.dataset.theme==='dark',{timeout:4000});
  await capture(mobile,'mobile-landing');
  const dimensions=await mobile.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}));
  if(dimensions.scroll>dimensions.width+2)throw Error('GLOBAL_LANDING_V3_MOBILE_OVERFLOW '+JSON.stringify(dimensions));
  await mobile.locator('#capabilities').scrollIntoViewIfNeeded();
  await capture(mobile,'mobile-capabilities');
  console.log('GLOBAL_LANDING_V3_MOBILE_OK');
 }
 await mobile.goto(base+'/#dashboard',{waitUntil:'domcontentloaded',timeout:30000});
 await mobile.locator('.v2-mobile-bottom button').first().waitFor({timeout:20000});
 const count=await mobile.locator('.v2-mobile-bottom button').count();
 if(count!==5)throw Error('MOBILE_NAV_EXPECTED_5_FOUND_'+count);
 await mobile.locator('.v2-mobile-bottom button').filter({hasText:'History'}).click();
 if(localPreview)await mobile.getByRole('heading',{name:'Complete history center'}).waitFor({timeout:10000});
 await capture(mobile,'mobile-history');
 await mobile.locator('.v2-mobile-bottom button').filter({hasText:'Profile'}).click();
 await capture(mobile,'mobile-profile');
 if(localPreview){
  const appearance=await mobile.locator('.global-theme-toggle').evaluate(element=>getComputedStyle(element).display);
  if(appearance!=='none')throw Error('MOBILE_FLOATING_THEME_OBSCURES_CONTENT');
  await mobile.locator('.v2-profile-theme').click();
  await mobile.waitForFunction(()=>document.documentElement.dataset.theme==='light',{timeout:3000});
  console.log('GLOBAL_UI_MOBILE_THEME_CONTROL_OK');
 }
 await mobile.locator('.v2-mobile-bottom button').filter({hasText:'Home'}).click();
 await capture(mobile,'mobile-dashboard');
 console.log('GLOBAL_UI_MOBILE_OK');
 await mobile.close();
 if(errors.length)throw Error('GLOBAL_UI_JS_OR_ASSET_ERRORS '+JSON.stringify(errors.slice(0,15)));
 console.log('GLOBAL_UI_LIVE_BROWSER_PASS checks='+checks.join(','));
}catch(error){
 console.error('GLOBAL_UI_LIVE_BROWSER_FAIL '+String(error));
 if(errors.length)console.error('GLOBAL_UI_ERRORS '+JSON.stringify(errors.slice(0,15)));
 process.exitCode=1;
}finally{await browser.close();}
