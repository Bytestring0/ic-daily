import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import { buildImageMessage, deliverDigest } from '../scripts/mail.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
const edition = { date: '2026-10-19', entries: [{ title: 'Chip news' }] };
const config = { enabled: true, host: 'smtp.example.com', port: 465, secure: true, user: 'sender@example.com', pass: 'private-test-password', from: 'sender@example.com', to: ['one@example.com', 'two@example.com'], site: 'https://example.com/ic-daily/' };

test('mail contains exactly one card image and a site link, with no embedded recipients or credentials', () => {
  const message = buildImageMessage(edition, png, config);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].cid, 'ic-daily-digest');
  assert.match(message.html, /cid:ic-daily-digest/);
  assert.match(message.html, /https:\/\/example.com\/ic-daily\/edition\/2026-10-19\//);
  const body = message.html + message.text;
  for (const privateValue of [config.user, config.pass, ...config.to]) assert.equal(body.includes(privateValue), false);
  assert.throws(() => buildImageMessage(edition, Buffer.from('not an image'), config), /PNG/);
});

test('individual SMTP envelopes hide other subscribers and disable unsafe remote content access', async () => {
  const calls = [];
  const result = await deliverDigest(edition, png, config, { createTransport: options => {
    assert.equal(options.auth.pass, config.pass);
    assert.equal(options.disableUrlAccess, true);
    assert.equal(options.debug, false);
    return { sendMail: async message => { calls.push(message); return { rejected: [] }; }, close() {} };
  } });
  assert.equal(result.sent, 2);
  assert.equal(calls[0].to, config.to[0]); assert.equal(calls[1].to, config.to[1]);
  assert.equal(calls[0].bcc, undefined); assert.equal(calls[0].cc, undefined);
  assert.equal(calls[0].to.includes(config.to[1]), false);
});

test('disabled mail never connects, and missing secrets cannot send', async () => {
  const result = await deliverDigest(edition, png, { enabled: false }, { createTransport: () => { throw Error('must not connect'); } });
  assert.equal(result.skipped, true);
  await assert.rejects(deliverDigest(edition, png, { ...config, pass: '' }), /Secrets/);
  await assert.rejects(deliverDigest(edition, png, { ...config, to: ['bad\r\nBcc: injected@example.com'] }), /地址/);
});

test('GitHub only sends after deployment, loading the recipient solely from Secrets', () => {
  const workflow = YAML.parse(fs.readFileSync('.github/workflows/daily.yml', 'utf8'));
  const notify = workflow.jobs.notify;
  assert.ok(notify.needs.includes('deploy'));
  assert.match(notify.if, /needs.deploy.result == 'success'/);
  const send = notify.steps.find(s => s.name === '发送图片日报');
  assert.equal(send.env.MAIL_TO, '${{ secrets.MAIL_TO }}');
  assert.equal(send.env.SMTP_PASS, '${{ secrets.SMTP_PASS }}');
  const artifact = notify.steps.find(s => s.name === '保存日报长图');
  assert.equal(artifact.with.path, '.cache/mail/digest.png');
});
