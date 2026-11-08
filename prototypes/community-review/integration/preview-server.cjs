const path = require('node:path');
const { createAuthenticatedActionApp } = require('./authenticated-app.cjs');
const { app } = createAuthenticatedActionApp({ dataDir: path.join(__dirname, 'preview-data') });
app.listen(Number(process.env.INTEGRATION_PORT || 3105), '127.0.0.1', () => console.log('Independent review: http://127.0.0.1:' + (process.env.INTEGRATION_PORT || 3105) + '/review/'));
