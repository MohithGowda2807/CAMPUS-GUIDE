# Amazon Cognito Configuration Guide (Free / Lite Tier)

## 1. Cost & Free-Tier Guardrails

To keep RVCE Campus Navigator strictly within the **Amazon Cognito Free Tier** (up to 10,000 Monthly Active Users on the Lite tier):

| Setting / Feature | Required Configuration | Cost Impact |
| :--- | :--- | :--- |
| **Feature Plan** | **Lite Tier** (Standard User Pool) | **\$0 / Free Tier** up to 10,000 MAU |
| **Cognito Plus Tier** (Threat Protection / Compromised Credential Check) | **DO NOT ENABLE** without written budget approval | Paid per-MAU add-on — **disabled** |
| **SMS MFA / SNS Text Messaging** | **DISABLED** | Paid per-SMS via Amazon SNS — **avoided** |
| **MFA Method** | **TOTP Authenticator App** (`SOFTWARE_TOKEN_MFA`) | **\$0** (Free in Lite tier) |
| **Email Delivery (Initial Rollout)** | Cognito Default Email (up to 50 emails/day in dev/pilot) or institutional SES within approved quota | \$0 in pilot; monitor SES volume if >50 registrations/resets per day |
| **Custom Lambda Triggers** | Optional / Not required (eligibility enforced in FastAPI backend) | \$0 |

---

## 2. Step-by-Step AWS Cognito User Pool Setup

### Step 1 — Create User Pool (`ap-south-1` Mumbai Region Recommended)
1. Open **AWS Console -> Amazon Cognito -> User pools -> Create user pool**.
2. **Application type**: Select **Mobile app** (Public client — **Generate a client secret: UNCHECKED / OFF**).
3. **Name your application**: `rvce-campus-navigator-android`.
4. **Sign-in identifiers**: Select **Email** only (case-insensitive User Pool setting enabled).
5. **Required attributes for sign-up**: `email`, `name`.

### Step 2 — Password & Multi-Factor Authentication Policy
1. **Password policy**:
   - Minimum length: `8` characters (12+ recommended for `ADMIN` accounts).
   - Require uppercase letters, lowercase letters, numbers, and special characters.
   - Temporary password validity: `3` days.
2. **Multi-factor authentication (MFA)**:
   - Enforcement: **Optional MFA** (mandatory for `ADMIN` accounts operationally; self-service enrolment supported for all `FACULTY`/`STAFF` in `staff/security.tsx`).
   - MFA methods: Enable **Authenticator apps (TOTP)** ONLY. **Uncheck SMS message**.
3. **User account recovery**:
   - Enable **Self-service account recovery** -> **Email only** (never SMS, never security questions).

### Step 3 — App Client & OAuth 2.0 PKCE Configuration
Under **Applications -> App clients -> `rvce-campus-navigator-android`**:
1. **Client type**: **Public client** (**Client secret = None**).
2. **Authentication flows**:
   - Enable `ALLOW_USER_SRP_AUTH`
   - Enable `ALLOW_REFRESH_TOKEN_AUTH`
   - Enable `ALLOW_USER_PASSWORD_AUTH` (for native screen sign-in over TLS 1.2+)
3. **Token expiration**:
   - Access token expiration: **15 minutes**
   - ID token expiration: **15 minutes**
   - Refresh token expiration: **7 days** (enable **Refresh token rotation** if available on pool)
   - Enable **Token revocation**: **Enabled**
4. **Managed Login / Hosted UI OIDC Settings**:
   - **Allowed callback URLs**: `rvce-navigator://auth/callback`
   - **Allowed sign-out URLs**: `rvce-navigator://auth/logout`
   - **OAuth 2.0 grant types**: **Authorization code grant** ONLY (NEVER enable Implicit grant).
   - **OpenID Connect scopes**: `openid`, `email`, `profile`, `aws.cognito.signin.user.admin` (required for user self-service `AssociateSoftwareToken` and `GlobalSignOut`).
   - **PKCE**: Enforced (`S256`).
   - **Passkeys (WebAuthn)** *(Optional)*: If supported within the selected Lite/Managed Login configuration at zero extra cost, Passkey sign-in works automatically through `signInWithOidcPkce()` (`rvce-navigator://auth/callback`).

---

## 3. Environment Variable Mapping (`.env`)

Populate the backend `.env` (never commit production `.env` to Git):

```ini
APP_ENV=production
COGNITO_REGION=ap-south-1
COGNITO_USER_POOL_ID=ap-south-1_XXXXXXXXX
COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_DOMAIN=https://rvce-navigator.auth.ap-south-1.amazoncognito.com
COGNITO_REDIRECT_URI=rvce-navigator://auth/callback
COGNITO_LOGOUT_URI=rvce-navigator://auth/logout
ALLOWED_STAFF_EMAIL_DOMAIN=rvce.edu.in

# 32-byte base64 key generated via: python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
DATA_PROTECTION_KEY_B64=<32-byte-base64-key-from-secret-manager>
```

Notice:
- **Zero AWS IAM Access Keys (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)** are needed by either the mobile app or the FastAPI backend because token verification uses public OIDC JWKS (`RS256`) and user authentication uses public-client OIDC/PKCE flows.
