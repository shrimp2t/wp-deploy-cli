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

## Configuration (`.env`)

Store the site/credentials you deploy to in a `.env` file — it's auto-loaded from the
current directory and used as defaults, so you can just run `deploy-version`:

```bash
cp .env.example .env    # then fill in your values
```

| Variable | Used for |
|---|---|
| `GITHUB_TOKEN` | GitHub auth (release source + asset upload) |
| `GITHUB_REPO` / `GITHUB_TAG` | default repo / tag to build from |
| `GITHUB_PUBLISH` | `true` to upload built zips as release assets |
| `EDD_ENDPOINT` / `EDD_TOKEN` | the EDD site to sync to, and its shared secret |
| `EDD_DOWNLOAD_ID` / `EDD_DOWNLOAD_FREE_ID` | pro / free download ids to update |
| `OUT_DIR` | default output directory |

Precedence: **CLI flag > `.env` / environment variable**. Real environment variables win
over the file (handy in CI). Keep `.env` out of git — only `.env.example` is committed.

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

## EDD sync (via existing WordPress REST — recommended)

No custom endpoint. EDD already registers the `download` post type with
`show_in_rest`, so WP core's own controller serves:

```
POST /wp-json/wp/v2/edd-downloads/<id>
```

The tool writes the Software Licensing fields (`_edd_sl_version`, `_edd_sl_changelog`)
there, authenticating with **Application Passwords** (WP core ≥ 5.6 — no plugin):

```bash
deploy-version --path=. \
  --wp-url=https://shop.example.com --wp-user=admin \
  --wp-app-password="xxxx xxxx xxxx xxxx xxxx xxxx" \
  --download-id=42 --download-free-id=43
```

One-time enabler: WP/EDD deliberately do **not** expose those SL meta keys to REST
(they are protected `_`-prefixed meta). Copy
`examples/mu-plugin-register-edd-sl-meta.php` into `wp-content/mu-plugins/` once — it
registers those **existing** fields for the **existing** endpoint (no
`register_rest_route`, no controller, no new URL), gated by the `edit_post` capability.

Use `--dry-run` to print the exact requests without sending them.

### Fallback: custom companion endpoint

If you'd rather not touch the site at all via REST, `--edd-endpoint=URL` POSTs a signed
JSON payload (version, changelog, files) to your own receiver instead — see
`src/edd.js`. A truly zero-code alternative is WP-CLI:
`wp post meta update <id> _edd_sl_version <ver>`.

## Differences from the original plugin

- No WordPress runtime, admin UI, custom post type, or webhook receiver — it's a CLI/CI tool.
- The transform engine also skips **string literals** (not just comments), so braces/quotes
  inside strings can't break brace matching.
- GitHub auth uses the `Authorization` header (the plugin's `?access_token=` query param was
  removed by GitHub in 2020).
