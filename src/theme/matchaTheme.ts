/**
 * Perfect Six field-guide theme
 *
 * An earthy green theme inspired by matcha tea and natural botanicals.
 * Core palette: #3E481D, #707E46, #C0CBA9, #F0F0E0, #FFFFFF
 * Uses Playwrite US Trad for headings and DM Sans for body text.
 */

import {defineTheme, defineSyntaxTheme} from '@astryxdesign/core/theme';
import {matchaIconRegistry} from './icons';

/** Matcha syntax palette — earthy greens and warm tones. */
const matchaSyntax = defineSyntaxTheme({
  name: 'xds-matcha',
  tokens: {
    keyword: ['#5a6b2a', '#a8bf6a'],
    string: ['#2e6b4a', '#7bc49e'],
    comment: ['#707E46', '#707E46'],
    number: ['#8c6b30', '#d4b870'],
    function: ['#3a5e8c', '#7ba8d4'],
    type: ['#6b4a8c', '#b08ed4'],
    variable: ['#3E481D', '#C0CBA9'],
    operator: ['#707E46', '#94a468'],
    constant: ['#8c6b30', '#d4b870'],
    tag: ['#8c3a3a', '#d47a7a'],
    attribute: ['#7c5e3a', '#c4a882'],
    property: ['#3a7c6b', '#70c4b0'],
    punctuation: ['#707E46', '#5a6440'],
    background: ['#F0F0E0', '#1a1c14'],
  },
});

export const matchaTheme = defineTheme({
  name: 'perfect-six',

  typography: {
    // base 16 / ratio 1.25 — aligned with the other themes' geometric scale.
    scale: {base: 16, ratio: 1.25},
    body: {
      family: 'Inter',
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    heading: {
      family: 'Georgia',
      fallbacks: 'Georgia, "Times New Roman", Times, serif',
    },
    code: {
      family: 'JetBrains Mono',
      fallbacks: '"SF Mono", Monaco, Consolas, monospace',
    },
  },

  motion: {fast: 125, medium: 300, slow: 700, ratio: 0.75},

  syntax: matchaSyntax,

  tokens: {
    // =========================================================================
    // Colors — earthy matcha palette
    // Core: #3E481D, #707E46, #C0CBA9, #F0F0E0, #FFFFFF
    // =========================================================================

    // Core semantic
    '--color-accent': ['#173F35', '#C7D8C8'],
    '--color-accent-muted': ['#173F3514', '#C7D8C820'],
    '--color-neutral': ['#4B3D300F', '#E9DFC91A'],
    '--color-background-surface': ['#FFFDF7', '#20221D'],
    '--color-background-body': ['#F3EBDD', '#151813'],
    '--color-overlay': ['#173F3580', '#0D100DCC'],
    '--color-overlay-hover': ['#173F350D', '#C7D8C80D'],
    '--color-overlay-pressed': ['#173F351A', '#C7D8C81A'],
    '--color-background-muted': ['#E9DFC9', '#2B3129'],

    // Text
    '--color-text-primary': ['#2B251E', '#F2EBDD'],
    '--color-text-secondary': ['#6D6255', '#BDB5A5'],
    '--color-text-disabled': ['#A69C8D', '#6F746B'],
    '--color-text-accent': ['#173F35', '#C7D8C8'],
    '--color-on-dark': '#FFFDF7',
    '--color-on-light': '#2B251E',
    '--color-on-accent': ['#FFFDF7', '#173F35'],
    '--color-on-success': ['#FFFDF7', '#173F35'],
    '--color-on-error': ['#FFFDF7', '#2B251E'],
    '--color-on-warning': ['#2B251E', '#2B251E'],

    // Icon
    '--color-icon-accent': ['#173F35', '#C7D8C8'],
    '--color-icon-primary': ['#2B251E', '#F2EBDD'],
    '--color-icon-secondary': ['#6D6255', '#BDB5A5'],
    '--color-icon-disabled': ['#A69C8D', '#6F746B'],

    // Surface variants
    '--color-background-card': ['#FFFDF7', '#20221D'],
    '--color-background-popover': ['#FFFDF7', '#2B3129'],
    '--color-background-inverted': ['#173F35', '#C7D8C8'],

    // Status / Sentiment
    '--color-success': ['#4D9900', '#6dbf2a'],
    '--color-success-muted': ['#4D990020', '#6dbf2a20'],
    '--color-error': ['#7A2E2E', '#D7867B'],
    '--color-error-muted': ['#7A2E2E20', '#D7867B20'],
    '--color-warning': ['#FFB600', '#ffc940'],
    '--color-warning-muted': ['#FFB60020', '#ffc94020'],

    // Border
    // Softer sage borders (default + emphasized/card) in light mode.
    '--color-border': ['#D8CCB8', '#E9DFC91A'],
    '--color-border-emphasized': ['#B7A992', '#6F746B'],

    // Effects
    '--color-skeleton': ['#C0CBA9', '#5a6440'],
    '--color-shadow': ['#3E481D1A', '#0000004D'],
    '--color-tint-hover': ['black', 'white'],

    // Categorical — Blue
    '--color-background-blue': ['#3a5e8c33', '#3a5e8c33'],
    '--color-border-blue': ['#3a5e8c', '#7ba8d4'],
    '--color-icon-blue': ['#3a5e8c', '#7ba8d4'],
    '--color-text-blue': ['#2e4a6e', '#8dbce0'],

    // Categorical — Cyan
    '--color-background-cyan': ['#3a7c7c33', '#3a7c7c33'],
    '--color-border-cyan': ['#3a7c7c', '#70c4c4'],
    '--color-icon-cyan': ['#3a7c7c', '#70c4c4'],
    '--color-text-cyan': ['#2e6060', '#82d4d4'],

    // Categorical — Gray
    '--color-background-gray': ['#707E4633', '#5a644033'],
    '--color-border-gray': ['#707E46', '#707E46'],
    '--color-icon-gray': ['#707E46', '#94a468'],
    '--color-text-gray': ['#3E481D', '#C0CBA9'],

    // Categorical — Green
    '--color-background-green': ['#4D990033', '#6dbf2a33'],
    '--color-border-green': ['#4D9900', '#6dbf2a'],
    '--color-icon-green': ['#4D9900', '#6dbf2a'],
    '--color-text-green': ['#3d7a00', '#80d43a'],

    // Categorical — Orange
    '--color-background-orange': ['#c4762033', '#d4903a33'],
    '--color-border-orange': ['#c47620', '#d4903a'],
    '--color-icon-orange': ['#c47620', '#d4903a'],
    '--color-text-orange': ['#a06018', '#e0a04a'],

    // Categorical — Pink
    '--color-background-pink': ['#c44a7033', '#e07a9a33'],
    '--color-border-pink': ['#c44a70', '#e07a9a'],
    '--color-icon-pink': ['#c44a70', '#e07a9a'],
    '--color-text-pink': ['#a03a5a', '#f08aaa'],

    // Categorical — Purple
    '--color-background-purple': ['#6b4a8c33', '#b08ed433'],
    '--color-border-purple': ['#6b4a8c', '#b08ed4'],
    '--color-icon-purple': ['#6b4a8c', '#b08ed4'],
    '--color-text-purple': ['#553a70', '#c0a0e0'],

    // Categorical — Red
    '--color-background-red': ['#FD000033', '#ff5c5c33'],
    '--color-border-red': ['#FD0000', '#ff5c5c'],
    '--color-icon-red': ['#FD0000', '#ff5c5c'],
    '--color-text-red': ['#cc0000', '#ff7a7a'],

    // Categorical — Teal
    '--color-background-teal': ['#2e6b5a33', '#5ab89833'],
    '--color-border-teal': ['#2e6b5a', '#5ab898'],
    '--color-icon-teal': ['#2e6b5a', '#5ab898'],
    '--color-text-teal': ['#245546', '#6ccaaa'],

    // Categorical — Yellow
    '--color-background-yellow': ['#FFB60033', '#ffc94033'],
    '--color-border-yellow': ['#FFB600', '#ffc940'],
    '--color-icon-yellow': ['#FFB600', '#ffc940'],
    '--color-text-yellow': ['#cc9200', '#ffd960'],

    // =========================================================================
    // Spacing
    // =========================================================================
    '--spacing-0-5': '3px',
    '--spacing-1': '6px',
    '--spacing-1-5': '9px',
    '--spacing-2': '12px',
    '--spacing-3': '18px',
    '--spacing-4': '24px',
    '--spacing-5': '30px',
    '--spacing-6': '36px',
    '--spacing-7': '42px',
    '--spacing-8': '48px',
    '--spacing-9': '54px',
    '--spacing-10': '60px',
    '--spacing-11': '66px',
    '--spacing-12': '72px',

    // =========================================================================
    // Radius — soft and rounded
    // =========================================================================
    '--radius-inner': '6px',
    '--radius-element': '10px',
    '--radius-container': '16px',
    '--radius-page': '24px',

    // No explicit --font-size-* overrides — font sizes come from
    // typography.scale above, keeping the scale the single source of truth.

    // =========================================================================
    // Element sizes
    // =========================================================================
    '--size-element-sm': '36px',
    '--size-element-md': '40px',
    '--size-element-lg': '44px',

    // =========================================================================
    // Shadows
    // =========================================================================
    '--shadow-low': '0 2px 4px #3E481D0D, 0 4px 8px #3E481D1A',
    '--shadow-med': '0 2px 4px #3E481D0D, 0 4px 12px #3E481D1A',
    '--shadow-high': '0 4px 6px #3E481D1A, 0 12px 24px #3E481D26',
    '--shadow-inset-hover': 'inset 0px 0px 0px 2px #3E481D30',
    '--shadow-inset-selected': 'inset 0px 0px 0px 2px #3E481D50',
    '--shadow-inset-success': 'inset 0px 0px 0px 2px #4D990050',
    '--shadow-inset-warning': 'inset 0px 0px 0px 2px #FFB60050',
    '--shadow-inset-error': 'inset 0px 0px 0px 2px #FD000050',
  },

  components: {
    button: {
      base: {
        borderRadius: 'var(--radius-element)',
      },
    },
    card: {
      base: {
        borderRadius: 'var(--radius-container)',
        padding: 'var(--spacing-3)',
      },
    },
    section: {
      base: {
        padding: 'var(--spacing-3)',
      },
    },
  },

  icons: matchaIconRegistry,
});
