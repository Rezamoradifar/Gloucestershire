import {LogOut,Wallet} from 'lucide-react';

export default function V3WalletControl({address,busy,onConnect,onDisconnect}:{address:string;busy:boolean;onConnect:()=>void;onDisconnect:()=>void}){
 if(!address)return <button type="button" className="wallet-button" disabled={busy} onClick={onConnect}><Wallet size={17}/>{busy?'Connecting…':'Connect wallet'}</button>;
 return <div className="gv3-wallet-session">
  <span className="gv3-wallet-address" title={address} aria-label={'Connected wallet '+address}><span aria-hidden="true" className="gv3-wallet-dot"/>{address.slice(0,6)}…{address.slice(-4)}</span>
  <button type="button" className="gv3-wallet-disconnect" disabled={busy} onClick={onDisconnect} aria-label="Disconnect wallet"><LogOut size={16} aria-hidden="true"/><span>Disconnect</span></button>
 </div>;
}
