import {Component,type ReactNode} from 'react';
export function reloadLatest(){const url=new URL(location.href);url.searchParams.set('reload',String(Date.now()));location.replace(url.href);}
export default class LoadingBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<section className="loading-recovery" role="alert"><span>GLOBAL DROP TRADE</span><h1>This view could not load.</h1><p>Your wallet has not been asked to sign anything. Reload the latest site version to try again.</p><button onClick={reloadLatest}>Reload latest version</button><a href="/">Back to website</a></section>:this.props.children;}
}
