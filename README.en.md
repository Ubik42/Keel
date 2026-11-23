<div align="center">

<img src="assets/icons/app.png" alt="Keel" width="120" />

# Keel

**A local-first library for every kind of file**: gather files scattered across your disks into one library, find them, preview them, keep them organized, and let rules do the repetitive sorting for you.

**🇺🇸 English** | [🇨🇳 简体中文](README.md)

[Releases](https://github.com/Ubik42/Keel/releases) · [Browser extension](https://github.com/Ubik42/Keel/releases?q=extension) · [User guide](docs/user-guide/README.en.md) · [Developer docs](docs/developer/README.en.md)

</div>

> **Keel comes from [Serpent](https://github.com/dolag233/Serpent).**
> Keel started from Serpent, the open-source digital asset manager by dolag233 and the Serpent contributors (MIT). The library, the import and preview pipelines, and the plugin and automation frameworks all come from Serpent. Thank you to its author and contributors.
> Since 2026-11-21 Keel has been developed on its own and no longer merges upstream. Keel follows its own design ideas (below), so most features and the structure will be redone step by step; staying in line with Serpent is not a goal. Serpent libraries open directly in Keel (the `.serpent` metadata folder is migrated to `.keel`); after migration Serpent no longer opens them.

## Design ideas

1. **One library for every kind of file, not just an image library.** Any file type can be added. Images, video, audio, PDF, fonts and 3D models are handled built in; plugins add metadata, thumbnails, previews and inspector sections for other types. Specialist programs stay outside Keel and work with it as "Open with" targets, for example Panthesia for practising MIDI files.
2. **The files are the library.** A new library keeps your files directly in the library folder, in your own folder structure; an existing folder can become a library in place, without copying. Keel's database, thumbnails and trash live in the `.keel` folder. Data travels with the files: companion files such as `.xmp` move, rename and delete with their main file.
3. **Rules do the sorting; AI writes the rules.** A rule is one thing: a manifest plus a TypeScript script, stored as files under `.keel/rules/` that you can diff or keep in Git. The rules folder ships its own guide, type declarations and examples, so an AI can write a rule without reading Keel's source. Rules can be dry-run first, need one confirmation before they run, and every run is recorded and can be undone.
4. **Your decisions come first.** What you enter is stored apart from what AI generates, and AI never overwrites it; organizing actions can be undone; risky actions such as permanent deletion ask first.
5. **Local first.** Data stays on your machine, with no account or cloud service. WebDAV sync is available when you want several devices.
6. **One program with a clear structure.** No split into separate packages, no generic framework for imagined other users. Code is layered by domain; dependency direction and style tokens are checked by lint rules.

## What it does today

- **Libraries**: files in the library root or in an `Assets` subfolder; take over an existing folder in place; open and convert Eagle and Billfish libraries; link external folders with path rules; switch between several libraries.
- **Browse and view**: grid and masonry layouts; workspace tabs, each keeping its place, search and selection; viewer for images (including RAW, EXR, PSD, TIFF), video, audio, GIF, image sequences, PDF, fonts, text, archives and 3D models (with HDRI lighting).
- **Organize**: hierarchical tags with colors and icons, where filtering by a parent tag includes its children; ratings, favorites, descriptions, authors, source links; folder covers; trash and undo.
- **Search**: advanced search syntax; filters for tags, rating, format, color, size, duration and more; experimental semantic search, including "find similar".
- **Rules**: run after imports, after library changes, on a schedule or continuously; the order in the sidebar list is the priority; validate, dry-run and read history over MCP or the command line (`Keel.exe --rule …`).
- **Open with and companion files**: a default program per extension (system default, a chosen program, the Keel viewer or a plugin); companion files follow their main file and are listed as attachments in the inspector.
- **AI analysis**: descriptions and tags for images, videos and 3D assets, with several service profiles.
- **Extensions**: plugins with declared permissions, automation scripts, and a built-in MCP server for AI clients.
- **Sync and capture**: two-way WebDAV sync; a browser extension saves images and videos from web pages into the library.
- **Appearance**: several themes plus custom themes; interface scale 75%–200%; adjustable font size and corner radius; Simplified Chinese and English UI.

## Status

- Version 0.4.0 (pre-release). Daily use and testing happen on **Windows** only; the macOS and Linux build scripts are kept but not verified.
- The releases page carries release notes and the browser extension; build the desktop app yourself as described under [Build locally](#build-locally).
- Parts of the user guide and its screenshots still describe Serpent and will be updated.

## Roadmap

The full plan and progress log are in [docs/进度.md](docs/进度.md) (Chinese).

### Done since going independent (2026-11)

- Renamed to Keel, with automatic metadata migration for existing libraries.
- Removed unused features: collections and smart collections, plus the auto-update check and the online plugin catalog that pointed upstream.
- Added: a file-type plugin interface, open-with per type, companion files; the rule system; hierarchical tags and tag appearance; the root library layout and in-place takeover.
- Restructured: renderer state moved to zustand and into components (`App.tsx` 17,673 → 17 lines); the back end split by domain (`library-service.ts` 52,331 → 686 lines); the main process split; styles turned into tokens with Stylelint rules.
- Performance: opening a 20,000-asset library to the first card went from 15.9 s to 0.9 s; browse-jump p95 from 2,454 ms to 181 ms.

### Planned

- **Finish the design tokens**: move the remaining per-theme component styles into tokens; let line heights and control sizes follow the font size (a few heading rows are tight at large sizes today).
- **Work with Panthesia**: a Panthesia plugin for Keel with MIDI / MusicXML metadata and piano-roll thumbnails, the `.panthesia` companion file, and a "Practise in Panthesia" open-with entry.
- **Release installers**: a Windows installer and portable build on the releases page.
- **Documentation**: rewrite the user guide and screenshots for Keel as it is now.

### Not planned

- **Collections and smart collections**: removed in favor of hierarchical tags; collections in old libraries are converted to tags once, smart collections to paused rules.
- **A visual rule editor**, or other rule kinds such as "structure rules" or "recognizers": a rule is a script, written by AI.
- **In-app auto-update and an online plugin catalog**: plugins are installed locally.
- **The legacy interface layout**: only the current interface is kept.
- **Mobile apps**, accounts and cloud services.
- **Splitting into several npm packages**, or a generic framework for other host programs.
- **Native rewrites for speed (Rust / napi-rs)**: measured in 2026-11, the current bottlenecks are OS process creation and disk writes, not JS computation. A native module is considered only when measurement shows a step is slowed by JS computation and pure-JS fixes do not help.

## Technology

| Layer | Choice |
| --- | --- |
| Desktop shell | Electron 43, built with electron-forge and Vite 8 (multiple entries) |
| Interface | React 19, zustand, TypeScript 6; styles refer only to tokens in `tokens.css` |
| Data | one SQLite database per library (better-sqlite3), FTS5 trigram full-text search, sqlite-vec vector search; migrations only add, and new builds must open old libraries |
| Media | sharp, FFmpeg / ffprobe, OpenImageIO, pdf.js, ufbx (WASM) and three.js; media tools ship with the app |
| Extensions | plugins declare permissions and run in a standard or a trusted host; scripts and rules run in a QuickJS sandbox through the automation gateway, with the same checks and undo as UI actions; built-in MCP server |
| Quality | ESLint (including directory dependency rules), Stylelint (token rules), vitest (unit and worker integration tests), Playwright E2E (runs in the background: no window pops up, focus is never taken) |

**Processes**: the main process owns windows, dialogs, custom protocols, plugin and rule scheduling and the MCP server; the Library Worker alone holds SQLite and the file system and does imports, scans, search and thumbnails; the renderer only draws the interface; plugins and scripts run in their own hosts.

**Principles**: measure before optimizing; the back end stays on Node, and a native module is added only when every condition in [section 5 of docs/进度.md](docs/进度.md) holds; new features reuse existing components and patterns instead of rebuilding them.

More in [docs/developer/architecture.en.md](docs/developer/architecture.en.md).

## Build locally

Requires Node.js 24 (see `.nvmrc`). Do not build on an SMB / NAS mount.

```bash
npm ci
npm run rebuild:native   # match better-sqlite3 to the Electron ABI
npm start                # development run (settings kept in the project's .local-profile)
npm run package          # package to out/Keel-<platform>-<arch>/
```

Common commands:

```bash
npm run lint             # ESLint and Stylelint
npm run typecheck        # TypeScript checks
npm test                 # unit and worker integration tests
npm run test:e2e         # Playwright E2E
```

Packaging, installers and other platforms are covered in [Build and packaging](docs/developer/build-packaging.en.md). After packaging on Windows, `Start-Keel.exe` in the project root starts Keel without a console.

## Documentation

| Document | Contents |
| --- | --- |
| [User guide](docs/user-guide/README.en.md) | install, import, browse, search, sync, AI, plugins, automation, troubleshooting |
| [What Keel adds](README.local.md) (Chinese) | root layout, in-place takeover, hierarchical tags, tag appearance and other Keel additions |
| [Developer docs](docs/developer/README.en.md) | setup, architecture, testing, build and packaging |
| [Extension author manual](docs/manual/README.md) | plugins, scripts, MCP |
| [Plan and progress](docs/进度.md) (Chinese) | long-term plan, stages, decisions and progress log |

## License

MIT, see [LICENSE](LICENSE): the original Serpent contributors copyright notice is kept, with Keel's copyright line added. Bundled media components and assets follow their own licenses (FFmpeg LGPL, OpenImageIO, ufbx MIT, Poly Haven CC0); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the LICENSE files under `resources/`.
