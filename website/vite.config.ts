import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const proxy={'/api':{target:'http://127.0.0.1:3115',changeOrigin:false}};
export default defineConfig({plugins:[react()],base:'./',esbuild:{charset:'ascii'},server:{proxy},preview:{proxy}});
