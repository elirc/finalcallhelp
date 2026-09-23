import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl, isTrustedAppUrlPure } from '../../src/main/security/urlPolicy';
import { EXTERNAL_LINK_ALLOWLIST } from '../../src/shared/constants';

describe('isAllowedExternalUrl', () => {
  it('allows allowlisted https links', () => {
    expect(isAllowedExternalUrl('https://ollama.com/download')).toBe(true);
    expect(isAllowedExternalUrl('https://console.groq.com/keys')).toBe(true);
    expect(isAllowedExternalUrl('https://openrouter.ai/keys')).toBe(true);
  });

  it('blocks non-https, lookalike hosts, and arbitrary paths on other hosts', () => {
    expect(isAllowedExternalUrl('http://ollama.com/download')).toBe(false);
    expect(isAllowedExternalUrl('https://ollama.com.evil.com/download')).toBe(false);
    expect(isAllowedExternalUrl('https://example.com/')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('file:///C:/Windows')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });

  it('accepts every allowlist entry verbatim (self-consistency)', () => {
    for (const url of EXTERNAL_LINK_ALLOWLIST) {
      expect(isAllowedExternalUrl(url), url).toBe(true);
    }
  });

  it('scopes path-restricted hosts: other paths on the same host are blocked', () => {
    expect(isAllowedExternalUrl('https://console.groq.com/')).toBe(false);
    expect(isAllowedExternalUrl('https://console.groq.com/settings/billing')).toBe(false);
    expect(isAllowedExternalUrl('https://ai.google.dev/')).toBe(false);
  });

  it('allows sub-paths under an allowlisted prefix', () => {
    expect(isAllowedExternalUrl('https://ollama.com/download/windows')).toBe(true);
    expect(isAllowedExternalUrl('https://huggingface.co/onnx-community/whisper-base')).toBe(true);
  });

  it('is not fooled by userinfo tricks or trailing-dot hosts', () => {
    expect(isAllowedExternalUrl('https://ollama.com@evil.com/download')).toBe(false);
    expect(isAllowedExternalUrl('https://ollama.com./download')).toBe(false);
  });

  it('normalizes scheme and host case', () => {
    expect(isAllowedExternalUrl('HTTPS://OLLAMA.COM/download')).toBe(true);
  });
});

describe('isTrustedAppUrlPure', () => {
  const entryPathSuffix = '/renderer/main_window/index.html';
  const packaged = { entryPathSuffix, allowAnyLocalhost: false };
  const entry =
    'file:///C:/Program%20Files/CueDeck/resources/app.asar/.vite/renderer/main_window/index.html';

  it('accepts the renderer entry file with or without a hash route', () => {
    expect(isTrustedAppUrlPure(entry, packaged)).toBe(true);
    expect(isTrustedAppUrlPure(`${entry}#/preferences/general`, packaged)).toBe(true);
    expect(isTrustedAppUrlPure(`${entry}#/`, packaged)).toBe(true);
  });

  it('ignores drive-letter and path case', () => {
    expect(
      isTrustedAppUrlPure('file:///c:/Users/X/App/.vite/Renderer/Main_Window/INDEX.html', packaged),
    ).toBe(true);
  });

  it('rejects other file: documents, including siblings of the entry', () => {
    expect(
      isTrustedAppUrlPure('file:///C:/app/.vite/renderer/main_window/other.html', packaged),
    ).toBe(false);
    expect(
      isTrustedAppUrlPure('file:///C:/app/.vite/renderer/main_window/index.html.evil', packaged),
    ).toBe(false);
    expect(isTrustedAppUrlPure('file:///C:/Users/X/Downloads/index.html', packaged)).toBe(false);
  });

  it('accepts localhost only for the exact dev origin or when any localhost is allowed', () => {
    expect(isTrustedAppUrlPure('http://localhost:5173/#/', packaged)).toBe(false);
    expect(
      isTrustedAppUrlPure('http://localhost:5173/#/', {
        entryPathSuffix,
        devOrigin: 'http://localhost:5173',
        allowAnyLocalhost: false,
      }),
    ).toBe(true);
    expect(
      isTrustedAppUrlPure('http://localhost:5174/', {
        entryPathSuffix,
        devOrigin: 'http://localhost:5173',
        allowAnyLocalhost: false,
      }),
    ).toBe(false);
    expect(
      isTrustedAppUrlPure('http://localhost:5173/', { entryPathSuffix, allowAnyLocalhost: true }),
    ).toBe(true);
    expect(
      isTrustedAppUrlPure('http://127.0.0.1:9999/', { entryPathSuffix, allowAnyLocalhost: true }),
    ).toBe(true);
    expect(
      isTrustedAppUrlPure('http://evil.test:5173/', { entryPathSuffix, allowAnyLocalhost: true }),
    ).toBe(false);
  });

  it('rejects remote and non-app schemes', () => {
    const loose = { entryPathSuffix, devOrigin: 'http://localhost:5173', allowAnyLocalhost: true };
    expect(isTrustedAppUrlPure('https://example.com', loose)).toBe(false);
    expect(isTrustedAppUrlPure('https://localhost:5173/', loose)).toBe(false);
    expect(isTrustedAppUrlPure('javascript:alert(1)', loose)).toBe(false);
    expect(isTrustedAppUrlPure('not a url', loose)).toBe(false);
  });
});
