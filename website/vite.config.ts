import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const proxy={'/api':{target:'http://127.0.0.1:3115',changeOrigin:false}};
export default defineConfig({plugins:[react(),{name:'portfolio-primary-identity',transformIndexHtml(){
 const mode=process.env.VITE_V3_UNIFIED_PRIMARY,vault=process.env.VITE_V3_CONTRACT_ADDRESS;
 if(mode==='portfolio-testnet' && process.env.VITE_V3_LANDING_AT_ROOT==='true' && vault && /^0x[0-9a-f]{40}$/i.test(vault))
  return [{tag:'meta',attrs:{name:'global-portfolio-vault',content:vault},injectTo:'head' as const}];
 return [];
}}],base:'./',esbuild:{charset:'ascii'},server:{proxy},preview:{proxy}});
