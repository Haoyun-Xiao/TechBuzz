import { build } from 'vite';
import { fileURLToPath } from 'node:url';
await build({ configFile:false, define:{'process.env.NODE_ENV':'"production"'}, build:{
  outDir:process.argv[2], emptyOutDir:false,
  lib:{entry:fileURLToPath(new URL('./view.tsx',import.meta.url)),name:'TechBuzzOffline',formats:['iife'],fileName:()=>'viewer.js'}
}});
