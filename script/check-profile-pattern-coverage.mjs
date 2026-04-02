import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const CATALOG_PATH = path.join(ROOT, 'script', 'profile-risk-pattern-catalog.json');
const OUT_PATH = path.join(ROOT, 'generated_documents', 'profile_pattern_coverage_report.md');

function lower(s) {
  return String(s || '').toLowerCase();
}

function inferTags(patternText) {
  const p = lower(patternText);
  const tags = new Set();

  if (p.includes('verified') || p.includes('official')) tags.add('identity_verification');
  if (p.includes('username') || p.includes('impersonation') || p.includes('fan account') || p.includes('name mismatch')) tags.add('username_similarity');
  if (p.includes('bio')) tags.add('bio_keyword_risk');
  if (p.includes('emoji')) tags.add('bio_keyword_risk');
  if (p.includes('follower') || p.includes('following') || p.includes('followers spike')) tags.add('network_anomaly');
  if (p.includes('private accounts') || p.includes('recently created accounts') || p.includes('numeric usernames')) tags.add('follower_quality');
  if (p.includes('engagement') || p.includes('comments') || p.includes('like counts')) tags.add('engagement_authenticity');
  if (p.includes('posting') || p.includes('posts') || p.includes('inactivity') || p.includes('burst')) tags.add('posting_behavior');
  if (p.includes('caption') || p.includes('keyword') || p.includes('urgency') || p.includes('dm me') || p.includes('profit')) tags.add('caption_semantics');
  if (p.includes('link') || p.includes('telegram') || p.includes('whatsapp') || p.includes('discord') || p.includes('redirect') || p.includes('linktree')) tags.add('link_funnel');
  if (p.includes('scam') || p.includes('crypto') || p.includes('forex') || p.includes('binary options') || p.includes('nft') || p.includes('betting') || p.includes('recruitment') || p.includes('charity')) tags.add('niche_domain_risk');
  if (p.includes('change') || p.includes('repurposed') || p.includes('inactive') || p.includes('deleted') || p.includes('sold')) tags.add('lifecycle');
  if (p.includes('thumbnail') || p.includes('luxury') || p.includes('screenshots') || p.includes('ai-generated') || p.includes('stock photos')) tags.add('media_style');
  if (p.includes('report') || p.includes('complaint')) tags.add('report_density');

  return Array.from(tags);
}

const implemented = new Set([
  'identity_verification',
  'username_similarity',
  'bio_keyword_risk',
  'network_anomaly',
  'follower_quality',
  'engagement_authenticity',
  'posting_behavior',
  'caption_semantics',
  'link_funnel',
  'niche_domain_risk',
  'lifecycle',
  'report_density',
]);

const partial = new Set([
  'media_style',
]);

function tagStatus(tag) {
  if (implemented.has(tag)) return 'covered';
  if (partial.has(tag)) return 'partial';
  return 'missing';
}

function summarizeStatuses(tags) {
  if (tags.length === 0) return 'missing';
  const statuses = tags.map(tagStatus);
  if (statuses.every((s) => s === 'covered')) return 'covered';
  if (statuses.every((s) => s === 'missing')) return 'missing';
  return 'partial';
}

function main() {
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Catalog not found: ${CATALOG_PATH}`);
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const rows = [];
  const categoryTotals = [];
  let index = 1;

  for (const category of catalog.categories) {
    let covered = 0;
    let partialCount = 0;
    let missing = 0;

    for (const pattern of category.patterns) {
      const tags = inferTags(pattern);
      const status = summarizeStatuses(tags);
      if (status === 'covered') covered += 1;
      else if (status === 'partial') partialCount += 1;
      else missing += 1;

      rows.push({
        id: index,
        category: category.name,
        pattern,
        tags,
        status,
      });
      index += 1;
    }

    categoryTotals.push({
      category: category.name,
      total: category.patterns.length,
      covered,
      partial: partialCount,
      missing,
    });
  }

  const total = rows.length;
  const coveredTotal = rows.filter((r) => r.status === 'covered').length;
  const partialTotal = rows.filter((r) => r.status === 'partial').length;
  const missingTotal = rows.filter((r) => r.status === 'missing').length;

  const lines = [];
  lines.push('# Profile Pattern Coverage Report');
  lines.push('');
  lines.push(`Catalog: \`${path.relative(ROOT, CATALOG_PATH)}\``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total patterns: ${total}`);
  lines.push(`- Covered: ${coveredTotal}`);
  lines.push(`- Partial: ${partialTotal}`);
  lines.push(`- Missing: ${missingTotal}`);
  lines.push('');
  lines.push('## Category Breakdown');
  lines.push('');
  lines.push('| Category | Total | Covered | Partial | Missing |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of categoryTotals) {
    lines.push(`| ${row.category} | ${row.total} | ${row.covered} | ${row.partial} | ${row.missing} |`);
  }
  lines.push('');
  lines.push('## Missing/Partial Patterns');
  lines.push('');
  for (const row of rows.filter((r) => r.status !== 'covered')) {
    lines.push(`- [${row.id}] ${row.pattern} | status=${row.status} | tags=${row.tags.join(', ') || 'none'}`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This report checks feature-coverage mapping at the pattern level.');
  lines.push('- `covered` means at least one implemented signal family maps to the pattern and no mapped tags are missing.');
  lines.push('- `partial` means mixed mapped tags (some covered, some missing/partial).');
  lines.push('- `missing` means no mapped implemented signal family was found.');

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${lines.join('\n')}\n`, 'utf8');

  console.log(`Coverage report written: ${OUT_PATH}`);
  console.log(`Total=${total} Covered=${coveredTotal} Partial=${partialTotal} Missing=${missingTotal}`);
}

main();
