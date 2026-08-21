# Verifying a NexoIP GitHub Release

This guide lets a Windows user independently verify the exact files attached to a NexoIP GitHub Release. It deliberately separates integrity from publisher identity and provenance.

`v1.0.0` is an **unsigned alpha technical preview**. It can pass the checksum procedure below, but it must not be treated as a signed stable release. A future stable release is valid only when its release notes state an exact Authenticode subject and all of the stable checks below succeed.

## 1. Download only the published release assets

Download from the [GitHub Releases page](https://github.com/ikerperez12/NexoIP-3D-Viewer/releases), or use an authenticated current [GitHub CLI](https://cli.github.com/) session:

```powershell
$repo = 'ikerperez12/NexoIP-3D-Viewer'
$tag = 'v1.0.0' # Replace with the release tag you are verifying.
$releaseDirectory = Join-Path $PWD "NexoIP-$tag"

if (Test-Path -LiteralPath $releaseDirectory) {
  throw "Choose an empty destination; $releaseDirectory already exists."
}
New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
gh release download $tag --repo $repo --dir $releaseDirectory
```

If you download in a browser instead, place `SHA256SUMS.txt` and every asset it names in the same empty directory.

## 2. Verify every checksum before opening an executable

Run this from PowerShell after setting `$releaseDirectory`:

```powershell
$manifestPath = Join-Path $releaseDirectory 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw 'SHA256SUMS.txt is missing.'
}

foreach ($line in Get-Content -LiteralPath $manifestPath) {
  if ($line -notmatch '^([a-f0-9]{64})  ([^\\/]+)$') {
    throw "Malformed checksum line: $line"
  }
  $expectedHash = $Matches[1]
  $assetName = $Matches[2]
  $assetPath = Join-Path $releaseDirectory $assetName
  if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
    throw "Missing release asset: $assetName"
  }
  $actualHash = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -cne $expectedHash) {
    throw "Checksum mismatch: $assetName"
  }
  Write-Host "Verified SHA-256: $assetName"
}
```

A matching checksum proves the downloaded bytes match the release manifest. It does **not** establish who published the executable.

## 3. Treat the current alpha correctly

The current `v1.0.0` alpha executables are intentionally not Authenticode-signed. A missing signature is expected for that alpha, not a warning to bypass, and no checksum can substitute for a trusted publisher identity. Windows SmartScreen or organisational policy may block the binaries.

Do not call an unsigned release stable. The stable-release contract remains in [Product readiness](PRODUCT_READINESS.md).

## 4. Additional checks required for a future stable release

Only use this section for a release whose notes contain an **Expected Authenticode subject** line. Copy that value exactly; do not accept a subject supplied by an untrusted download page or dialog.

```powershell
$expectedPublisherSubject = '<copy the exact Expected Authenticode subject from the GitHub Release notes>'
if ($expectedPublisherSubject -like '<*' -or [string]::IsNullOrWhiteSpace($expectedPublisherSubject)) {
  throw 'Set the exact publisher subject from the GitHub Release notes first.'
}

$executables = @(Get-ChildItem -LiteralPath $releaseDirectory -Filter '*.exe' -File)
if ($executables.Count -lt 2) {
  throw 'A stable Windows release must contain the installer and portable executable.'
}

foreach ($executable in $executables) {
  $signature = Get-AuthenticodeSignature -LiteralPath $executable.FullName
  if ($signature.Status -cne 'Valid') {
    throw "Invalid Authenticode signature for $($executable.Name): $($signature.Status)"
  }
  if ($signature.SignerCertificate.Subject -cne $expectedPublisherSubject) {
    throw "Unexpected publisher for $($executable.Name): $($signature.SignerCertificate.Subject)"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Missing trusted timestamp for $($executable.Name)"
  }
  Write-Host "Verified Authenticode identity and timestamp: $($executable.Name)"
}
```

`Status = Valid`, the exact expected subject, and a timestamp are all required. Do not downgrade a failed signature check merely because a file hash matches.

## 5. Verify GitHub Actions provenance

Stable releases attest both Windows executables and the attached CycloneDX SBOM. With the same `$repo`, `$tag`, and `$releaseDirectory`, use the exact workflow identity:

```powershell
$signerWorkflow = "$repo/.github/workflows/release.yml"
$artifacts = @(
  Get-ChildItem -LiteralPath $releaseDirectory -Filter '*.exe' -File
) + @(
  Get-ChildItem -LiteralPath $releaseDirectory -Filter '*.cdx.json' -File
)

foreach ($artifact in $artifacts) {
  gh attestation verify $artifact.FullName `
    --repo $repo `
    --signer-workflow $signerWorkflow `
    --source-ref "refs/tags/$tag" `
    --deny-self-hosted-runners
  Write-Host "Verified GitHub provenance: $($artifact.Name)"
}
```

The command verifies cryptographically signed GitHub Actions attestations for the local bytes, the repository, the release workflow, and the tag source. It is complementary to, not a replacement for, the checksum and Authenticode checks.

## What a verifier should retain

For a future stable release, retain the release tag and URL, artifact names, verified SHA-256 values, the exact expected publisher subject, PowerShell signature results, GitHub CLI version, and provenance command output. These facts make a later incident or revocation investigation reproducible.
