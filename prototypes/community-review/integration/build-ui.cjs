const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Script } = require('node:vm');
const { transformAccountReview } = require('./build-account-ui.cjs');
function buildReviewAssets(destination = path.join(__dirname, 'generated')) {
  const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const styles = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (styles.length !== 1 || scripts.length !== 1) throw Error('Review source must contain exactly one style/script block');
  const css = styles[0][1] + '\n' + fs.readFileSync(path.join(__dirname, 'review-discussion.css'), 'utf8'), js = transformAccountReview(scripts[0][1]);
  new Script(js, { filename: 'review.js' });
  const html = source.replace(styles[0][0], '<link rel="stylesheet" href="review.css">')
    .replace(scripts[0][0], '<script src="action-client.js" defer></script><script src="review.js" defer></script>');
  fs.mkdirSync(destination, { recursive: true });
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const manifest = { format: 'dianliang-review-build/v1', mode: 'independent-action-service',
    sourceSha256: hash(source), scriptSha256: hash(js), styleSha256: hash(css) };
  for (const [name, content] of [['index.html', html], ['review.css', css], ['review.js', js], ['manifest.json', JSON.stringify(manifest, null, 2)]])
    fs.writeFileSync(path.join(destination, name), content);
  fs.copyFileSync(path.join(__dirname, 'action-client.js'), path.join(destination, 'action-client.js'));
  return { destination: path.resolve(destination), manifest };
}
if (require.main === module) console.log(JSON.stringify(buildReviewAssets().manifest));
module.exports = { buildReviewAssets };
