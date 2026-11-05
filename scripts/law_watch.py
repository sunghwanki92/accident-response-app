#!/usr/bin/env python3
"""Weekly official publication-metadata watch. No AI calls or credentials.
This is not article-level legal interpretation or an exhaustive law search.
"""
import argparse, datetime as dt, json, re, sys, urllib.parse, urllib.request
from html.parser import HTMLParser
from pathlib import Path
KST=dt.timezone(dt.timedelta(hours=9))
FAMILIES=('도로교통법','교통사고처리 특례법','자동차손해배상 보장법')
BASE='https://www.law.go.kr/LSW/'
class LawRows(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows=[]; self.cells=None; self.cell=None; self.href=None; self.link=None; self.in_body=False
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='tbody':self.in_body=True
        if tag=='tr' and self.in_body:self.cells=[]; self.link=None
        if tag=='td' and self.cells is not None:self.cell=[]
        if tag=='a' and self.cell is not None and 'lsInfoP.do?' in attrs.get('href',''):self.link=attrs['href']
    def handle_data(self,data):
        if self.cell is not None:self.cell.append(data)
    def handle_endtag(self,tag):
        if tag=='td' and self.cell is not None:self.cells.append(' '.join(''.join(self.cell).split()));self.cell=None
        if tag=='tr' and self.cells is not None:
            if self.link:self.rows.append((self.cells,self.link))
            self.cells=None
        if tag=='tbody':self.in_body=False

def date_value(text):
    m=re.fullmatch(r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.',text)
    if not m:raise ValueError('공포/시행일 형식 변경: '+text[:40])
    return dt.date(*map(int,m.groups())).isoformat()

def parse_page(html,family):
    if '공포일자' not in html or '시행일자' not in html:raise ValueError('공식 목록의 표제 확인 실패')
    parser=LawRows();parser.feed(html);result=[]
    for cells,href in parser.rows:
        if len(cells)!=8:raise ValueError('공식 목록 열 구조 변경')
        name=cells[1];normalized=re.sub(r'\s','',name);root=re.sub(r'\s','',family)
        if normalized not in {root,root+'시행령',root+'시행규칙'}:continue
        query=urllib.parse.parse_qs(urllib.parse.urlsplit(href).query);seq=query.get('lsiSeq',[''])[0]
        if not seq.isdigit():raise ValueError('원문 식별자 확인 실패')
        published,effective=date_value(cells[6]),date_value(cells[7])
        result.append({'id':seq+':'+effective,'name':name,'ministry':cells[2],'amendment':cells[3],'type':cells[4],'number':cells[5],'published':published,'effective':effective,'url':BASE+'lsInfoP.do?'+urllib.parse.urlencode({'lsiSeq':seq,'viewCls':'lsRvsDocInfoR'})})
    if not result:raise ValueError('대상 법령 목록이 비어 있음: '+family)
    return result

def fetch_entries():
    rows={}
    for family in FAMILIES:
        for page in (1,2):
            url=BASE+'nwRvsLsPop.do?'+urllib.parse.urlencode({'lsNm':family,'searchType':'lsNm','sortIdx':0,'pg':page})
            req=urllib.request.Request(url,headers={'User-Agent':'TomKi-Law-Metadata-Watch/1.0 (weekly, public metadata)'})
            with urllib.request.urlopen(req,timeout=20) as r:
                if r.status!=200:raise ValueError('공식 목록 HTTP 오류')
                text=r.read(2_000_000).decode('utf8')
            marker=re.search(r'건\s*\((\d+)/(\d+)\)',text)
            if not marker or int(marker[1])!=page:raise ValueError('공식 목록 페이지 확인 실패')
            for entry in parse_page(text,family):rows[entry['id']]=entry
            if int(marker[2])<=page:break
    return sorted(rows.values(),key=lambda r:(r['published'],r['effective'],r['id']),reverse=True)

def update(previous,entries,now):
    today=now.astimezone(KST).date().isoformat();prev={r['id']:r for r in previous.get('entries',[])}
    old_day=previous.get('lastSuccessAt','')[:10]
    # If a family has >30 new publications since the last check, do not claim complete coverage.
    for root in FAMILIES:
        norm=lambda s:re.sub(r'\s','',s)
        old=[r for r in prev.values() if norm(r['name']).startswith(norm(root))]
        new=[r for r in entries if norm(r['name']).startswith(norm(root))]
        if old and not any(r['id'] in prev for r in new):raise ValueError('확인 범위를 넘는 변경: 수동 목록 확대 필요')
    changes=[]
    if prev:
        for row in entries:
            old=prev.get(row['id'])
            reason='새 공포 항목' if not old else '공식 목록 정보 변경' if old!=row else '시행일 도래' if old_day and old_day<row['effective']<=today else None
            if reason:changes.append({**row,'detectedAt':now.isoformat(),'reason':reason})
    queue={r['id']:r for r in previous.get('reviewQueue',[])}
    for row in changes:queue[row['id']]=row
    merged={**prev,**{r['id']:r for r in entries}}
    return {'schemaVersion':1,'status':'ok','lastAttemptAt':now.isoformat(),'lastSuccessAt':now.isoformat(),'schedule':'매주 금요일 오후 1:00 (한국시간) · 실행 지연 가능','mode':'metadata-only-no-ai','scope':'도로교통법·교통사고처리 특례법·자동차손해배상 보장법 및 시행령·시행규칙의 최근 공포목록 각 30행(최초 기준 이후 보존). 판례·보험약관·행정규칙은 포함하지 않음.','limitations':'한 개정 법령에 시행일이 여러 개일 수 있습니다. 일부 조항의 시행일이며 법 전체가 이 날짜에 모두 바뀐다는 뜻은 아닙니다. 개정 감지와 앱 안내문 반영은 별개입니다.','initialized':not bool(prev),'newChangeCount':len(changes),'entries':sorted(merged.values(),key=lambda r:(r['published'],r['effective'],r['id']),reverse=True),'reviewQueue':sorted(queue.values(),key=lambda r:r['detectedAt'],reverse=True),'source':'https://www.law.go.kr/LSW/nwRvsLsPop.do'}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'law-updates.json');args=parser.parse_args()
    previous=json.loads(args.output.read_text()) if args.output.exists() else {}
    now=dt.datetime.now(KST)
    try:result=update(previous,fetch_entries(),now);code=0
    except Exception as e:result={**previous,'schemaVersion':1,'status':'error','lastAttemptAt':now.isoformat(),'error':'공식 목록 확인 실패. 기존 정보를 유지하며 변경 없음을 뜻하지 않습니다.','diagnostic':str(e)[:160]};code=1
    tmp=args.output.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');tmp.replace(args.output)
    print(json.dumps({'status':result['status'],'entryCount':len(result.get('entries',[])),'changes':result.get('newChangeCount',0),'lastSuccessAt':result.get('lastSuccessAt')},ensure_ascii=False));return code
if __name__=='__main__':sys.exit(main())
