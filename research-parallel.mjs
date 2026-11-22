// Preserve source order while independent requests run concurrently. Finished work
// remains cached by each caller even when another request fails.
export async function parallelMap(items, concurrency, work) {
  const results=new Array(items.length), errors=[];
  let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(next<items.length){
      const index=next++;
      try{results[index]=await work(items[index],index)}catch(error){errors.push(error)}
    }
  }));
  if(errors.length)throw errors[0];
  return results;
}
export function researchConcurrency() {
  return Math.max(1,Math.min(16,Number.parseInt(process.env.TECHBUZZ_RESEARCH_CONCURRENCY||'12',10)||12));
}
