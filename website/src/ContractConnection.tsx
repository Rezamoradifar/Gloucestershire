import {useEffect,useState,type ReactNode} from 'react';
import {loadRuntimeConfig} from './config';
export default function ContractConnection({children}:{children:ReactNode}){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let stopped=false;setError('');setReady(false);loadRuntimeConfig().then(()=>{if(!stopped)setReady(true);}).catch(e=>{if(!stopped)setError(e instanceof Error?e.message:'Contract connection failed.');});return()=>{stopped=true;};},[attempt]);
 if(ready)return children;
 return <main className="dashboard-loading"><h1>Connecting your account</h1>{error?<><p role="alert">{error}</p><button className="small-button" onClick={()=>setAttempt(n=>n+1)}>Retry connection</button></>:<p role="status">Checking the configured contract and network…</p>}<a href="#">Back to website</a></main>;
}
