import datetime as dt, importlib.util, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('watch',Path(__file__).resolve().parents[1]/'scripts/law_watch.py');watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch)
class LawWatchTests(unittest.TestCase):
 def fixture(self):
  return '<table><thead>공포일자 시행일자</thead><tbody>'+''.join('<tr><td>1</td><td><a href="lsInfoP.do?lsiSeq=123">도로교통법</a></td><td>경찰청</td><td>일부개정</td><td>법률</td><td>제1호</td><td>2026. 10. 13.</td><td>'+date+'</td></tr>' for date in ['2026. 10. 13.','2027. 4. 14.'])+'</tbody></table>'
 def test_same_amendment_multiple_effective_dates_remain_distinct(self):
  rows=watch.parse_page(self.fixture(),'도로교통법');self.assertEqual(len(rows),2);self.assertNotEqual(rows[0]['id'],rows[1]['id'])
 def test_bad_source_is_failure_not_no_change(self):
  for source in ['<html>maintenance</html>',self.fixture().replace('2027. 4. 14.','TBD')]:
   with self.assertRaises(ValueError):watch.parse_page(source,'도로교통법')
 def test_baseline_and_unchanged_need_no_ai_or_review(self):
  rows=watch.parse_page(self.fixture(),'도로교통법');now=dt.datetime(2026,11,5,tzinfo=watch.KST);baseline=watch.update({},rows,now);self.assertTrue(baseline['initialized']);self.assertEqual(baseline['reviewQueue'],[]);same=watch.update(baseline,rows,now+dt.timedelta(days=7));self.assertEqual(same['newChangeCount'],0)
 def test_effective_transition_queued_not_auto_applied(self):
  rows=watch.parse_page(self.fixture(),'도로교통법');before=watch.update({},rows,dt.datetime(2027,4,13,tzinfo=watch.KST));after=watch.update(before,rows,dt.datetime(2027,4,14,tzinfo=watch.KST));self.assertEqual(after['newChangeCount'],1);self.assertEqual(after['reviewQueue'][0]['reason'],'시행일 도래')
 def test_window_gap_fails_closed_and_prior_entries_are_preserved(self):
  rows=watch.parse_page(self.fixture(),'도로교통법');before=watch.update({},rows,dt.datetime(2026,11,5,tzinfo=watch.KST));new=[{**r,'id':'99:'+r['effective']}for r in rows]
  with self.assertRaises(ValueError):watch.update(before,new,dt.datetime(2026,11,12,tzinfo=watch.KST))

parse_publication_page=watch.parse_publication_page
FAMILY='도로교통법'
HEAD='번호 법령명 공포일자 법령종류 공포번호 시행일자 제정·개정구분 소관부처'.split()

def sample():
    attrs={'frm_menuId':'1','frm_subMenuId':'23','frm_tabMenuId':'123','frm_query':FAMILY,'frm_pg':'1','frm_selSort':'20desc','frm_outmax':'15'}
    inputs=''.join(f'<input id="{k}" value="{v}">' for k,v in attrs.items())
    table='<table><caption>공포법령 검색결과 목록</caption><thead><tr>'+''.join(f'<th>{h}</th>' for h in HEAD)+'</tr></thead><tbody>'
    for i,(date,effective) in enumerate([('2026. 10. 13.','20261013'),('2027. 4. 14.','20270414')],1):
        table+=f"""<tr><td>{i}</td><td><a href="javascript:void(0);" onclick="lawInfoPop('291133','20261013','22067', '{effective}', 'N'); return false;"><strong>도로</strong><strong>교통법</strong></a></td><td>2026. 10. 13.</td><td><p>법률</p></td><td>제22067호</td><td>{date}</td><td>일부개정</td><td><p>경찰청</p><p>법무부</p></td></tr>"""
    return inputs+'<p id="totCnt">총 <span>2</span>건</p>'+table+'</tbody></table><input id="pageIndex" value="1" onkeydown="1 > 0"><span>/1</span>'

class PublicationTest(unittest.TestCase):
    def test_multiple_effective_dates_and_ministry_format(self):
        rows,pages,total=parse_publication_page(sample(),FAMILY,1)
        self.assertEqual((pages,total),(1,2))
        self.assertEqual([r['id'] for r in rows],['291133:2026-10-13','291133:2027-04-14'])
        self.assertEqual(rows[0]['ministry'],'경찰청,법무부')
    def test_reject_wrong_search_page_and_tab(self):
        for html,family,page in [(sample(),'다른 법',1),(sample(),FAMILY,2),(sample().replace('value="123"','value="121"'),FAMILY,1)]:
            with self.subTest(family=family,page=page),self.assertRaises(ValueError):
                parse_publication_page(html,family,page)
    def test_reject_incomplete_rows_and_inconsistent_link(self):
        for html in [sample().replace('<span>2</span>','<span>3</span>'),sample().replace("'20270414'","'20270415'"),sample().replace('공포일자','다른 항목')]:
            with self.assertRaises(ValueError):
                parse_publication_page(html,FAMILY,1)
    def test_nonfamily_rows_never_count_as_target(self):
        self.assertRaises(ValueError,parse_publication_page,sample().replace('<strong>교통법</strong>','<strong>교통법에 관한 별도 법</strong>'),FAMILY,1)


if __name__=='__main__':unittest.main()
