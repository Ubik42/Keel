import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {LibraryService} from '../../src/worker/library-service';
import {importNoConflict} from './import-no-conflict';

describe('folder rename atomicity',()=>{
 it.each([['root','rename'],['assets','rename'],['root','move'],['assets','move']] as const)('does not publish an old reconciliation snapshot after %s folder %s',async (storageLayout,action)=>{
  const parent=mkdtempSync(path.join(tmpdir(),'serpent-rename-race-'));
  let pause=false;let entered!:()=>void;let release!:()=>void;
  const started=new Promise<void>(r=>{entered=r;});const gate=new Promise<void>(r=>{release=r;});
  const service=new LibraryService({observerFactory:()=>({close(){}}),contentFingerprintAsync:async source=>{
   const hash=createHash('sha1').update(readFileSync(source)).digest('hex');
   if(pause){entered();await gate;}return hash;
  }});
  try{
   const library=service.createLibrary({displayName:'fixture',selectedParentPath:parent,storageLayout});
   const folder=service.createManagedFolder({libraryId:library.libraryId,name:'Before'});
   const source=path.join(parent,'photo.txt');writeFileSync(source,'original');
   const imported=importNoConflict(service,library.libraryId,source,folder.folderId).assets[0]!;
   const assetsRoot=storageLayout==='root'?library.libraryPath:path.join(library.libraryPath,'Assets');
   const original=path.join(assetsRoot,'Before','photo.txt');
   writeFileSync(original,'modified content');const future=new Date(Date.now()+60000);utimesSync(original,future,future);
   const target=action==='move'?service.createManagedFolder({libraryId:library.libraryId,name:'Target'}):null;
   const expectedPath=target?'Target/Before':'After';
   const expectedFolders=target?['Target','Target/Before']:['After'];
   pause=true;
   const reconciliation=service.runOpenBackgroundReconciliation(library.libraryId);
   await started;
   if(target)service.moveManagedFolders({libraryId:library.libraryId,folderIds:[folder.folderId],targetParentFolderId:target.folderId});
   else service.renameManagedFolder({libraryId:library.libraryId,folderId:folder.folderId,newName:'After'});
   release();await reconciliation;
   expect(service.listManagedFolders(library.libraryId).map(f=>f.relativePath)).toEqual(expectedFolders);
   expect(existsSync(path.join(assetsRoot,'Before'))).toBe(false);
   expect(readFileSync(path.join(assetsRoot,expectedPath,'photo.txt'),'utf8')).toBe('modified content');
   const assets=service.listAssets({libraryId:library.libraryId,recursive:true});
   expect(assets).toHaveLength(1);
   expect(assets[0]).toMatchObject({assetId:imported.assetId,relativeFilePath:expectedPath+'/photo.txt',availability:'available'});
   pause=false;await service.runOpenBackgroundReconciliation(library.libraryId);
   expect(service.listManagedFolders(library.libraryId).map(f=>f.relativePath)).toEqual(expectedFolders);
   expect(service.listAssets({libraryId:library.libraryId,recursive:true})).toHaveLength(1);
  }finally{release();service.closeAll();rmSync(parent,{recursive:true,force:true});}
 },15000);
 it.each(['root','assets'] as const)('rolls back the real directory if the %s index update fails',storageLayout=>{
  const parent=mkdtempSync(path.join(tmpdir(),'serpent-rename-rollback-'));
  const service=new LibraryService({observerFactory:()=>({close(){}})});
  const require=createRequire(import.meta.url);
  const Database=require('better-sqlite3') as new(path:string)=>{exec(sql:string):void;close():void};
  try{
   const library=service.createLibrary({displayName:'fixture',selectedParentPath:parent,storageLayout});
   const folder=service.createManagedFolder({libraryId:library.libraryId,name:'Before'});
   const source=path.join(parent,'photo.txt');writeFileSync(source,'original');
   const imported=importNoConflict(service,library.libraryId,source,folder.folderId).assets[0]!;
   const db=new Database(path.join(library.libraryPath,'.keel','library.db'));
   try{db.exec("CREATE TRIGGER reject_folder_rename BEFORE UPDATE ON managed_folders BEGIN SELECT RAISE(ABORT, 'test rollback'); END");}finally{db.close();}
   expect(()=>service.renameManagedFolder({libraryId:library.libraryId,folderId:folder.folderId,newName:'After'})).toThrow();
   const assetsRoot=storageLayout==='root'?library.libraryPath:path.join(library.libraryPath,'Assets');
   expect(existsSync(path.join(assetsRoot,'After'))).toBe(false);
   expect(readFileSync(path.join(assetsRoot,'Before','photo.txt'),'utf8')).toBe('original');
   expect(service.listManagedFolders(library.libraryId).map(f=>f.relativePath)).toEqual(['Before']);
   expect(service.listAssets({libraryId:library.libraryId,recursive:true})[0]).toMatchObject({assetId:imported.assetId,relativeFilePath:'Before/photo.txt'});
  }finally{service.closeAll();rmSync(parent,{recursive:true,force:true});}
 });

});
