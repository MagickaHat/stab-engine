# Battle animation importer

Converts Pokémon Essentials battle animations (`Data/PkmnAnimations.rxdata`) into readable,
editable JSON in `content/animations/`. The sheets and sounds they use are imported by
`npm run assets:animations` (tools/assets), with matching names.

```bash
npm run animations:import -- --pack <Essentials project or animation pack>
npm run animations:import -- --pack <dir> --dry-run      # show the plan, write nothing
npm run animations:import -- --pack <dir> --pack <dir2>  # layer packs; later ones win
npm run animations:import -- --pack <dir> --force        # also overwrite hand-edited files
npm test                                                 # run the importer's tests
```

| File | Role |
|------|------|
| `import.ts` | CLI: find the `.rxdata`, convert, write files (keeping hand edits), report. |
| `convert.ts` | `PBAnimation` → engine format; file naming; JSON layout. |
| `marshal.ts` | Ruby Marshal reader (data only: no Ruby needed, nothing executed). |
| `fixtures/` | A tiny `.rxdata` for the tests, and the Ruby script that made it. |
| `../../src/battle/animation/format.ts` | The format's types and constants, shared with the game. |
| `../../content/animations/schema.json` | JSON Schema of the files. |

See [docs/ANIMATION_SYSTEM.md](../../docs/ANIMATION_SYSTEM.md) for the format, and for how to build
the player and editor on top of it.
