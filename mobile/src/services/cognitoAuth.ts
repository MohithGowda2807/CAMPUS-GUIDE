import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import type { AuthProviderConfig } from '../types/campus';

WebBrowser.maybeCompleteAuthSession();

const SECURE_SESSION_KEY = 'rvce_cognito_session_v2';
const LEGACY_TOKEN_KEY = 'rvce_navigator_token';
const ALLOWED_INSTITUTIONAL_DOMAIN = 'rvce.edu.in';

export interface StoredCognitoSession {
  accessToken: string;
  idToken: string;
  refreshToken: string | null;
  expiresAtEpochMs: number;
  email?: string;
}

export interface MfaSetupDetails {
  secretCode: string;
  otpauthUri: string;
}

export type SignInOutcome =
  | { status: 'AUTHENTICATED'; session: StoredCognitoSession }
  | {
      status: 'MFA_REQUIRED';
      mfaSession: string;
      email: string;
      challengeType?: 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP';
      mfaSetup?: MfaSetupDetails;
    }
  | { status: 'EMAIL_VERIFICATION_REQUIRED'; email: string; devOtpHint?: string };

let memorySession: StoredCognitoSession | null = null;
let cachedProviderConfig: AuthProviderConfig | null = null;
let refreshPromise: Promise<string | null> | null = null;

// -----------------------------------------------------------------------------
// Validation & Anti-Enumeration Sanitization (Exported for Unit Testing)
// -----------------------------------------------------------------------------
export function validateRvceInstitutionalEmail(rawEmail: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const cleaned = (rawEmail || '').trim().toLowerCase();
  if (!cleaned) {
    return {
      valid: false,
      normalized: '',
      error: 'Enter your official @rvce.edu.in email address.',
    };
  }
  const parts = cleaned.split('@');
  if (parts.length !== 2) {
    return {
      valid: false,
      normalized: cleaned,
      error: 'Enter a valid @rvce.edu.in institutional email address.',
    };
  }
  const [local, domain] = parts;
  if (domain !== ALLOWED_INSTITUTIONAL_DOMAIN) {
    return {
      valid: false,
      normalized: cleaned,
      error: 'Only @rvce.edu.in institutional email addresses are eligible.',
    };
  }
  const localOk =
    /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(local) && !local.includes('..');
  if (!localOk) {
    return {
      valid: false,
      normalized: cleaned,
      error: 'Invalid email username format before @rvce.edu.in.',
    };
  }
  return { valid: true, normalized: `${local}@${ALLOWED_INSTITUTIONAL_DOMAIN}` };
}

export function validateStrongPassword(password: string): {
  valid: boolean;
  checks: {
    minLength: boolean;
    uppercase: boolean;
    lowercase: boolean;
    digit: boolean;
    symbol: boolean;
  };
  error?: string;
} {
  const pw = password || '';
  const checks = {
    minLength: pw.length >= 8 && pw.length <= 128,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    digit: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  const valid =
    checks.minLength && checks.uppercase && checks.lowercase && checks.digit && checks.symbol;
  return {
    valid,
    checks,
    error: valid
      ? undefined
      : 'Use at least 8 characters including uppercase, lowercase, number, and symbol.',
  };
}

export function toBase64Url(base64Str: string): string {
  return base64Str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function generatePkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}> {
  const verifierBytes = await Crypto.getRandomBytesAsync(32);
  const stateBytes = await Crypto.getRandomBytesAsync(16);

  const bytesToHex = (arr: Uint8Array) =>
    Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  const codeVerifier = bytesToHex(verifierBytes);
  const state = bytesToHex(stateBytes);
  const b64Digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  const codeChallenge = toBase64Url(b64Digest);

  return { codeVerifier, codeChallenge, state };
}

export function sanitizeAuthErrorMessage(err: unknown, context: 'LOGIN' | 'GENERAL' = 'GENERAL'): string {
  if (context === 'LOGIN') {
    if (err instanceof Error) {
      const lower = err.message.toLowerCase();
      if (lower.includes('network') || lower.includes('abort') || lower.includes('fetch')) {
        return 'Unable to reach authentication service. Check your connection and try again.';
      }
      if (lower.includes('too many') || lower.includes('429') || lower.includes('limit')) {
        return 'Too many sign-in attempts. Please wait a few minutes before trying again.';
      }
    }
    // Strict anti-enumeration generic failure message
    return 'Invalid institutional email or password.';
  }

  if (err instanceof Error && err.message) {
    const msg = err.message;
    if (msg.includes('AbortError') || msg.includes('Network request failed')) {
      return 'Network connection interrupted. Please check your internet or server connection.';
    }
    if (msg.length < 220 && !msg.includes('Traceback') && !msg.includes('SQL')) {
      return msg;
    }
  }
  return 'Unable to complete request right now. Please try again.';
}

// -----------------------------------------------------------------------------
// Android Keystore Encrypted Session Persistence (`expo-secure-store`)
// -----------------------------------------------------------------------------
export async function loadStoredSession(): Promise<StoredCognitoSession | null> {
  if (memorySession) return memorySession;
  try {
    // Clean up any legacy v2.0 token key if present
    await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY).catch(() => {});
    const raw = await SecureStore.getItemAsync(SECURE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCognitoSession;
    if (!parsed.accessToken || !parsed.idToken) return null;
    memorySession = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: StoredCognitoSession | null): Promise<void> {
  memorySession = session;
  try {
    if (!session) {
      await SecureStore.deleteItemAsync(SECURE_SESSION_KEY);
      await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY).catch(() => {});
    } else {
      await SecureStore.setItemAsync(SECURE_SESSION_KEY, JSON.stringify(session), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
  } catch {
    // Keep memory state if Keystore unavailable in test runner
  }
}

export function setAuthProviderConfig(cfg: AuthProviderConfig): void {
  cachedProviderConfig = cfg;
}

export async function ensureAuthProviderConfig(apiBaseUrl: string): Promise<AuthProviderConfig> {
  if (cachedProviderConfig) return cachedProviderConfig;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`${apiBaseUrl}/auth/config`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error('Unable to load authentication provider configuration.');
    }
    const cfg = (await res.json()) as AuthProviderConfig;
    cachedProviderConfig = cfg;
    return cfg;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Direct AWS Cognito Public Client JSON-RPC Helper (Zero Client Secret)
// -----------------------------------------------------------------------------
async function callAwsCognitoIdp<T>(
  endpoint: string,
  targetOperation: string,
  payload: Record<string, unknown>
): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${targetOperation}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errType = String(body.__type || '');
    const msg = String(body.message || body.Message || 'Authentication request failed.');
    const error = new Error(msg) as Error & { code?: string };
    error.code = errType;
    throw error;
  }
  return body as T;
}

async function callSandboxCognito<T>(
  cognitoBaseEndpoint: string,
  operation: string,
  payload: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${cognitoBaseEndpoint}/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Request failed.');
  }
  return body as T;
}

// -----------------------------------------------------------------------------
// Cognito Public Client Flows (Supports BOTH Live AWS Cognito & Local Dev OIDC)
// -----------------------------------------------------------------------------
export const cognitoClient = {
  /**
   * Standards-compliant OAuth 2.0 Authorization Code Flow with S256 PKCE
   * (`rvce-navigator://auth/callback`) — supports Cognito Managed Login & Passkeys!
   */
  signInWithOidcPkce: async (apiBaseUrl: string): Promise<StoredCognitoSession> => {
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);
    if (!cfg.authorization_endpoint || !cfg.token_endpoint) {
      throw new Error('OIDC Hosted UI domain is not configured on this User Pool yet.');
    }

    const { codeVerifier, codeChallenge, state } = await generatePkcePair();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.client_id,
      redirect_uri: cfg.redirect_uri,
      scope: 'openid profile email aws.cognito.signin.user.admin',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });

    const authUrl = `${cfg.authorization_endpoint}?${params.toString()}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, cfg.redirect_uri);
    if (result.type !== 'success' || !result.url) {
      throw new Error('Sign-in was cancelled.');
    }

    const parsedUrl = new URL(result.url);
    const returnedError = parsedUrl.searchParams.get('error');
    if (returnedError) {
      throw new Error(parsedUrl.searchParams.get('error_description') || 'Authentication denied.');
    }
    const returnedState = parsedUrl.searchParams.get('state');
    if (returnedState !== state) {
      throw new Error('Security state mismatch during OIDC callback.');
    }
    const code = parsedUrl.searchParams.get('code');
    if (!code) {
      throw new Error('Authorization code missing in callback.');
    }

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.client_id,
      code,
      redirect_uri: cfg.redirect_uri,
      code_verifier: codeVerifier,
    });

    const tokenRes = await fetch(cfg.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const tokJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokJson.access_token) {
      throw new Error(tokJson.error_description || 'Token exchange failed.');
    }

    const session: StoredCognitoSession = {
      accessToken: tokJson.access_token,
      idToken: tokJson.id_token || tokJson.access_token,
      refreshToken: tokJson.refresh_token || null,
      expiresAtEpochMs: Date.now() + Number(tokJson.expires_in || 900) * 1000,
    };
    await saveStoredSession(session);
    return session;
  },

  signUpStaff: async (
    apiBaseUrl: string,
    input: { email: string; fullName: string; password: string }
  ): Promise<{ userSub: string; confirmed: boolean; devOtpHint?: string }> => {
    const emailCheck = validateRvceInstitutionalEmail(input.email);
    if (!emailCheck.valid) throw new Error(emailCheck.error);
    const pwCheck = validateStrongPassword(input.password);
    if (!pwCheck.valid) throw new Error(pwCheck.error);

    const cfg = await ensureAuthProviderConfig(apiBaseUrl);
    if (cfg.provider_mode === 'AWS_COGNITO') {
      const res = await callAwsCognitoIdp<{ UserSub: string; UserConfirmed: boolean }>(
        cfg.cognito_idp_endpoint,
        'SignUp',
        {
          ClientId: cfg.client_id,
          Username: emailCheck.normalized,
          Password: input.password,
          UserAttributes: [
            { Name: 'email', Value: emailCheck.normalized },
            { Name: 'name', Value: input.fullName.trim() },
          ],
        }
      );
      return { userSub: res.UserSub, confirmed: Boolean(res.UserConfirmed) };
    }

    const res = await callSandboxCognito<{
      user_sub: string;
      user_confirmed: boolean;
      sandbox_dev_otp_hint?: string;
    }>(cfg.cognito_idp_endpoint, 'sign-up', {
      email: emailCheck.normalized,
      full_name: input.fullName.trim(),
      password: input.password,
    });
    return {
      userSub: res.user_sub,
      confirmed: res.user_confirmed,
      devOtpHint: res.sandbox_dev_otp_hint,
    };
  },

  confirmEmailOtp: async (apiBaseUrl: string, email: string, code: string): Promise<void> => {
    const emailCheck = validateRvceInstitutionalEmail(email);
    if (!emailCheck.valid) throw new Error(emailCheck.error);
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);

    if (cfg.provider_mode === 'AWS_COGNITO') {
      await callAwsCognitoIdp(cfg.cognito_idp_endpoint, 'ConfirmSignUp', {
        ClientId: cfg.client_id,
        Username: emailCheck.normalized,
        ConfirmationCode: code.trim(),
      });
      return;
    }

    await callSandboxCognito(cfg.cognito_idp_endpoint, 'confirm-sign-up', {
      email: emailCheck.normalized,
      code: code.trim(),
    });
  },

  resendEmailOtp: async (
    apiBaseUrl: string,
    email: string
  ): Promise<{ devOtpHint?: string }> => {
    const emailCheck = validateRvceInstitutionalEmail(email);
    if (!emailCheck.valid) throw new Error(emailCheck.error);
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);

    if (cfg.provider_mode === 'AWS_COGNITO') {
      await callAwsCognitoIdp(cfg.cognito_idp_endpoint, 'ResendConfirmationCode', {
        ClientId: cfg.client_id,
        Username: emailCheck.normalized,
      });
      return {};
    }

    const res = await callSandboxCognito<{ sandbox_dev_otp_hint?: string }>(
      cfg.cognito_idp_endpoint,
      'resend-confirmation-code',
      { email: emailCheck.normalized }
    );
    return { devOtpHint: res.sandbox_dev_otp_hint };
  },

  signInWithPassword: async (
    apiBaseUrl: string,
    email: string,
    password: string
  ): Promise<SignInOutcome> => {
    const emailCheck = validateRvceInstitutionalEmail(email);
    if (!emailCheck.valid) throw new Error(emailCheck.error);
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);

    if (cfg.provider_mode === 'AWS_COGNITO') {
      try {
        const res = await callAwsCognitoIdp<{
          ChallengeName?: string;
          Session?: string;
          AuthenticationResult?: {
            AccessToken: string;
            IdToken: string;
            RefreshToken?: string;
            ExpiresIn?: number;
          };
        }>(cfg.cognito_idp_endpoint, 'InitiateAuth', {
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: cfg.client_id,
          AuthParameters: {
            USERNAME: emailCheck.normalized,
            PASSWORD: password,
          },
        });

        if (res.ChallengeName === 'MFA_SETUP' && res.Session) {
          const assoc = await callAwsCognitoIdp<{ SecretCode: string; Session?: string }>(
            cfg.cognito_idp_endpoint,
            'AssociateSoftwareToken',
            { Session: res.Session }
          );
          const label = encodeURIComponent(emailCheck.normalized);
          return {
            status: 'MFA_REQUIRED',
            mfaSession: assoc.Session || res.Session,
            email: emailCheck.normalized,
            challengeType: 'MFA_SETUP',
            mfaSetup: {
              secretCode: assoc.SecretCode,
              otpauthUri: `otpauth://totp/RVCE%20Campus%20Navigator:${label}?secret=${assoc.SecretCode}&issuer=RVCE%20Campus%20Navigator`,
            },
          };
        }

        if (res.ChallengeName === 'SOFTWARE_TOKEN_MFA' && res.Session) {
          return {
            status: 'MFA_REQUIRED',
            mfaSession: res.Session,
            email: emailCheck.normalized,
            challengeType: 'SOFTWARE_TOKEN_MFA',
          };
        }

        if (!res.AuthenticationResult) {
          throw new Error('Unsupported authentication challenge.');
        }

        const session: StoredCognitoSession = {
          accessToken: res.AuthenticationResult.AccessToken,
          idToken: res.AuthenticationResult.IdToken,
          refreshToken: res.AuthenticationResult.RefreshToken || null,
          expiresAtEpochMs: Date.now() + (res.AuthenticationResult.ExpiresIn || 900) * 1000,
          email: emailCheck.normalized,
        };
        await saveStoredSession(session);
        return { status: 'AUTHENTICATED', session };
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code || '';
        if (code.includes('UserNotConfirmedException')) {
          return { status: 'EMAIL_VERIFICATION_REQUIRED', email: emailCheck.normalized };
        }
        throw err;
      }
    }

    const res = await callSandboxCognito<{
      challenge_name: string | null;
      session?: string;
      sandbox_dev_otp_hint?: string;
      secret_code?: string;
      otpauth_uri?: string;
      tokens?: {
        access_token: string;
        id_token: string;
        refresh_token: string;
        expires_in: number;
      };
    }>(cfg.cognito_idp_endpoint, 'sign-in', {
      email: emailCheck.normalized,
      password,
    });

    if (res.challenge_name === 'EMAIL_NOT_VERIFIED') {
      return {
        status: 'EMAIL_VERIFICATION_REQUIRED',
        email: emailCheck.normalized,
        devOtpHint: res.sandbox_dev_otp_hint,
      };
    }
    if (
      (res.challenge_name === 'MFA_SETUP' || res.challenge_name === 'SOFTWARE_TOKEN_MFA') &&
      res.session
    ) {
      return {
        status: 'MFA_REQUIRED',
        mfaSession: res.session,
        email: emailCheck.normalized,
        challengeType: res.challenge_name,
        mfaSetup: res.secret_code
          ? {
              secretCode: res.secret_code,
              otpauthUri:
                res.otpauth_uri ||
                `otpauth://totp/RVCE%20Campus%20Navigator:${encodeURIComponent(emailCheck.normalized)}?secret=${res.secret_code}&issuer=RVCE%20Campus%20Navigator`,
            }
          : undefined,
      };
    }
    if (!res.tokens) {
      throw new Error('Authentication failed.');
    }

    const session: StoredCognitoSession = {
      accessToken: res.tokens.access_token,
      idToken: res.tokens.id_token,
      refreshToken: res.tokens.refresh_token,
      expiresAtEpochMs: Date.now() + res.tokens.expires_in * 1000,
      email: emailCheck.normalized,
    };
    await saveStoredSession(session);
    return { status: 'AUTHENTICATED', session };
  },

  verifyMfaChallenge: async (
    apiBaseUrl: string,
    mfaSession: string,
    email: string,
    totpCode: string,
    challengeType: 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP' = 'SOFTWARE_TOKEN_MFA'
  ): Promise<StoredCognitoSession> => {
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);
    if (cfg.provider_mode === 'AWS_COGNITO') {
      if (challengeType === 'MFA_SETUP') {
        const verified = await callAwsCognitoIdp<{ Session?: string }>(
          cfg.cognito_idp_endpoint,
          'VerifySoftwareToken',
          {
            Session: mfaSession,
            UserCode: totpCode.trim(),
            FriendlyDeviceName: 'RVCE Staff Android Authenticator',
          }
        );
        const res = await callAwsCognitoIdp<{
          AuthenticationResult: {
            AccessToken: string;
            IdToken: string;
            RefreshToken?: string;
            ExpiresIn?: number;
          };
        }>(cfg.cognito_idp_endpoint, 'RespondToAuthChallenge', {
          ClientId: cfg.client_id,
          ChallengeName: 'MFA_SETUP',
          Session: verified.Session || mfaSession,
          ChallengeResponses: {
            USERNAME: email,
          },
        });
        const session: StoredCognitoSession = {
          accessToken: res.AuthenticationResult.AccessToken,
          idToken: res.AuthenticationResult.IdToken,
          refreshToken: res.AuthenticationResult.RefreshToken || null,
          expiresAtEpochMs: Date.now() + (res.AuthenticationResult.ExpiresIn || 900) * 1000,
          email,
        };
        await saveStoredSession(session);
        return session;
      }

      const res = await callAwsCognitoIdp<{
        AuthenticationResult: {
          AccessToken: string;
          IdToken: string;
          RefreshToken?: string;
          ExpiresIn?: number;
        };
      }>(cfg.cognito_idp_endpoint, 'RespondToAuthChallenge', {
        ClientId: cfg.client_id,
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        Session: mfaSession,
        ChallengeResponses: {
          USERNAME: email,
          SOFTWARE_TOKEN_MFA_CODE: totpCode.trim(),
        },
      });
      const session: StoredCognitoSession = {
        accessToken: res.AuthenticationResult.AccessToken,
        idToken: res.AuthenticationResult.IdToken,
        refreshToken: res.AuthenticationResult.RefreshToken || null,
        expiresAtEpochMs: Date.now() + (res.AuthenticationResult.ExpiresIn || 900) * 1000,
        email,
      };
      await saveStoredSession(session);
      return session;
    }

    const res = await callSandboxCognito<{
      tokens: {
        access_token: string;
        id_token: string;
        refresh_token: string;
        expires_in: number;
      };
    }>(cfg.cognito_idp_endpoint, 'respond-mfa', {
      session: mfaSession,
      code: totpCode.trim(),
    });
    const session: StoredCognitoSession = {
      accessToken: res.tokens.access_token,
      idToken: res.tokens.id_token,
      refreshToken: res.tokens.refresh_token,
      expiresAtEpochMs: Date.now() + res.tokens.expires_in * 1000,
      email,
    };
    await saveStoredSession(session);
    return session;
  },

  requestPasswordReset: async (
    apiBaseUrl: string,
    email: string
  ): Promise<{ devOtpHint?: string }> => {
    const emailCheck = validateRvceInstitutionalEmail(email);
    if (!emailCheck.valid) throw new Error(emailCheck.error);
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);

    if (cfg.provider_mode === 'AWS_COGNITO') {
      await callAwsCognitoIdp(cfg.cognito_idp_endpoint, 'ForgotPassword', {
        ClientId: cfg.client_id,
        Username: emailCheck.normalized,
      }).catch(() => {
        // Suppress enumeration differences
      });
      return {};
    }

    const res = await callSandboxCognito<{ sandbox_dev_otp_hint?: string }>(
      cfg.cognito_idp_endpoint,
      'forgot-password',
      { email: emailCheck.normalized }
    );
    return { devOtpHint: res.sandbox_dev_otp_hint };
  },

  confirmPasswordReset: async (
    apiBaseUrl: string,
    email: string,
    code: string,
    newPassword: string
  ): Promise<void> => {
    const emailCheck = validateRvceInstitutionalEmail(email);
    if (!emailCheck.valid) throw new Error(emailCheck.error);
    const pwCheck = validateStrongPassword(newPassword);
    if (!pwCheck.valid) throw new Error(pwCheck.error);
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);

    if (cfg.provider_mode === 'AWS_COGNITO') {
      await callAwsCognitoIdp(cfg.cognito_idp_endpoint, 'ConfirmForgotPassword', {
        ClientId: cfg.client_id,
        Username: emailCheck.normalized,
        ConfirmationCode: code.trim(),
        Password: newPassword,
      });
      return;
    }

    await callSandboxCognito(cfg.cognito_idp_endpoint, 'confirm-forgot-password', {
      email: emailCheck.normalized,
      code: code.trim(),
      new_password: newPassword,
    });
  },

  beginTotpEnrolment: async (
    apiBaseUrl: string
  ): Promise<{ secretCode: string; otpauthUri: string }> => {
    const session = await loadStoredSession();
    if (!session) throw new Error('Active session required.');
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);

    if (cfg.provider_mode === 'AWS_COGNITO') {
      const res = await callAwsCognitoIdp<{ SecretCode: string }>(
        cfg.cognito_idp_endpoint,
        'AssociateSoftwareToken',
        { AccessToken: session.accessToken }
      );
      const label = encodeURIComponent(session.email || 'staff@rvce.edu.in');
      return {
        secretCode: res.SecretCode,
        otpauthUri: `otpauth://totp/RVCE%20Campus%20Navigator:${label}?secret=${res.SecretCode}&issuer=RVCE%20Campus%20Navigator`,
      };
    }

    const res = await callSandboxCognito<{ secret_code: string; otpauth_uri: string }>(
      cfg.cognito_idp_endpoint,
      'associate-totp',
      { access_token: session.accessToken }
    );
    return { secretCode: res.secret_code, otpauthUri: res.otpauth_uri };
  },

  verifyTotpEnrolment: async (apiBaseUrl: string, code: string): Promise<void> => {
    const session = await loadStoredSession();
    if (!session) throw new Error('Active session required.');
    const cfg = await ensureAuthProviderConfig(apiBaseUrl);

    if (cfg.provider_mode === 'AWS_COGNITO') {
      await callAwsCognitoIdp(cfg.cognito_idp_endpoint, 'VerifySoftwareToken', {
        AccessToken: session.accessToken,
        UserCode: code.trim(),
        FriendlyDeviceName: 'RVCE Staff Android Authenticator',
      });
      await callAwsCognitoIdp(cfg.cognito_idp_endpoint, 'SetUserMFAPreference', {
        AccessToken: session.accessToken,
        SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
      });
      return;
    }

    await callSandboxCognito(cfg.cognito_idp_endpoint, 'verify-totp', {
      access_token: session.accessToken,
      code: code.trim(),
    });
  },

  getValidToken: async (
    apiBaseUrl: string,
    preferIdToken = false
  ): Promise<string | null> => {
    const session = await loadStoredSession();
    if (!session) return null;

    // Refresh proactively if within 45 seconds of expiration
    if (Date.now() < session.expiresAtEpochMs - 45_000) {
      return preferIdToken ? session.idToken : session.accessToken;
    }

    if (!session.refreshToken) {
      await saveStoredSession(null);
      return null;
    }

    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const cfg = await ensureAuthProviderConfig(apiBaseUrl);
          if (cfg.provider_mode === 'AWS_COGNITO') {
            const res = await callAwsCognitoIdp<{
              AuthenticationResult: {
                AccessToken: string;
                IdToken?: string;
                ExpiresIn?: number;
              };
            }>(cfg.cognito_idp_endpoint, 'InitiateAuth', {
              AuthFlow: 'REFRESH_TOKEN_AUTH',
              ClientId: cfg.client_id,
              AuthParameters: { REFRESH_TOKEN: session.refreshToken },
            });
            const updated: StoredCognitoSession = {
              accessToken: res.AuthenticationResult.AccessToken,
              idToken: res.AuthenticationResult.IdToken || session.idToken,
              refreshToken: session.refreshToken,
              expiresAtEpochMs: Date.now() + (res.AuthenticationResult.ExpiresIn || 900) * 1000,
              email: session.email,
            };
            await saveStoredSession(updated);
            return preferIdToken ? updated.idToken : updated.accessToken;
          }

          if (!cfg.token_endpoint) throw new Error('No token endpoint');
          const res = await fetch(cfg.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'refresh_token',
              client_id: cfg.client_id,
              refresh_token: session.refreshToken,
            }),
          });
          const body = await res.json();
          if (!res.ok || !body.access_token) throw new Error('Refresh rejected');
          const updated: StoredCognitoSession = {
            accessToken: body.access_token,
            idToken: body.id_token || session.idToken,
            refreshToken: body.refresh_token || session.refreshToken,
            expiresAtEpochMs: Date.now() + Number(body.expires_in || 900) * 1000,
            email: session.email,
          };
          await saveStoredSession(updated);
          return preferIdToken ? updated.idToken : updated.accessToken;
        } catch {
          await saveStoredSession(null);
          return null;
        } finally {
          refreshPromise = null;
        }
      })();
    }

    return refreshPromise;
  },

  revokeCognitoSession: async (apiBaseUrl: string, globalSignOut = false): Promise<void> => {
    const session = await loadStoredSession();
    try {
      if (session) {
        const cfg = await ensureAuthProviderConfig(apiBaseUrl).catch(() => null);
        if (cfg) {
          if (cfg.provider_mode === 'AWS_COGNITO') {
            if (globalSignOut) {
              await callAwsCognitoIdp(cfg.cognito_idp_endpoint, 'GlobalSignOut', {
                AccessToken: session.accessToken,
              }).catch(() => {});
            }
            if (session.refreshToken) {
              await callAwsCognitoIdp(cfg.cognito_idp_endpoint, 'RevokeToken', {
                ClientId: cfg.client_id,
                Token: session.refreshToken,
              }).catch(() => {});
            }
          } else {
            if (globalSignOut) {
              await callSandboxCognito(cfg.cognito_idp_endpoint, 'global-sign-out', {
                access_token: session.accessToken,
              }).catch(() => {});
            }
            if (session.refreshToken && cfg.revocation_endpoint) {
              await fetch(cfg.revocation_endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: session.refreshToken }),
              }).catch(() => {});
            }
          }
        }
      }
    } finally {
      await saveStoredSession(null);
    }
  },
};
