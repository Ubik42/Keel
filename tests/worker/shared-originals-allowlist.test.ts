import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibraryService } from '../../src/worker/library-service';
import { removePathWithSyncRetry } from '../../src/worker/windows-fs-retry';

describe('shared originals allowlist', () => {
  it('indexes only included files on the first scan and excludes future unrelated files', async () => {
    const parent=mkdtempSync(path.join(tmpdir(),'serpent-shared-originals-'));
    const diagnostics: string[] = [];
    const service=new LibraryService({ onDiagnostic: (event) => diagnostics.push(event.scope) });
    try {
      const external=path.join(parent,'originals');mkdirSync(external);
      mkdirSync(path.join(external,'.keel'));writeFileSync(path.join(external,'.keel','library.db'),'metadata');
      writeFileSync(path.join(external,'.keelignore'),'private');
      writeFileSync(path.join(external,'one.jpg'),'one');writeFileSync(path.join(external,'other.jpg'),'other');
      const library=service.createLibrary({displayName:'phone',selectedParentPath:parent});
      const linked=service.importFolderAsLinked({libraryId:library.libraryId,sourceRootPath:external,initialRules:[
        {ruleId:'all',action:'exclude',target:'path',pattern:'**',enabled:true},
        {ruleId:'one',action:'include',target:'path',pattern:'one.jpg',enabled:true},
      ]});
      expect(linked.assetCount).toBe(1);
      expect(service.listAssets({libraryId:library.libraryId,recursive:true}).map(a=>a.displayName)).toEqual(['one.jpg']);
      writeFileSync(path.join(external,'future.jpg'),'future');service.refreshManagedAssets(library.libraryId);
      expect(service.listAssets({libraryId:library.libraryId,recursive:true}).map(a=>a.displayName)).toEqual(['one.jpg']);
      await service.runOpenBackgroundReconciliation(library.libraryId);
      expect(diagnostics).not.toContain('open.refresh-managed-assets');
      expect(service.listAssets({libraryId:library.libraryId,recursive:true}).map(a=>a.displayName)).toEqual(['one.jpg']);
    } finally {service.closeAll();removePathWithSyncRetry(parent);}
  });
});
