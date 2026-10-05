import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.cwd());
const index=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
const db=fs.readFileSync(path.join(root,'src/db.js'),'utf8');
const migrate=fs.readFileSync(path.join(root,'src/migrate.js'),'utf8');
const workplace=fs.readFileSync(path.join(root,'src/routes/workplace.js'),'utf8');
const attendance=fs.readFileSync(path.join(root,'src/routes/attendance.js'),'utf8');
const leave=fs.readFileSync(path.join(root,'src/routes/leave.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'src/routes/admin.js'),'utf8');
const validate=fs.readFileSync(path.join(root,'src/validate.js'),'utf8');

assert.match(index,/health\/live/);
assert.match(index,/health\/ready/);
assert.match(index,/APP_VERSION/);
assert.match(index,/BUILD_SHA/);
assert.match(index,/X-Request-ID/);
assert.match(index,/GCS_BUCKET/);
assert.match(index,/APP_ORIGIN/);
assert.match(docker,/USER node/);
assert.match(docker,/STOPSIGNAL SIGTERM/);
assert.match(db,/connectTimeout: 10000/);
assert.match(db,/queueLimit: 20/);
assert.match(migrate,/GET_LOCK/);
assert.match(index,/requestTimeout=30000/);
assert.match(index,/headersTimeout=35000/);
assert.match(workplace,/uploadLimiter/);
assert.match(attendance,/attendanceMutationLimiter/);
assert.match(leave,/leaveMutationLimiter/);
assert.match(admin,/adminMutationLimiter/);
assert.match(admin,/system-health/);
assert.match(admin,/mysql_version/);
assert.match(validate,/request_id:req.requestId/);
assert.match(validate,/requestId: req.requestId/);

console.log('Production API contracts: PASS');
