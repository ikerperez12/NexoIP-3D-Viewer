import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const releaseWorkflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

function extractPowerShellRunBlocks(workflow) {
  const lines = workflow.split(/\r?\n/);
  const scripts = [];

  for (let index = 0; index < lines.length; index += 1) {
    const runMatch = /^(\s*)run: \|\s*$/.exec(lines[index]);
    if (!runMatch) continue;

    const runIndent = runMatch[1].length;
    const blockLines = [];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim() === '') {
        blockLines.push('');
        continue;
      }
      const indent = /^\s*/.exec(line)[0].length;
      if (indent <= runIndent) break;
      blockLines.push(line.slice(runIndent + 2));
    }
    scripts.push({ line: index + 1, source: blockLines.join('\n') });
    index = cursor - 1;
  }

  return scripts;
}

const powerShellParser = [
  '$blocks = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$diagnostics = @()',
  'foreach ($block in @($blocks)) {',
  '  $tokens = $null',
  '  $errors = $null',
  '  [System.Management.Automation.Language.Parser]::ParseInput([string]$block.source, [ref]$tokens, [ref]$errors) | Out-Null',
  '  foreach ($parseError in $errors) {',
  '    $diagnostics += "run block at release.yml line $($block.line), PowerShell line $($parseError.Extent.StartLineNumber): $($parseError.Message)"',
  '  }',
  '}',
  'if ($diagnostics.Count -gt 0) {',
  '  $diagnostics | ForEach-Object { Write-Error $_ }',
  '  exit 1',
  '}',
].join('\n');

test('release workflow isolates attestation privileges from release publication', () => {
  const attestJob = releaseWorkflow.indexOf('  attest:\n');
  const publishJob = releaseWorkflow.indexOf('  publish:\n');
  const binaryAttestation = releaseWorkflow.indexOf('- name: Attest Windows binaries');
  const sbomAttestation = releaseWorkflow.indexOf('- name: Attest SBOM for Windows binaries');
  const sbomProvenance = releaseWorkflow.indexOf('- name: Attest release SBOM provenance');
  const draftReservation = releaseWorkflow.indexOf('- name: Atomically reserve a new immutable draft release');
  const attestContract = releaseWorkflow.slice(attestJob, publishJob);
  const publishContract = releaseWorkflow.slice(publishJob);

  expect(attestJob).toBeGreaterThan(-1);
  expect(publishJob).toBeGreaterThan(attestJob);
  expect(attestContract).toContain('contents: read');
  expect(attestContract).toContain('id-token: write');
  expect(attestContract).toContain('attestations: write');
  expect(attestContract).not.toContain('contents: write');
  expect(publishContract).toContain('- attest');
  expect(publishContract).toContain('contents: write');
  expect(publishContract).not.toContain('id-token: write');
  expect(publishContract).not.toContain('attestations: write');
  expect(binaryAttestation).toBeGreaterThan(-1);
  expect(sbomAttestation).toBeGreaterThan(binaryAttestation);
  expect(sbomProvenance).toBeGreaterThan(sbomAttestation);
  expect(draftReservation).toBeGreaterThan(sbomProvenance);
});

test('failed publication removes only the matching unpublished draft so the immutable tag can be retried', () => {
  const cleanupStep = releaseWorkflow.indexOf('- name: Remove an unpublished draft after a failed publish attempt');
  const publishStep = releaseWorkflow.indexOf('- name: Publish the verified reserved draft');
  const cleanupContract = releaseWorkflow.slice(cleanupStep);

  expect(cleanupStep).toBeGreaterThan(publishStep);
  expect(cleanupContract).toContain("if: ${{ failure() && steps.create_release.outputs.release_id != '' }}");
  expect(cleanupContract).toContain('if (-not $release.draft)');
  expect(cleanupContract).toContain('$release.tag_name -cne $env:GITHUB_REF_NAME');
  expect(cleanupContract).not.toContain('$release.target_commitish');
  expect(cleanupContract).toContain('gh api --method DELETE $endpoint');
});

test('release workflow resolves the immutable tag again immediately before publication', () => {
  const uploadStep = releaseWorkflow.indexOf('- name: Upload assets to the reserved draft');
  const uploadedVerification = releaseWorkflow.indexOf('- name: Verify every uploaded draft asset before publication');
  const publishStep = releaseWorkflow.indexOf('- name: Publish the verified reserved draft');
  const publishContract = releaseWorkflow.slice(uploadStep, releaseWorkflow.indexOf('- name: Remove an unpublished draft', uploadStep));
  const finalPublicationContract = releaseWorkflow.slice(publishStep, releaseWorkflow.indexOf('- name: Remove an unpublished draft', publishStep));
  const assetUpload = publishContract.indexOf('gh release upload');
  const tagResolution = finalPublicationContract.indexOf('$currentTagCommit = Resolve-TagCommit');
  const publication = finalPublicationContract.indexOf('gh api --method PATCH');

  expect(uploadStep).toBeGreaterThan(-1);
  expect(uploadedVerification).toBeGreaterThan(uploadStep);
  expect(publishStep).toBeGreaterThan(uploadedVerification);
  expect(publishContract).toContain('RELEASE_ID: ${{ steps.create_release.outputs.release_id }}');
  expect(assetUpload).toBeGreaterThan(-1);
  expect(publishContract).toContain("gh api --method GET -H 'Accept: application/octet-stream'");
  expect(publishContract).toContain('Uploaded asset hash differs from the verified bundle');
  expect(tagResolution).toBeGreaterThan(-1);
  expect(publication).toBeGreaterThan(tagResolution);
  expect(finalPublicationContract).toContain('$currentTagCommit -cne $env:SOURCE_SHA');
});

test('release workflow preserves its protected-source and signing gates', () => {
  expect(releaseWorkflow).toContain("Default branch '$defaultBranch' must be protected before a release can access production-signing.");
  expect(releaseWorkflow).toContain('Release tag commit $tagCommit is not the protected $defaultBranch tip $mainCommit.');
  expect(releaseWorkflow).toContain('NEXOIP_SIGNING_SUBJECT: ${{ vars.NEXOIP_SIGNING_SUBJECT }}');
  expect(releaseWorkflow).toContain("must be Authenticode Valid, but is $($signature.Status).");
  expect(releaseWorkflow).toContain('is missing a trusted Authenticode timestamp.');
  expect(releaseWorkflow).toContain('Packaged Electron runtime PE differs from verified official Electron');
  expect(releaseWorkflow).toContain('Revalidate SHA-256 checksums');
});

test('every PowerShell release step parses before a protected signing run', () => {
  const blocks = extractPowerShellRunBlocks(releaseWorkflow);
  expect(blocks.length).toBeGreaterThan(0);

  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', powerShellParser], {
    input: JSON.stringify(blocks),
    encoding: 'utf8',
  });
  const diagnostics = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n');
  expect(result.status, `PowerShell parse failed for a release.yml run block:\n${diagnostics}`).toBe(0);
});
