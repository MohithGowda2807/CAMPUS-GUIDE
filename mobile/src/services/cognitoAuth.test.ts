import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const keystoreMap = new Map<string, string>();

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async (key: string) => keystoreMap.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, val: string) => {
    keystoreMap.set(key, val);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    keystoreMap.delete(key);
  }),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
  getRandomBytesAsync: vi.fn(async (byteCount: number) => new Uint8Array(randomBytes(byteCount))),
  digestStringAsync: vi.fn(async (_algo: string, data: string) =>
    createHash('sha256').update(data, 'utf8').digest('base64')
  ),
}));

import {
  generatePkcePair,
  loadStoredSession,
  sanitizeAuthErrorMessage,
  saveStoredSession,
  toBase64Url,
  validateRvceInstitutionalEmail,
  validateStrongPassword,
} from './cognitoAuth';

describe('RVCE Cognito OIDC & Security Controls (OWASP MASVS-AUTH / MASVS-STORAGE)', () => {
  beforeEach(async () => {
    keystoreMap.clear();
    await saveStoredSession(null);
  });

  it('normalizes valid @rvce.edu.in institutional emails', () => {
    const res = validateRvceInstitutionalEmail('  Dr.Shobha.G@RVCE.EDU.IN  ');
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe('dr.shobha.g@rvce.edu.in');
  });

  it('strictly rejects non-rvce domains, subdomains, lookalike suffixes, and malformed local parts', () => {
    const invalidEmails = [
      '',
      'visitor@gmail.com',
      'attacker@rvce.edu.in.evil.com',
      'user@sub.rvce.edu.in',
      'user@rvce.ac.in',
      'double..dot@rvce.edu.in',
      '.leadingdot@rvce.edu.in',
      'two@at@rvce.edu.in',
    ];
    for (const candidate of invalidEmails) {
      const check = validateRvceInstitutionalEmail(candidate);
      expect(check.valid, `Expected ${candidate} to be rejected`).toBe(false);
    }
  });

  it('enforces Cognito strong password policy checks', () => {
    expect(validateStrongPassword('short1!A').valid).toBe(true);
    expect(validateStrongPassword('RvceAuth#2026').valid).toBe(true);
    expect(validateStrongPassword('alllowercase1!').valid).toBe(false);
    expect(validateStrongPassword('ALLUPPERCASE1!').valid).toBe(false);
    expect(validateStrongPassword('NoDigitsHere!').valid).toBe(false);
    expect(validateStrongPassword('NoSymbols2026').valid).toBe(false);
    expect(validateStrongPassword('Ab1!').valid).toBe(false);
  });

  it('generates RFC-7636 S256 PKCE verifier and matching SHA-256 Base64URL challenge', async () => {
    expect(toBase64Url('abc+def/ghi==')).toBe('abc-def_ghi');

    const pkce = await generatePkcePair();
    expect(pkce.codeVerifier.length).toBe(64);
    expect(pkce.state.length).toBe(32);
    expect(pkce.codeChallenge).not.toContain('+');
    expect(pkce.codeChallenge).not.toContain('/');
    expect(pkce.codeChallenge).not.toContain('=');

    const expectedChallenge = createHash('sha256')
      .update(pkce.codeVerifier, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    expect(pkce.codeChallenge).toBe(expectedChallenge);
  });

  it('prevents account enumeration on LOGIN and strips internal stack/SQL details', () => {
    const userNotFound = new Error('UserNotFoundException: User does not exist.');
    const wrongPassword = new Error('NotAuthorizedException: Incorrect username or password.');
    expect(sanitizeAuthErrorMessage(userNotFound, 'LOGIN')).toBe(
      'Invalid institutional email or password.'
    );
    expect(sanitizeAuthErrorMessage(wrongPassword, 'LOGIN')).toBe(
      'Invalid institutional email or password.'
    );

    const rateLimited = new Error('429 Too many login attempts');
    expect(sanitizeAuthErrorMessage(rateLimited, 'LOGIN')).toContain('Too many sign-in attempts');

    const sqlLeak = new Error('SQL syntax error near SELECT * FROM users');
    expect(sanitizeAuthErrorMessage(sqlLeak, 'GENERAL')).toBe(
      'Unable to complete request right now. Please try again.'
    );
  });

  it('persists OIDC tokens in Keystore and wipes session + legacy keys on sign-out', async () => {
    keystoreMap.set('rvce_navigator_token', 'legacy-v1-token');
    expect(await loadStoredSession()).toBeNull();
    expect(keystoreMap.has('rvce_navigator_token')).toBe(false);

    await saveStoredSession({
      accessToken: 'eyJ.access.rs256',
      idToken: 'eyJ.id.rs256',
      refreshToken: 'opaque-refresh-token',
      expiresAtEpochMs: Date.now() + 900_000,
      email: 'hod.cse@rvce.edu.in',
    });

    const loaded = await loadStoredSession();
    expect(loaded?.email).toBe('hod.cse@rvce.edu.in');
    expect(keystoreMap.has('rvce_cognito_session_v2')).toBe(true);

    // Sign out wipes Keystore completely
    await saveStoredSession(null);
    expect(await loadStoredSession()).toBeNull();
    expect(keystoreMap.has('rvce_cognito_session_v2')).toBe(false);
  });
});
