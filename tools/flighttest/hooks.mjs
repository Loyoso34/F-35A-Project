// Uygulama tarayıcıda 'three'yi import map ile CDN'den alır. Node'da çıplak 'three'
// belirteci bu klasörün node_modules'üne (ya da THREE_PATH ile verilen kopyaya) yönlendirilir.
import { pathToFileURL } from 'node:url';
const base = process.env.THREE_PATH
  ? pathToFileURL(process.env.THREE_PATH.replace(/\/?$/, '/')).href
  : new URL('./node_modules/three/', import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: base + 'build/three.module.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: base + 'examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}
