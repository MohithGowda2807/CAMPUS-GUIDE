# RVCE Campus Navigator — Mobile Design System

## 1. Visual Identity & Brand Philosophy

The visual design system of the **RVCE Campus Navigator** mobile app balances institutional prestige with the consumer-grade fluidity seen in modern apps like Swiggy, Zomato, and Google Maps.

- **Primary Identity**: Deep Institutional Navy (`#27447E`)
- **Surface Dominance**: Crisp, clean white surfaces (`#FFFFFF`) with generous negative space
- **Atmosphere**: Professional, spacious, trustworthy, uncluttered — no childish illustrations, no unnecessary gradients, no cartoon emojis.

---

## 2. Color Palette (Design Tokens)

```typescript
export const Colors = {
  // Institutional Brand
  primary: '#27447E',          // RVCE Navy
  primaryDark: '#1E3666',      // Active / Pressed Navy
  primaryLight: '#EDF2FA',     // Soft Blue Tint (Badges, Active tabs)
  primaryBorder: '#CBD5E1',

  // Neutrals & Surfaces
  background: '#F8FAFC',       // Clean modern slate-white backdrop
  card: '#FFFFFF',             // Surface layer
  cardSecondary: '#F1F5F9',    // Secondary inset cards
  border: '#E2E8F0',           // 1px subtle boundary
  borderStrong: '#CBD5E1',

  // Typography
  textPrimary: '#0F172A',      // High contrast heading & title text
  textSecondary: '#475569',    // Informational body & metadata
  textMuted: '#94A3B8',        // Placeholders & hints
  textInverse: '#FFFFFF',      // White on dark backgrounds

  // Semantic Statuses
  success: '#15803D',          // Verified, Active, Available (In Office)
  successBg: '#F0FDF4',
  successBorder: '#BBF7D0',

  warning: '#D97706',          // In Lecture, In Meeting, Offline Cache
  warningBg: '#FFFBEB',
  warningBorder: '#FDE68A',

  danger: '#DC2626',           // On Leave, Cancelled, Emergency Clinic
  dangerBg: '#FEF2F2',
  dangerBorder: '#FECACA',

  accentBlue: '#0284C7',       // Walking path, GPS location indicator
  accentNavy: '#1D4ED8',       // Vehicle road highlight
};
```

---

## 3. Typography Hierarchy

Based on an 8-point typographic rhythm with clear weights:

| Token | Size | Line Height | Weight | Usage |
|---|---|---|---|---|
| `Display` | 28px | 34px | Bold (700) | Welcome banner, Major feature headlines |
| `Title1` | 22px | 28px | Bold (700) | Screen titles, Modal headings |
| `Title2` | 18px | 24px | SemiBold (600) | Card headings, Building names |
| `Headline` | 16px | 22px | SemiBold (600) | Section headers, List group titles |
| `Body` | 14px | 20px | Regular (400) | Body copy, descriptions, form labels |
| `BodyMedium`| 14px | 20px | Medium (500) | Emphasized body text, button labels |
| `Caption` | 12px | 16px | Medium (500) | Secondary badges, metadata pills, timestamps |
| `Overline` | 11px | 14px | Bold (700) | Uppercase category tags, department codes |

---

## 4. Spacing & Elevation (8-Point Grid)

### Spacing Tokens
- `xs`: 4px
- `sm`: 8px
- `md`: 12px
- `lg`: 16px
- `xl`: 24px
- `xxl`: 32px

### Corner Radii
- `sm`: 6px (Pills, badges)
- `md`: 10px (Buttons, text fields)
- `lg`: 16px (Cards, dialogs)
- `xl`: 24px (Bottom sheets, floating search bar)
- `full`: 9999px (Circular floating action buttons, avatars)

### Elevation & Shadows (Native Android & iOS)
- **Level 1 (Subtle Card)**: `elevation: 1`, `shadowOpacity: 0.04`, `shadowRadius: 3`
- **Level 2 (Floating Search)**: `elevation: 4`, `shadowOpacity: 0.08`, `shadowRadius: 8`
- **Level 3 (Bottom Sheet)**: `elevation: 8`, `shadowOpacity: 0.14`, `shadowRadius: 16`
- **Level 4 (Modal Dialog)**: `elevation: 16`, `shadowOpacity: 0.22`, `shadowRadius: 24`

---

## 5. Reusable Component Specifications

### 5.1 Search Bar (Swiggy/Google Maps Style)
- Floating capsule container with `elevation: 4` and soft white background.
- Left search icon in `#27447E`, right mic/clear icon, and subtle placeholder: *"Search RVCE buildings, faculty, labs..."*
- Tap triggers an instant fullscreen or focused sheet with instant debounced filtering.

### 5.2 Floating Map Action Buttons (FABs)
- Square with 12px corner radius or circular 44px touch target.
- White background with `#27447E` icon.
- Actions: **Reset to Campus**, **My GPS Location**, **Travel Mode Toggle (Walk / Drive)**.

### 5.3 Draggable Bottom Sheet
- Header with top grabber pill (`width: 36px, height: 4px, backgroundColor: #CBD5E1`).
- Snap points:
  - **Collapsed (130dp)**: Destination title, subtitle, and primary "Directions" button.
  - **Mid (380dp)**: Overview, department listings, facilities present, floor list.
  - **Expanded (85% height)**: Turn-by-turn directions or comprehensive building floor-plan index.

### 5.4 Faculty Status Pills
- High-contrast, accessibility-checked badges:
  - 🟢 **Available**: `#F0FDF4` bg, `#15803D` text, `#BBF7D0` border
  - 🟡 **In Lecture / Meeting**: `#FFFBEB` bg, `#D97706` text, `#FDE68A` border
  - ⚪ **Not Updated**: `#F1F5F9` bg, `#64748B` text, `#E2E8F0` border
