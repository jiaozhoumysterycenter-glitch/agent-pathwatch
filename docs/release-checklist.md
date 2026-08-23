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
- [ ] Enable GitHub private vulnerability reporting and replace the provisional
      wording in `SECURITY.md` with the repository's direct private-advisory URL.
- [ ] Run the workflow successfully on Node 20/22/24 Linux, Node 20 macOS, and
      Node 20 Windows.
- [ ] Re-run `npm run check`, `npm test`, and `npm pack --dry-run` from the
      independent repository root.
- [ ] Inspect the tarball file list and installed `.bin/agent-pathwatch`.
- [ ] Change the changelog heading from `Unreleased` to the actual release date,
      create the signed/tagged release, and only then consider npm publication.

Repository creation and the first source push are complete. Enabling GitHub
security settings, tags, and npm publication remain explicit external actions.
