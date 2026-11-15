# Asset importer

Imports battle sprites, icons, overworld sprites, footprints, cries and item icons from a
Pokémon Essentials resource pack into `public/assets/`, renamed to Showdown IDs and reduced to
1× pixel scale.

```bash
npm run assets:import -- --pack <extracted pack folder>             # import everything
npm run assets:import -- --pack <dir> --dry-run                     # show the plan, write nothing
npm run assets:import -- --pack <dir> --only front,back,item,cry    # some kinds only
npm run assets:import -- --pack <dir> --pack <add-on dir>           # layer packs; later ones win
npm run assets:import -- --pack <dir> --force                       # convert unchanged files again
npm run assets:import -- --manifest-only                            # rebuild manifest.json only
npm test                                                            # run the importer's tests
```

The pack must be extracted first (`.rar`/`.zip` → folder). Pass the folder that directly contains
`Graphics/`.

| File | Role |
|------|------|
| `import.ts` | CLI entry: plan → convert → clean up → manifest, credits, report. |
| `packs/gen9.ts` | **Edit this.** Pack layout: which folder becomes which file, target sizes, form aliases. |
| `pack.ts` | Types for pack definitions. Add a file in `packs/` and register it in `config.ts` for a new layout. |
| `config.ts` | Paths and the list of known pack layouts. |
| `plan.ts` | Decides the destination of every file. |
| `resolve.ts` | Essentials names → Showdown species/forme IDs, using `content/pbs`. |
| `essentials.ts` | Essentials file-name and PBS `FormName` parsing. |
| `image.ts` | Lossless un-upscaling, fixed-canvas fitting. |
| `png.ts` | PNG reader/writer (no native dependencies). |
| `convert.ts`, `worker.ts`, `pool.ts` | Per-file conversion, run on all CPU cores. |
| `manifest.ts` | Writes `public/assets/manifest.json`. |

See [docs/ASSET_PIPELINE.md](../../docs/ASSET_PIPELINE.md) for the output layout and how to fix
anything the report flags.
