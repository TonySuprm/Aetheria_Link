import { Request } from 'express';
import { envGet, envGetAppId, envGetAppName, envGetRequired, envIsProd, isElfHostedInstance } from './env';

describe('env', () => {
  test('envGet', () => {
    expect(envGet('NODE_ENV')).toBe('test');
  });

  test('envGetRequired set', () => {
    expect(envGetRequired('NODE_ENV')).toBe('test');
  });

  test('envGetRequired not set', () => {
    expect(() => envGetRequired('NOT_SET')).toThrow('Environment variable "NOT_SET" is not configured.');
  });

  test('envGetAppId', () => {
    expect(envGetAppId()).toBe('aethlink');

    process.env['MANIFEST_ID'] = 'aethlink.dev';
    expect(envGetAppId()).toBe('aethlink.dev');
    delete process.env['MANIFEST_ID'];
  });

  test('envGetAppName', () => {
    expect(envGetAppName()).toBe('AethLink');

    process.env['MANIFEST_NAME'] = 'AethLink | dev';
    expect(envGetAppName()).toBe('AethLink | dev');
    delete process.env['MANIFEST_NAME'];
  });

  test('envIsProd', () => {
    expect(envIsProd()).toBeFalsy();

    const previousNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    expect(envIsProd()).toBeTruthy();
    process.env['NODE_ENV'] = previousNodeEnv;
  });

  test('isElfHostedInstancce', () => {
    expect(isElfHostedInstance({ host: 'someuser.elfhosted.com' } as Request)).toBeTruthy();
    expect(isElfHostedInstance({ host: 'aetheria-link.hayd.uk' } as Request)).toBeFalsy();
  });
});
