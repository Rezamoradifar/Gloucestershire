export function v3PageRange(total:number,requestedPage:number,size:number){
 if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(requestedPage)||requestedPage<0||
  !Number.isSafeInteger(size)||size<1||size>50)throw Error('Invalid V3 page request.');
 const lastPage=total===0?0:Math.floor((total-1)/size);
 const page=Math.min(requestedPage,lastPage),start=page*size;
 return {page,start,length:Math.min(size,total-start),total};
}
