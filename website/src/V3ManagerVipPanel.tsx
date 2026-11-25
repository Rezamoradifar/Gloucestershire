import {useEffect,useRef,useState} from 'react';
import type {Eip1193Provider} from 'ethers';
import type {V3SiteReleaseConfig} from './v3-site-config';
import {readManagerVip,type VipChange,type VipRecord} from './v3-manager-vip';
import {formatUtcTime} from './utc-time';

type Props={provider:Eip1193Provider;manager:string;config:V3SiteReleaseConfig;busy:boolean;readOnly:boolean;
  onChange:(change:VipChange,description:string)=>Promise<void>};

export default function V3ManagerVipPanel({provider,manager,config,busy,readOnly,onChange}:Props) {
  const [input,setInput]=useState(''),[record,setRecord]=useState<VipRecord|null>(null);
  const [checking,setChecking]=useState(false),[error,setError]=useState('');
  const request=useRef(0);
  useEffect(()=>()=>{request.current++;},[provider,manager,config.address]);

  async function lookup(target:string) {
    const id=++request.current;
    setChecking(true);setRecord(null);setError('');
    try{
      const next=await readManagerVip(provider,manager,target,config);
      if(request.current===id)setRecord(next);
    }catch(e){
      if(request.current===id)setError(e instanceof Error?e.message:'Member lookup unavailable.');
    }finally{if(request.current===id)setChecking(false);}
  }
  async function review(current:VipRecord) {
    const id=request.current;
    const next=!current.approved;
    await onChange({kind:'setVipKyc',member:current.member,previous:current.approved,approved:next},
      'Member wallet: '+current.member+'. Change VIP verification from '+(current.approved?'approved':'not approved')+
      ' to '+(next?'approved':'not approved')+' on this vault.');
    if(id===request.current)await lookup(current.member);
  }
  return <section className="gv2-panel" aria-labelledby="gv3-vip-title">
    <h3 id="gv3-vip-title">Member VIP verification</h3>
    <p>After reviewing the member’s identity, approve VIP access for balances above 50,000 test USDT.</p>
    <form className="gv3-input-row" onSubmit={e=>{e.preventDefault();void lookup(input);}}>
      <label htmlFor="gv3-vip-wallet">Member wallet address</label>
      <input id="gv3-vip-wallet" value={input} onChange={e=>{request.current++;setInput(e.target.value);setRecord(null);setError('');setChecking(false);}}
        disabled={busy} spellCheck={false} autoComplete="off" placeholder="0x…"/>
      <button type="submit" disabled={busy||checking||!input.trim()}>{checking?'Checking member…':'Look up member'}</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    {record&&<div aria-live="polite"><div className="gv2-detail"><span>Member wallet</span><b style={{overflowWrap:'anywhere'}}>{record.member}</b></div>
      <div className="gv2-detail"><span>VIP verification</span><b>{!record.registered?'Unregistered in this vault':record.approved?'Approved':'Not approved'}</b></div>
      <p>Confirmed at block {record.block.toLocaleString('en-US')} · {formatUtcTime(record.timestamp)}</p>
      {record.registered&&<button type="button" disabled={busy||readOnly||checking} onClick={()=>void review(record)}>
        {record.approved?'Review revocation':'Review VIP approval'}</button>}
    </div>}
  </section>;
}
