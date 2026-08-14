# freemium-deploy

Build **Free** and **Pro (premium)** distributables of a WordPress theme/plugin from a
**single source** using inline premium markers. A Node/JS re-implementation of the
FameThemes *Freemium Deployment* WordPress plugin — as a CLI (and library) that runs
locally or in CI.

```bash
cd path/to/theme_or_plugin
deploy-version --path=.
# -> dist/<slug>-free-vX.Y.Z.zip  and  dist/<slug>-pro-vX.Y.Z.zip
```

## Install

```bash
npm install -g freemium-deploy      # or: npx freemium-deploy --path=.
```

Requires Node ≥ 18. `unzip` must be on PATH only when fetching source from GitHub.

## How it works

You keep **one** codebase and mark the premium parts inline. The tool emits two clean
copies with those parts resolved.

**PHP** — branch on a marker function; the function itself is stripped from output:

```php
function ft_is__premium() { return true; }        // removed from both builds

if ( ft_is__premium() ) {
    // pro-only code   -> kept in pro, removed in free
} else {
    // free code       -> kept in free, removed in pro
}
```

Negation and comparisons are understood: `! ft_is__premium()`, `== true`, `!= true`,
`== false`, `!= false`. `if` without `else` is fine (the block is simply dropped in the
other variant). Nested markers are resolved recursively.

**CSS / JS / SCSS / LESS** — comment-tagged blocks:

```css
/*<if_is_premium>*/
.pro { color: red; }   /* removed in free; tags stripped in pro */
/*</if_is_premium>*/
```

**HTML** — `<!-- if_is_premium --> ... <!-- /if_is_premium -->`

Files transformed: `.php .js .css .sass .scss .less .txt .readme`. Everything else is
copied verbatim.

## `deploy.json` (optional, in the source root)

Fully compatible with the original plugin's format:

```json
{
  "type": "theme",
  "name": "easymag",
  "premium_name": "",
  "function_premium": "easymag_is__premium",
  "premium_suffix": "pro",
  "replace": "SUFFIX",
  "replace_pro": "Pro",
  "replace_free": "",
  "premium_only": ["/premium/", "/inc/typography-wp/"],
  "premium_files": ["/inc/widgets/widget-hero-2.php"]
}
```

| Key | Meaning |
|---|---|
| `type` | `theme` or `plugin` (auto-detected from `style.css` if omitted) |
| `name` | free output slug/folder (default: source folder name) |
| `premium_name` | pro output slug (default: `<name>-<premium_suffix>`) |
| `function_premium` | marker function name (default `ft_is__premium`) |
| `premium_suffix` | suffix for the pro slug (default `premium`) |
| `replace` / `replace_free` / `replace_pro` | string swapped per variant (string or arrays). Powers the `SUFFIX` → `` / `Pro` trick in theme names |
| `premium_only` | directories excluded from the **free** build (full path from root, e.g. `/premium/`) |
| `premium_files` | individual files excluded from the **free** build |

Version is read from `style.css` (theme) or the plugin header, and used in the zip names.

## CLI

```
deploy-version --path=DIR [options]

Build:
  --path=DIR            Source dir (default: ".")
  --out=DIR             Output dir (default: sibling "dist/")
  --free-only | --pro-only
  --no-zip              Emit folders only
  --keep                Keep unzipped folders alongside the zips

GitHub (needs GITHUB_TOKEN or --github-token):
  --github-repo=OWNER/NAME --github-tag=TAG   Build from a release's source
  --github-publish                            Upload built zips as release assets

EDD sync (needs a companion endpoint — see below):
  --edd-endpoint=URL --edd-token=SECRET
  --edd-download-id=N --edd-download-free-id=N

Misc: --dry-run  -h/--help  -v/--version
```

### GitHub Actions example

```yaml
on:
  release:
    types: [published]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx freemium-deploy
          --github-repo=${{ github.repository }}
          --github-tag=${{ github.event.release.tag_name }}
          --github-publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Library

```js
import { build, Finder } from 'freemium-deploy';

const res = await build({ path: '.', variants: ['free', 'premium'] });
// res.free.zip, res.premium.zip, res.version, ...

// Transform a single string:
new Finder({ variant: 'free', key: 'ft_is__premium' }).deployPhp(src);
```

## EDD sync

A standalone Node process cannot write WP/EDD post meta directly. `--edd-endpoint` POSTs
a signed JSON payload to a small companion REST route you add on the EDD site, which then
updates `edd_download_files`, `_edd_sl_version`, and `_edd_sl_changelog`. Payload shape:

```json
{
  "version": "1.3.7",
  "changelog": "…",
  "download_id": 123,
  "download_free_id": 456,
  "files": [
    { "variant": "free", "name": "easymag-free-v1.3.7.zip", "url": "https://…", "size": 911360 },
    { "variant": "premium", "name": "easymag-pro-v1.3.7.zip", "url": "https://…", "size": 984064 }
  ]
}
```

Send `Authorization: Bearer <--edd-token>` and verify it on the receiver. Use `--dry-run`
to print the payload without sending.

## Differences from the original plugin

- No WordPress runtime, admin UI, custom post type, or webhook receiver — it's a CLI/CI tool.
- The transform engine also skips **string literals** (not just comments), so braces/quotes
  inside strings can't break brace matching.
- GitHub auth uses the `Authorization` header (the plugin's `?access_token=` query param was
  removed by GitHub in 2020).
