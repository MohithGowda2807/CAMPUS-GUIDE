import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AuthProviderConfig, OnboardingStatus, UserProfile } from '../types/campus';
import { ApiHttpError, campusApi, getApiBaseUrl, initStorage } from '../services/api';
import {
  cognitoClient,
  ensureAuthProviderConfig,
  loadStoredSession,
  sanitizeAuthErrorMessage,
  type MfaSetupDetails,
} from '../services/cognitoAuth';

export type AuthStage =
  | 'LOADING'
  | 'UNAUTHENTICATED'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'MFA_REQUIRED'
  | 'PENDING_APPROVAL'
  | 'REJECTED_OR_SUSPENDED'
  | 'AUTHENTICATED';

interface PendingRegistrationDraft {
  fullName: string;
  email: string;
  password?: string;
  termsAccepted: boolean;
}

interface AuthContextType {
  user: UserProfile | null;
  authStage: AuthStage;
  onboardingStatus: OnboardingStatus | null;
  statusReason: string | null;
  pendingEmail: string;
  mfaChallengeType: 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP';
  mfaSetupDetails: MfaSetupDetails | null;
  providerConfig: AuthProviderConfig | null;
  devOtpHint: string | null;
  sessionExpiredNotice: string | null;
  loading: boolean;
  clearNotices: () => void;
  signInWithPassword: (email: string, password: string) => Promise<AuthStage>;
  signInWithOidcPkce: () => Promise<AuthStage>;
  verifyMfaCode: (totpCode: string) => Promise<AuthStage>;
  registerStaffAccount: (input: {
    fullName: string;
    email: string;
    password: string;
    termsAccepted: boolean;
  }) => Promise<{ nextStage: AuthStage; devOtpHint?: string }>;
  confirmEmailVerification: (email: string, otpCode: string) => Promise<AuthStage>;
  resendEmailVerification: (email: string) => Promise<{ devOtpHint?: string }>;
  requestPasswordReset: (email: string) => Promise<{ devOtpHint?: string }>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>;
  refreshSessionState: () => Promise<AuthStage>;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAllSessions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authStage, setAuthStage] = useState<AuthStage>('LOADING');
  const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string>('');
  const [mfaChallengeType, setMfaChallengeType] = useState<'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP'>(
    'SOFTWARE_TOKEN_MFA'
  );
  const [mfaSetupDetails, setMfaSetupDetails] = useState<MfaSetupDetails | null>(null);
  const [providerConfig, setProviderConfig] = useState<AuthProviderConfig | null>(null);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const mfaSessionRef = useRef<string | null>(null);
  const regDraftRef = useRef<PendingRegistrationDraft | null>(null);

  const clearNotices = useCallback(() => {
    setDevOtpHint(null);
    setSessionExpiredNotice(null);
  }, []);

  const syncBackendOnboarding = useCallback(
    async (draftOverride?: PendingRegistrationDraft | null): Promise<AuthStage> => {
      try {
        const st = await campusApi.getSessionStatus();
        setOnboardingStatus(st.onboarding_status);
        setStatusReason(st.status_reason);
        if (st.email) setPendingEmail(st.email);

        if (st.onboarding_status === 'UNREGISTERED_PROFILE') {
          const draft = draftOverride || regDraftRef.current;
          const fallbackName =
            draft?.fullName ||
            (st.email ? st.email.split('@')[0].replace(/[._-]+/g, ' ') : 'RVCE Staff Member');
          const syncEmail = draft?.email || st.email || pendingEmail;
          if (!syncEmail) {
            setUser(null);
            setAuthStage('UNAUTHENTICATED');
            return 'UNAUTHENTICATED';
          }
          const completed = await campusApi.completeStaffRegistration({
            full_name: fallbackName,
            email: syncEmail,
            terms_accepted: draft?.termsAccepted ?? true,
          });
          regDraftRef.current = null;
          setOnboardingStatus(completed.onboarding_status);
          setStatusReason(completed.status_reason);
          if (completed.onboarding_status === 'APPROVED' && completed.user) {
            setUser(completed.user);
            setAuthStage('AUTHENTICATED');
            return 'AUTHENTICATED';
          }
          if (completed.onboarding_status === 'PENDING_APPROVAL') {
            setUser(null);
            setAuthStage('PENDING_APPROVAL');
            return 'PENDING_APPROVAL';
          }
          setUser(null);
          setAuthStage('REJECTED_OR_SUSPENDED');
          return 'REJECTED_OR_SUSPENDED';
        }

        if (st.onboarding_status === 'APPROVED' && st.user) {
          regDraftRef.current = null;
          setUser(st.user);
          setAuthStage('AUTHENTICATED');
          return 'AUTHENTICATED';
        }

        if (st.onboarding_status === 'PENDING_APPROVAL') {
          setUser(null);
          setAuthStage('PENDING_APPROVAL');
          return 'PENDING_APPROVAL';
        }

        setUser(null);
        setAuthStage('REJECTED_OR_SUSPENDED');
        return 'REJECTED_OR_SUSPENDED';
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 401) {
          await cognitoClient.revokeCognitoSession(getApiBaseUrl(), false);
          setUser(null);
          setOnboardingStatus(null);
          setSessionExpiredNotice('Your staff session expired or was signed out. Please sign in again.');
          setAuthStage('UNAUTHENTICATED');
          return 'UNAUTHENTICATED';
        }
        throw err;
      }
    },
    [pendingEmail]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await initStorage();
        const cfg = await ensureAuthProviderConfig(getApiBaseUrl()).catch(() => null);
        if (mounted && cfg) setProviderConfig(cfg);

        const stored = await loadStoredSession();
        if (!stored) {
          if (mounted) {
            setAuthStage('UNAUTHENTICATED');
            setLoading(false);
          }
          return;
        }
        if (mounted) {
          await syncBackendOnboarding();
        }
      } catch {
        if (mounted) {
          setUser(null);
          setAuthStage('UNAUTHENTICATED');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [syncBackendOnboarding]);

  const signInWithPassword = async (email: string, password: string): Promise<AuthStage> => {
    setSessionExpiredNotice(null);
    setDevOtpHint(null);
    const baseUrl = getApiBaseUrl();
    try {
      const cfg = await ensureAuthProviderConfig(baseUrl);
      setProviderConfig(cfg);
      const outcome = await cognitoClient.signInWithPassword(baseUrl, email, password);

      if (outcome.status === 'EMAIL_VERIFICATION_REQUIRED') {
        setPendingEmail(outcome.email);
        setDevOtpHint(outcome.devOtpHint || null);
        setAuthStage('EMAIL_VERIFICATION_REQUIRED');
        return 'EMAIL_VERIFICATION_REQUIRED';
      }

      if (outcome.status === 'MFA_REQUIRED') {
        mfaSessionRef.current = outcome.mfaSession;
        setPendingEmail(outcome.email);
        setMfaChallengeType(outcome.challengeType || 'SOFTWARE_TOKEN_MFA');
        setMfaSetupDetails(outcome.mfaSetup || null);
        setAuthStage('MFA_REQUIRED');
        return 'MFA_REQUIRED';
      }

      setPendingEmail(outcome.session.email || email.trim().toLowerCase());
      return await syncBackendOnboarding();
    } catch (err) {
      throw new Error(sanitizeAuthErrorMessage(err, 'LOGIN'));
    }
  };

  const signInWithOidcPkce = async (): Promise<AuthStage> => {
    setSessionExpiredNotice(null);
    setDevOtpHint(null);
    const baseUrl = getApiBaseUrl();
    try {
      const cfg = await ensureAuthProviderConfig(baseUrl);
      setProviderConfig(cfg);
      await cognitoClient.signInWithOidcPkce(baseUrl);
      return await syncBackendOnboarding();
    } catch (err) {
      throw new Error(sanitizeAuthErrorMessage(err, 'GENERAL'));
    }
  };

  const verifyMfaCode = async (totpCode: string): Promise<AuthStage> => {
    if (!mfaSessionRef.current || !pendingEmail) {
      setAuthStage('UNAUTHENTICATED');
      throw new Error('MFA session expired. Please sign in again.');
    }
    try {
      await cognitoClient.verifyMfaChallenge(
        getApiBaseUrl(),
        mfaSessionRef.current,
        pendingEmail,
        totpCode,
        mfaChallengeType
      );
      mfaSessionRef.current = null;
      setMfaSetupDetails(null);
      return await syncBackendOnboarding(regDraftRef.current);
    } catch (err) {
      throw new Error(sanitizeAuthErrorMessage(err, 'GENERAL'));
    }
  };

  const registerStaffAccount = async (input: {
    fullName: string;
    email: string;
    password: string;
    termsAccepted: boolean;
  }): Promise<{ nextStage: AuthStage; devOtpHint?: string }> => {
    if (!input.termsAccepted) {
      throw new Error('Please accept the RVCE Staff Account & Privacy Terms to proceed.');
    }
    const baseUrl = getApiBaseUrl();
    try {
      const cfg = await ensureAuthProviderConfig(baseUrl);
      setProviderConfig(cfg);
      const res = await cognitoClient.signUpStaff(baseUrl, {
        email: input.email,
        fullName: input.fullName,
        password: input.password,
      });
      const normEmail = input.email.trim().toLowerCase();
      regDraftRef.current = {
        fullName: input.fullName.trim(),
        email: normEmail,
        password: input.password,
        termsAccepted: true,
      };
      setPendingEmail(normEmail);
      setDevOtpHint(res.devOtpHint || null);
      setAuthStage('EMAIL_VERIFICATION_REQUIRED');
      return { nextStage: 'EMAIL_VERIFICATION_REQUIRED', devOtpHint: res.devOtpHint };
    } catch (err) {
      throw new Error(sanitizeAuthErrorMessage(err, 'GENERAL'));
    }
  };

  const confirmEmailVerification = async (email: string, otpCode: string): Promise<AuthStage> => {
    const baseUrl = getApiBaseUrl();
    const normEmail = (email || pendingEmail).trim().toLowerCase();
    try {
      await cognitoClient.confirmEmailOtp(baseUrl, normEmail, otpCode);
      setDevOtpHint(null);

      // If user just registered in this flow, seamlessly authenticate & run eligibility check
      const draft = regDraftRef.current;
      if (draft && draft.email === normEmail && draft.password) {
        const tempPass = draft.password;
        draft.password = undefined; // Wipe transient password from memory immediately!
        const outcome = await cognitoClient.signInWithPassword(baseUrl, normEmail, tempPass);
        if (outcome.status === 'AUTHENTICATED') {
          return await syncBackendOnboarding(draft);
        }
        if (outcome.status === 'MFA_REQUIRED') {
          mfaSessionRef.current = outcome.mfaSession;
          setMfaChallengeType(outcome.challengeType || 'SOFTWARE_TOKEN_MFA');
          setMfaSetupDetails(outcome.mfaSetup || null);
          setAuthStage('MFA_REQUIRED');
          return 'MFA_REQUIRED';
        }
      }

      setAuthStage('UNAUTHENTICATED');
      return 'UNAUTHENTICATED';
    } catch (err) {
      throw new Error(sanitizeAuthErrorMessage(err, 'GENERAL'));
    }
  };

  const resendEmailVerification = async (email: string): Promise<{ devOtpHint?: string }> => {
    try {
      const res = await cognitoClient.resendEmailOtp(
        getApiBaseUrl(),
        (email || pendingEmail).trim().toLowerCase()
      );
      if (res.devOtpHint) setDevOtpHint(res.devOtpHint);
      return res;
    } catch (err) {
      throw new Error(sanitizeAuthErrorMessage(err, 'GENERAL'));
    }
  };

  const requestPasswordReset = async (email: string): Promise<{ devOtpHint?: string }> => {
    const norm = email.trim().toLowerCase();
    setPendingEmail(norm);
    try {
      const res = await cognitoClient.requestPasswordReset(getApiBaseUrl(), norm);
      if (res.devOtpHint) setDevOtpHint(res.devOtpHint);
      return res;
    } catch (err) {
      throw new Error(sanitizeAuthErrorMessage(err, 'GENERAL'));
    }
  };

  const confirmPasswordReset = async (
    email: string,
    code: string,
    newPassword: string
  ): Promise<void> => {
    try {
      await cognitoClient.confirmPasswordReset(
        getApiBaseUrl(),
        (email || pendingEmail).trim().toLowerCase(),
        code,
        newPassword
      );
      setDevOtpHint(null);
    } catch (err) {
      throw new Error(sanitizeAuthErrorMessage(err, 'GENERAL'));
    }
  };

  const refreshSessionState = async (): Promise<AuthStage> => {
    return syncBackendOnboarding();
  };

  const refreshMe = async (): Promise<void> => {
    try {
      const u = await campusApi.getMe();
      setUser(u);
    } catch (err) {
      if (err instanceof ApiHttpError && err.status === 401) {
        await logout();
        setSessionExpiredNotice('Your session expired. Please sign in again.');
      }
    }
  };

  const logout = async (): Promise<void> => {
    const baseUrl = getApiBaseUrl();
    try {
      await campusApi.logoutBackendSession().catch(() => {});
    } finally {
      await cognitoClient.revokeCognitoSession(baseUrl, false);
      regDraftRef.current = null;
      mfaSessionRef.current = null;
      setUser(null);
      setOnboardingStatus(null);
      setStatusReason(null);
      setDevOtpHint(null);
      setAuthStage('UNAUTHENTICATED');
    }
  };

  const logoutAllSessions = async (): Promise<void> => {
    const baseUrl = getApiBaseUrl();
    try {
      await campusApi.logoutAllBackendSessions().catch(() => {});
    } finally {
      await cognitoClient.revokeCognitoSession(baseUrl, true);
      regDraftRef.current = null;
      mfaSessionRef.current = null;
      setUser(null);
      setOnboardingStatus(null);
      setStatusReason(null);
      setDevOtpHint(null);
      setAuthStage('UNAUTHENTICATED');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authStage,
        onboardingStatus,
        statusReason,
        pendingEmail,
        mfaChallengeType,
        mfaSetupDetails,
        providerConfig,
        devOtpHint,
        sessionExpiredNotice,
        loading,
        clearNotices,
        signInWithPassword,
        signInWithOidcPkce,
        verifyMfaCode,
        registerStaffAccount,
        confirmEmailVerification,
        resendEmailVerification,
        requestPasswordReset,
        confirmPasswordReset,
        refreshSessionState,
        refreshMe,
        logout,
        logoutAllSessions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
