import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

describe('Context Lite Mode', () => {
  it('should have agent-context-lite.md file', () => {
    const litePath = new URL('../../agent-context-lite.md', import.meta.url);
    assert.ok(
      fs.existsSync(litePath),
      'agent-context-lite.md should exist'
    );
  });

  it('should have lite as valid context strip mode', () => {
    const configSrc = fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8');
    assert.ok(
      configSrc.includes("'lite'"),
      'config.ts should have lite as valid mode'
    );
  });

  it('should handle lite mode in context-injector.ts', () => {
    const injectorSrc = fs.readFileSync(new URL('../src/context-injector.ts', import.meta.url), 'utf-8');
    assert.ok(
      injectorSrc.includes("contextStripMode === 'lite'"),
      'context-injector.ts should handle lite mode'
    );
    assert.ok(
      injectorSrc.includes('getLiteContextContent'),
      'context-injector.ts should have getLiteContextContent function'
    );
  });

  it('should have agent-context-lite.md with required sections', () => {
    const liteContent = fs.readFileSync(new URL('../../agent-context-lite.md', import.meta.url), 'utf-8');
    assert.ok(liteContent.includes('Quick Reference'), 'Should have Quick Reference');
    assert.ok(liteContent.includes('Golden Rules'), 'Should have Golden Rules');
    assert.ok(liteContent.includes('Decision Engine'), 'Should have Decision Engine');
    assert.ok(liteContent.includes('Subagent Doctrine'), 'Should have Subagent Doctrine');
    assert.ok(liteContent.includes('Background Task'), 'Should have Background Task');
    assert.ok(liteContent.includes('Verification'), 'Should have Verification');
    assert.ok(liteContent.includes('Error Recovery'), 'Should have Error Recovery');
  });

  it('should be significantly shorter than original', () => {
    const originalPath = new URL('../../agent-context.md', import.meta.url);
    const litePath = new URL('../../agent-context-lite.md', import.meta.url);

    if (fs.existsSync(originalPath) && fs.existsSync(litePath)) {
      const originalSize = fs.statSync(originalPath).size;
      const liteSize = fs.statSync(litePath).size;
      assert.ok(
        liteSize < originalSize * 0.5,
        `Lite version should be less than 50% of original (original: ${originalSize}, lite: ${liteSize})`
      );
    }
  });
});
