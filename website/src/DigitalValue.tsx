import './v3-digital.css';

const paths={
 a:'12,4 44,4 39,11 17,11',
 b:'47,8 51,12 51,42 44,47 44,15',
 c:'44,54 51,58 51,88 47,92 44,85',
 d:'17,89 39,89 44,96 12,96',
 e:'5,58 12,54 12,85 9,92 5,88',
 f:'5,12 9,8 12,15 12,47 5,42',
 g:'13,46 43,46 47,50 43,54 13,54 9,50'
} as const;
const active:Record<string,string>={
 '0':'abcdef','1':'bc','2':'abdeg','3':'abcdg','4':'bcfg',
 '5':'acdfg','6':'acdefg','7':'abc','8':'abcdefg','9':'abcdfg'
};

// The visible segments are a presentation of the supplied string. They never
// interpolate account balances or derive unconfirmed financial values.
export default function DigitalValue({value,unit,size='card',label}:{
 value:string;unit?:string;size?:'card'|'hero'|'clock';label?:string;
}){
 return <span className={'gv3-digital gv3-digital--'+size} role="img" aria-label={label??(value+(unit?' '+unit:''))}>
  <span className="gv3-digital-run" aria-hidden="true">{Array.from(value).map((character,index)=>
   active[character]!==undefined?
    <svg className="gv3-digital-digit" viewBox="0 0 56 100" key={index} focusable="false">
     {Object.entries(paths).map(([segment,points])=><polygon key={segment} points={points}
      className={active[character].includes(segment)?'lit':'unlit'}/>)}</svg>:
    <span className={'gv3-digital-mark '+(character===':'?'colon':'')} key={index}>{character}</span>
  )}</span>
  {unit&&<span className="gv3-digital-unit" aria-hidden="true">{unit}</span>}
 </span>;
}
