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
if __name__=='__main__':unittest.main()
