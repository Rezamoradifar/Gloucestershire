#!/usr/bin/env node
// Local, deterministic, public-only API for Vite preview UI smoke. No secrets or transactions.
import http from 'node:http';
const vault='0x4C0F6141b18971db4b14e45c0bE8CddB09febc14';
const send=(res,status,payload)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(payload));};
http.createServer((req,res)=>{
 const pathname=new URL(req.url||'/', 'http://127.0.0.1:3115').pathname;
 if(req.method!=='GET'){send(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
 if(pathname==='/api/config'){send(res,200,{version:1,chainId:97,vaultAddress:vault});return;}
 if(pathname==='/api/automation/status'){send(res,200,{version:1,status:'unavailable',chainId:97,vaultAddress:vault,checkedAt:null,fresh:false,lastCredit:null});return;}
 if(pathname==='/api/community/announcements'){send(res,200,{items:[]});return;}
 if(pathname==='/api/marketplace'){send(res,200,{query:'',market:'US',providers:[],checkout:'merchant',ordersAvailable:false});return;}
 if(pathname==='/api/trades'){send(res,200,{status:'not_configured',trades:[],configured:false});return;}
 if(pathname==='/api/health'){send(res,200,{status:'ok',configured:true});return;}
 send(res,404,{error:'NOT_CONFIGURED_IN_UI_SMOKE'});
}).listen(3115,'127.0.0.1',()=>console.log('GLOBAL_LOCAL_UI_API_READY'));
