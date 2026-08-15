# Deploying a complete theme or plugin

End-to-end setup for shipping **one** codebase as a **free** build (to WordPress.org SVN)
and a **pro** build (to an EDD store), from a single `deploy-version` run.

```
                     ┌─────────────────────────────────────────┐
   single source ──▶ │  deploy-version --path=. …               │
   (with markers +   │                                          │
    deploy.json)     │   free  ──▶  wordpress.org SVN (--svn)   │
                     │   pro   ──▶  EDD download   (--api-url)   │
                     │   both  ──▶  GitHub release (--github-*)  │
                     └─────────────────────────────────────────┘
```

## 1. Prepare the source

Keep a single codebase and mark the premium parts inline.

**PHP** — branch on your own marker function (stripped from both builds):

```php
function my_theme_is__premium() { return true; }   // removed on build

if ( my_theme_is__premium() ) {
    // pro-only code    (kept in pro, removed in free)
} else {
    // free fallback    (kept in free, removed in pro)
}
```

**CSS/JS/SCSS**: `/*<if_is_premium>*/ … /*</if_is_premium>*/` — **HTML**: `<!-- if_is_premium --> … <!-- /if_is_premium -->`.

Add a **`deploy.json`** in the source root (see `examples/deploy.theme.json` /
`examples/deploy.plugin.json`):

```json
{
  "type": "theme",
  "name": "my-theme",
  "premium_name": "my-theme-pro",
  "function_premium": "my_theme_is__premium",
  "premium_suffix": "pro",
  "replace": "SUFFIX", "replace_pro": "Pro", "replace_free": "",
  "premium_only": ["/premium/"],
  "premium_files": []
}
```

- `premium_only` dirs and `premium_files` are dropped from the **free** build.
- `replace` swaps a token per variant — e.g. a `Theme Name: My Theme SUFFIX` header
  becomes `My Theme` (free) / `My Theme Pro` (pro).

Verify the split before wiring up any targets:

```bash
cd path/to/my-theme
deploy-version --path=.            # -> dist/my-theme-free-vX.Y.Z.zip + my-theme-pro-vX.Y.Z.zip
```

## 2. Set up the EDD store (pro build target)

On the EDD site:

1. Install **`wordpress-plugin/wp-deploy-endpoint.php`** as a normal plugin and activate it.
   It adds `POST /wp-json/wp-deploy/v1/download`.
2. Create a **WordPress Application Password** for a user who can edit downloads:
   Users → Profile → Application Passwords (WP ≥ 5.6). Use it as `FD_API_USER` +
   `FD_API_APP_PASSWORD` below.
3. Create the **pro** download (and a free one if you sell/track it), then note their IDs
   (Downloads list → hover a product → the `post=<id>` in the edit link).

## 3. Set up the free build target (WordPress.org SVN)

You need an **approved** wp.org slug and your wp.org account. `svn` and `rsync` must be on
PATH. Credentials are passed to `svn` and never stored (`--svn-user` / `--svn-password`,
or `SVN_USER` / `SVN_PASSWORD`).

## 4. Configure `.env`

Copy `examples/deploy.env` into the source folder as `.env` and fill it in (it is
auto-loaded). Minimal shape:

```dotenv
FD_API_URL=https://shop.example.com
FD_API_USER=admin
FD_API_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
EDD_DOWNLOAD_ID=42

SVN_SLUG=my-theme
SVN_USER=your-wporg-username
SVN_PASSWORD=your-wporg-password

# GitHub release (via gh CLI). GITHUB_PUBLISH is the config equivalent of --github-publish.
GITHUB_PUBLISH=true
# GITHUB_REPO=owner/my-theme   # optional; auto-detected from the project's git origin
```

With `GITHUB_PUBLISH=true` in `.env`, every deploy also creates/updates the GitHub release
and uploads the built zips — no `--github-publish` flag needed on the command line.

## 5. Deploy

```bash
cd path/to/my-theme

# dry-run first — prints every action, changes nothing
deploy-version --path=. --svn --dry-run

# real: free -> wp.org SVN, pro -> EDD download, in one run
deploy-version --path=. --svn
```

`--api-url` + `EDD_DOWNLOAD_ID` come from `.env`, so the pro zip is uploaded and set as the
download's file with the SL version + changelog; `--svn` publishes the free build to
`trunk` + `tags/<version>` (plugin) or a `<version>/` folder (theme).

If `GITHUB_PUBLISH=true` is in `.env` (or you pass `--github-publish`), the same run also
creates/updates the GitHub release via the gh CLI and attaches both zips.

### Pro-only products (no free version, no wp.org SVN)

If a plugin/theme has **only a pro build** (no free/pro split), set `DEPLOY_SINGLE=true`
(or pass `--single`). It produces a single package named by its slug (no `-pro` suffix),
skips the free variant and SVN, and needs **no** `DEPLOY_FUNCTION_PREMIUM` / premium
markers. See `examples/deploy.pro-only.env`:

```bash
deploy-version --path=.          # with DEPLOY_SINGLE=true in .env
# -> dist/my-pro-plugin-vX.Y.Z.zip  → EDD (+ GitHub release if enabled)
```

### Plugin instead of theme

Identical flow — set `"type": "plugin"` in `deploy.json` (or omit it; a folder without
`style.css` is detected as a plugin). Version is read from the main plugin header. SVN then
targets `plugins.svn.wordpress.org/<slug>/` with `trunk` + `tags/<version>`.

## Cheat sheet

| Goal | Flag(s) |
|---|---|
| Build free + pro zips only | *(none)* |
| Publish free to wp.org SVN | set `SVN_SLUG`+`SVN_USER`+`SVN_PASSWORD` (auto-runs), or `--svn` |
| Upload pro to EDD + set file/version | `--api-url` (+ `FD_API_*`, `EDD_DOWNLOAD_ID`) |
| Attach zips to a GitHub release | `--github-publish` (+ `GITHUB_*`) |
| Preview without changing anything | `--dry-run` |
| Local self-signed site | `--insecure` |
