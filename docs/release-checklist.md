# Pre-public release checklist

The current directory is the source root of the standalone public
`jiaozhoumysterycenter-glitch/agent-pathwatch` repository. Its local checkout
may live inside a larger private workspace, but that outer workspace is not part
of the public history.

Before the first public release:

- [x] Make `agent-pathwatch/` the root of its own Git repository so
      `.github/workflows/test.yml` is a root workflow.
- [x] Choose the public GitHub owner/repository name, then add real
      `repository`, `bugs`, and `homepage` URLs to `package.json`.
- [x] Enable GitHub private vulnerability reporting and replace the provisional
      wording in `SECURITY.md` with the repository's direct private-advisory URL.
- [x] Run the workflow successfully on Node 20/22/24 Linux, Node 20 macOS, and
      Node 20 Windows.
- [x] Re-run `npm run check`, `npm test`, and `npm pack --dry-run` from the
      independent repository root.
- [x] Inspect the tarball file list and installed `.bin/agent-pathwatch`.
- [x] Change the `0.1.0` changelog heading to the actual release date and create
      the tagged GitHub release.
- [ ] Before any npm publication from post-tag `main`, choose a new version,
      update `package.json` and the changelog, and repeat the package inspection.

Repository creation and the first source push are complete. Enabling GitHub
security settings and the `v0.1.0` tag/release are complete. npm publication
remains an explicit external action.
