---
name: LedgerFlow
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#002114'
  on-tertiary-container: '#069669'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#85f8c4'
  tertiary-fixed-dim: '#68dba9'
  on-tertiary-fixed: '#002114'
  on-tertiary-fixed-variant: '#005137'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 56px
    fontWeight: '800'
    lineHeight: 64px
    letterSpacing: -0.03em
  display-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.025em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  code-num:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  margin: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system establishes a high-trust, institutional-grade financial SaaS aesthetic tailored for freelancers, consultancies, and digital agencies. The visual language conveys fiscal discipline, technological precision, and calm clarity, drawing inspiration from modern financial infrastructure leaders like Stripe, Ramp, and Linear.

### Aesthetics & Design Movement
The style operates within **Corporate Precision Minimalism** augmented with micro-surface tactile elevation. It rejects chaotic gradients and playful exaggerations in favor of structural integrity:
- Crisp 1px borders anchoring content containers.
- Pure optical white surfaces resting over subtle slate underpinnings.
- Monospaced numerical treatments for monetary figures, providing an architectural and transparent layout.
- High-contrast visual hierarchies designed to build instant cognitive credibility during conversion.

## Colors

The palette pairs institutional authority with deliberate, conversion-oriented functional accents. The system defaults to light mode to maximize clean visual scanning and documentation readability.

### Core Roles
- **Primary (`#0F172A`)**: Deep Slate. Used for primary typography, dominant calls-to-action on standard tiers, and structural contrast.
- **Secondary (`#2563EB`)**: Precision Blue. Used for interactive focus, featured plan containers, toggle active states, and core branding hooks.
- **Tertiary (`#059669`)**: Emerald Trust. Used for value badges (e.g., "Save 20%"), checkmarks, enterprise savings tags, and positive billing deltas.
- **Neutral (`#64748B`)**: Cool Slate. Used for secondary descriptions, feature exclusions, and inactive states.

### Surface Architecture
- **Canvas Base**: `#F8FAFC` provides a neutral canvas that separates content without visual fatigue.
- **Surface Elevation**: `#FFFFFF` for pricing tier cards, modal overlays, and feature compare matrices.
- **Subtle Surface**: `#F1F5F9` for table headers, inactive segmented switches, and code/monospaced metadata blocks.
- **Structural Outlines**: `#E2E8F0` for default component framing; `#CBD5E1` for hover states.

## Typography

The typographic pairing divides responsibilities strictly between branding authority and systematic clarity:
- **Plus Jakarta Sans** provides geometric structure and contemporary warmth for displays, pricing headlines, and section banners.
- **Inter** ensures legibility across dense feature-comparison matrices, technical specifications, and general user interface elements.
- **JetBrains Mono** is reserved for financial metrics, billing breakdown figures, API tier allowances, and invoice identifier tags.

All numbers in pricing displays leverage tabular figures (`font-variant-numeric: tabular-nums`) to prevent layout shifts across currency or billing frequency changes.

## Layout & Spacing

The layout is built upon a standard 12-column grid system capped at a maximum width of `1280px` for optimal horizontal gaze-tracking across three- and four-tier comparison layouts.

### Structural Flow
- **Desktop (1024px+)**: 12 columns, 24px (`1.5rem`) gutters, 32px (`2rem`) side margins. Pricing tiers align horizontally into 3 or 4 symmetrical cards.
- **Tablet (768px - 1023px)**: 8 columns, 20px gutters, 24px margins. Cards flow into a 2x2 grid format; the recommended plan spans full-width or retains the dominant upper-left orientation.
- **Mobile (< 768px)**: 4 columns, 16px gutters, 16px margins. Cards stack vertically, prioritizing the recommended plan at the top or offering a horizontal swipeable carousel with pinned feature labels.

Spacing rhythm is strictly modular: internal card padding uses `space-xl` (40px) on desktop to guarantee an uncluttered presentation, scaling down to `space-lg` (24px) on compact mobile screens.

## Elevation & Depth

Visual hierarchy uses **low-contrast outlines accompanied by ambient, diffused soft shadowing**. This avoids visual distraction while creating distinct operational layers.

### Elevation Levels
- **Level 0 (Base Canvas)**: `#F8FAFC` flat surface.
- **Level 1 (Standard Card)**: Background `#FFFFFF`, border `1px solid #E2E8F0`, shadow `0 1px 3px 0 rgba(15, 23, 42, 0.05), 0 1px 2px -1px rgba(15, 23, 42, 0.05)`.
- **Level 2 (Featured Plan / Elevated)**: Background `#FFFFFF`, border `1.5px solid #2563EB`, shadow `0 10px 25px -5px rgba(37, 99, 235, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.03)`. This subtle blue halo separates the recommended plan from adjoining alternatives.
- **Level 3 (Tooltips / Currency Switchers)**: Background `#0F172A`, shadow `0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.1)`.

## Shapes

The design uses a balanced `roundedness: 2` (0.5rem base radius). This produces clean corners that convey institutional precision without feeling harsh or brutalist.

### Radius Distribution
- **Cards and Outer Containers**: `rounded-xl` (1.5rem / 24px) creates an intentional, contained frame for pricing tables.
- **Buttons, Text Inputs, and Segmented Switches**: `rounded-lg` (0.75rem / 12px) ensures tactile comfort and clear touch targets.
- **Micro Badges, Tooltips, and Savings Indicators**: Fully rounded pill shapes (`9999px`) provide contrast against the predominantly rectangular layout.

## Components

### Buttons
- **Primary CTA**: `#0F172A` background, `#FFFFFF` text, `rounded-lg`. Hover changes background to `#1E293B` with a subtle transform `translateY(-1px)`.
- **Featured Plan CTA**: `#2563EB` background, `#FFFFFF` text, `rounded-lg`. Hover changes background to `#1D4ED8`. Focus outline: 2px offset with `#3B82F6`.
- **Secondary / Enterprise CTA**: Pure white `#FFFFFF` surface, `1px solid #E2E8F0`, `#0F172A` text. Hover shifts border to `#CBD5E1` and background to `#F8FAFC`.

### Pricing Badges & Pills
- **"Most Popular" Identifier**: Positioned absolute or centered top-border. Primary blue fill (`#2563EB`), white text, `label-sm`, padding `4px 12px`, pill radius (`9999px`).
- **"Save 20%" Savings Pill**: Emerald tint (`#ECFDF5`), `#059669` text, `1px solid #A7F3D0`, pill radius (`9999px`), bold numeric tracking.

### Billing Period Toggle (Monthly / Annual)
- Segmented control mounted on `#F1F5F9` background, `padding: 4px`, `rounded-lg`.
- Inactive option: `#64748B` text, transparent background.
- Active option: `#FFFFFF` background, `#0F172A` text, `rounded-md`, elevated by `0 1px 2px rgba(15, 23, 42, 0.08)`.

### Feature Checklist
- Included feature items contain a solid emerald checkmark icon within an `#ECFDF5` circle (dimension: 20x20px).
- Excluded or non-applicable features display an `#E2E8F0` minus icon, with label typography falling back to `#94A3B8`.
- Information icons beside enterprise features trigger hover tooltips with dark slate backgrounds (`#0F172A`).

### Pricing Cards
- Standard cards feature subtle `#E2E8F0` borders.
- The recommended tier features a badge offset at the top, a `1.5px solid #2563EB` border, and a subtle indigo-to-transparent vertical surface tint (1% gradient at the top header area).