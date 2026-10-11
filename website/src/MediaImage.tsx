export default function MediaImage({name,alt,className='',square=false,sizes='(max-width: 700px) 92vw, 33vw'}:{name:string;alt:string;className?:string;square?:boolean;sizes?:string}) {
 return <img className={className} src={`/assets/${name}-640.webp`} srcSet={`/assets/${name}-640.webp 640w, /assets/${name}-1280.webp 1280w`} sizes={sizes} width={1280} height={square?1280:853} alt={alt} loading="lazy" decoding="async"/>;
}
