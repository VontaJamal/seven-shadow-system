# Release Trust Chain

Seven Shadow System release provenance requires seven controls:

1. Signed annotated Git tags.
2. npm publish with provenance (`--provenance`).
3. GitHub artifact attestations for release tarballs.
4. CycloneDX SBOM generation (`sbom.cdx.json`).
5. SHA-256 checksums covering tarball + SBOM + conformance bundle + provider fixture bundle.
6. Sigstore signatures for `sbom.cdx.json` and `SHA256SUMS.txt`.
7. Trust-store lifecycle lint gate for sample trust contracts.

## Required Repository Secrets

- `NPM_TOKEN`: npm token with publish access to `@rinshari/seven-shadow-system`.
- `RELEASE_GPG_PUBLIC_KEY`: ASCII-armored public key used to verify signed tags.

## Pre-Release Gate

`Release Dry Run / dry-run` must pass before cutting a release tag.
This validates trust-store linting, packaging, checksums, SBOM generation, and signature mechanics without publishing.

## Maintainer Tag Procedure

Create a signed annotated tag locally, then push:

```bash
git tag -s v0.2.1 -m "v0.2.1"
git push origin v0.2.1
```

The release workflow (`.github/workflows/release.yml`) verifies the tag signature before any publish steps run.

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
