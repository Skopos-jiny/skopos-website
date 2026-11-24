// 사이트가 보내는 모든 퍼널 이벤트가 운영 DB 허용 목록(최신 SQL)에 있는지 확인
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('코드에서 보내는 이벤트는 모두 funnel_events 허용 목록에 있음', () => {
  const sqlDir = path.join(root, 'supabase/sql');
  const latest = fs.readdirSync(sqlDir).filter(f => /\.sql$/.test(f) &&
    /funnel_events_event_check check/.test(fs.readFileSync(path.join(sqlDir, f), 'utf8'))).sort().pop();
  const sql = fs.readFileSync(path.join(sqlDir, latest), 'utf8');
  const allowed = new Set([...sql.slice(sql.indexOf('funnel_events_event_check check')).matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
  const files = fs.readdirSync(root).filter(f => /\.(html|js)$/.test(f));
  const sent = new Set();
  for (const f of files) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/SkoposTrack\.event\(\s*'([a-z_]+)'|\bevent\('([a-z_]+)'/g)) sent.add(m[1] || m[2]);
  const missing = [...sent].filter(e => !allowed.has(e));
  assert.deepEqual(missing, [], 'allowlist에 없는 이벤트: ' + missing.join(', ') + ' (기준 ' + latest + ')');
});
