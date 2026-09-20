import { describe, expect, it } from 'vitest';
import { describeApiErrorCode, toUserFacingError } from '@/utils/userFacingError';

describe('userFacingError', () => {
  it('maps network failures to an actionable Chinese message', () => {
    expect(toUserFacingError(new TypeError('Failed to fetch'))).toBe('网络不可用，请检查连接');
    expect(toUserFacingError(new Error('NetworkError when attempting to fetch resource.'))).toBe('网络不可用，请检查连接');
    expect(toUserFacingError(new Error('Load failed'))).toBe('网络不可用，请检查连接');
  });

  it('maps timeouts separately from a hard connection failure', () => {
    expect(toUserFacingError(new Error('请求超时：The operation timed out'))).toContain('超时');
    expect(toUserFacingError(new Error('ETIMEDOUT'))).toContain('超时');
  });

  it('maps API Error codes to per-code Chinese explanations', () => {
    expect(toUserFacingError(new Error('API Error 401'))).toContain('API Key');
    expect(toUserFacingError(new Error('API Error 403'))).toContain('API Key');
    expect(toUserFacingError(new Error('API Error 404'))).toContain('接口地址');
    expect(toUserFacingError(new Error('API Error 429'))).toContain('过于频繁');
    expect(toUserFacingError(new Error('API Error 503'))).toContain('服务');
    expect(toUserFacingError(new Error('API Error 418'))).toContain('418');
  });

  it('never leaks a raw provider body or an English transport string to the player', () => {
    const providerBody = '{"error":{"message":"invalid_request_error: messages must alternate","type":"invalid_request_error"}}';
    const mapped = toUserFacingError(new Error(providerBody));

    expect(mapped).not.toContain('invalid_request_error');
    expect(mapped).not.toContain('{');
    expect(mapped).toBe('请求失败，请重试或检查接口设置');
    expect(toUserFacingError(new Error('No response body'))).toBe('接口没有返回内容，请检查接口设置');
    expect(toUserFacingError(new Error('Unexpected token < in JSON at position 0'))).toBe('接口返回的内容不是有效数据，请检查接口设置');
  });

  it('keeps our own already-localized messages intact', () => {
    expect(toUserFacingError(new Error('存档包中没有可导入的存档节点。'))).toBe('存档包中没有可导入的存档节点。');
  });

  it('falls back with the caller action and never prints the raw object', () => {
    expect(toUserFacingError(new Error('boom'), { action: '保存' })).toBe('保存失败，请重试或检查接口设置');
    expect(toUserFacingError(undefined, { action: '读取存档' })).toBe('读取存档失败，请重试或检查接口设置');
    expect(toUserFacingError({ message: 'odd' })).toBe('请求失败，请重试或检查接口设置');
    expect(toUserFacingError(new Error('AbortError: signal is aborted without reason'))).toBe('请求已取消');
  });

  it('describes known status codes and degrades gracefully for unknown ones', () => {
    expect(describeApiErrorCode(400)).toContain('400');
    expect(describeApiErrorCode(401)).toContain('API Key');
    expect(describeApiErrorCode(599)).toContain('599');
  });
});
