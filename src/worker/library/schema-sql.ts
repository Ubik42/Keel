import { createHash } from 'node:crypto';
import type { DatabaseConnection } from './database';
import { columnsFor, hasTable } from './lenient-columns';
import { RAW_IMAGE_EXTENSIONS, EMBEDDED_IMAGE_METADATA_EXTENSIONS } from '../../shared/media-formats';
import { LINKED_DIRECTORY_INDEX_SQL } from './linked-directory-index';
import { AUTOMATIC_TASKS_SQL, AUTOMATIC_TASK_LAYOUT_SQL } from '../../shared/automatic-tasks';
import { ASSET_COMPANIONS_SQL } from './companion-files';
import { RULES_SQL } from '../../shared/rules';

/**
 * Schema SQL, checksums and the migration list (moved verbatim: the SQL text is what the migration checksums cover).
 */
export const INITIAL_SCHEMA_SQL = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE library (
    library_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

export const INITIAL_SCHEMA_CHECKSUM = createHash('sha256').update(INITIAL_SCHEMA_SQL).digest('hex');

export const ASSET_SCHEMA_SQL = `
  CREATE TABLE managed_folders (
    folder_id TEXT PRIMARY KEY,
    parent_folder_id TEXT REFERENCES managed_folders(folder_id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE assets (
    asset_id TEXT PRIMARY KEY,
    location_kind TEXT NOT NULL CHECK (location_kind = 'managed'),
    managed_folder_id TEXT REFERENCES managed_folders(folder_id) ON DELETE RESTRICT,
    relative_file_path TEXT NOT NULL UNIQUE,
    current_revision_id TEXT,
    availability TEXT NOT NULL CHECK (availability IN ('available', 'missing')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE revisions (
    revision_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    parent_revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    modified_at TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('import', 'external_change', 'replace')),
    accepted_at TEXT NOT NULL
  );

  CREATE TABLE file_operations (
    operation_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('preparing', 'applying', 'committed', 'rolled_back', 'failed')
    ),
    manifest_json TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX assets_folder_path_idx
    ON assets(managed_folder_id, relative_file_path);
  CREATE INDEX revisions_asset_accepted_idx
    ON revisions(asset_id, accepted_at);
`;

export const ASSET_SCHEMA_CHECKSUM = createHash('sha256').update(ASSET_SCHEMA_SQL).digest('hex');

export const PORTABLE_PATH_SCHEMA_BEFORE_BACKFILL_SQL = `
  ALTER TABLE managed_folders ADD COLUMN path_identity TEXT;
  ALTER TABLE assets ADD COLUMN path_identity TEXT;
`;

export const PORTABLE_PATH_SCHEMA_AFTER_BACKFILL_SQL = `
  CREATE UNIQUE INDEX managed_folders_path_identity_unique
    ON managed_folders(path_identity);
  CREATE UNIQUE INDEX assets_path_identity_unique
    ON assets(path_identity);
  CREATE TRIGGER managed_folders_path_identity_required_insert
    BEFORE INSERT ON managed_folders
    WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'managed folder path identity is required'); END;
  CREATE TRIGGER managed_folders_path_identity_required_update
    BEFORE UPDATE OF path_identity ON managed_folders
    WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'managed folder path identity is required'); END;
  CREATE TRIGGER assets_path_identity_required_insert
    BEFORE INSERT ON assets
    WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'asset path identity is required'); END;
  CREATE TRIGGER assets_path_identity_required_update
    BEFORE UPDATE OF path_identity ON assets
    WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'asset path identity is required'); END;
`;

export const PORTABLE_PATH_BACKFILL_AUDIT_ID =
  'portable-path-identity:nfc-per-segment:ecmascript-upper-lower-casefold:v1';

export const PORTABLE_PATH_SCHEMA_CHECKSUM = createHash('sha256')
  .update(PORTABLE_PATH_SCHEMA_BEFORE_BACKFILL_SQL)
  .update(PORTABLE_PATH_BACKFILL_AUDIT_ID)
  .update(PORTABLE_PATH_SCHEMA_AFTER_BACKFILL_SQL)
  .digest('hex');

export const LINKED_FOLDERS_SCHEMA_SQL = `
  CREATE TABLE linked_folders (
    folder_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    display_name TEXT NOT NULL,
    absolute_root_path TEXT NOT NULL,
    source_device_hint TEXT,
    status TEXT NOT NULL CHECK (status IN ('available', 'offline')),
    path_identity TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- SQLite cannot ALTER a CHECK constraint, so the assets table is rebuilt to
  -- relax location_kind to 'managed' | 'linked', add linked_folder_id, and
  -- replace the global UNIQUE on relative_file_path / path_identity with
  -- location-scoped partial unique indexes: a linked asset's relative path is
  -- relative to its linked root, not globally unique across the library.
  CREATE TABLE assets_v4 (
    asset_id TEXT PRIMARY KEY,
    location_kind TEXT NOT NULL CHECK (location_kind IN ('managed', 'linked')),
    managed_folder_id TEXT REFERENCES managed_folders(folder_id) ON DELETE RESTRICT,
    linked_folder_id TEXT REFERENCES linked_folders(folder_id) ON DELETE RESTRICT,
    relative_file_path TEXT NOT NULL,
    current_revision_id TEXT,
    availability TEXT NOT NULL CHECK (availability IN ('available', 'missing')),
    path_identity TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (location_kind = 'managed' AND linked_folder_id IS NULL) OR
      (location_kind = 'linked' AND managed_folder_id IS NULL AND linked_folder_id IS NOT NULL)
    )
  );

  INSERT INTO assets_v4 (
    asset_id, location_kind, managed_folder_id, linked_folder_id,
    relative_file_path, current_revision_id, availability, path_identity,
    created_at, updated_at
  )
  SELECT
    asset_id, location_kind, managed_folder_id, NULL,
    relative_file_path, current_revision_id, availability, path_identity,
    created_at, updated_at
  FROM assets;

  DROP INDEX IF EXISTS assets_folder_path_idx;
  DROP INDEX IF EXISTS assets_path_identity_unique;
  DROP TRIGGER IF EXISTS assets_path_identity_required_insert;
  DROP TRIGGER IF EXISTS assets_path_identity_required_update;
  DROP TABLE assets;
  ALTER TABLE assets_v4 RENAME TO assets;

  CREATE INDEX assets_folder_path_idx
    ON assets(managed_folder_id, relative_file_path);
  CREATE INDEX assets_linked_folder_path_idx
    ON assets(linked_folder_id, relative_file_path);
  CREATE UNIQUE INDEX assets_managed_relative_unique
    ON assets(relative_file_path) WHERE location_kind = 'managed';
  CREATE UNIQUE INDEX assets_managed_path_identity_unique
    ON assets(path_identity) WHERE location_kind = 'managed';
  CREATE UNIQUE INDEX assets_linked_relative_unique
    ON assets(linked_folder_id, relative_file_path) WHERE location_kind = 'linked';
  CREATE UNIQUE INDEX assets_linked_path_identity_unique
    ON assets(linked_folder_id, path_identity) WHERE location_kind = 'linked';
  CREATE TRIGGER assets_path_identity_required_insert
    BEFORE INSERT ON assets WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'asset path identity is required'); END;
  CREATE TRIGGER assets_path_identity_required_update
    BEFORE UPDATE OF path_identity ON assets WHEN NEW.path_identity IS NULL
    BEGIN SELECT RAISE(ABORT, 'asset path identity is required'); END;
`;

export const LINKED_FOLDERS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(LINKED_FOLDERS_SCHEMA_SQL)
  .digest('hex');

export const ORGANIZATION_SCHEMA_SQL = `
  CREATE TABLE tags (
    tag_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    name TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE (library_id, name COLLATE NOCASE)
  );

  CREATE TABLE human_asset_tags (
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
  );

  -- AI tag relationships are structurally ready but not written until slice 0009.
  CREATE TABLE ai_asset_tags (
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    PRIMARY KEY (asset_id, tag_id)
  );

  CREATE TABLE asset_metadata (
    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    label TEXT,
    description TEXT,
    rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    palette TEXT,
    source_page_url TEXT,
    entity_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE collections (
    collection_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    parent_id TEXT REFERENCES collections(collection_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cover_asset_id TEXT REFERENCES assets(asset_id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE collection_assets (
    collection_id TEXT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, asset_id)
  );

  CREATE TABLE smart_collections (
    smart_collection_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    name TEXT NOT NULL,
    query_definition TEXT NOT NULL,
    sort_definition TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX tags_library_idx ON tags(library_id);
  CREATE INDEX human_asset_tags_tag_idx ON human_asset_tags(tag_id);
  CREATE INDEX ai_asset_tags_tag_idx ON ai_asset_tags(tag_id);
  CREATE INDEX collections_library_parent_idx ON collections(library_id, parent_id);
  CREATE INDEX collection_assets_asset_idx ON collection_assets(asset_id);
  CREATE INDEX smart_collections_library_idx ON smart_collections(library_id);
`;

export const ORGANIZATION_SCHEMA_CHECKSUM = createHash('sha256')
  .update(ORGANIZATION_SCHEMA_SQL)
  .digest('hex');

export const SEARCH_SCHEMA_SQL = `
  CREATE TABLE asset_search_index (
    asset_id TEXT UNIQUE NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    folder_path TEXT NOT NULL DEFAULT '',
    metadata_text TEXT NOT NULL DEFAULT ''
  );

  CREATE VIRTUAL TABLE asset_search USING fts5(
    label,
    filename,
    tags,
    description,
    source_url,
    folder_path,
    metadata_text,
    content='asset_search_index'
  );

  CREATE TRIGGER asset_search_index_ai AFTER INSERT ON asset_search_index BEGIN
    INSERT INTO asset_search(rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES (new.rowid, new.label, new.filename, new.tags, new.description,
            new.source_url, new.folder_path, new.metadata_text);
  END;

  CREATE TRIGGER asset_search_index_ad AFTER DELETE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.label, old.filename, old.tags, old.description,
            old.source_url, old.folder_path, old.metadata_text);
  END;

  CREATE TRIGGER asset_search_index_au AFTER UPDATE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.label, old.filename, old.tags, old.description,
            old.source_url, old.folder_path, old.metadata_text);
    INSERT INTO asset_search(rowid, label, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES (new.rowid, new.label, new.filename, new.tags, new.description,
            new.source_url, new.folder_path, new.metadata_text);
  END;

  -- Rebuild smart_collections for v6 shape (collection_id pk, query_definition_json,
  -- position, UNIQUE(library_id, name)). Requires FK disable as DROP TABLE cascades.
  CREATE TABLE smart_collections_v6 (
    collection_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library(library_id),
    name TEXT NOT NULL,
    query_definition_json TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO smart_collections_v6 (collection_id, library_id, name, query_definition_json, position, created_at, updated_at)
  SELECT
    smart_collection_id,
    library_id,
    name,
    '{"query":' || json_quote(query_definition) || ',"sort":' || json_quote(sort_definition) || '}',
    0,
    created_at,
    updated_at
  FROM smart_collections;

  DROP TABLE smart_collections;
  ALTER TABLE smart_collections_v6 RENAME TO smart_collections;

  CREATE UNIQUE INDEX smart_collections_library_name_unique
    ON smart_collections(library_id, name);
`;

export const SEARCH_SCHEMA_CHECKSUM = createHash('sha256')
  .update(SEARCH_SCHEMA_SQL)
  .digest('hex');

export const TRASH_SCHEMA_SQL = `
  ALTER TABLE assets ADD COLUMN deleted_at TEXT;
  ALTER TABLE assets ADD COLUMN trashed_from_relative_path TEXT;
  ALTER TABLE assets ADD COLUMN trashed_from_folder_id TEXT
    REFERENCES managed_folders(folder_id) ON DELETE SET NULL;

  CREATE INDEX assets_deleted_at_idx ON assets(deleted_at) WHERE deleted_at IS NOT NULL;
  CREATE INDEX assets_deleted_folder_idx ON assets(trashed_from_folder_id) WHERE deleted_at IS NOT NULL;

  -- The v7 migration is additive on assets but must relax the revisions.origin
  -- CHECK constraint to include 'relink'. SQLite cannot ALTER a CHECK constraint,
  -- so the revisions table is rebuilt. FK relationships (asset_id REFERENCES
  -- assets, parent_revision_id REFERENCES revisions) must be preserved.
  -- PRAGMA foreign_keys is OFF during this migration to prevent DROP TABLE from
  -- cascading through child FKs; assets rows are NOT touched by this rebuild.
  CREATE TABLE revisions_v7 (
    revision_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    parent_revision_id TEXT REFERENCES revisions_v7(revision_id) ON DELETE SET NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    modified_at TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('import', 'external_change', 'replace', 'relink')),
    accepted_at TEXT NOT NULL
  );

  INSERT INTO revisions_v7
    (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
     original_filename, origin, accepted_at)
  SELECT revision_id, asset_id, parent_revision_id, byte_size, modified_at,
         original_filename, origin, accepted_at
    FROM revisions;

  DROP TABLE revisions;
  ALTER TABLE revisions_v7 RENAME TO revisions;

  DROP INDEX IF EXISTS revisions_asset_accepted_idx;
  CREATE INDEX revisions_asset_accepted_idx
    ON revisions(asset_id, accepted_at);
`;

export const TRASH_SCHEMA_CHECKSUM = createHash('sha256')
  .update(TRASH_SCHEMA_SQL)
  .digest('hex');

export const AI_CONTENT_SCHEMA_SQL = `
  CREATE TABLE ai_content (
    ai_content_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    field_name TEXT NOT NULL CHECK (field_name IN ('label', 'description', 'structured_metadata')),
    value TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );

  CREATE INDEX ai_content_asset_field ON ai_content(asset_id, field_name);
`;

export const AI_CONTENT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AI_CONTENT_SCHEMA_SQL)
  .digest('hex');

export const THUMBNAIL_SCHEMA_SQL = `
  CREATE TABLE revision_artifacts (
    artifact_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('thumbnail', 'video_poster', 'contact_sheet', 'webm_proxy',
               'extracted_metadata', 'extracted_palette')
    ),
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    file_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    generator_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'generating', 'ready', 'failed')
    ),
    error_code TEXT,
    generated_at TEXT,
    invalidated_at TEXT
  );

  CREATE UNIQUE INDEX revision_artifacts_current
    ON revision_artifacts(revision_id, kind)
    WHERE invalidated_at IS NULL;

  CREATE TABLE jobs (
    job_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    asset_id TEXT REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('generate_thumbnail', 'generate_video_poster',
               'generate_contact_sheet', 'generate_webm_proxy',
               'extract_metadata', 'extract_palette')
    ),
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')
    ),
    priority INTEGER NOT NULL DEFAULT 0,
    progress REAL DEFAULT 0.0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX jobs_library_status_priority
    ON jobs(library_id, status, priority DESC, created_at);
`;

export const THUMBNAIL_SCHEMA_CHECKSUM = createHash('sha256')
  .update(THUMBNAIL_SCHEMA_SQL)
  .digest('hex');

// Migration v10: add AI analysis job kinds to the jobs table CHECK constraint.
// SQLite cannot ALTER a CHECK constraint; we recreate the table in-place.
export const AI_JOBS_SCHEMA_SQL = `
  CREATE TABLE jobs_new (
    job_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    asset_id TEXT REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('generate_thumbnail', 'generate_video_poster',
               'generate_contact_sheet', 'generate_webm_proxy',
               'extract_metadata', 'extract_palette',
               'ai.image.analysis', 'ai.video.analysis')
    ),
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')
    ),
    priority INTEGER NOT NULL DEFAULT 0,
    progress REAL DEFAULT 0.0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT INTO jobs_new SELECT * FROM jobs;
  DROP TABLE jobs;
  ALTER TABLE jobs_new RENAME TO jobs;

  CREATE INDEX jobs_library_status_priority
    ON jobs(library_id, status, priority DESC, created_at);
`;

export const AI_JOBS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AI_JOBS_SCHEMA_SQL)
  .digest('hex');

export const MEDIA_DURATION_SCHEMA_SQL = `
  ALTER TABLE revision_artifacts ADD COLUMN duration_ms INTEGER
    CHECK (duration_ms IS NULL OR duration_ms >= 0);
  CREATE INDEX revision_artifacts_duration_idx
    ON revision_artifacts(duration_ms)
    WHERE kind = 'extracted_metadata' AND status = 'ready' AND invalidated_at IS NULL;
`;

export const MEDIA_DURATION_SCHEMA_CHECKSUM = createHash('sha256')
  .update(MEDIA_DURATION_SCHEMA_SQL)
  .digest('hex');

export const PALETTE_SORT_SCHEMA_SQL = `
  ALTER TABLE revision_artifacts ADD COLUMN dominant_hue REAL
    CHECK (dominant_hue IS NULL OR (dominant_hue >= 0 AND dominant_hue < 360));
  ALTER TABLE revision_artifacts ADD COLUMN dominant_lightness REAL
    CHECK (dominant_lightness IS NULL OR (dominant_lightness >= 0 AND dominant_lightness <= 1));
  CREATE INDEX revision_artifacts_palette_sort_idx
    ON revision_artifacts(dominant_hue, dominant_lightness)
    WHERE kind = 'extracted_palette' AND status = 'ready' AND invalidated_at IS NULL;
`;

export const PALETTE_SORT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(PALETTE_SORT_SCHEMA_SQL)
  .digest('hex');

export const LINKED_FOLDER_RULES_SCHEMA_SQL = `
  CREATE TABLE linked_folder_rules (
    rule_id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL REFERENCES linked_folders(folder_id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    action TEXT NOT NULL CHECK (action IN ('include', 'exclude')),
    target TEXT NOT NULL CHECK (target IN ('path', 'filename', 'extension', 'folder')),
    pattern TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    UNIQUE(folder_id, position)
  );
  CREATE INDEX linked_folder_rules_folder ON linked_folder_rules(folder_id, position);

  CREATE TABLE linked_ignored_assets (
    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    ignored_at TEXT NOT NULL
  );

  INSERT INTO linked_folder_rules(rule_id, folder_id, position, action, target, pattern, enabled)
    SELECT folder_id || ':default:0', folder_id, 0, 'exclude', 'folder', '.git', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:1', folder_id, 1, 'exclude', 'folder', 'node_modules', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:2', folder_id, 2, 'exclude', 'folder', '.svn', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:3', folder_id, 3, 'exclude', 'folder', '.hg', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:4', folder_id, 4, 'exclude', 'folder', '__pycache__', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:5', folder_id, 5, 'exclude', 'filename', '.DS_Store', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:6', folder_id, 6, 'exclude', 'filename', 'Thumbs.db', 1 FROM linked_folders;
  INSERT INTO linked_folder_rules SELECT folder_id || ':default:7', folder_id, 7, 'exclude', 'filename', 'desktop.ini', 1 FROM linked_folders;
`;

export const LINKED_FOLDER_RULES_SCHEMA_CHECKSUM = createHash('sha256')
  .update(LINKED_FOLDER_RULES_SCHEMA_SQL)
  .digest('hex');

// Migration v14: retire the pre-release asset Label concept. Real filenames,
// descriptions, ratings, favorites, palettes, source URLs, and tag relations
// remain intact. Label values are intentionally discarded rather than mapped
// to filenames or tags because neither mapping preserves their semantics.
export const RETIRE_ASSET_LABEL_SCHEMA_SQL = `
  -- A saved query that explicitly depended on Label cannot be translated to
  -- filename, tags, or description without changing user intent. Delete these
  -- pre-release smart collections instead of leaving a silently empty result.
  DELETE FROM smart_collections
   WHERE json_valid(query_definition_json)
     AND EXISTS (
       SELECT 1
         FROM json_tree(smart_collections.query_definition_json)
        WHERE json_tree.key = 'field' AND json_tree.value = 'label'
     );

  CREATE TABLE asset_metadata_v14 (
    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    description TEXT,
    rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    palette TEXT,
    source_page_url TEXT,
    entity_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  INSERT INTO asset_metadata_v14
    (asset_id, description, rating, favorite, palette, source_page_url,
     entity_version, updated_at)
  SELECT asset_id, description, rating, favorite, palette, source_page_url,
         entity_version, updated_at
    FROM asset_metadata;
  DROP TABLE asset_metadata;
  ALTER TABLE asset_metadata_v14 RENAME TO asset_metadata;

  CREATE TABLE ai_content_v14 (
    ai_content_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    field_name TEXT NOT NULL CHECK (field_name IN ('description', 'structured_metadata')),
    value TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  INSERT INTO ai_content_v14
    (ai_content_id, asset_id, revision_id, field_name, value,
     model_id, model_version, generated_at)
  SELECT ai_content_id, asset_id, revision_id, field_name, value,
         model_id, model_version, generated_at
    FROM ai_content
   WHERE field_name <> 'label';
  DROP TABLE ai_content;
  ALTER TABLE ai_content_v14 RENAME TO ai_content;
  CREATE INDEX ai_content_asset_field ON ai_content(asset_id, field_name);

  DROP TRIGGER IF EXISTS asset_search_index_ai;
  DROP TRIGGER IF EXISTS asset_search_index_ad;
  DROP TRIGGER IF EXISTS asset_search_index_au;
  DROP TABLE asset_search;

  CREATE TABLE asset_search_index_v14 (
    asset_id TEXT UNIQUE NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    filename TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    folder_path TEXT NOT NULL DEFAULT '',
    metadata_text TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO asset_search_index_v14
    (asset_id, filename, tags, description, source_url, folder_path, metadata_text)
  SELECT asset_id, filename, tags, description, source_url, folder_path, metadata_text
    FROM asset_search_index;
  DROP TABLE asset_search_index;
  ALTER TABLE asset_search_index_v14 RENAME TO asset_search_index;

  CREATE VIRTUAL TABLE asset_search USING fts5(
    filename,
    tags,
    description,
    source_url,
    folder_path,
    metadata_text,
    content='asset_search_index'
  );
  CREATE TRIGGER asset_search_index_ai AFTER INSERT ON asset_search_index BEGIN
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.folder_path, new.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_ad AFTER DELETE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.folder_path, old.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_au AFTER UPDATE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.folder_path, old.metadata_text);
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.folder_path, new.metadata_text);
  END;
  INSERT INTO asset_search(asset_search) VALUES('rebuild');
`;

export const RETIRE_ASSET_LABEL_SCHEMA_CHECKSUM = createHash('sha256')
  .update(RETIRE_ASSET_LABEL_SCHEMA_SQL)
  .digest('hex');

// Migration v15: add an author/creator metadata field, editable
// by users and auto-populated from EXIF/IPTC/XMP on first thumbnail
// generation. FTS5 content tables cannot have a column appended in place, so
// the search index and its triggers are rebuilt with an `author` column
// alongside the existing `source_url` column, mirroring the v14 rebuild.
export const AUTHOR_METADATA_SCHEMA_SQL = `
  ALTER TABLE asset_metadata ADD COLUMN author TEXT;

  DROP TRIGGER IF EXISTS asset_search_index_ai;
  DROP TRIGGER IF EXISTS asset_search_index_ad;
  DROP TRIGGER IF EXISTS asset_search_index_au;
  DROP TABLE asset_search;

  ALTER TABLE asset_search_index ADD COLUMN author TEXT NOT NULL DEFAULT '';

  CREATE VIRTUAL TABLE asset_search USING fts5(
    filename,
    tags,
    description,
    source_url,
    author,
    folder_path,
    metadata_text,
    content='asset_search_index'
  );
  CREATE TRIGGER asset_search_index_ai AFTER INSERT ON asset_search_index BEGIN
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.author, new.folder_path, new.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_ad AFTER DELETE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.author, old.folder_path, old.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_au AFTER UPDATE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.author, old.folder_path, old.metadata_text);
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.author, new.folder_path, new.metadata_text);
  END;
  INSERT INTO asset_search(asset_search) VALUES('rebuild');
`;

export const AUTHOR_METADATA_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AUTHOR_METADATA_SCHEMA_SQL)
  .digest('hex');

// Migration v16 (F8): AI aesthetic rating in ai_content;
// retire structured_metadata bag.
export const AI_RATING_CONTENT_SCHEMA_SQL = `
  DELETE FROM ai_content WHERE field_name = 'structured_metadata';

  CREATE TABLE ai_content_v16 (
    ai_content_id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    field_name TEXT NOT NULL CHECK (field_name IN ('description', 'rating')),
    value TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  INSERT INTO ai_content_v16
    (ai_content_id, asset_id, revision_id, field_name, value,
     model_id, model_version, generated_at)
  SELECT ai_content_id, asset_id, revision_id, field_name, value,
         model_id, model_version, generated_at
    FROM ai_content
   WHERE field_name IN ('description', 'rating');
  DROP TABLE ai_content;
  ALTER TABLE ai_content_v16 RENAME TO ai_content;
  CREATE INDEX ai_content_asset_field ON ai_content(asset_id, field_name);
`;

export const AI_RATING_CONTENT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AI_RATING_CONTENT_SCHEMA_SQL)
  .digest('hex');

export const TRASHED_MANAGED_FOLDERS_SCHEMA_SQL = `
  CREATE TABLE trashed_managed_folders (
    tombstone_id TEXT PRIMARY KEY,
    folder_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_relative_path TEXT,
    trashed_at TEXT NOT NULL,
    trashed_asset_count INTEGER NOT NULL CHECK (trashed_asset_count >= 0)
  );

  CREATE INDEX trashed_managed_folders_trashed_at_idx
    ON trashed_managed_folders(trashed_at DESC);
`;

export const TRASHED_MANAGED_FOLDERS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(TRASHED_MANAGED_FOLDERS_SCHEMA_SQL)
  .digest('hex');

// Migration v18: replace exact-token FTS with a raw,
// normalized trigram index. FTS5's trigram tokenizer accelerates arbitrary
// contains matching for terms of three or more characters; the Worker applies
// the same exact predicate for shorter terms so one-character search remains
// correct instead of silently returning no results.
export const CONTEXTUAL_SUBSTRING_SEARCH_SCHEMA_SQL = `
  DROP TRIGGER IF EXISTS asset_search_index_ai;
  DROP TRIGGER IF EXISTS asset_search_index_ad;
  DROP TRIGGER IF EXISTS asset_search_index_au;
  DROP TABLE asset_search;
  DELETE FROM asset_search_index;

  CREATE VIRTUAL TABLE asset_search USING fts5(
    filename,
    tags,
    description,
    source_url,
    author,
    folder_path,
    metadata_text,
    content='asset_search_index',
    tokenize='trigram case_sensitive 0'
  );
  CREATE TRIGGER asset_search_index_ai AFTER INSERT ON asset_search_index BEGIN
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.author, new.folder_path, new.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_ad AFTER DELETE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.author, old.folder_path, old.metadata_text);
  END;
  CREATE TRIGGER asset_search_index_au AFTER UPDATE ON asset_search_index BEGIN
    INSERT INTO asset_search(asset_search, rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES ('delete', old.rowid, old.filename, old.tags, old.description,
            old.source_url, old.author, old.folder_path, old.metadata_text);
    INSERT INTO asset_search(rowid, filename, tags, description, source_url, author, folder_path, metadata_text)
    VALUES (new.rowid, new.filename, new.tags, new.description,
            new.source_url, new.author, new.folder_path, new.metadata_text);
  END;
`;

export const CONTEXTUAL_SUBSTRING_SEARCH_SCHEMA_CHECKSUM = createHash('sha256')
  .update(CONTEXTUAL_SUBSTRING_SEARCH_SCHEMA_SQL)
  .digest('hex');

// Migration v19: AI descriptions are stored separately from
// human metadata. Rebuild the canonical search index so existing AI analysis
// results are searchable without requiring a new analysis run.
export const AI_DESCRIPTION_SEARCH_BACKFILL_SCHEMA_SQL = `
  DELETE FROM asset_search_index;
`;

export const AI_DESCRIPTION_SEARCH_BACKFILL_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AI_DESCRIPTION_SEARCH_BACKFILL_SCHEMA_SQL)
  .digest('hex');

// Migration v20 (jcur): durable trash-folder binding so
// same-name tombstones do not share assets/covers after managed_folders rows
// are deleted (trashed_from_folder_id is FK ON DELETE SET NULL).
export const TRASH_TOMBSTONE_ASSET_BIND_SCHEMA_SQL = `
  ALTER TABLE assets ADD COLUMN trashed_from_tombstone_id TEXT;
  CREATE INDEX assets_trashed_tombstone_idx
    ON assets(trashed_from_tombstone_id)
    WHERE deleted_at IS NOT NULL AND trashed_from_tombstone_id IS NOT NULL;
`;

export const TRASH_TOMBSTONE_ASSET_BIND_SCHEMA_CHECKSUM = createHash('sha256')
  .update(TRASH_TOMBSTONE_ASSET_BIND_SCHEMA_SQL)
  .digest('hex');

// Migration v21: audio must not depend on Chromium's variable
// container/codec support. Add a distinct Opus/Ogg playback proxy and job kind
// without changing the established video WebM artifact contract.
export const MEDIA_PROXY_SCHEMA_SQL = `
  CREATE TABLE revision_artifacts_v21 (
    artifact_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('thumbnail', 'video_poster', 'contact_sheet', 'webm_proxy', 'audio_proxy',
               'extracted_metadata', 'extracted_palette')
    ),
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    file_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    generator_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'generating', 'ready', 'failed')
    ),
    error_code TEXT,
    generated_at TEXT,
    invalidated_at TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    dominant_hue REAL CHECK (dominant_hue IS NULL OR (dominant_hue >= 0 AND dominant_hue < 360)),
    dominant_lightness REAL CHECK (dominant_lightness IS NULL OR (dominant_lightness >= 0 AND dominant_lightness <= 1))
  );
  INSERT INTO revision_artifacts_v21
    (artifact_id, revision_id, kind, mime_type, byte_size, file_path, width, height,
     generator_version, status, error_code, generated_at, invalidated_at, duration_ms,
     dominant_hue, dominant_lightness)
    SELECT artifact_id, revision_id, kind, mime_type, byte_size, file_path, width, height,
           generator_version, status, error_code, generated_at, invalidated_at, duration_ms,
           dominant_hue, dominant_lightness
      FROM revision_artifacts;
  DROP TABLE revision_artifacts;
  ALTER TABLE revision_artifacts_v21 RENAME TO revision_artifacts;
  CREATE UNIQUE INDEX revision_artifacts_current
    ON revision_artifacts(revision_id, kind)
    WHERE invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_duration_idx
    ON revision_artifacts(duration_ms)
    WHERE kind = 'extracted_metadata' AND status = 'ready' AND invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_palette_sort_idx
    ON revision_artifacts(dominant_hue, dominant_lightness)
    WHERE kind = 'extracted_palette' AND status = 'ready' AND invalidated_at IS NULL;

  CREATE TABLE jobs_v21 (
    job_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    asset_id TEXT REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('generate_thumbnail', 'generate_video_poster',
               'generate_contact_sheet', 'generate_webm_proxy', 'generate_audio_proxy',
               'extract_metadata', 'extract_palette',
               'ai.image.analysis', 'ai.video.analysis')
    ),
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')
    ),
    priority INTEGER NOT NULL DEFAULT 0,
    progress REAL DEFAULT 0.0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO jobs_v21 SELECT * FROM jobs;
  DROP TABLE jobs;
  ALTER TABLE jobs_v21 RENAME TO jobs;
  CREATE INDEX jobs_library_status_priority
    ON jobs(library_id, status, priority DESC, created_at);
`;

export const MEDIA_PROXY_SCHEMA_CHECKSUM = createHash('sha256')
  .update(MEDIA_PROXY_SCHEMA_SQL)
  .digest('hex');

// Migration v22: keep a user-selected input color space
// separate from file metadata so the source remains untouched and clearing the
// override restores automatic detection.
export const COLOR_SPACE_OVERRIDE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS asset_color_space_overrides (
    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    color_space TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export const COLOR_SPACE_OVERRIDE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(COLOR_SPACE_OVERRIDE_SCHEMA_SQL)
  .digest('hex');

export const IMAGE_SEQUENCE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS asset_sequences (
    sequence_id TEXT PRIMARY KEY,
    primary_asset_id TEXT NOT NULL UNIQUE REFERENCES assets(asset_id) ON DELETE CASCADE,
    fps REAL NOT NULL CHECK(fps >= 1 AND fps <= 240),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS asset_sequence_frames (
    sequence_id TEXT NOT NULL REFERENCES asset_sequences(sequence_id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL UNIQUE REFERENCES assets(asset_id) ON DELETE CASCADE,
    frame_number INTEGER NOT NULL CHECK(frame_number >= 0),
    position INTEGER NOT NULL CHECK(position >= 0),
    PRIMARY KEY(sequence_id, position),
    UNIQUE(sequence_id, frame_number)
  );
  CREATE INDEX IF NOT EXISTS idx_asset_sequence_frames_asset
    ON asset_sequence_frames(asset_id);
`;

export const IMAGE_SEQUENCE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(IMAGE_SEQUENCE_SCHEMA_SQL)
  .digest('hex');

/**
 * Cross-process writers coordinate through these two durable tables.  The
 * sequence is maintained by SQLite triggers, so it commits or rolls back with
 * the mutation that caused it; it is never a best-effort notification emitted
 * after the fact.  Every library database contains exactly one library row,
 * which keeps the trigger body independent from the mutated table's shape.
 */
export const WRITE_COORDINATION_SCHEMA_SQL = `
  CREATE TABLE library_write_leases (
    library_id TEXT PRIMARY KEY REFERENCES library(library_id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    acquired_at_ms INTEGER NOT NULL CHECK(acquired_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > acquired_at_ms)
  );

  CREATE TABLE library_change_sequence (
    library_id TEXT PRIMARY KEY REFERENCES library(library_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence >= 0)
  );

  INSERT INTO library_change_sequence (library_id, sequence)
    SELECT library_id, 0 FROM library;

  -- Fresh libraries insert their single library row after all migrations have
  -- run, so seed that row as well as pre-existing libraries migrated to v24.
  CREATE TRIGGER library_change_sequence_seed AFTER INSERT ON library BEGIN
    INSERT OR IGNORE INTO library_change_sequence (library_id, sequence)
      VALUES (NEW.library_id, 0);
  END;

  CREATE TRIGGER library_change_on_assets_insert AFTER INSERT ON assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_assets_update AFTER UPDATE ON assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_assets_delete AFTER DELETE ON assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revisions_insert AFTER INSERT ON revisions BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revisions_update AFTER UPDATE ON revisions BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revisions_delete AFTER DELETE ON revisions BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_managed_folders_insert AFTER INSERT ON managed_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_managed_folders_update AFTER UPDATE ON managed_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_managed_folders_delete AFTER DELETE ON managed_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_folders_insert AFTER INSERT ON linked_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_folders_update AFTER UPDATE ON linked_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_folders_delete AFTER DELETE ON linked_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_ignored_assets_insert AFTER INSERT ON linked_ignored_assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_ignored_assets_update AFTER UPDATE ON linked_ignored_assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_ignored_assets_delete AFTER DELETE ON linked_ignored_assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_folder_rules_insert AFTER INSERT ON linked_folder_rules BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_folder_rules_update AFTER UPDATE ON linked_folder_rules BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_linked_folder_rules_delete AFTER DELETE ON linked_folder_rules BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_metadata_insert AFTER INSERT ON asset_metadata BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_metadata_update AFTER UPDATE ON asset_metadata BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_metadata_delete AFTER DELETE ON asset_metadata BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_color_space_overrides_insert AFTER INSERT ON asset_color_space_overrides BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_color_space_overrides_update AFTER UPDATE ON asset_color_space_overrides BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_color_space_overrides_delete AFTER DELETE ON asset_color_space_overrides BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_tags_insert AFTER INSERT ON tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_tags_update AFTER UPDATE ON tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_tags_delete AFTER DELETE ON tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_human_asset_tags_insert AFTER INSERT ON human_asset_tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_human_asset_tags_update AFTER UPDATE ON human_asset_tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_human_asset_tags_delete AFTER DELETE ON human_asset_tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_ai_asset_tags_insert AFTER INSERT ON ai_asset_tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_ai_asset_tags_update AFTER UPDATE ON ai_asset_tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_ai_asset_tags_delete AFTER DELETE ON ai_asset_tags BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_collections_insert AFTER INSERT ON collections BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_collections_update AFTER UPDATE ON collections BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_collections_delete AFTER DELETE ON collections BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_collection_assets_insert AFTER INSERT ON collection_assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_collection_assets_update AFTER UPDATE ON collection_assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_collection_assets_delete AFTER DELETE ON collection_assets BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_smart_collections_insert AFTER INSERT ON smart_collections BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_smart_collections_update AFTER UPDATE ON smart_collections BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_smart_collections_delete AFTER DELETE ON smart_collections BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_ai_content_insert AFTER INSERT ON ai_content BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_ai_content_update AFTER UPDATE ON ai_content BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_ai_content_delete AFTER DELETE ON ai_content BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_insert AFTER INSERT ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_update AFTER UPDATE ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_delete AFTER DELETE ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_jobs_insert AFTER INSERT ON jobs BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_jobs_update AFTER UPDATE ON jobs BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_jobs_delete AFTER DELETE ON jobs BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_file_operations_insert AFTER INSERT ON file_operations BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_file_operations_update AFTER UPDATE ON file_operations BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_file_operations_delete AFTER DELETE ON file_operations BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_trashed_managed_folders_insert AFTER INSERT ON trashed_managed_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_trashed_managed_folders_update AFTER UPDATE ON trashed_managed_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_trashed_managed_folders_delete AFTER DELETE ON trashed_managed_folders BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_sequences_insert AFTER INSERT ON asset_sequences BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_sequences_update AFTER UPDATE ON asset_sequences BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_sequences_delete AFTER DELETE ON asset_sequences BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_sequence_frames_insert AFTER INSERT ON asset_sequence_frames BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_sequence_frames_update AFTER UPDATE ON asset_sequence_frames BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_asset_sequence_frames_delete AFTER DELETE ON asset_sequence_frames BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
`;

export const WRITE_COORDINATION_SCHEMA_CHECKSUM = createHash('sha256')
  .update(WRITE_COORDINATION_SCHEMA_SQL)
  .digest('hex');

// Migration v25: durable ownership for long-running, detached Jobs. The
// lease is separate from the library writer lease so a Job can heartbeat
// while filesystem/media work remains outside a SQLite transaction.
export const JOB_LEASE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS library_job_leases (
    library_id TEXT NOT NULL REFERENCES library(library_id) ON DELETE CASCADE,
    job_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    fencing_token INTEGER NOT NULL CHECK(fencing_token > 0),
    acquired_at_ms INTEGER NOT NULL CHECK(acquired_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > acquired_at_ms),
    PRIMARY KEY(library_id, job_id)
  );
`;

export const JOB_LEASE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(JOB_LEASE_SCHEMA_SQL)
  .digest('hex');

// Migration v29: 资源库同步。
// - assets.sync_id：跨设备稳定身份（每台设备本地 asset_id 不同），
//   同步交换格式以 sync_id 为键；NULL 表示尚未参与同步。
// - sync_manifest_cache：上次同步点的远端 manifest 缓存。
export const SYNC_SCHEMA_SQL = `
  ALTER TABLE assets ADD COLUMN sync_id TEXT;
  CREATE INDEX IF NOT EXISTS assets_sync_id ON assets(sync_id);
  CREATE TABLE IF NOT EXISTS sync_manifest_cache (
    library_id TEXT NOT NULL PRIMARY KEY,
    manifest_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export const SYNC_SCHEMA_CHECKSUM = createHash('sha256')
  .update(SYNC_SCHEMA_SQL)
  .digest('hex');

// Migration v39: sync session ledger. The v38 sync migration shipped without
// the sync_sessions table that beginSyncSession/finishSyncSession write to;
// adding it as a fresh append-only migration keeps every released v38 checksum
// immutable.
export const SYNC_SESSIONS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sync_sessions (
    session_id TEXT NOT NULL PRIMARY KEY,
    library_id TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    progress_total INTEGER NOT NULL DEFAULT 0,
    progress_done INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error_message TEXT
  );
  CREATE INDEX IF NOT EXISTS sync_sessions_library
    ON sync_sessions(library_id, started_at);
`;

export const SYNC_SESSIONS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(SYNC_SESSIONS_SCHEMA_SQL)
  .digest('hex');

// Migration v40: covering partial indexes for the default name-sorted browse
// page (all assets / folder recursive CTE) so COUNT + first-page queries do
// not scan the whole assets table into a temp B-tree on every request. On
// SMB/NAS libraries each cold page read is a network round trip, which made
// the first browse after open take seconds.
//
// 版本收编：dev_performance_1 worktree 已用相同版本号发布过
// v40（BROWSE_HOT_PATH_INDEX_SCHEMA_SQL，checksum c6bb1f26…）且真实用户库
// （NAS 图像测试库）已按该定义迁移。此处必须原样保留那份 SQL 文本——改动一个
// 字节都会改变 checksum，让两个分支互相把对方的库判成 LIBRARY_CORRUPT 触发
// 数据抢救。Additive-only，符合数据兼容纪律（ADR-0028 v37/v38 先例）。
export const ASSETS_ACTIVE_NAME_INDEX_SCHEMA_SQL = `
  CREATE INDEX IF NOT EXISTS assets_active_folder_name_idx
    ON assets(managed_folder_id, relative_file_path, asset_id)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS assets_active_name_idx
    ON assets(relative_file_path, asset_id)
    WHERE deleted_at IS NULL;
`;

export const ASSETS_ACTIVE_NAME_INDEX_SCHEMA_CHECKSUM = createHash('sha256')
  .update(ASSETS_ACTIVE_NAME_INDEX_SCHEMA_SQL)
  .digest('hex');

// Migration v41: covering partial index for the created-at descending sort
// ("newest first", the common large-library browsing order). Without it the
// sort builds a temp B-tree over the whole assets table on every request;
// with it SQLite reads the first LIMIT rows straight off the index and joins
// only those. Measured 60ms → <0.1ms for the bare top-50 probe on a 20k
// library; SMB cold-cache first sort previously paid a full-table scan of
// network round trips. Additive-only (new index) per ADR-0028.
export const ASSETS_ACTIVE_CREATED_DESC_INDEX_SCHEMA_SQL = `
  CREATE INDEX IF NOT EXISTS assets_active_created_desc_idx
    ON assets(created_at DESC, asset_id ASC)
    WHERE deleted_at IS NULL;
`;

export const ASSETS_ACTIVE_CREATED_DESC_INDEX_SCHEMA_CHECKSUM = createHash('sha256')
  .update(ASSETS_ACTIVE_CREATED_DESC_INDEX_SCHEMA_SQL)
  .digest('hex');

// Migration v42: partial index for the tombstone backfill that runs on every
// library open. The backfill's UPDATE only touches rows with
// deleted_at IS NOT NULL AND trashed_from_tombstone_id IS NULL — with this
// index an empty-trash library proves "no candidates" without reading the
// table at all (measured 161ms full-scan on SMB → <0.1ms), and a non-empty
// trash locates its rows directly. Additive-only per ADR-0028.
export const TOMBSTONE_BACKFILL_INDEX_SCHEMA_SQL = `
  CREATE INDEX IF NOT EXISTS assets_tombstone_backfill_idx
    ON assets(trashed_from_folder_id)
    WHERE deleted_at IS NOT NULL
      AND trashed_from_tombstone_id IS NULL;
`;

export const TOMBSTONE_BACKFILL_INDEX_SCHEMA_CHECKSUM = createHash('sha256')
  .update(TOMBSTONE_BACKFILL_INDEX_SCHEMA_SQL)
  .digest('hex');

// Migration v43: RAW viewers need a full-size decoded image, while the
// 512px thumbnail remains the card/browse derivative. Keep that viewer image
// separate so opening an ARW never makes the grid load a camera-sized PNG.
export const RAW_VIEWER_ARTIFACT_SCHEMA_SQL = `
  CREATE TABLE revision_artifacts_v43 (
    artifact_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('thumbnail', 'viewer_image', 'video_poster', 'contact_sheet',
               'webm_proxy', 'audio_proxy', 'extracted_metadata',
               'extracted_palette', 'model_glb')
    ),
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    file_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    generator_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'generating', 'ready', 'failed')
    ),
    error_code TEXT,
    generated_at TEXT,
    invalidated_at TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    dominant_hue REAL CHECK (dominant_hue IS NULL OR (dominant_hue >= 0 AND dominant_hue < 360)),
    dominant_lightness REAL CHECK (dominant_lightness IS NULL OR (dominant_lightness >= 0 AND dominant_lightness <= 1))
  );
  INSERT INTO revision_artifacts_v43
    (artifact_id, revision_id, kind, mime_type, byte_size, file_path, width, height,
     generator_version, status, error_code, generated_at, invalidated_at, duration_ms,
     dominant_hue, dominant_lightness)
    SELECT artifact_id, revision_id, kind, mime_type, byte_size, file_path, width, height,
           generator_version, status, error_code, generated_at, invalidated_at, duration_ms,
           dominant_hue, dominant_lightness
      FROM revision_artifacts;
  DROP TABLE revision_artifacts;
  ALTER TABLE revision_artifacts_v43 RENAME TO revision_artifacts;
  CREATE UNIQUE INDEX revision_artifacts_current
    ON revision_artifacts(revision_id, kind)
    WHERE invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_duration_idx
    ON revision_artifacts(duration_ms)
    WHERE kind = 'extracted_metadata' AND status = 'ready' AND invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_palette_sort_idx
    ON revision_artifacts(dominant_hue, dominant_lightness)
    WHERE kind = 'extracted_palette' AND status = 'ready' AND invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_revision_kind_status
    ON revision_artifacts(revision_id, kind, status, invalidated_at);
  CREATE TRIGGER library_change_on_revision_artifacts_insert AFTER INSERT ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_update AFTER UPDATE ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_delete AFTER DELETE ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
`;

export const RAW_VIEWER_ARTIFACT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(RAW_VIEWER_ARTIFACT_SCHEMA_SQL)
  .digest('hex');

/**
 * Migration v44: persist the artifact identity that the media policy uses.
 *
 * Before this migration revision_artifacts was unique only by kind. That
 * forced every generator/settings change to invalidate by convention and
 * made it impossible to distinguish two valid viewer images for different
 * colour spaces or EXR planes. The identity columns are nullable for the
 * compatibility boundary: the trigger fills them for the many legacy write
 * sites that still insert the original column set, while the rebuild
 * backfills every existing row before the new current-key index is created.
 */
export const artifactRoleSql = (kindColumn: string): string => `CASE ${kindColumn}
      WHEN 'thumbnail' THEN 'card-thumbnail'
      WHEN 'viewer_image' THEN 'viewer-image'
      WHEN 'video_poster' THEN 'video-poster'
      WHEN 'contact_sheet' THEN 'contact-sheet'
      WHEN 'webm_proxy' THEN 'playback-proxy'
      WHEN 'audio_proxy' THEN 'playback-proxy'
      WHEN 'extracted_metadata' THEN 'technical-metadata'
      WHEN 'extracted_palette' THEN 'palette'
      WHEN 'model_glb' THEN 'model-viewer'
      ELSE NULL
    END`;

export const artifactGeneratorIdSql = (versionColumn: string): string => `CASE
      WHEN instr(${versionColumn}, ';') > 0
        THEN substr(${versionColumn}, 1, instr(${versionColumn}, ';') - 1)
      ELSE ${versionColumn}
    END`;

export const artifactSettingsHashSql = (versionColumn: string): string => `CASE
      WHEN instr(${versionColumn}, ';') > 0
        THEN COALESCE(NULLIF(substr(${versionColumn}, instr(${versionColumn}, ';') + 1), ''), 'default')
      ELSE 'default'
    END`;

export const artifactKeySql = (input: {
  assetColumn: string;
  revisionColumn: string;
  roleColumn: string;
  generatorIdColumn: string;
  generatorVersionColumn: string;
  settingsHashColumn: string;
}): string => `printf(
      '%d:%s|%d:%s|%d:%s|%d:%s|%d:%s|%d:%s',
      length(${input.assetColumn}), ${input.assetColumn},
      length(${input.revisionColumn}), ${input.revisionColumn},
      length(${input.roleColumn}), ${input.roleColumn},
      length(${input.generatorIdColumn}), ${input.generatorIdColumn},
      length(${input.generatorVersionColumn}), ${input.generatorVersionColumn},
      length(${input.settingsHashColumn}), ${input.settingsHashColumn}
    )`;

export const ARTIFACT_IDENTITY_SCHEMA_SQL = `
  CREATE TABLE revision_artifacts_v44 (
    artifact_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('thumbnail', 'viewer_image', 'video_poster', 'contact_sheet',
               'webm_proxy', 'audio_proxy', 'extracted_metadata',
               'extracted_palette', 'model_glb')
    ),
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    file_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    generator_version TEXT NOT NULL,
    artifact_role TEXT,
    generator_id TEXT,
    settings_hash TEXT,
    artifact_key TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'generating', 'ready', 'failed')
    ),
    error_code TEXT,
    generated_at TEXT,
    invalidated_at TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    dominant_hue REAL CHECK (dominant_hue IS NULL OR (dominant_hue >= 0 AND dominant_hue < 360)),
    dominant_lightness REAL CHECK (dominant_lightness IS NULL OR (dominant_lightness >= 0 AND dominant_lightness <= 1))
  );
  WITH identity AS (
    SELECT ra.artifact_id, ra.revision_id, ra.kind, ra.mime_type, ra.byte_size,
           ra.file_path, ra.width, ra.height, ra.generator_version, ra.status,
           ra.error_code, ra.generated_at, ra.invalidated_at, ra.duration_ms,
           ra.dominant_hue, ra.dominant_lightness, r.asset_id,
           ${artifactRoleSql('ra.kind')} AS artifact_role,
           ${artifactGeneratorIdSql('ra.generator_version')} AS generator_id,
           ${artifactSettingsHashSql('ra.generator_version')} AS settings_hash
      FROM revision_artifacts ra
      JOIN revisions r ON r.revision_id = ra.revision_id
  ), keyed AS (
    SELECT identity.*,
           ${artifactKeySql({
             assetColumn: 'asset_id',
             revisionColumn: 'revision_id',
             roleColumn: 'artifact_role',
             generatorIdColumn: 'generator_id',
             generatorVersionColumn: 'generator_version',
             settingsHashColumn: 'settings_hash',
           })} AS artifact_key
      FROM identity
  )
  INSERT INTO revision_artifacts_v44
    (artifact_id, revision_id, kind, mime_type, byte_size, file_path, width, height,
     generator_version, artifact_role, generator_id, settings_hash, artifact_key,
     status, error_code, generated_at, invalidated_at, duration_ms,
     dominant_hue, dominant_lightness)
  SELECT artifact_id, revision_id, kind, mime_type, byte_size, file_path, width, height,
         generator_version, artifact_role, generator_id, settings_hash, artifact_key,
         status, error_code, generated_at, invalidated_at, duration_ms,
         dominant_hue, dominant_lightness
    FROM keyed;
  DROP TABLE revision_artifacts;
  ALTER TABLE revision_artifacts_v44 RENAME TO revision_artifacts;
  CREATE UNIQUE INDEX revision_artifacts_current
    ON revision_artifacts(revision_id, artifact_key)
    WHERE invalidated_at IS NULL AND artifact_key IS NOT NULL;
  CREATE INDEX revision_artifacts_duration_idx
    ON revision_artifacts(duration_ms)
    WHERE kind = 'extracted_metadata' AND status = 'ready' AND invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_palette_sort_idx
    ON revision_artifacts(dominant_hue, dominant_lightness)
    WHERE kind = 'extracted_palette' AND status = 'ready' AND invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_revision_kind_status
    ON revision_artifacts(revision_id, kind, status, invalidated_at);
  CREATE INDEX revision_artifacts_identity_idx
    ON revision_artifacts(revision_id, artifact_role, generator_id, settings_hash, invalidated_at);
  CREATE TRIGGER revision_artifacts_identity_after_insert
    AFTER INSERT ON revision_artifacts
    WHEN NEW.artifact_key IS NULL
  BEGIN
    UPDATE revision_artifacts
       SET artifact_role = ${artifactRoleSql('NEW.kind')},
           generator_id = ${artifactGeneratorIdSql('NEW.generator_version')},
           settings_hash = ${artifactSettingsHashSql('NEW.generator_version')},
           artifact_key = ${artifactKeySql({
             assetColumn: '(SELECT asset_id FROM revisions WHERE revision_id = NEW.revision_id)',
             revisionColumn: 'NEW.revision_id',
             roleColumn: artifactRoleSql('NEW.kind'),
             generatorIdColumn: artifactGeneratorIdSql('NEW.generator_version'),
             generatorVersionColumn: 'NEW.generator_version',
             settingsHashColumn: artifactSettingsHashSql('NEW.generator_version'),
           })}
     WHERE artifact_id = NEW.artifact_id
       AND artifact_key IS NULL;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_insert AFTER INSERT ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_update AFTER UPDATE ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_delete AFTER DELETE ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
`;

export const ARTIFACT_IDENTITY_SCHEMA_CHECKSUM = createHash('sha256')
  .update(ARTIFACT_IDENTITY_SCHEMA_SQL)
  .digest('hex');

/**
 * Migration v45: separate browse invalidation from volatile job/artifact
 * writes. Thumbnail progress and artifact commits update the broad library
 * sequence, but they do not change BrowseSession membership or ordering. A
 * BrowseSession must remain usable while those background writes continue;
 * only tables that can change scope, filters, sort keys, or folder/collection
 * membership advance this narrower sequence.
 */
export const BROWSE_CHANGE_SEQUENCE_TABLES = [
  'assets',
  'revisions',
  'managed_folders',
  'linked_folders',
  'linked_ignored_assets',
  'linked_folder_rules',
  'asset_metadata',
  'asset_color_space_overrides',
  'tags',
  'human_asset_tags',
  'ai_asset_tags',
  'collections',
  'collection_assets',
  'smart_collections',
  'ai_content',
  'trashed_managed_folders',
] as const;

export const BROWSE_CHANGE_SEQUENCE_TRIGGER_SQL = BROWSE_CHANGE_SEQUENCE_TABLES
  .flatMap((table) => [
    `CREATE TRIGGER IF NOT EXISTS browse_change_on_${table}_insert AFTER INSERT ON ${table} BEGIN
       UPDATE browse_change_sequence SET sequence = sequence + 1;
     END;`,
    `CREATE TRIGGER IF NOT EXISTS browse_change_on_${table}_update AFTER UPDATE ON ${table} BEGIN
       UPDATE browse_change_sequence SET sequence = sequence + 1;
     END;`,
    `CREATE TRIGGER IF NOT EXISTS browse_change_on_${table}_delete AFTER DELETE ON ${table} BEGIN
       UPDATE browse_change_sequence SET sequence = sequence + 1;
     END;`,
  ])
  .join('\n  ');

export const BROWSE_CHANGE_SEQUENCE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS browse_change_sequence (
    library_id TEXT PRIMARY KEY REFERENCES library(library_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence >= 0)
  );
  INSERT OR IGNORE INTO browse_change_sequence (library_id, sequence)
    SELECT library_id, 0 FROM library;
  CREATE TRIGGER IF NOT EXISTS browse_change_sequence_seed AFTER INSERT ON library BEGIN
    INSERT OR IGNORE INTO browse_change_sequence (library_id, sequence)
      VALUES (NEW.library_id, 0);
  END;
  ${BROWSE_CHANGE_SEQUENCE_TRIGGER_SQL}
`;

export const BROWSE_CHANGE_SEQUENCE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(BROWSE_CHANGE_SEQUENCE_SCHEMA_SQL)
  .digest('hex');

// Migration v46: ignored-path materialization changes the visible browse
// result, but the two tables are intentionally separate from the v45 core
// table list so the released v45 checksum remains immutable.
export const BROWSE_IGNORE_RULE_SEQUENCE_SCHEMA_SQL = `
  CREATE TRIGGER IF NOT EXISTS browse_change_on_explicit_ignored_paths_insert
    AFTER INSERT ON explicit_ignored_paths BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER IF NOT EXISTS browse_change_on_explicit_ignored_paths_update
    AFTER UPDATE ON explicit_ignored_paths BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER IF NOT EXISTS browse_change_on_explicit_ignored_paths_delete
    AFTER DELETE ON explicit_ignored_paths BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER IF NOT EXISTS browse_change_on_gitignore_ignored_paths_insert
    AFTER INSERT ON gitignore_ignored_paths BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER IF NOT EXISTS browse_change_on_gitignore_ignored_paths_update
    AFTER UPDATE ON gitignore_ignored_paths BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER IF NOT EXISTS browse_change_on_gitignore_ignored_paths_delete
    AFTER DELETE ON gitignore_ignored_paths BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
`;

export const BROWSE_IGNORE_RULE_SEQUENCE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(BROWSE_IGNORE_RULE_SEQUENCE_SCHEMA_SQL)
  .digest('hex');

// Migration v47: sequence frame rows decide whether a source asset is a
// visible browse item. Keep those changes on the same narrow cursor so the
// catalog allowlist can safely serve the default browse query from a snapshot.
export const BROWSE_SEQUENCE_FRAME_SCHEMA_SQL = `
  CREATE TRIGGER IF NOT EXISTS browse_change_on_asset_sequence_frames_insert
    AFTER INSERT ON asset_sequence_frames BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER IF NOT EXISTS browse_change_on_asset_sequence_frames_update
    AFTER UPDATE ON asset_sequence_frames BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER IF NOT EXISTS browse_change_on_asset_sequence_frames_delete
    AFTER DELETE ON asset_sequence_frames BEGIN
      UPDATE browse_change_sequence SET sequence = sequence + 1;
    END;
`;

export const BROWSE_SEQUENCE_FRAME_SCHEMA_CHECKSUM = createHash('sha256')
  .update(BROWSE_SEQUENCE_FRAME_SCHEMA_SQL)
  .digest('hex');

// Migration v48: retain the source filesystem identity for linked assets.
// Relative paths are presentation/index keys, not source identity: an
// in-root rename keeps the same device/inode while changing the path. Keeping
// these values on the asset row lets watcher reconciliation repair that move
// without hashing every file in a large linked folder.
export const LINKED_SOURCE_IDENTITY_SCHEMA_SQL = `
  ALTER TABLE assets ADD COLUMN source_device TEXT;
  ALTER TABLE assets ADD COLUMN source_inode TEXT;
  CREATE INDEX assets_source_identity_idx
    ON assets(location_kind, linked_folder_id, source_device, source_inode)
    WHERE deleted_at IS NULL;
`;

export const LINKED_SOURCE_IDENTITY_SCHEMA_CHECKSUM = createHash('sha256')
  .update(LINKED_SOURCE_IDENTITY_SCHEMA_SQL)
  .digest('hex');

// Migration v49: a linked root can be attached under a managed
// folder ("导入链接文件夹" from the folder context menu). Deliberately no
// REFERENCES clause: trashing a managed folder DELETEs its managed_folders row,
// and a cascading SET NULL would silently reset the nesting — the id is kept so
// a restore re-nests the link, while the renderer falls back to showing the
// link at the library root whenever the parent is not visible.
export const LINKED_FOLDER_PARENT_SCHEMA_SQL = `
  ALTER TABLE linked_folders ADD COLUMN parent_folder_id TEXT;
`;

export const LINKED_FOLDER_PARENT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(LINKED_FOLDER_PARENT_SCHEMA_SQL)
  .digest('hex');

// Migration v50: the recent media-job list is ordered by
// created_at/job_id for one library. The status/priority index cannot satisfy
// that order, so a task-panel refresh otherwise sorts the full history before
// applying its 500-row limit.
export const JOB_RECENT_LIST_INDEX_SCHEMA_SQL = `
  CREATE INDEX IF NOT EXISTS jobs_library_created_desc
    ON jobs(library_id, created_at DESC, job_id DESC);
`;

export const JOB_RECENT_LIST_INDEX_SCHEMA_CHECKSUM = createHash('sha256')
  .update(JOB_RECENT_LIST_INDEX_SCHEMA_SQL)
  .digest('hex');

// Migration v51: persist the bounded RAW metadata admission
// cursor. The secondary pump is allowed to restart without losing the fact
// that a library was exhausted; the browse token fences the cursor against
// catalog and ignore-rule changes, while failed RAW retries use a separate
// bounded requeue path.
export const RAW_METADATA_BACKFILL_STATE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS raw_metadata_backfill_state (
    library_id TEXT PRIMARY KEY REFERENCES library(library_id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    cursor_asset_id TEXT,
    exhausted INTEGER NOT NULL DEFAULT 0 CHECK(exhausted IN (0, 1)),
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS raw_metadata_backfill_state_token
    ON raw_metadata_backfill_state(library_id, token, exhausted, cursor_asset_id);
`;

export const RAW_METADATA_BACKFILL_STATE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(RAW_METADATA_BACKFILL_STATE_SCHEMA_SQL)
  .digest('hex');

export const RAW_METADATA_BACKFILL_STATE_COLUMNS = [
  'token',
  'cursor_asset_id',
  'exhausted',
  'updated_at',
] as const;

export function hasRawMetadataBackfillStateSchema(connection: DatabaseConnection): boolean {
  const columns = columnsFor(connection, 'raw_metadata_backfill_state');
  return RAW_METADATA_BACKFILL_STATE_COLUMNS.every((column) => columns.has(column));
}

// Migration v52: the retry-only admission path must inspect
// only due RAW failures rather than walking the general job history.
export const RAW_METADATA_RETRY_INDEX_SCHEMA_SQL = `
  CREATE INDEX IF NOT EXISTS jobs_raw_metadata_retry
    ON jobs(library_id, updated_at, job_id)
    WHERE kind = 'extract_metadata'
      AND status = 'failed'
      AND error_code = 'RAW_METADATA_EXTRACTION_FAILED';
`;

export const RAW_METADATA_RETRY_INDEX_SCHEMA_CHECKSUM = createHash('sha256')
  .update(RAW_METADATA_RETRY_INDEX_SCHEMA_SQL)
  .digest('hex');

export const MEDIA_JOB_STATUS_COUNT_KINDS_SQL = `'generate_thumbnail', 'generate_video_poster', 'extract_metadata', 'generate_contact_sheet', 'generate_webm_proxy', 'generate_audio_proxy', 'extract_palette'`;

export const MEDIA_JOB_STATUS_COUNT_STATUSES_SQL = `'queued', 'running', 'succeeded', 'failed', 'paused', 'cancelled'`;

// Migration v53: media job status counts are maintained in the
// same transaction as jobs writes. Panel/status reads then become a 6-row
// primary-key lookup instead of GROUP BY over the whole job history.
export const MEDIA_JOB_STATUS_COUNTS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS media_job_status_counts (
    library_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN (${MEDIA_JOB_STATUS_COUNT_STATUSES_SQL})),
    count INTEGER NOT NULL CHECK(count >= 0),
    PRIMARY KEY (library_id, status)
  );
  INSERT OR IGNORE INTO media_job_status_counts (library_id, status, count)
  SELECT library_id, status, COUNT(*)
    FROM jobs
   WHERE kind IN (${MEDIA_JOB_STATUS_COUNT_KINDS_SQL})
     AND status IN (${MEDIA_JOB_STATUS_COUNT_STATUSES_SQL})
     AND (error_code IS NULL OR error_code <> 'ASSET_IGNORED')
   GROUP BY library_id, status;
  CREATE TRIGGER IF NOT EXISTS media_job_status_counts_ai
  AFTER INSERT ON jobs
  WHEN NEW.kind IN (${MEDIA_JOB_STATUS_COUNT_KINDS_SQL})
   AND NEW.status IN (${MEDIA_JOB_STATUS_COUNT_STATUSES_SQL})
   AND (NEW.error_code IS NULL OR NEW.error_code <> 'ASSET_IGNORED')
  BEGIN
    INSERT INTO media_job_status_counts(library_id, status, count)
    VALUES (NEW.library_id, NEW.status, 1)
    ON CONFLICT(library_id, status) DO UPDATE SET count = count + 1;
  END;
  CREATE TRIGGER IF NOT EXISTS media_job_status_counts_ad
  AFTER DELETE ON jobs
  WHEN OLD.kind IN (${MEDIA_JOB_STATUS_COUNT_KINDS_SQL})
   AND OLD.status IN (${MEDIA_JOB_STATUS_COUNT_STATUSES_SQL})
   AND (OLD.error_code IS NULL OR OLD.error_code <> 'ASSET_IGNORED')
  BEGIN
    UPDATE media_job_status_counts
       SET count = MAX(0, count - 1)
     WHERE library_id = OLD.library_id AND status = OLD.status;
  END;
  CREATE TRIGGER IF NOT EXISTS media_job_status_counts_au
  AFTER UPDATE OF status, kind, error_code, library_id ON jobs
  BEGIN
    UPDATE media_job_status_counts
       SET count = MAX(0, count - 1)
     WHERE OLD.kind IN (${MEDIA_JOB_STATUS_COUNT_KINDS_SQL})
       AND OLD.status IN (${MEDIA_JOB_STATUS_COUNT_STATUSES_SQL})
       AND (OLD.error_code IS NULL OR OLD.error_code <> 'ASSET_IGNORED')
       AND library_id = OLD.library_id
       AND status = OLD.status
       AND (
         NEW.kind NOT IN (${MEDIA_JOB_STATUS_COUNT_KINDS_SQL})
         OR NEW.status NOT IN (${MEDIA_JOB_STATUS_COUNT_STATUSES_SQL})
         OR (NEW.error_code IS NOT NULL AND NEW.error_code = 'ASSET_IGNORED')
         OR NEW.library_id <> OLD.library_id
         OR NEW.status <> OLD.status
         OR NEW.kind <> OLD.kind
       );
    INSERT INTO media_job_status_counts(library_id, status, count)
    SELECT NEW.library_id, NEW.status, 1
     WHERE NEW.kind IN (${MEDIA_JOB_STATUS_COUNT_KINDS_SQL})
       AND NEW.status IN (${MEDIA_JOB_STATUS_COUNT_STATUSES_SQL})
       AND (NEW.error_code IS NULL OR NEW.error_code <> 'ASSET_IGNORED')
       AND (
         OLD.kind NOT IN (${MEDIA_JOB_STATUS_COUNT_KINDS_SQL})
         OR OLD.status NOT IN (${MEDIA_JOB_STATUS_COUNT_STATUSES_SQL})
         OR (OLD.error_code IS NOT NULL AND OLD.error_code = 'ASSET_IGNORED')
         OR NEW.library_id <> OLD.library_id
         OR NEW.status <> OLD.status
         OR NEW.kind <> OLD.kind
       )
    ON CONFLICT(library_id, status) DO UPDATE SET count = count + 1;
  END;
`;

export const MEDIA_JOB_STATUS_COUNTS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(MEDIA_JOB_STATUS_COUNTS_SCHEMA_SQL)
  .digest('hex');

// Migration v54: persist a normalized filename extension so
// RAW metadata admission can use an equality/IN predicate plus a covering
// index instead of LOWER(relative_file_path) LIKE '%suffix' over the catalog.
export const ASSET_NORMALIZED_EXTENSION_EXPR = `CASE
    WHEN instr(relative_file_path, '.') = 0 THEN NULL
    ELSE lower('.' || replace(relative_file_path, rtrim(relative_file_path, replace(relative_file_path, '.', '')), ''))
  END`;

export const ASSET_NORMALIZED_EXTENSION_NEW_EXPR = `CASE
    WHEN instr(NEW.relative_file_path, '.') = 0 THEN NULL
    ELSE lower('.' || replace(NEW.relative_file_path, rtrim(NEW.relative_file_path, replace(NEW.relative_file_path, '.', '')), ''))
  END`;

export const ASSET_NORMALIZED_EXTENSION_SCHEMA_SQL = `
  ALTER TABLE assets ADD COLUMN normalized_extension TEXT;
  UPDATE assets SET normalized_extension = ${ASSET_NORMALIZED_EXTENSION_EXPR};
  CREATE INDEX IF NOT EXISTS assets_normalized_extension_asset
    ON assets(normalized_extension, asset_id)
    WHERE availability = 'available' AND current_revision_id IS NOT NULL AND deleted_at IS NULL;
  CREATE TRIGGER IF NOT EXISTS assets_normalized_extension_ai
  AFTER INSERT ON assets
  BEGIN
    UPDATE assets
       SET normalized_extension = ${ASSET_NORMALIZED_EXTENSION_NEW_EXPR}
     WHERE asset_id = NEW.asset_id;
  END;
  CREATE TRIGGER IF NOT EXISTS assets_normalized_extension_au
  AFTER UPDATE OF relative_file_path ON assets
  BEGIN
    UPDATE assets
       SET normalized_extension = ${ASSET_NORMALIZED_EXTENSION_NEW_EXPR}
     WHERE asset_id = NEW.asset_id;
  END;
`;

export const ASSET_NORMALIZED_EXTENSION_SCHEMA_CHECKSUM = createHash('sha256')
  .update(ASSET_NORMALIZED_EXTENSION_SCHEMA_SQL)
  .digest('hex');

export const ENTITY_APPEARANCE_SCHEMA_SQL = `
  ALTER TABLE managed_folders ADD COLUMN appearance_glyph_kind TEXT;
  ALTER TABLE managed_folders ADD COLUMN appearance_glyph_value TEXT;
  ALTER TABLE managed_folders ADD COLUMN appearance_color_id TEXT;
  ALTER TABLE linked_folders ADD COLUMN appearance_glyph_kind TEXT;
  ALTER TABLE linked_folders ADD COLUMN appearance_glyph_value TEXT;
  ALTER TABLE linked_folders ADD COLUMN appearance_color_id TEXT;
  ALTER TABLE collections ADD COLUMN appearance_glyph_kind TEXT;
  ALTER TABLE collections ADD COLUMN appearance_glyph_value TEXT;
  ALTER TABLE collections ADD COLUMN appearance_color_id TEXT;
  ALTER TABLE smart_collections ADD COLUMN appearance_glyph_kind TEXT;
  ALTER TABLE smart_collections ADD COLUMN appearance_glyph_value TEXT;
  ALTER TABLE smart_collections ADD COLUMN appearance_color_id TEXT;
`;

export const ENTITY_APPEARANCE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(ENTITY_APPEARANCE_SCHEMA_SQL)
  .digest('hex');

export const PALETTE_SATURATION_SCHEMA_SQL = `
  ALTER TABLE revision_artifacts ADD COLUMN dominant_saturation REAL
    CHECK (dominant_saturation IS NULL OR (dominant_saturation >= 0 AND dominant_saturation <= 1));
`;

export const PALETTE_SATURATION_SCHEMA_CHECKSUM = createHash('sha256')
  .update(PALETTE_SATURATION_SCHEMA_SQL)
  .digest('hex');

export const FOLDER_CUSTOM_COVER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS folder_custom_covers (
    library_id TEXT NOT NULL,
    folder_key TEXT NOT NULL,
    relative_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (library_id, folder_key)
  );
`;

export const FOLDER_CUSTOM_COVER_SCHEMA_CHECKSUM = createHash('sha256')
  .update(FOLDER_CUSTOM_COVER_SCHEMA_SQL)
  .digest('hex');

export const FOLDER_CUSTOM_COVER_ASSET_SCHEMA_SQL = `
  ALTER TABLE folder_custom_covers ADD COLUMN cover_asset_id TEXT;
`;

export const FOLDER_CUSTOM_COVER_ASSET_SCHEMA_CHECKSUM = createHash('sha256')
  .update(FOLDER_CUSTOM_COVER_ASSET_SCHEMA_SQL)
  .digest('hex');

export const REVISION_SIZE_FINGERPRINT_INDEX_SCHEMA_SQL = `
  CREATE INDEX revisions_size_fingerprint_idx
    ON revisions(byte_size, content_fingerprint);
`;

export const REVISION_SIZE_FINGERPRINT_INDEX_SCHEMA_CHECKSUM = createHash('sha256')
  .update(REVISION_SIZE_FINGERPRINT_INDEX_SCHEMA_SQL)
  .digest('hex');

export const ENTITY_APPEARANCE_TABLES = [
  'managed_folders',
  'linked_folders',
  'collections',
  'smart_collections',
] as const;

export const ENTITY_APPEARANCE_COLUMNS = [
  'appearance_glyph_kind',
  'appearance_glyph_value',
  'appearance_color_id',
] as const;

export function ensureEntityAppearanceSchema(connection: DatabaseConnection): void {
  for (const table of ENTITY_APPEARANCE_TABLES) {
    if (!hasTable(connection, table)) continue;
    const columns = new Set(columnsFor(connection, table));
    for (const column of ENTITY_APPEARANCE_COLUMNS) {
      if (columns.has(column)) continue;
      connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  }
}

export function ensureFolderCustomCoverAssetSchema(connection: DatabaseConnection): void {
  const columns = connection.pragma('table_info(folder_custom_covers)') as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'cover_asset_id')) {
    connection.exec(FOLDER_CUSTOM_COVER_ASSET_SCHEMA_SQL);
  }
}

export function ensureAssetNormalizedExtensionSchema(connection: DatabaseConnection): void {
  const columns = columnsFor(connection, 'assets');
  if (!columns.has('normalized_extension')) {
    connection.exec('ALTER TABLE assets ADD COLUMN normalized_extension TEXT');
  }
  connection.exec(`
    UPDATE assets
       SET normalized_extension = ${ASSET_NORMALIZED_EXTENSION_EXPR}
     WHERE normalized_extension IS NULL AND instr(relative_file_path, '.') > 0;
    CREATE INDEX IF NOT EXISTS assets_normalized_extension_asset
      ON assets(normalized_extension, asset_id)
      WHERE availability = 'available' AND current_revision_id IS NOT NULL AND deleted_at IS NULL;
    CREATE TRIGGER IF NOT EXISTS assets_normalized_extension_ai
    AFTER INSERT ON assets
    BEGIN
      UPDATE assets
         SET normalized_extension = ${ASSET_NORMALIZED_EXTENSION_NEW_EXPR}
       WHERE asset_id = NEW.asset_id;
    END;
    CREATE TRIGGER IF NOT EXISTS assets_normalized_extension_au
    AFTER UPDATE OF relative_file_path ON assets
    BEGIN
      UPDATE assets
         SET normalized_extension = ${ASSET_NORMALIZED_EXTENSION_NEW_EXPR}
       WHERE asset_id = NEW.asset_id;
    END;
  `);
}

export function rawImageExtensionMatchSql(
  connection: DatabaseConnection,
  alias: string,
): { sql: string; params: readonly string[] } {
  if (columnsFor(connection, 'assets').has('normalized_extension')) {
    return {
      sql: `${alias}.normalized_extension IN (${RAW_IMAGE_EXTENSIONS.map(() => '?').join(',')})`,
      params: RAW_IMAGE_EXTENSIONS,
    };
  }
  return {
    sql: `(${RAW_IMAGE_EXTENSIONS.map(() => `LOWER(${alias}.relative_file_path) LIKE ?`).join(' OR ')})`,
    params: RAW_IMAGE_EXTENSIONS.map((extension) => `%${extension}`),
  };
}

export function embeddedImageMetadataExtensionMatchSql(
  connection: DatabaseConnection,
  alias: string,
): { sql: string; params: readonly string[] } {
  if (columnsFor(connection, 'assets').has('normalized_extension')) {
    return {
      sql: `${alias}.normalized_extension IN (${EMBEDDED_IMAGE_METADATA_EXTENSIONS.map(() => '?').join(',')})`,
      params: EMBEDDED_IMAGE_METADATA_EXTENSIONS,
    };
  }
  return {
    sql: `(${EMBEDDED_IMAGE_METADATA_EXTENSIONS.map(() => `LOWER(${alias}.relative_file_path) LIKE ?`).join(' OR ')})`,
    params: EMBEDDED_IMAGE_METADATA_EXTENSIONS.map((extension) => `%${extension}`),
  };
}

export function ensureLinkedFolderParentSchema(connection: DatabaseConnection): void {
  const columns = columnsFor(connection, 'linked_folders');
  if (!columns.has('parent_folder_id')) {
    connection.exec('ALTER TABLE linked_folders ADD COLUMN parent_folder_id TEXT');
  }
}

export function ensureLinkedSourceIdentitySchema(connection: DatabaseConnection): void {
  const columns = columnsFor(connection, 'assets');
  if (!columns.has('source_device')) {
    connection.exec('ALTER TABLE assets ADD COLUMN source_device TEXT');
  }
  if (!columns.has('source_inode')) {
    connection.exec('ALTER TABLE assets ADD COLUMN source_inode TEXT');
  }
  connection.exec(`
    CREATE INDEX IF NOT EXISTS assets_source_identity_idx
      ON assets(location_kind, linked_folder_id, source_device, source_inode)
      WHERE deleted_at IS NULL;
  `);
}

// Migration v26: the thumbnail queue asks whether a job already exists for a
// revision. Without a matching index, opening a large library performs a
// quadratic NOT EXISTS scan over the jobs table before the visible batch is
// queued.
export const THUMBNAIL_QUEUE_INDEX_SCHEMA_SQL = `
  CREATE INDEX IF NOT EXISTS jobs_asset_kind_status
    ON jobs(asset_id, kind, status);
  CREATE INDEX IF NOT EXISTS revision_artifacts_revision_kind_status
    ON revision_artifacts(revision_id, kind, status, invalidated_at);
`;

export const THUMBNAIL_QUEUE_INDEX_SCHEMA_CHECKSUM = createHash('sha256')
  .update(THUMBNAIL_QUEUE_INDEX_SCHEMA_SQL)
  .digest('hex');

/**
 * Migration v27: plugin background jobs reuse the shared jobs table with a
 * dedicated kind plus owner/version/handler/payload columns for §9.4.
 */
export const PLUGIN_BACKGROUND_JOBS_SCHEMA_SQL = `
  CREATE TABLE jobs_v27 (
    job_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    asset_id TEXT REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('generate_thumbnail', 'generate_video_poster',
               'generate_contact_sheet', 'generate_webm_proxy', 'generate_audio_proxy',
               'extract_metadata', 'extract_palette',
               'ai.image.analysis', 'ai.video.analysis',
               'plugin.background')
    ),
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')
    ),
    priority INTEGER NOT NULL DEFAULT 0,
    progress REAL DEFAULT 0.0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    owner_plugin_id TEXT,
    owner_package_hash TEXT,
    plugin_handler_id TEXT,
    payload_json TEXT,
    recovery_strategy TEXT CHECK (
      recovery_strategy IS NULL
      OR recovery_strategy IN ('idempotent', 'checkpoint')
    )
  );
  INSERT INTO jobs_v27 (
    job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
    attempt_count, error_code, error_detail, created_at, updated_at,
    owner_plugin_id, owner_package_hash, plugin_handler_id, payload_json, recovery_strategy
  )
  SELECT
    job_id, library_id, asset_id, revision_id, kind, status, priority, progress,
    attempt_count, error_code, error_detail, created_at, updated_at,
    NULL, NULL, NULL, NULL, NULL
  FROM jobs;
  DROP TABLE jobs;
  ALTER TABLE jobs_v27 RENAME TO jobs;
  CREATE INDEX jobs_library_status_priority
    ON jobs(library_id, status, priority DESC, created_at);
  CREATE INDEX IF NOT EXISTS jobs_asset_kind_status
    ON jobs(asset_id, kind, status);
  CREATE INDEX IF NOT EXISTS jobs_plugin_owner_status
    ON jobs(library_id, owner_plugin_id, owner_package_hash, status)
    WHERE kind = 'plugin.background';
`;

export const PLUGIN_BACKGROUND_JOBS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(PLUGIN_BACKGROUND_JOBS_SCHEMA_SQL)
  .digest('hex');

/** Migration v32: interrupted plugin jobs are terminal and never auto-claimed. */
export const PLUGIN_JOB_INTERRUPTED_SCHEMA_SQL = `
  CREATE TABLE jobs_v32 (
    job_id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    asset_id TEXT REFERENCES assets(asset_id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(revision_id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (
      kind IN ('generate_thumbnail', 'generate_video_poster',
               'generate_contact_sheet', 'generate_webm_proxy', 'generate_audio_proxy',
               'extract_metadata', 'extract_palette',
               'ai.image.analysis', 'ai.video.analysis',
               'plugin.background')
    ),
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'interrupted')
    ),
    priority INTEGER NOT NULL DEFAULT 0,
    progress REAL DEFAULT 0.0,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    owner_plugin_id TEXT,
    owner_package_hash TEXT,
    plugin_handler_id TEXT,
    payload_json TEXT,
    recovery_strategy TEXT CHECK (
      recovery_strategy IS NULL
      OR recovery_strategy IN ('idempotent', 'checkpoint')
    )
  );
  INSERT INTO jobs_v32 SELECT * FROM jobs;
  DROP TABLE jobs;
  ALTER TABLE jobs_v32 RENAME TO jobs;
  CREATE INDEX jobs_library_status_priority
    ON jobs(library_id, status, priority DESC, created_at);
  CREATE INDEX IF NOT EXISTS jobs_asset_kind_status
    ON jobs(asset_id, kind, status);
  CREATE INDEX IF NOT EXISTS jobs_plugin_owner_status
    ON jobs(library_id, owner_plugin_id, owner_package_hash, status)
    WHERE kind = 'plugin.background';
  CREATE TRIGGER library_change_on_jobs_insert AFTER INSERT ON jobs BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_jobs_update AFTER UPDATE ON jobs BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_jobs_delete AFTER DELETE ON jobs BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
`;

export const PLUGIN_JOB_INTERRUPTED_SCHEMA_CHECKSUM = createHash('sha256')
  .update(PLUGIN_JOB_INTERRUPTED_SCHEMA_SQL)
  .digest('hex');

// Migration v33 (slice 0030-B): FBX conversion stores its GLB
// as a derived artifact (`kind = 'model_glb'`). The v21 rebuild of
// revision_artifacts pinned the kind CHECK to the media-artifact set, so the
// table is rebuilt again with the new kind. The rebuild must also recreate the
// change-sequence triggers (v27) and the thumbnail-queue index (v29), which
// DROP TABLE would otherwise remove.
export const MODEL_ARTIFACT_KIND_SCHEMA_SQL = `
  CREATE TABLE revision_artifacts_v33 (
    artifact_id TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (
      kind IN ('thumbnail', 'video_poster', 'contact_sheet', 'webm_proxy', 'audio_proxy',
               'extracted_metadata', 'extracted_palette', 'model_glb')
    ),
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    file_path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    generator_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'generating', 'ready', 'failed')
    ),
    error_code TEXT,
    generated_at TEXT,
    invalidated_at TEXT,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    dominant_hue REAL CHECK (dominant_hue IS NULL OR (dominant_hue >= 0 AND dominant_hue < 360)),
    dominant_lightness REAL CHECK (dominant_lightness IS NULL OR (dominant_lightness >= 0 AND dominant_lightness <= 1))
  );
  INSERT INTO revision_artifacts_v33
    (artifact_id, revision_id, kind, mime_type, byte_size, file_path, width, height,
     generator_version, status, error_code, generated_at, invalidated_at, duration_ms,
     dominant_hue, dominant_lightness)
    SELECT artifact_id, revision_id, kind, mime_type, byte_size, file_path, width, height,
           generator_version, status, error_code, generated_at, invalidated_at, duration_ms,
           dominant_hue, dominant_lightness
      FROM revision_artifacts;
  DROP TABLE revision_artifacts;
  ALTER TABLE revision_artifacts_v33 RENAME TO revision_artifacts;
  CREATE UNIQUE INDEX revision_artifacts_current
    ON revision_artifacts(revision_id, kind)
    WHERE invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_duration_idx
    ON revision_artifacts(duration_ms)
    WHERE kind = 'extracted_metadata' AND status = 'ready' AND invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_palette_sort_idx
    ON revision_artifacts(dominant_hue, dominant_lightness)
    WHERE kind = 'extracted_palette' AND status = 'ready' AND invalidated_at IS NULL;
  CREATE INDEX revision_artifacts_revision_kind_status
    ON revision_artifacts(revision_id, kind, status, invalidated_at);
  CREATE TRIGGER library_change_on_revision_artifacts_insert AFTER INSERT ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_update AFTER UPDATE ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER library_change_on_revision_artifacts_delete AFTER DELETE ON revision_artifacts BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
  END;
`;

export const MODEL_ARTIFACT_KIND_SCHEMA_CHECKSUM = createHash('sha256')
  .update(MODEL_ARTIFACT_KIND_SCHEMA_SQL)
  .digest('hex');

/**
 * Migration v34: content fingerprint for portable change detection.
 * A library copied to another platform rewrites every file mtime (zip
 * extraction), so mtime alone can no longer prove a revision unchanged.
 * `refreshManagedAssets` stores a SHA-1 of the file bytes on the current
 * revision; a NULL fingerprint means "never verified" and is backfilled on
 * the first mtime mismatch (treated as unchanged — see refreshManagedAssets).
 * Additive column only; satisfies the migrate-add-only discipline.
 */
export const CONTENT_FINGERPRINT_SCHEMA_SQL = `
  ALTER TABLE revisions ADD COLUMN content_fingerprint TEXT;
`;

export const CONTENT_FINGERPRINT_SCHEMA_CHECKSUM = createHash('sha256')
  .update(CONTENT_FINGERPRINT_SCHEMA_SQL)
  .digest('hex');

/**
 * Idempotent v34 apply: downgrade fixtures and re-run scenarios may already
 * carry the column, so the ALTER must be skipped instead of failing the
 * migration chain (same pattern as v20/v31 ensure functions).
 */
export function ensureContentFingerprintColumn(connection: DatabaseConnection): void {
  if (columnsFor(connection, 'revisions').has('content_fingerprint')) return;
  connection.exec(CONTENT_FINGERPRINT_SCHEMA_SQL);
}

/**
 * Migration v38 is additive, but a number of older downgrade/replay fixtures
 * retain the physical sync_id column while rewinding only user_version and
 * schema_migrations. Keep the canonical checksum while making the apply
 * operation idempotent for those valid legacy shapes.
 */
export function ensureSyncSchema(connection: DatabaseConnection): void {
  if (!columnsFor(connection, 'assets').has('sync_id')) {
    connection.exec('ALTER TABLE assets ADD COLUMN sync_id TEXT');
  }
  connection.exec(`
    CREATE INDEX IF NOT EXISTS assets_sync_id ON assets(sync_id);
    CREATE TABLE IF NOT EXISTS sync_manifest_cache (
      library_id TEXT NOT NULL PRIMARY KEY,
      manifest_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

/**
 * Migration v28: namespaced, package-versioned materialized Provider fields.
 * Queries only select the active package hash supplied by Main, so upgrading
 * or deactivating a plugin cannot expose stale values.
 */
export const PLUGIN_DERIVED_FIELDS_SCHEMA_SQL = `
  CREATE TABLE plugin_derived_fields (
    library_id TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL,
    package_hash TEXT NOT NULL,
    field_id TEXT NOT NULL,
    field_type TEXT NOT NULL CHECK (field_type IN ('string', 'number', 'boolean', 'date', 'json')),
    value_text TEXT,
    value_number REAL,
    value_boolean INTEGER CHECK (value_boolean IS NULL OR value_boolean IN (0, 1)),
    value_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (library_id, asset_id, plugin_id, package_hash, field_id)
  );
  CREATE INDEX plugin_derived_fields_lookup
    ON plugin_derived_fields(library_id, plugin_id, package_hash, field_id, asset_id);
`;

export const PLUGIN_DERIVED_FIELDS_SCHEMA_CHECKSUM = createHash('sha256')
  .update(PLUGIN_DERIVED_FIELDS_SCHEMA_SQL)
  .digest('hex');

// Migration v24: explicit user ignore entries.  Paths are
// relative to the managed Assets root or a linked-folder root.  A folder entry
// hides the folder and every descendant without deleting the indexed rows, so
// unignore can restore the view when the source is still present.
export const EXPLICIT_IGNORES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS explicit_ignored_paths (
    location_kind TEXT NOT NULL CHECK (location_kind IN ('managed', 'linked')),
    -- Empty string identifies the managed Assets root; linked folder ids are
    -- validated by the Worker before writes (the column intentionally is not
    -- a foreign key because managed rows use the empty-string sentinel).
    linked_folder_id TEXT NOT NULL DEFAULT '',
    relative_path TEXT NOT NULL,
    path_kind TEXT NOT NULL CHECK (path_kind IN ('asset', 'folder')),
    ignored_at TEXT NOT NULL,
    PRIMARY KEY(location_kind, linked_folder_id, relative_path, path_kind),
    CHECK (location_kind = 'linked' OR linked_folder_id = '')
  );
  CREATE INDEX IF NOT EXISTS explicit_ignored_paths_lookup
    ON explicit_ignored_paths(location_kind, linked_folder_id, relative_path, path_kind);
`;

export const EXPLICIT_IGNORES_SCHEMA_CHECKSUM = createHash('sha256')
  .update(EXPLICIT_IGNORES_SCHEMA_SQL)
  .digest('hex');

// Migration v25: extension ignores are library-scoped rules that hide every
// asset whose filename ends in the selected extension.  The v24 CHECK
// constraint only allowed asset/folder rows, so rebuild the small table while
// preserving existing entries.
export const EXTENSION_IGNORES_SCHEMA_SQL = `
  CREATE TABLE explicit_ignored_paths_v25 (
    location_kind TEXT NOT NULL CHECK (location_kind IN ('managed', 'linked')),
    linked_folder_id TEXT NOT NULL DEFAULT '',
    relative_path TEXT NOT NULL,
    path_kind TEXT NOT NULL CHECK (path_kind IN ('asset', 'folder', 'extension')),
    ignored_at TEXT NOT NULL,
    PRIMARY KEY(location_kind, linked_folder_id, relative_path, path_kind),
    CHECK (location_kind = 'linked' OR linked_folder_id = '')
  );
  INSERT INTO explicit_ignored_paths_v25
    (location_kind, linked_folder_id, relative_path, path_kind, ignored_at)
  SELECT location_kind, linked_folder_id, relative_path, path_kind, ignored_at
    FROM explicit_ignored_paths;
  DROP TABLE explicit_ignored_paths;
  ALTER TABLE explicit_ignored_paths_v25 RENAME TO explicit_ignored_paths;
  CREATE INDEX explicit_ignored_paths_lookup
    ON explicit_ignored_paths(location_kind, linked_folder_id, relative_path, path_kind);
`;

export const EXTENSION_IGNORES_SCHEMA_CHECKSUM = createHash('sha256')
  .update(EXTENSION_IGNORES_SCHEMA_SQL)
  .digest('hex');

// Migration v26: the editable library-level .keelignore is materialized into
// the database so every browse/search/count query can apply the same rules
// without making SQLite call back into the filesystem. The text file remains
// the source of truth; this table is rebuilt whenever its contents change.
export const GITIGNORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS gitignore_ignored_paths (
    relative_path TEXT NOT NULL,
    path_kind TEXT NOT NULL CHECK (path_kind IN ('asset', 'folder')),
    PRIMARY KEY(relative_path, path_kind)
  );
  CREATE INDEX IF NOT EXISTS gitignore_ignored_paths_lookup
    ON gitignore_ignored_paths(relative_path, path_kind);
`;

export const GITIGNORE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(GITIGNORE_SCHEMA_SQL)
  .digest('hex');

// Migration v35 (ADR-0032): one durable, per-library
// operation history shared by Desktop, scripts, MCP and plugins. The payloads
// are typed recipe JSON owned by the Worker; they are never exposed through
// the renderer or automation protocol as executable recovery instructions.
export const OPERATION_HISTORY_SCHEMA_SQL = `
  CREATE TABLE operation_history (
    history_entry_id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('desktop', 'script', 'mcp', 'plugin')),
    source_reference TEXT,
    label_key TEXT NOT NULL,
    label_args_json TEXT NOT NULL,
    policy TEXT NOT NULL CHECK (policy IN ('reversible', 'barrier')),
    state TEXT NOT NULL CHECK (state IN ('open', 'applied', 'undoing', 'undone', 'redoing', 'stale')),
    applied_sequence INTEGER NOT NULL UNIQUE,
    stale_code TEXT,
    affected_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE operation_history_steps (
    history_step_id TEXT PRIMARY KEY,
    history_entry_id TEXT NOT NULL REFERENCES operation_history(history_entry_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    command_id TEXT NOT NULL,
    recipe_kind TEXT NOT NULL,
    recipe_version INTEGER NOT NULL CHECK (recipe_version > 0),
    forward_payload_json TEXT NOT NULL,
    inverse_payload_json TEXT NOT NULL,
    affected_entities_json TEXT NOT NULL,
    current_direction TEXT NOT NULL CHECK (current_direction IN ('forward', 'inverse')),
    UNIQUE(history_entry_id, ordinal)
  );

  CREATE TABLE operation_history_attempts (
    attempt_id TEXT PRIMARY KEY,
    history_entry_id TEXT NOT NULL REFERENCES operation_history(history_entry_id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('undo', 'redo')),
    status TEXT NOT NULL CHECK (status IN ('preparing', 'applying', 'committed', 'rolled_back', 'failed')),
    next_step_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (next_step_ordinal >= 0),
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX operation_history_state_sequence_idx
    ON operation_history(state, applied_sequence);
  CREATE INDEX operation_history_steps_entry_idx
    ON operation_history_steps(history_entry_id, ordinal);
  CREATE INDEX operation_history_attempts_entry_idx
    ON operation_history_attempts(history_entry_id, created_at);

  -- History is a user-visible projection.  Treat its append/state changes as
  -- ordinary library mutations so another open Worker refreshes menus and
  -- automation projections even when the underlying operation was performed
  -- by a different process.
  CREATE TRIGGER library_change_on_operation_history_insert
    AFTER INSERT ON operation_history BEGIN
      UPDATE library_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER library_change_on_operation_history_update
    AFTER UPDATE ON operation_history BEGIN
      UPDATE library_change_sequence SET sequence = sequence + 1;
    END;
  CREATE TRIGGER library_change_on_operation_history_delete
    AFTER DELETE ON operation_history BEGIN
      UPDATE library_change_sequence SET sequence = sequence + 1;
    END;
`;

export const OPERATION_HISTORY_SCHEMA_CHECKSUM = createHash('sha256')
  .update(OPERATION_HISTORY_SCHEMA_SQL)
  .digest('hex');

// Migration v36: redo is a LIFO stack. The original forward commit order is
// not enough to identify the next redo after undoing several entries, so keep
// a durable sequence assigned when each undo commits.
export const OPERATION_HISTORY_REDO_STACK_SCHEMA_SQL = `
  ALTER TABLE operation_history
    ADD COLUMN redo_sequence INTEGER NOT NULL DEFAULT 0;
  UPDATE operation_history
     SET redo_sequence = applied_sequence
   WHERE state = 'undone';
  CREATE INDEX operation_history_redo_sequence_idx
    ON operation_history(state, redo_sequence);
`;

export const OPERATION_HISTORY_REDO_STACK_SCHEMA_CHECKSUM = createHash('sha256')
  .update(OPERATION_HISTORY_REDO_STACK_SCHEMA_SQL)
  .digest('hex');

// Migration v37: keep the per-asset opt-out from import-triggered automatic
// AI durable. Preview generation remains enabled, while reopening a library
// cannot turn a previous Eagle import back into an AI enqueue.
export const AUTO_ANALYSIS_SUPPRESSION_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS asset_auto_analysis_suppression (
    asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (reason IN ('external-library-import')),
    created_at TEXT NOT NULL
  );
`;

export const AUTO_ANALYSIS_SUPPRESSION_SCHEMA_CHECKSUM = createHash('sha256')
  .update(AUTO_ANALYSIS_SUPPRESSION_SCHEMA_SQL)
  .digest('hex');

// Keep individual recipes bounded so a DB-only mutation cannot turn the
// library database into an unbounded snapshot store. Large-content/history
// operations remain a separate phase with explicit byte retention policy.
export const OPERATION_HISTORY_MAX_RECIPE_BYTES = 4 * 1024 * 1024;

export const OPERATION_HISTORY_MAX_AUDIT_ENTRIES = 2_000;

export const OPERATION_HISTORY_STALE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

// Exported for schema-compatibility tests that replay migrations
// version-by-version (/6).
export const TAG_HIERARCHY_SQL = `
  CREATE TABLE IF NOT EXISTS tag_hierarchy (
    tag_id TEXT PRIMARY KEY REFERENCES tags(tag_id) ON DELETE CASCADE,
    parent_tag_id TEXT REFERENCES tags(tag_id) ON DELETE SET NULL,
    CHECK (tag_id <> parent_tag_id)
  );
  CREATE INDEX IF NOT EXISTS tag_hierarchy_parent ON tag_hierarchy(parent_tag_id);
`;

export const TAG_APPEARANCE_SQL = `
  CREATE TABLE IF NOT EXISTS tag_appearance (
    tag_id TEXT PRIMARY KEY REFERENCES tags(tag_id) ON DELETE CASCADE,
    appearance_json TEXT NOT NULL
  );
`;

export const MIGRATIONS = [
  { version: 1, sql: INITIAL_SCHEMA_SQL, checksum: INITIAL_SCHEMA_CHECKSUM },
  { version: 2, sql: ASSET_SCHEMA_SQL, checksum: ASSET_SCHEMA_CHECKSUM },
  {
    version: 3,
    sql: PORTABLE_PATH_SCHEMA_BEFORE_BACKFILL_SQL,
    checksum: PORTABLE_PATH_SCHEMA_CHECKSUM,
  },
  { version: 4, sql: LINKED_FOLDERS_SCHEMA_SQL, checksum: LINKED_FOLDERS_SCHEMA_CHECKSUM },
  { version: 5, sql: ORGANIZATION_SCHEMA_SQL, checksum: ORGANIZATION_SCHEMA_CHECKSUM },
  { version: 6, sql: SEARCH_SCHEMA_SQL, checksum: SEARCH_SCHEMA_CHECKSUM },
  { version: 7, sql: TRASH_SCHEMA_SQL, checksum: TRASH_SCHEMA_CHECKSUM },
  { version: 8, sql: AI_CONTENT_SCHEMA_SQL, checksum: AI_CONTENT_SCHEMA_CHECKSUM },
  { version: 9, sql: THUMBNAIL_SCHEMA_SQL, checksum: THUMBNAIL_SCHEMA_CHECKSUM },
  { version: 10, sql: AI_JOBS_SCHEMA_SQL, checksum: AI_JOBS_SCHEMA_CHECKSUM },
  { version: 11, sql: MEDIA_DURATION_SCHEMA_SQL, checksum: MEDIA_DURATION_SCHEMA_CHECKSUM },
  { version: 12, sql: PALETTE_SORT_SCHEMA_SQL, checksum: PALETTE_SORT_SCHEMA_CHECKSUM },
  { version: 13, sql: LINKED_FOLDER_RULES_SCHEMA_SQL, checksum: LINKED_FOLDER_RULES_SCHEMA_CHECKSUM },
  { version: 14, sql: RETIRE_ASSET_LABEL_SCHEMA_SQL, checksum: RETIRE_ASSET_LABEL_SCHEMA_CHECKSUM },
  { version: 15, sql: AUTHOR_METADATA_SCHEMA_SQL, checksum: AUTHOR_METADATA_SCHEMA_CHECKSUM },
  { version: 16, sql: AI_RATING_CONTENT_SCHEMA_SQL, checksum: AI_RATING_CONTENT_SCHEMA_CHECKSUM },
  {
    version: 17,
    sql: TRASHED_MANAGED_FOLDERS_SCHEMA_SQL,
    checksum: TRASHED_MANAGED_FOLDERS_SCHEMA_CHECKSUM,
  },
  {
    version: 18,
    sql: CONTEXTUAL_SUBSTRING_SEARCH_SCHEMA_SQL,
    checksum: CONTEXTUAL_SUBSTRING_SEARCH_SCHEMA_CHECKSUM,
  },
  {
    version: 19,
    sql: AI_DESCRIPTION_SEARCH_BACKFILL_SCHEMA_SQL,
    checksum: AI_DESCRIPTION_SEARCH_BACKFILL_SCHEMA_CHECKSUM,
  },
  {
    version: 20,
    sql: TRASH_TOMBSTONE_ASSET_BIND_SCHEMA_SQL,
    checksum: TRASH_TOMBSTONE_ASSET_BIND_SCHEMA_CHECKSUM,
  },
  { version: 21, sql: MEDIA_PROXY_SCHEMA_SQL, checksum: MEDIA_PROXY_SCHEMA_CHECKSUM },
  { version: 22, sql: COLOR_SPACE_OVERRIDE_SCHEMA_SQL, checksum: COLOR_SPACE_OVERRIDE_SCHEMA_CHECKSUM },
  { version: 23, sql: IMAGE_SEQUENCE_SCHEMA_SQL, checksum: IMAGE_SEQUENCE_SCHEMA_CHECKSUM },
  { version: 24, sql: EXPLICIT_IGNORES_SCHEMA_SQL, checksum: EXPLICIT_IGNORES_SCHEMA_CHECKSUM },
  { version: 25, sql: EXTENSION_IGNORES_SCHEMA_SQL, checksum: EXTENSION_IGNORES_SCHEMA_CHECKSUM },
  { version: 26, sql: GITIGNORE_SCHEMA_SQL, checksum: GITIGNORE_SCHEMA_CHECKSUM },
  {
    version: 27,
    sql: WRITE_COORDINATION_SCHEMA_SQL,
    checksum: WRITE_COORDINATION_SCHEMA_CHECKSUM,
  },
  { version: 28, sql: JOB_LEASE_SCHEMA_SQL, checksum: JOB_LEASE_SCHEMA_CHECKSUM },
  {
    version: 29,
    sql: THUMBNAIL_QUEUE_INDEX_SCHEMA_SQL,
    checksum: THUMBNAIL_QUEUE_INDEX_SCHEMA_CHECKSUM,
  },
  {
    version: 30,
    sql: PLUGIN_BACKGROUND_JOBS_SCHEMA_SQL,
    checksum: PLUGIN_BACKGROUND_JOBS_SCHEMA_CHECKSUM,
  },
  {
    version: 31,
    sql: PLUGIN_DERIVED_FIELDS_SCHEMA_SQL,
    checksum: PLUGIN_DERIVED_FIELDS_SCHEMA_CHECKSUM,
  },
  {
    version: 32,
    sql: PLUGIN_JOB_INTERRUPTED_SCHEMA_SQL,
    checksum: PLUGIN_JOB_INTERRUPTED_SCHEMA_CHECKSUM,
  },
  {
    version: 33,
    sql: MODEL_ARTIFACT_KIND_SCHEMA_SQL,
    checksum: MODEL_ARTIFACT_KIND_SCHEMA_CHECKSUM,
  },
  {
    version: 34,
    sql: CONTENT_FINGERPRINT_SCHEMA_SQL,
    checksum: CONTENT_FINGERPRINT_SCHEMA_CHECKSUM,
  },
  {
    version: 35,
    sql: OPERATION_HISTORY_SCHEMA_SQL,
    checksum: OPERATION_HISTORY_SCHEMA_CHECKSUM,
  },
  {
    version: 36,
    sql: OPERATION_HISTORY_REDO_STACK_SCHEMA_SQL,
    checksum: OPERATION_HISTORY_REDO_STACK_SCHEMA_CHECKSUM,
  },
  // v37 was first consumed by real user data (auto-analysis suppression) before
  // the sync work landed; the sync migration therefore takes v38 to keep every
  // existing v37 library (whose schema_migrations row carries the suppression
  // checksum) openable without touching its history..
  // Libraries opened by the sync-first fork recorded the opposite assignment
  // (v37=SYNC, v38=AUTO). migrateForkedSyncAutoAnalysisMigrationHistory
  // rewrites only schema_migrations for that exact history.
  {
    version: 37,
    sql: AUTO_ANALYSIS_SUPPRESSION_SCHEMA_SQL,
    checksum: AUTO_ANALYSIS_SUPPRESSION_SCHEMA_CHECKSUM,
  },
  { version: 38, sql: SYNC_SCHEMA_SQL, checksum: SYNC_SCHEMA_CHECKSUM },
  { version: 39, sql: SYNC_SESSIONS_SCHEMA_SQL, checksum: SYNC_SESSIONS_SCHEMA_CHECKSUM },
  {
    version: 40,
    sql: ASSETS_ACTIVE_NAME_INDEX_SCHEMA_SQL,
    checksum: ASSETS_ACTIVE_NAME_INDEX_SCHEMA_CHECKSUM,
  },
  {
    version: 41,
    sql: ASSETS_ACTIVE_CREATED_DESC_INDEX_SCHEMA_SQL,
    checksum: ASSETS_ACTIVE_CREATED_DESC_INDEX_SCHEMA_CHECKSUM,
  },
  {
    version: 42,
    sql: TOMBSTONE_BACKFILL_INDEX_SCHEMA_SQL,
    checksum: TOMBSTONE_BACKFILL_INDEX_SCHEMA_CHECKSUM,
  },
  {
    version: 43,
    sql: RAW_VIEWER_ARTIFACT_SCHEMA_SQL,
    checksum: RAW_VIEWER_ARTIFACT_SCHEMA_CHECKSUM,
  },
  {
    version: 44,
    sql: ARTIFACT_IDENTITY_SCHEMA_SQL,
    checksum: ARTIFACT_IDENTITY_SCHEMA_CHECKSUM,
  },
  {
    version: 45,
    sql: BROWSE_CHANGE_SEQUENCE_SCHEMA_SQL,
    checksum: BROWSE_CHANGE_SEQUENCE_SCHEMA_CHECKSUM,
  },
  {
    version: 46,
    sql: BROWSE_IGNORE_RULE_SEQUENCE_SCHEMA_SQL,
    checksum: BROWSE_IGNORE_RULE_SEQUENCE_SCHEMA_CHECKSUM,
  },
  {
    version: 47,
    sql: BROWSE_SEQUENCE_FRAME_SCHEMA_SQL,
    checksum: BROWSE_SEQUENCE_FRAME_SCHEMA_CHECKSUM,
  },
  {
    version: 48,
    sql: LINKED_SOURCE_IDENTITY_SCHEMA_SQL,
    checksum: LINKED_SOURCE_IDENTITY_SCHEMA_CHECKSUM,
  },
  {
    version: 49,
    sql: LINKED_FOLDER_PARENT_SCHEMA_SQL,
    checksum: LINKED_FOLDER_PARENT_SCHEMA_CHECKSUM,
  },
  {
    version: 50,
    sql: JOB_RECENT_LIST_INDEX_SCHEMA_SQL,
    checksum: JOB_RECENT_LIST_INDEX_SCHEMA_CHECKSUM,
  },
  {
    version: 51,
    sql: RAW_METADATA_BACKFILL_STATE_SCHEMA_SQL,
    checksum: RAW_METADATA_BACKFILL_STATE_SCHEMA_CHECKSUM,
  },
  {
    version: 52,
    sql: RAW_METADATA_RETRY_INDEX_SCHEMA_SQL,
    checksum: RAW_METADATA_RETRY_INDEX_SCHEMA_CHECKSUM,
  },
  {
    version: 53,
    sql: MEDIA_JOB_STATUS_COUNTS_SCHEMA_SQL,
    checksum: MEDIA_JOB_STATUS_COUNTS_SCHEMA_CHECKSUM,
  },
  {
    version: 54,
    sql: ASSET_NORMALIZED_EXTENSION_SCHEMA_SQL,
    checksum: ASSET_NORMALIZED_EXTENSION_SCHEMA_CHECKSUM,
  },
  {
    version: 55,
    sql: ENTITY_APPEARANCE_SCHEMA_SQL,
    checksum: ENTITY_APPEARANCE_SCHEMA_CHECKSUM,
  },
  {
    version: 56,
    sql: PALETTE_SATURATION_SCHEMA_SQL,
    checksum: PALETTE_SATURATION_SCHEMA_CHECKSUM,
  },
  {
    version: 57,
    sql: FOLDER_CUSTOM_COVER_SCHEMA_SQL,
    checksum: FOLDER_CUSTOM_COVER_SCHEMA_CHECKSUM,
  },
  {
    version: 58,
    sql: FOLDER_CUSTOM_COVER_ASSET_SCHEMA_SQL,
    checksum: FOLDER_CUSTOM_COVER_ASSET_SCHEMA_CHECKSUM,
  },
  {
    version: 59,
    sql: REVISION_SIZE_FINGERPRINT_INDEX_SCHEMA_SQL,
    checksum: REVISION_SIZE_FINGERPRINT_INDEX_SCHEMA_CHECKSUM,
  },
  {
    version: 60,
    sql: LINKED_DIRECTORY_INDEX_SQL,
    checksum: createHash('sha256').update(LINKED_DIRECTORY_INDEX_SQL).digest('hex'),
  },
  { version: 61, sql: TAG_HIERARCHY_SQL, checksum: createHash('sha256').update(TAG_HIERARCHY_SQL).digest('hex') },
  { version: 62, sql: TAG_APPEARANCE_SQL, checksum: createHash('sha256').update(TAG_APPEARANCE_SQL).digest('hex') },
  { version: 63, sql: AUTOMATIC_TASKS_SQL, checksum: createHash('sha256').update(AUTOMATIC_TASKS_SQL).digest('hex') },
  { version: 64, sql: AUTOMATIC_TASK_LAYOUT_SQL, checksum: createHash('sha256').update(AUTOMATIC_TASK_LAYOUT_SQL).digest('hex') },
  { version: 65, sql: ASSET_COMPANIONS_SQL, checksum: createHash('sha256').update(ASSET_COMPANIONS_SQL).digest('hex') },
  { version: 66, sql: RULES_SQL, checksum: createHash('sha256').update(RULES_SQL).digest('hex') },
] as const;

export const SUPPORTED_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;

/**
 * the in-place table-rebuild migrations (CREATE replacement
 * → copy → DROP old → RENAME). The worker disables FK enforcement around
 * these; `tests/worker/migration-discipline.test.ts` asserts this set matches
 * the static gate's rebuild exceptions exactly, so a new rebuild migration
 * must be added to both places.
 */
export const TABLE_REBUILD_MIGRATION_VERSIONS: ReadonlySet<number> = new Set([
  4, 6, 7, 10, 14, 16, 18, 21, 25, 30, 32, 33, 43, 44,
]);
