import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LibraryService } from '../src/worker/library-service';
import { libraryMetaDir } from '../src/shared/library-meta-dir';
import type { LinkedFolderRule } from '../src/shared/asset-types';

const root = path.resolve(process.argv[2] ?? '');
if (!existsSync(root) || !process.argv[2]) throw new Error('缺少资源库目录');
const service = new LibraryService();
try {
  const library = existsSync(libraryMetaDir(root, 'library.db'))
    ? service.openLibrary(root)
    : service.createLibrary({ displayName: path.basename(root), selectedParentPath: root, useExistingFolder: true });
  // openLibrary/createLibrary above already moved a legacy `.serpent` to `.keel`.
  const settingsPath = libraryMetaDir(root, 'phone-sync', 'config.json');
  const linksPath = libraryMetaDir(root, 'phone-sync', 'shared-links.json');
  if (existsSync(settingsPath) && existsSync(linksPath)) {
    const config = JSON.parse(readFileSync(settingsPath, 'utf8')) as { shared_roots: Record<string,string> };
    const links = JSON.parse(readFileSync(linksPath, 'utf8')) as Record<string,string[]>;
    for (const [name, source] of Object.entries(config.shared_roots)) {
      const paths = links[name] ?? [];
      const rules: LinkedFolderRule[] = [
        { ruleId: randomUUID(), action: 'exclude', target: 'path', pattern: '**', enabled: true },
        ...paths.map((pattern): LinkedFolderRule => ({ ruleId: randomUUID(), action: 'include', target: 'path', pattern, enabled: true })),
      ];
      const existing = service.listLinkedFolders(library.libraryId).find((folder) => folder.relativePath === '' && path.resolve(folder.absoluteRootPath) === path.resolve(source));
      if (!existing && paths.length) service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: path.resolve(source), displayName: '共享照片 · ' + name, initialRules: rules });
      else if (existing) {
        const previous = service.getLinkedFolderRules({ libraryId: library.libraryId, folderId: existing.folderId });
        const signature = (items: LinkedFolderRule[]) => JSON.stringify(items.map(({ action, target, pattern, enabled }) => ({ action, target, pattern, enabled })));
        if (signature(previous) !== signature(rules)) service.setLinkedFolderRules({ libraryId: library.libraryId, folderId: existing.folderId, rules });
      }
    }
  }
  service.refreshManagedAssets(library.libraryId);
  const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
  console.log(JSON.stringify({ libraryId: library.libraryId, name: library.displayName, root, assets: assets.length }));
} finally { service.closeAll(); }
