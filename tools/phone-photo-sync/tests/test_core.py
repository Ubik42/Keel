import unittest
import tempfile
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from core import Archive, digest, safe_relative

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)/'library'
        (self.root/'.keel').mkdir(parents=True)
        (self.root/'.keel/library.db').touch()
        self.config={'device_folder':'phone','shared_roots':{}}
        self.archive=Archive(self.root,self.config)
        self.payload={}
        self.reads=0
    def tearDown(self):
        self.archive.close();self.tmp.cleanup()
    def entry(self,name,data,stamp='1'):
        self.payload[name]=data
        return {'path':name,'bytes':len(data),'stamp':stamp}
    def download(self,item,target):
        self.reads+=1;target.write_bytes(self.payload[item['path']])
        return {'sha256':digest(target),'bytes':target.stat().st_size}
    def importer(self,items,tag_refs):
        # Stand-in for Keel: file each staged item under its phone file name.
        self.tagged=tag_refs
        imported={}
        for item in items:
            target=self.root/'imported'/Path(item['file']).name
            if target.exists():target=target.with_name(item['hash'][:8]+target.name)
            target.parent.mkdir(exist_ok=True);Path(item['file']).replace(target)
            imported[item['hash']]={'path':str(target)}
        return {'imported':imported,'errors':{}}
    def run_sync(self,items):
        return self.archive.update(items,self.download,self.importer,report=lambda _:None)
    def test_new_and_no_change_reuses_baseline(self):
        item=self.entry('DCIM/a.jpg',b'photo')
        self.assertEqual(self.run_sync([item])['newContent'],1)
        self.assertEqual(self.run_sync([item])['unchanged'],1)
        self.assertEqual(self.reads,1)
    def test_records_stay_in_metadata(self):
        self.run_sync([self.entry('DCIM/a.jpg',b'photo')])
        self.assertTrue((self.root/'.keel/phone-sync/手机照片路径对应表.csv').is_file())
        self.assertFalse((self.root/'_管理').exists())
    def test_reused_library_content_is_tagged(self):
        self.run_sync([self.entry('DCIM/a.jpg',b'photo')])
        self.run_sync([self.entry('Pictures/copy.jpg',b'photo')])
        self.assertEqual(len(self.tagged),1)
    def test_rejected_import_keeps_source_unrecorded(self):
        item=self.entry('DCIM/a.jpg',b'photo')
        result=self.archive.update([item],self.download,lambda items,refs:{'imported':{},'errors':{}},report=lambda _:None)
        self.assertEqual(len(result['errors']),1)
        self.assertEqual(self.archive.db.execute('select count(*) from sources').fetchone()[0],0)
        self.assertFalse((self.root/'.keel/phone-sync/staging/import').exists())
    def test_duplicate_and_renamed_phone_file_keep_one_content(self):
        a=self.entry('DCIM/a.jpg',b'photo');b=self.entry('Pictures/b.jpg',b'photo')
        result=self.run_sync([a,b])
        self.assertEqual(result['newContent'],1);self.assertEqual(result['reusedContent'],1)
        self.assertEqual(len(list(self.root.rglob('*.jpg'))),1)
    def test_changed_same_size_preserves_old_version(self):
        item=self.entry('DCIM/a.jpg',b'old','1');self.run_sync([item])
        item=self.entry('DCIM/a.jpg',b'new','2');self.run_sync([item])
        self.assertEqual({p.read_bytes() for p in self.root.rglob('*.jpg')},{b'old',b'new'})
    def test_phone_removal_never_deletes_archive(self):
        self.run_sync([self.entry('DCIM/a.jpg',b'photo')]);self.run_sync([])
        self.assertEqual(len(list(self.root.rglob('*.jpg'))),1)
    def test_local_reorganization_does_not_copy_again(self):
        item=self.entry('DCIM/a.jpg',b'photo');self.run_sync([item])
        source=next(self.root.rglob('*.jpg'));target=self.root/'organized.jpg';source.rename(target)
        self.archive.refresh_local_index()
        self.assertEqual(self.run_sync([item])['unchanged'],1);self.assertEqual(self.reads,1)
    def test_missing_local_original_is_restored(self):
        item=self.entry('DCIM/a.jpg',b'photo');self.run_sync([item])
        next(self.root.rglob('*.jpg')).unlink()
        self.assertEqual(self.run_sync([item])['newContent'],1)
    def test_failure_does_not_advance_source_state(self):
        item=self.entry('DCIM/a.jpg',b'photo')
        def fail(item,target):raise OSError('disconnected')
        result=self.archive.update([item],fail,self.importer,report=lambda _:None)
        self.assertEqual(len(result['errors']),1)
        self.assertEqual(self.archive.db.execute('select count(*) from sources').fetchone()[0],0)
        self.assertEqual(self.run_sync([item])['newContent'],1)
    def test_path_traversal_is_rejected(self):
        with self.assertRaises(ValueError):safe_relative('../escape.jpg')
    def test_unknown_timestamp_is_rechecked(self):
        item=self.entry('DCIM/a.jpg',b'photo',None);self.run_sync([item]);self.run_sync([item])
        self.assertEqual(self.reads,2)

if __name__=='__main__':unittest.main()
