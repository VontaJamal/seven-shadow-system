# Release Trust Chain

Seven Shadow System release provenance requires ten controls:

1. Signed annotated Git tags.
2. npm publish with provenance (`--provenance`).
3. GitHub artifact attestations for release tarballs.
4. CycloneDX SBOM generation (`sbom.cdx.json`).
5. SHA-256 checksums covering tarball + SBOM + conformance bundle + provider fixture bundle.
6. Sigstore signatures for `sbom.cdx.json` and `SHA256SUMS.txt`.
7. Signature verification gate for generated SBOM/checksum artifacts before publish.
8. Provenance attestation verification gate for the tarball before publish.
9. Trust-store lifecycle lint gate for sample trust contracts.
10. Release tag/package version invariant (`github.ref_name` must equal `v<package.json.version>`).

## Required Repository Secrets

- `NPM_TOKEN`: npm token with publish access to `@rinshari/sss` and 2FA bypass enabled for CI publish.
- `RELEASE_GPG_PUBLIC_KEY`: ASCII-armored public key used to verify signed tags.

## Pre-Release Gate

`Release Dry Run / dry-run` must pass before cutting a release tag.
This validates trust-store linting, packaging, checksums, SBOM generation, and signature mechanics without publishing.

`RC Soak / rc-soak` should pass for release candidate tags to validate deterministic replay stability across providers.

Maintainers can run the same gate locally with:

```bash
npm run release:verify
```

## Maintainer Tag Procedure

Create a signed annotated tag locally, then push:

```bash
npm run release:rc:prepare
git tag -s v0.3.0-rc.1 -m "v0.3.0-rc.1"
git push origin v0.3.0-rc.1
```

The release workflow (`.github/workflows/release.yml`) verifies the tag signature and enforces tag/version equality before any publish steps run.
It also verifies signed SBOM/checksum outputs and verifies tarball provenance attestations prior to npm publish.

npm dist-tag behavior:

- prerelease versions (for example `0.3.0-rc.3`) publish to `next`
- stable versions (for example `0.3.0`) publish to `latest`

## Release Outputs

- npm package published with provenance.
- GitHub release assets:
  - `<package>.tgz`
  - `seven-shadow-conformance-bundle.zip`
  - `seven-shadow-provider-contract-fixtures-v<packageVersion>.zip`
  - `sbom.cdx.json`
  - `sbom.cdx.json.sig`
  - `sbom.cdx.json.pem`
  - `SHA256SUMS.txt`
  - `SHA256SUMS.txt.sig`
  - `SHA256SUMS.txt.pem`
- Build provenance attestation recorded by GitHub for the tarball.
- Verified keyless signatures for `sbom.cdx.json` and `SHA256SUMS.txt`.
- Verified provenance attestation for the release tarball.

## Verification Commands

Verify checksums:

```bash
sha256sum -c SHA256SUMS.txt
```

Verify SBOM signature (keyless certificate):

```bash
cosign verify-blob \
  --certificate-identity-regexp "https://github.com/VontaJamal/seven-shadow-system/.github/workflows/release.yml@refs/tags/v.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --certificate sbom.cdx.json.pem \
  --signature sbom.cdx.json.sig \
  sbom.cdx.json
```

Verify checksum-file signature:

```bash
cosign verify-blob \
  --certificate-identity-regexp "https://github.com/VontaJamal/seven-shadow-system/.github/workflows/release.yml@refs/tags/v.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --certificate SHA256SUMS.txt.pem \
  --signature SHA256SUMS.txt.sig \
  SHA256SUMS.txt
```

Rollback operations reference:

- `docs/runbooks/trust-store-rollback.md`
