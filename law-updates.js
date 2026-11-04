// Metadata only. This view never invokes AI or reads personal storage.
(()=>{
const panel=document.getElementById('law-watch-panel'),body=document.getElementById('law-watch-body');if(!panel||!body)return;let loaded=false;
const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
function dateKST(value){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);const get=k=>parts.find(p=>p.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');}
panel.addEventListener('toggle',async()=>{
 if(!panel.open||loaded)return;loaded=true;
 try{
  const res=await fetch('/law-updates.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!res.ok)throw new Error();const d=await res.json();
  if(d.schemaVersion!==1||!Array.isArray(d.entries))throw new Error();
  body.replaceChildren();const stale=!d.lastSuccessAt||Date.now()-Date.parse(d.lastSuccessAt)>10*86400000;
  body.appendChild(text('p',d.status==='error'?'이번 공식 목록 확인에 실패했습니다. 이전 정보를 유지하고 있습니다.':stale?'마지막 확인이 오래됐습니다. 최신 원문을 직접 확인해주세요.':'공식 공포목록 확인 · '+new Date(d.lastSuccessAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})));
  body.appendChild(text('p','매주 월요일 오전 9:20 확인 예약 · AI 사용 없음. 실행은 지연될 수 있습니다.'));
  if(d.reviewQueue?.length)body.appendChild(text('p','안내문 영향 검토 대기 '+d.reviewQueue.length+'건 · 개정 감지와 앱 문구 반영은 별개입니다.'));
  const today=dateKST(new Date()),rows=[...d.entries].sort((a,b)=>b.published.localeCompare(a.published)||b.effective.localeCompare(a.effective)).slice(0,8);
  for(const row of rows){const div=document.createElement('div');div.style.cssText='padding:12px 0;border-bottom:1px solid #ddd';const link=text('a',row.name+' · '+row.number);const url=new URL(row.url);if(url.origin!=='https://www.law.go.kr'||url.pathname!=='/LSW/lsInfoP.do')continue;link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';div.append(link,text('p','공포 '+row.published+' · '+(row.effective>today?'시행 예정 ':'시행일 도래 ')+row.effective));body.appendChild(div);}
  body.appendChild(text('p',d.limitations));body.appendChild(text('p',d.scope));
 }catch(e){body.textContent='지금 법규 확인 정보를 불러올 수 없습니다. 변경이 없다는 뜻은 아닙니다. 국가법령정보센터에서 원문을 확인해주세요.';loaded=false;}
});
})();
