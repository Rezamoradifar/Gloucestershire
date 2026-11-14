import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import {describe,expect,it} from 'vitest';

// Resolve the simple descendant selectors used by the metric and digital
// styles. This guards the actual legacy span conflict; it is not browser QA.
type Element={tag:string;classes:string[]};
const files=['v2-dashboard.css','v2-classic-shell.css','v2-classic-refinement.css',
 'v2-mobile-dock.css','v2-responsive-complete.css','v2-premium-experience.css',
 'v2-signature-dashboard.css','v3-dashboard.css','v1-v3-dashboard.css','v3-digital.css'];
const elements:Element[]=[
 {tag:'div',classes:['gv2','shell','gv2-classic','gv3-workspace']},
 {tag:'div',classes:['gv2-metric']},{tag:'strong',classes:[]},
 {tag:'span',classes:['gv3-digital','gv3-digital--card']},
 {tag:'span',classes:['gv3-digital-run']},{tag:'span',classes:['gv3-digital-mark']}
];
function matches(selector:string,target:number){
 if(/[:>#\[+~*]/.test(selector))return false;
 const tokens=selector.trim().split(/\s+/);
 let index=target;
 for(let i=tokens.length-1;i>=0;i--){
  const token=tokens[i],tag=token.match(/^[a-z][\w-]*/i)?.[0],classes=[...token.matchAll(/\.([\w-]+)/g)].map(m=>m[1]);
  const match=(element:Element)=>!(tag&&element.tag!==tag)&&classes.every(c=>element.classes.includes(c));
  if(i===tokens.length-1){if(!match(elements[index]))return false;index--;}
  else{while(index>=0&&!match(elements[index]))index--;if(index<0)return false;index--;}
 }
 return true;
}
function display(target:number,width:number){
 let winner:{score:number;order:number;value:string}|null=null,order=0;
 for(const file of files){
  const css=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  postcss.parse(css).walkRules(rule=>{
   for(let parent=rule.parent;parent;parent=parent.parent){
    if(parent.type!=='atrule'||parent.name!=='media')continue;
    const max=parent.params.match(/max-width\s*:\s*(\d+)px/),min=parent.params.match(/min-width\s*:\s*(\d+)px/);
    if((max&&width>Number(max[1]))||(min&&width<Number(min[1])))return;
   }
   for(const selector of rule.selectors){
    if(!matches(selector,target))continue;
    const classCount=(selector.match(/\.[\w-]+/g)||[]).length;
    const tagCount=selector.trim().split(/\s+/).filter(x=>/^[a-z]/i.test(x)).length;
    rule.walkDecls('display',decl=>{
     const candidate={score:(decl.important?10000:0)+classCount*100+tagCount,order:order++,value:decl.value};
     if(!winner||candidate.score>winner.score||(candidate.score===winner.score&&candidate.order>winner.order))winner=candidate;
    });
   }
  });
 }
 return (winner as {value:string}|null)?.value;
}
describe('digital metric layout cascade',()=>{
 for(const width of [390,1280])it(`keeps the instrument and digits horizontal at ${width}px`,()=>{
  expect(display(3,width)).toBe('flex');
  expect(display(4,width)).toBe('inline-flex');
  expect(display(5,width)).toBe('inline-block');
 });
});
