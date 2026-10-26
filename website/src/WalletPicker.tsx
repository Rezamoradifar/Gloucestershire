import {useEffect,useRef} from 'react';
import {Wallet,QrCode,X,LogOut} from 'lucide-react';
import {chainName} from './config';
import {walletConnectReady,type WalletKind} from './wallet';
import './wallet.css';

export default function WalletPicker({open,address,busy,onClose,onConnect,onDisconnect}:{open:boolean;address:string;busy:boolean;onClose:()=>void;onConnect:(kind:WalletKind)=>void;onDisconnect:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();if(!open&&dialog.current?.open)dialog.current?.close();},[open]);
 return <dialog ref={dialog} className="confirm-dialog wallet-picker" aria-labelledby="wallet-picker-title" onCancel={onClose} onClose={onClose}>
  <div className="panel-title"><h2 id="wallet-picker-title">{address?'Your wallet':'Connect your wallet'}</h2><button className="icon-button" aria-label="Close wallet selector" onClick={onClose}><X/></button></div>
  <p className="muted">{chainName} · Choose how to connect</p>
  {address&&<p className="connected-wallet"><code>{address}</code></p>}
  <div className="wallet-options">
   <button disabled={busy} onClick={()=>onConnect('injected')}><Wallet/><span><strong>Browser wallet</strong><small>SafePal, MetaMask, Trust Wallet or another installed wallet</small></span></button>
   <button disabled={busy||!walletConnectReady} onClick={()=>onConnect('walletconnect')}><QrCode/><span><strong>WalletConnect</strong><small>{walletConnectReady?'Scan a QR code or connect a mobile wallet':'Mobile & QR connections are not available yet'}</small></span></button>
  </div>
  <p className="muted wallet-connection-note">Connecting shares your public account address. Payments require a separate confirmation in your wallet.</p>
  <details className="wallet-mobile-guide"><summary>Connecting from a phone?</summary><p><strong>On this phone:</strong> choose WalletConnect, open the wallet list, then select your wallet app. Approve the connection there and return to Global.</p><p><strong>On another device:</strong> scan the QR code from your wallet’s WalletConnect scanner. Browser wallet works when an extension or your wallet’s built-in browser is available.</p><p>Use {chainName}. If a request expires, reopen Connect wallet for a fresh code. Never enter a recovery phrase or private key on this site.</p></details>
  {address&&<button className="small-button" disabled={busy} onClick={onDisconnect}><LogOut size={16}/> Disconnect</button>}
 </dialog>;
}
