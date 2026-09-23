import { describe, expect, it } from 'vitest';
import {
  modelsCancelDownloadSchema,
  modelsRemoveSchema,
  openPreferencesSchema,
  preferencesSectionSchema,
  providersProbeSchema,
} from '../../src/shared/schemas';

/** Request schemas added in the 2026-09 round (deep links, probe cache, cancel-download). */
describe('openPreferencesSchema', () => {
  it('accepts no payload, an empty object, and every known section', () => {
    expect(openPreferencesSchema.parse(undefined)).toBeUndefined();
    expect(openPreferencesSchema.parse({})).toEqual({});
    for (const section of preferencesSectionSchema.options) {
      expect(openPreferencesSchema.parse({ section })).toEqual({ section });
    }
  });

  it('rejects unknown sections', () => {
    expect(openPreferencesSchema.safeParse({ section: 'secrets' }).success).toBe(false);
    expect(openPreferencesSchema.safeParse({ section: '' }).success).toBe(false);
  });
});

describe('providersProbeSchema', () => {
  it('takes an optional fresh flag and nothing else', () => {
    expect(providersProbeSchema.parse({ providerId: 'ollama' })).toEqual({ providerId: 'ollama' });
    expect(providersProbeSchema.parse({ providerId: 'ollama', fresh: true }).fresh).toBe(true);
    expect(providersProbeSchema.safeParse({ providerId: 'ollama', fresh: 'yes' }).success).toBe(
      false,
    );
    expect(providersProbeSchema.safeParse({ providerId: '' }).success).toBe(false);
  });
});

describe('modelsCancelDownloadSchema', () => {
  it('requires a UUID operation id', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(modelsCancelDownloadSchema.parse({ operationId: id }).operationId).toBe(id);
    expect(modelsCancelDownloadSchema.safeParse({ operationId: 'abc' }).success).toBe(false);
    expect(modelsCancelDownloadSchema.safeParse({}).success).toBe(false);
    expect(modelsCancelDownloadSchema.safeParse(null).success).toBe(false);
  });
});

describe('modelsRemoveSchema', () => {
  it('takes a bounded model id and nothing else', () => {
    expect(modelsRemoveSchema.parse({ modelId: 'onnx-community/whisper-base' })).toEqual({
      modelId: 'onnx-community/whisper-base',
    });
    expect(modelsRemoveSchema.safeParse({ modelId: '' }).success).toBe(false);
    expect(modelsRemoveSchema.safeParse({ modelId: 'x'.repeat(201) }).success).toBe(false);
    expect(modelsRemoveSchema.safeParse({}).success).toBe(false);
    expect(modelsRemoveSchema.safeParse({ modelId: 42 }).success).toBe(false);
  });
});
