# Custom game data

Your overrides and new content. The PokeAPI importer **never** writes here.

- Use the same file names as `../generated/` (`pokedex.json`, `moves.json`, …).
- Each file is a JSON Merge Patch: a new ID **adds** an entry, an object **patches** an existing
  one (only the fields you write change), and `null` **removes** it.
- Sub-folders are **content packs** with their own table files. They are applied alphabetically,
  before the files in this folder. Delete a pack folder to remove it, or prefix it with `_` to
  disable it.
- Keep the `"$schema"` line for autocompletion in VS Code.
- Run `npm run pbs:validate` after editing.

Full guide: [docs/DATA_PIPELINE.md](../../../docs/DATA_PIPELINE.md#5-custom-content-and-overrides).
