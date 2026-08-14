import fs from 'node:fs';
import { expect, test } from 'vitest';

const releaseWorkflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('release workflow finishes attestations before reserving a GitHub Release', () => {
  const binaryAttestation = releaseWorkflow.indexOf('- name: Attest Windows binaries');
  const sbomAttestation = releaseWorkflow.indexOf('- name: Attest SBOM for Windows binaries');
  const draftReservation = releaseWorkflow.indexOf('- name: Atomically reserve a new immutable draft release');

  expect(binaryAttestation).toBeGreaterThan(-1);
  expect(sbomAttestation).toBeGreaterThan(binaryAttestation);
  expect(draftReservation).toBeGreaterThan(sbomAttestation);
});

test('failed publication removes only the matching unpublished draft so the immutable tag can be retried', () => {
  const cleanupStep = releaseWorkflow.indexOf('- name: Remove an unpublished draft after a failed publish attempt');
  const publishStep = releaseWorkflow.indexOf('- name: Upload assets and publish the reserved release');
  const cleanupContract = releaseWorkflow.slice(cleanupStep);

  expect(cleanupStep).toBeGreaterThan(publishStep);
  expect(cleanupContract).toContain("if: ${{ failure() && steps.create_release.outputs.release_id != '' }}");
  expect(cleanupContract).toContain('if (-not $release.draft)');
  expect(cleanupContract).toContain('$release.tag_name -cne $env:GITHUB_REF_NAME');
  expect(cleanupContract).not.toContain('$release.target_commitish');
  expect(cleanupContract).toContain('gh api --method DELETE $endpoint');
});

test('release workflow resolves the immutable tag again immediately before publication', () => {
  const publishStep = releaseWorkflow.indexOf('- name: Upload assets and publish the reserved release');
  const publishContract = releaseWorkflow.slice(publishStep, releaseWorkflow.indexOf('- name: Remove an unpublished draft', publishStep));
  const assetUpload = publishContract.indexOf('gh release upload');
  const tagResolution = publishContract.indexOf('$currentTagCommit = Resolve-TagCommit');
  const publication = publishContract.indexOf('gh api --method PATCH');

  expect(publishContract).toContain('SOURCE_SHA: ${{ needs.verify-release-source.outputs.source_sha }}');
  expect(assetUpload).toBeGreaterThan(-1);
  expect(tagResolution).toBeGreaterThan(assetUpload);
  expect(publication).toBeGreaterThan(tagResolution);
  expect(publishContract).toContain('$currentTagCommit -cne $env:SOURCE_SHA');
});
