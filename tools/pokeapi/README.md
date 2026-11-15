# PokeAPI importer

Converts [PokeAPI](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv)'s CSV dump into
Pokémon Showdown-format JSON in `content/pbs/generated/`.

```bash
npm run pokeapi:import                        # latest PokeAPI (downloads are cached in .cache/)
npm run pokeapi:import -- --ref <commit-sha>  # a fixed PokeAPI version
npm run pokeapi:import -- --refresh           # download again
npm run pokeapi:import -- --csv-dir <folder>  # use a local clone
```

| File | Role |
|------|------|
| `import.ts` | CLI entry: fetch → convert → validate → write. |
| `config.ts` | Paths, languages, excluded version groups, learn-method codes. |
| `fetch.ts` | Downloads/caches CSVs; list of tables used. |
| `csv.ts` | CSV parser. |
| `context.ts` | Shared state: ID maps, localized text, warnings. |
| `ids.ts` | PokeAPI identifier → Showdown ID/name (checked against `@pkmn/sim`). |
| `convert/*.ts` | One converter per table group. |

See [docs/DATA_PIPELINE.md](../../docs/DATA_PIPELINE.md) for the data format and how it is used.
