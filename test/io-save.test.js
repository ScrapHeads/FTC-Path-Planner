import test from 'node:test';
import assert from 'node:assert/strict';
import { saveExport } from '../js/io_save.js';

const payload = { suggestedName: 'AutoPath.java', content: 'public class AutoPath {}', mime: 'text/plain' };

function setup(t, picker) {
  const downloads = [];
  const timers = [];
  const blobs = [];
  t.mock.method(globalThis, 'setTimeout', callback => timers.push(callback));
  t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return 'blob:export'; });
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  globalThis.window = picker ? { showSaveFilePicker: picker } : {};
  globalThis.document = {
    body: { appendChild(anchor) { anchor.attached = true; } },
    createElement() {
      return {
        click() { assert.equal(this.attached, true); downloads.push({ name: this.download, url: this.href }); },
        remove() { this.attached = false; }
      };
    }
  };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  return { downloads, timers, blobs, revoke };
}

test('successful native save writes and closes without downloading', async t => {
  const writes = [];
  const context = setup(t, async options => {
    assert.equal(options.suggestedName, payload.suggestedName);
    return { async createWritable() { return {
      async write(content) { writes.push(content); },
      async close() { writes.push('closed'); }
    }; } };
  });
  assert.equal(await saveExport(payload), 'saved');
  assert.deepEqual(writes, [payload.content, 'closed']);
  assert.equal(context.downloads.length, 0);
});

for (const name of ['NotAllowedError', 'SecurityError']) {
  test(`blocked native write (${name}) downloads the same content and filename`, async t => {
    const context = setup(t, async () => ({
      async createWritable() { throw new DOMException('Write blocked', name); }
    }));
    assert.equal(await saveExport(payload), 'downloaded');
    assert.deepEqual(context.downloads, [{ name: payload.suggestedName, url: 'blob:export' }]);
    assert.equal(await context.blobs[0].text(), payload.content);
    assert.equal(context.revoke.mock.callCount(), 0);
    context.timers[0]();
    assert.equal(context.revoke.mock.calls[0].arguments[0], 'blob:export');
  });
}

test('a denied directory permission downloads without opening another picker', async t => {
  const context = setup(t, () => assert.fail('Unexpected picker'));
  const directory = {
    async queryPermission() { return 'denied'; },
    async getFileHandle() { assert.fail('Unexpected file access'); }
  };
  assert.equal(await saveExport(payload, directory), 'downloaded');
  assert.equal(context.downloads.length, 1);
});

test('a chosen directory can grant permission and save directly', async t => {
  const context = setup(t, () => assert.fail('Unexpected picker'));
  let closed = false;
  const directory = {
    async queryPermission() { return 'prompt'; },
    async requestPermission(options) { assert.deepEqual(options, { mode: 'readwrite' }); return 'granted'; },
    async getFileHandle(name, options) {
      assert.equal(name, payload.suggestedName);
      assert.deepEqual(options, { create: true });
      return { async createWritable() { return {
        async write(content) { assert.equal(content, payload.content); },
        async close() { closed = true; }
      }; } };
    }
  };
  assert.equal(await saveExport(payload, directory), 'saved');
  assert.equal(closed, true);
  assert.equal(context.downloads.length, 0);
});

test('browsers without a file picker download normally', async t => {
  const context = setup(t);
  assert.equal(await saveExport(payload), 'downloaded');
  assert.equal(context.downloads.length, 1);
});

for (const name of ['AbortError', 'NotFoundError', 'NoModificationAllowedError']) {
  test(`${name} does not trigger an unexpected download`, async t => {
    const error = new DOMException('Save interrupted', name);
    const context = setup(t, async () => { throw error; });
    await assert.rejects(saveExport(payload), candidate => candidate === error);
    assert.equal(context.downloads.length, 0);
  });
}
