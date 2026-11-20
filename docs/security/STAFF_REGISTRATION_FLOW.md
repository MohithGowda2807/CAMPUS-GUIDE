# Staff Registration & Institutional Eligibility Flow

## 1. Security Objectives

1. **Collect Minimal Personal Information**: Official `@rvce.edu.in` email, Full Name, Password (handled only by Cognito), and explicit Terms/Privacy acceptance timestamp.
2. **Strict Domain Enforcement**: Reject any email address outside exact `@rvce.edu.in` on **both** mobile client (`validateRvceInstitutionalEmail`) and backend (`normalize_and_validate_rvce_email` + MySQL `CHECK (email LIKE '%@rvce.edu.in')`).
3. **Prevent Privilege Self-Assignment**: Users cannot select a role during registration (`ConfigDict(extra="forbid")` rejects tampered payloads such as `{"role": "ADMIN"}` with HTTP `422`).
4. **Email Ownership != Staff Privilege**: Because students or non-staff accounts could hold institutional addresses, a verified `@rvce.edu.in` email is **never** automatically granted staff permissions unless matched against the administrator-controlled `staff_eligibility_allowlist`.
5. **Never Fabricate Directory Records**: Unknown applicants are never inserted into the `staff` table; only existing verified RVCE `staff` rows or administrator-reviewed mappings are linked.

---

## 2. End-to-End Registration Sequence

```mermaid
sequenceDiagram
  autonumber
  actor Applicant as RVCE Applicant (@rvce.edu.in)
  participant App as Mobile App (auth/register.tsx)
  participant IdP as Amazon Cognito User Pool
  participant API as FastAPI (/api/v1/auth/complete-registration)
  participant DB as MySQL (campusguide)
  actor Admin as RVCE Administrator (ADMIN)

  Applicant->>App: Enter Full Name, @rvce.edu.in Email, Password, Accept Terms
  App->>App: Normalize & validate @rvce.edu.in + password strength
  App->>IdP: SignUp(email, name, password)
  IdP-->>Applicant: Send 6-digit Email Verification OTP
  Applicant->>App: Enter 6-digit OTP (auth/verify-email.tsx)
  App->>IdP: ConfirmSignUp(email, OTP) -> SignIn -> RS256 ID Token
  App->>API: POST /auth/complete-registration (Bearer ID Token)
  API->>API: Verify RS256 JWT + email_verified == true + exact @rvce.edu.in
  API->>DB: SELECT * FROM staff_eligibility_allowlist WHERE email = ? AND is_active = TRUE
  alt Email is pre-authorised on Allowlist
    API->>DB: INSERT users (approval_status='APPROVED', is_active=TRUE, linked_staff_id)
    API->>DB: INSERT user_roles (FACULTY or STAFF from allowlist)
    API-->>App: onboarding_status = APPROVED + UserProfile
    App->>App: Navigate to auth/transition -> Faculty Dashboard
  else Email NOT on Allowlist
    API->>DB: INSERT users (approval_status='PENDING_APPROVAL', is_active=FALSE)
    Note over API,DB: Zero rows inserted into user_roles; no staff row invented
    API-->>App: onboarding_status = PENDING_APPROVAL
    App->>App: Route to auth/pending-approval.tsx (Portal Locked)
    Admin->>API: POST /admin/accounts/{user_id}/decision (APPROVE / REJECT)
    Note over API: Blocks self-approval (actor.user_id != target.user_id)
    API->>DB: Update users.approval_status + Audit Log Trigger
  end
```

---

## 3. Domain Normalization & Edge-Case Protections

`normalize_and_validate_rvce_email` (`backend/app/auth/data_protection.py`) normalizes Unicode (`NFKC`), strips surrounding whitespace, lowercases the address, and enforces:
- Exactly one `@` separator.
- Domain part must equal `"rvce.edu.in"` (`@gmail.com`, `@rvce.ac.in`, `@student.rvce.edu.in`, and `@rvce.edu.in.attacker.com` are rejected).
- Local part matches `^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$` with no consecutive dots (`..`).

---

## 4. Administrator Lifecycle Controls (`staff/admin-approvals.tsx`)

Authorised `ADMIN` users can execute four audited state transitions via `POST /api/v1/admin/accounts/{user_id}/decision`:
- **`APPROVE`**: Activates account (`approval_status = 'APPROVED'`, `is_active = TRUE`), assigns controlled role (`FACULTY`, `STAFF`, or `ADMIN`), optionally links an existing `staff.staff_id`, and records `approved_by_user_id` + `approved_at`.
- **`REJECT`**: Marks `approval_status = 'REJECTED'`, `is_active = FALSE`, strips all `user_roles`, and advances `tokens_valid_after`.
- **`SUSPEND`**: Temporarily locks an account (`approval_status = 'SUSPENDED'`, `is_active = FALSE`) and invalidates active tokens immediately.
- **`REVOKE`**: Permanently revokes staff privileges (`approval_status = 'REVOKED'`, `is_active = FALSE`), deletes `user_roles`, and invalidates active tokens.
- **Self-Approval Prohibition**: Backend enforces `target_user_id != current_admin.user_id` (`403 Forbidden`).
