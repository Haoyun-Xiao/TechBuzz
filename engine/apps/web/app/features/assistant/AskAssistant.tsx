import { Link } from 'react-router';
export function AskAssistant({type,id}:{type:string;id:string}) {
  return <div style={{margin:'12px 0'}}><Link className="text-accent" to={`/assistant?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`}>问研究助手 ↗</Link></div>;
}
