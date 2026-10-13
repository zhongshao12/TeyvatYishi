import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('desktop CI uses the verified frontend rather than an incidental local dist', () => {
  it('transfers the actual web build between isolated jobs before locked Rust compilation', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const desktop = workflow.slice(workflow.indexOf('  desktop-rust:'));
    const web = workflow.slice(workflow.indexOf('  build-test:'), workflow.indexOf('  desktop-rust:'));
    expect(desktop).toMatch(/needs:\s*build-test/);
    expect(web).toMatch(/uses:\s*actions\/upload-artifact@v4/);
    expect(web).toMatch(/name:\s*verified-frontend\s*\n\s*path:\s*dist\s*\n\s*if-no-files-found:\s*error/);
    expect(desktop).toMatch(/uses:\s*actions\/download-artifact@v4\s*\n\s*with:\s*\n\s*name:\s*verified-frontend\s*\n\s*path:\s*dist/);
    expect(desktop.indexOf('actions/download-artifact')).toBeLessThan(desktop.indexOf('cargo check --locked'));
    expect(workflow).not.toContain('continue-on-error');
    expect(readFileSync('src-tauri/tauri.conf.json', 'utf8')).toContain('"frontendDist": "../dist"');
  });
});
