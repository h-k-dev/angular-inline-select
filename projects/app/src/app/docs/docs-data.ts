/**
 * The documentation registry — THE single place that grows with the library.
 *
 * Adding a component: add a page entry to `PAGES`, a `ComponentApi` to its
 * section, and its tokens to a token group. Adding a token to an existing
 * component: extend its section's token group. The API and Theming pages
 * render whatever lives here — no page code changes.
 */

export interface ApiMember {
  name: string;
  type: string;
  default?: string;
  description: string;
}

export interface ComponentApi {
  /** Class name, e.g. `AngularInlineText`. */
  name: string;
  selector: string;
  summary: string;
  /** Two-way bindable `model()` signals. */
  models: ApiMember[];
  inputs: ApiMember[];
  /** `output()` events — the payload goes in `type`. */
  outputs: ApiMember[];
}

export interface ThemingToken {
  token: string;
  /** The rest of the resolution chain when the token is unset. */
  fallback: string;
  description: string;
}

export interface TokenGroup {
  title: string;
  description?: string;
  tokens: ThemingToken[];
}

export interface SectionDocs {
  title: string;
  components: ComponentApi[];
  tokenGroups: TokenGroup[];
}

/** The sidenav source of truth: every playground page, in nav order. */
export const PAGES = [
  { path: 'text', label: 'Text' },
  { path: 'number', label: 'Number' },
  { path: 'phone', label: 'Phone' },
  { path: 'temporal', label: 'Temporal' },
  { path: 'json', label: 'JSON' },
] as const;

// -----------------------------------------------------------------------------
// Shared API rows — the Form Value Contract every inline control implements.
// -----------------------------------------------------------------------------
const FORM_CONTRACT_INPUTS: ApiMember[] = [
  {
    name: 'disabled',
    type: 'boolean',
    default: 'false',
    description: 'Form Value Contract: the control is not interactive.',
  },
  {
    name: 'readonly',
    type: 'boolean',
    default: 'false',
    description: 'Form Value Contract: visible and focusable, but not editable.',
  },
  {
    name: 'required',
    type: 'boolean',
    default: 'false',
    description:
      'Form Value Contract: marks the field required (also hides the clear bubble — a guaranteed-doomed clear stays unavailable).',
  },
  {
    name: 'errors',
    type: 'readonly ValidationError.WithOptionalFieldTree[]',
    default: '[]',
    description:
      'Form Value Contract: validation errors from the bound field. Message-carrying errors render in the panel footer when errors are visible.',
  },
  {
    name: 'invalid',
    type: 'boolean',
    default: 'false',
    description: "Form Value Contract: the bound field's verdict on validity.",
  },
  {
    name: 'touched',
    type: 'boolean',
    default: 'false',
    description:
      'Form Value Contract: the bound field dictates when errors may show (the `form.submitted` half of the ErrorStateMatcher analogue).',
  },
  {
    name: 'hidden',
    type: 'boolean',
    default: 'false',
    description: 'Form Value Contract: removes the control from the layout (`display: none`).',
  },
];

const TOUCH_OUTPUT: ApiMember = {
  name: 'touch',
  type: 'void',
  description:
    'Form Value Contract: emitted on the closing edge of an edit session (the blur analogue), on a failed save attempt, and on clear.',
};

const AFFIX_INPUTS: ApiMember[] = [
  {
    name: 'prefixTemplate',
    type: 'TemplateRef<unknown> | undefined',
    default: 'undefined',
    description:
      'Prefix template (matPrefix analogue) for composition; direct consumers use `ng-template[editablePrefix]` content instead. Rendered aria-hidden, outside the editable text.',
  },
  {
    name: 'suffixTemplate',
    type: 'TemplateRef<unknown> | undefined',
    default: 'undefined',
    description:
      'Suffix template (matSuffix analogue) for composition; direct consumers use `ng-template[editableSuffix]` content instead.',
  },
];

const ARIA_LABEL_INPUT: ApiMember = {
  name: 'ariaLabel',
  type: 'string | undefined',
  default: 'undefined',
  description:
    'Accessible name for the field — contenteditable has no native label association. Falls back to the placeholder.',
};

const EDITING_MODEL: ApiMember = {
  name: 'editing',
  type: 'boolean',
  default: 'false',
  description: 'Whether an edit session is open (the field is elevated). Two-way bindable.',
};

// -----------------------------------------------------------------------------
// Shared token groups
// -----------------------------------------------------------------------------

/** Tokens of the inline-text surfaces — also picked up by number and phone, which render through the same surfaces. */
const TEXT_SURFACE_TOKENS: TokenGroup = {
  title: 'Field surfaces',
  description:
    'The in-flow display and the elevated editor. Resolution order: ' +
    'var(--editable-text-<token>, var(--mat-sys-<token>, <fallback>)).',
  tokens: [
    {
      token: '--editable-text-underline',
      fallback: 'underline',
      description:
        'The resting dashed underline’s text-decoration-line. Set to `none` to hide the inline-editable affordance; keyboard focus (solid underline) and the idle error underline re-assert themselves and stay visible.',
    },
    {
      token: '--editable-text-underline-color',
      fallback: 'var(--mat-sys-primary, #428bca)',
      description: 'Color of the dashed affordance underline (and the solid focus underline).',
    },
    {
      token: '--editable-text-color',
      fallback: 'inherit',
      description: 'Text color of a filled (non-empty) field.',
    },
    {
      token: '--editable-text-error-color',
      fallback: 'var(--mat-sys-error, #dc3545)',
      description: 'Underline color while the field is invalid and errors are visible.',
    },
    {
      token: '--editable-text-placeholder-opacity',
      fallback: '0.3875',
      description: 'Opacity of the placeholder (shown when the field is empty).',
    },
    {
      token: '--editable-text-hyphens',
      fallback: 'auto',
      description:
        'Hyphenation of the in-flow display while wrapping (`wrapBehavior: "wrap"`). `auto` needs a language to be known — a `lang` attribute on the document or an ancestor — otherwise the browser skips the hyphen and breaks the word plainly. Set to `none` to never hyphenate.',
    },
    {
      token: '--editable-text-affix-color',
      fallback: 'var(--mat-sys-on-surface-variant, inherit)',
      description: 'Color of prefix/suffix affixes.',
    },
    {
      token: '--editable-text-dim-opacity',
      fallback: '0.35',
      description: 'Opacity of the in-flow field while its elevated editor is open.',
    },
    {
      token: '--editable-text-editor-color',
      fallback: 'var(--mat-sys-on-surface, inherit)',
      description: 'Text color inside the elevated editor.',
    },
    {
      token: '--editable-text-caret-color',
      fallback: 'var(--mat-sys-primary, #428bca)',
      description: 'Caret color of the editable surfaces.',
    },
    {
      token: '--editable-ease-standard',
      fallback: 'cubic-bezier(0.4, 0, 0.2, 1)',
      description: 'Easing for the field opacity transitions.',
    },
  ],
};

const CHROME_TOKENS: TokenGroup = {
  title: 'Shared chrome (panel, scrim, menu, messages, actions)',
  description: 'The elevated-editing chrome every inline control shares.',
  tokens: [
    {
      token: '--editable-scrim-color',
      fallback: 'oklch(from var(--mat-sys-surface) l c h / 0.55)',
      description: 'Backdrop behind the elevated panel.',
    },
    {
      token: '--editable-panel-width',
      fallback: 'min(60ch, calc(100dvw - 2 * var(--mat-sys-inner-spacing, 16px)))',
      description: 'The panel’s readable measure — a constant, never measured.',
    },
    {
      token: '--editable-panel-background',
      fallback: 'var(--mat-sys-surface-container, #fff)',
      description: 'Panel card background.',
    },
    {
      token: '--editable-panel-border-color',
      fallback: 'color-mix(in oklch, var(--mat-sys-on-surface, #000) 20%, var(--mat-sys-surface-container, #fff))',
      description: 'Panel card border.',
    },
    {
      token: '--editable-panel-radius',
      fallback: 'var(--mat-sys-corner-large, var(--radius, 0.625rem))',
      description: 'Panel corner radius.',
    },
    {
      token: '--editable-panel-shadow',
      fallback: 'layered soft shadow (4 stops)',
      description: 'Panel elevation shadow.',
    },
    {
      token: '--editable-menu-max-height',
      fallback: '40vh',
      description: 'Max height of the slash-command menu before it scrolls.',
    },
    {
      token: '--editable-menu-active-background',
      fallback: 'var(--mat-sys-secondary-container, #d7e3ff)',
      description: 'Background of the keyboard-active menu option.',
    },
    {
      token: '--editable-menu-active-color',
      fallback: 'var(--mat-sys-on-secondary-container, #001b3f)',
      description: 'Text color of the keyboard-active menu option.',
    },
    {
      token: '--editable-message-error-color',
      fallback: 'var(--mat-sys-error, #dc3545)',
      description: 'Color of control-rendered error messages in the panel footer.',
    },
    {
      token: '--editable-message-hint-color',
      fallback: 'var(--mat-sys-outline, #6b7280)',
      description: 'Color of hint messages (live hints, “Unsaved changes”).',
    },
    {
      token: '--editable-error-font',
      fallback: 'var(--mat-sys-body-small-font, inherit)',
      description: 'Font family of projected [editable-error] content.',
    },
    {
      token: '--editable-error-size',
      fallback: 'var(--mat-sys-body-small-size, 0.75rem)',
      description: 'Font size of projected [editable-error] content.',
    },
    {
      token: '--editable-error-weight',
      fallback: 'var(--mat-sys-body-small-weight, 400)',
      description: 'Font weight of projected [editable-error] content.',
    },
    {
      token: '--editable-error-line-height',
      fallback: 'var(--mat-sys-body-small-line-height, 1rem)',
      description: 'Line height of projected [editable-error] content.',
    },
    {
      token: '--editable-error-tracking',
      fallback: 'var(--mat-sys-body-small-tracking, 0.025rem)',
      description: 'Letter spacing of projected [editable-error] content.',
    },
    {
      token: '--editable-error-color',
      fallback: 'var(--mat-sys-error, #dc3545)',
      description: 'Color of projected [editable-error] content.',
    },
    {
      token: '--editable-ease-emphasized',
      fallback: 'cubic-bezier(0, 0, 0.2, 1)',
      description: 'Easing for panel lift, message and bubble enter animations.',
    },
    {
      token: '--editable-scrollbar-thumb',
      fallback: 'var(--mat-sys-outline, #9aa0a6)',
      description:
        'Thumb color of the quiet scrollbar (50% translucent at rest, opaque on hover). Applied to the library’s scroll containers (slash-menu, JSON editor) and to any consumer element carrying the `editable-scrollbar` class.',
    },
    {
      token: '--editable-scrollbar-focus',
      fallback: 'var(--mat-sys-primary, #6750a4)',
      description: 'Thumb tint while keyboard focus is on — or inside — the scroll container.',
    },
    {
      token: '--editable-bubble-pad',
      fallback: 'calc(var(--mat-sys-inner-spacing, 16px) * 0.75)',
      description: 'Transparent pad around the floating bubble — the visual gap and the forgiving hit halo.',
    },
    {
      token: '--editable-text-action-background',
      fallback: 'oklch(from var(--mat-sys-surface-container-highest, #eee) l c h / 0.75)',
      description: 'Background of the pill action buttons (Discard, Clear).',
    },
    {
      token: '--editable-text-action-color',
      fallback: 'var(--mat-sys-on-surface-variant, #5f6368)',
      description: 'Text color of the pill action buttons.',
    },
    {
      token: '--editable-text-action-hover-background',
      fallback: 'var(--mat-sys-surface-container-highest, #eee)',
      description: 'Hover background of the pill action buttons.',
    },
    {
      token: '--editable-text-action-hover-color',
      fallback: 'var(--mat-sys-on-surface-variant, #5f6368)',
      description: 'Hover text color of the pill action buttons.',
    },
    {
      token: '--editable-text-action-save-background',
      fallback: 'var(--mat-sys-primary, #4285f4)',
      description: 'Background of the Save button.',
    },
    {
      token: '--editable-text-action-save-color',
      fallback: 'var(--mat-sys-on-primary, #fff)',
      description: 'Text color of the Save button.',
    },
    {
      token: '--editable-text-action-save-hover-background',
      fallback: 'var(--mat-sys-primary, #4285f4)',
      description: 'Hover background of the Save button.',
    },
    {
      token: '--editable-text-action-save-hover-color',
      fallback: 'var(--mat-sys-on-primary, #fff)',
      description: 'Hover text color of the Save button.',
    },
  ],
};

/** The temporal components style their own surfaces but consume the same token names. */
const TEMPORAL_TOKENS: TokenGroup = {
  title: 'Temporal surfaces',
  description:
    'Date, time and duration render their own field surfaces but resolve the same --editable-text-* names, so a theme written for the text field carries over.',
  tokens: [
    {
      token: '--editable-text-underline-color',
      fallback: 'var(--mat-sys-primary, #428bca)',
      description: 'Dashed border-bottom affordance color.',
    },
    {
      token: '--editable-text-error-color',
      fallback: 'var(--mat-sys-error, #dc3545)',
      description: 'Border-bottom color while invalid and errors are visible.',
    },
    {
      token: '--editable-text-caret-color',
      fallback: 'var(--mat-sys-primary, #428bca)',
      description: 'Caret color of the editable segments.',
    },
    {
      token: '--editable-text-placeholder-opacity',
      fallback: '0.3875',
      description: 'Opacity of empty-segment placeholders.',
    },
    {
      token: '--editable-text-affix-color',
      fallback: 'var(--mat-sys-on-surface-variant, inherit)',
      description: 'Color of prefix/suffix affixes.',
    },
    {
      token: '--editable-panel-container-color',
      fallback: 'var(--mat-sys-surface-container, #fff)',
      description: 'Background of the temporal picker containers (calendar, time list).',
    },
  ],
};

const JSON_SURFACE_TOKENS: TokenGroup = {
  title: 'JSON preview + editor surfaces',
  description:
    'The idle preview looks and themes EXACTLY like the inline-text display — same per-line dashed underline, same token names, same focus/error re-assertions — so a theme written for the text field carries over unchanged. The elevated CodeMirror editor reuses the editor/caret/panel tokens.',
  tokens: [
    {
      token: '--editable-text-underline',
      fallback: 'underline',
      description:
        'The resting dashed underline’s text-decoration-line. Set to `none` to hide the affordance; keyboard focus and the idle error state re-assert their underlines.',
    },
    {
      token: '--editable-text-underline-color',
      fallback: 'var(--mat-sys-primary, #428bca)',
      description: 'Color of the dashed affordance underline (and the solid focus underline).',
    },
    {
      token: '--editable-text-color',
      fallback: 'inherit',
      description: 'Text color of a filled (non-empty) preview.',
    },
    {
      token: '--editable-text-error-color',
      fallback: 'var(--mat-sys-error, #dc3545)',
      description: 'Underline color while the field is invalid and errors are visible.',
    },
    {
      token: '--editable-text-placeholder-opacity',
      fallback: '0.3875',
      description: 'Opacity of the empty-field placeholder.',
    },
    {
      token: '--editable-text-dim-opacity',
      fallback: '0.35',
      description: 'Opacity of the in-flow field while its elevated editor is open.',
    },
    {
      token: '--editable-text-editor-color',
      fallback: 'var(--mat-sys-on-surface, inherit)',
      description: 'Text color inside the elevated CodeMirror editor.',
    },
    {
      token: '--editable-text-caret-color',
      fallback: 'var(--mat-sys-primary, #428bca)',
      description: 'Caret color inside the elevated editor.',
    },
    {
      token: '--editable-dialog-width',
      fallback: 'min(600px, 100%)',
      description: 'Width of the editing dialog card (the readable default; full-screen on touch/narrow viewports).',
    },
    {
      token: '--editable-json-syntax-property',
      fallback: 'light-dark(#0550ae, #79c0ff) — GitHub Primer',
      description: 'Editor syntax color: object keys. Every syntax fallback follows the app color-scheme via light-dark().',
    },
    {
      token: '--editable-json-syntax-string',
      fallback: 'light-dark(#0a3069, #a5d6ff) — GitHub Primer',
      description: 'Editor syntax color: string values.',
    },
    {
      token: '--editable-json-syntax-number',
      fallback: 'light-dark(#0550ae, #79c0ff) — GitHub Primer',
      description: 'Editor syntax color: numbers.',
    },
    {
      token: '--editable-json-syntax-keyword',
      fallback: 'light-dark(#0550ae, #79c0ff) — GitHub Primer',
      description: 'Editor syntax color: true/false/null (GitHub renders JSON constants in the same accent as keys).',
    },
    {
      token: '--editable-json-syntax-invalid',
      fallback: 'light-dark(#82071e, #ffa198) — GitHub Primer',
      description: 'Editor syntax color: invalid tokens.',
    },
    {
      token: '--editable-json-gutter-color',
      fallback: 'light-dark(#8c959f, #6e7681) — GitHub Primer',
      description: 'Line-number gutter color.',
    },
  ],
};

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

export const DOCS: Record<string, SectionDocs> = {
  text: {
    title: 'Inline Text',
    components: [
      {
        name: 'AngularInlineText',
        selector: 'angular-inline-text',
        summary:
          'A static in-flow text that elevates into a floating editor on the first real edit. The page never reflows while typing; the value commits on Save / Enter (single-line) / Ctrl+Enter.',
        models: [
          {
            name: 'value',
            type: 'string',
            default: "''",
            description:
              'The committed value channel. Follows every keystroke while a session is open (live draft), settles on commit, and rolls back on discard.',
          },
          EDITING_MODEL,
        ],
        inputs: [
          ...FORM_CONTRACT_INPUTS,
          {
            name: 'isSingleLine',
            type: 'boolean',
            default: 'false',
            description:
              'Constrains the VALUE to one line: no line break may exist in it (Enter accepts, pasted breaks collapse to spaces). Says nothing about how the text is painted — see wrapBehavior.',
          },
          {
            name: 'wrapBehavior',
            type: "'noWrap' | 'wrap'",
            default: "'noWrap'",
            description:
              "Single-line only — how the display handles a width constraint: 'noWrap' keeps the one line and ellipsizes, 'wrap' paints it over several visual lines (breaking at whitespace, inside long words when there is none, hyphenated where the browser can). Multi-line fields ignore it entirely and always wrap. The elevated editor always wraps.",
          },
          {
            name: 'placeholder',
            type: 'string',
            default: "'N/A'",
            description: 'Placeholder shown while empty; also the aria-label fallback.',
          },
          ARIA_LABEL_INPUT,
          {
            name: 'inputMode',
            type: 'string | undefined',
            default: 'undefined',
            description:
              "Virtual-keyboard hint for mobile ('decimal', 'tel', 'email', …) applied to both editable surfaces.",
          },
          {
            name: 'normalizeValue',
            type: 'boolean',
            default: 'false',
            description:
              'Trims leading/trailing whitespace on commit. Interior spacing is never touched.',
          },
          ...AFFIX_INPUTS,
          {
            name: 'hintTemplate',
            type: 'TemplateRef<unknown> | undefined',
            default: 'undefined',
            description:
              'Live per-keystroke feedback rendered in the panel footer; direct consumers use `ng-template[editableHint]` content instead.',
          },
          {
            name: 'menuTemplate',
            type: 'TemplateRef<unknown> | undefined',
            default: 'undefined',
            description:
              'Slash-command menu template — dormant unless provided. The consumer owns options and filtering; the control owns trigger, keyboard navigation, and combobox ARIA. Content sugar: `ng-template[editableMenu]`.',
          },
        ],
        outputs: [
          {
            name: 'savedModelChange',
            type: '{ value: string }',
            description:
              'THE consumer commit event: fires once per changed settlement (accept-timed, change-gated) with the model.',
          },
          {
            name: 'saved',
            type: 'InlineTextSaved — { value: string; changed: boolean }',
            description:
              'The machinery channel: exactly one emission per settled edit session — Save, Discard, and clear alike. For wrapping controls and adapters; app consumers bind savedModelChange.',
          },
          TOUCH_OUTPUT,
          {
            name: 'reverted',
            type: 'string',
            description:
              'Emitted when a draft is discarded, with the discarded draft text. Deprecated — superseded by `saved`; kept during the Roadmap Phase 3 transition.',
          },
        ],
      },
    ],
    tokenGroups: [TEXT_SURFACE_TOKENS, CHROME_TOKENS],
  },

  number: {
    title: 'Inline Number',
    components: [
      {
        name: 'AngularInlineNumber',
        selector: 'angular-inline-number',
        summary:
          'The inline-text machinery specialized for numbers: a parse/format codec pair turns the drafted string into a numeric model on commit.',
        models: [
          {
            name: 'value',
            type: 'number | string | null',
            default: 'null',
            description: 'The committed numeric value (string passthrough for unparseable drafts).',
          },
          EDITING_MODEL,
        ],
        inputs: [
          ...FORM_CONTRACT_INPUTS,
          {
            name: 'placeholder',
            type: 'string',
            default: "'N/A'",
            description: 'Placeholder shown while empty.',
          },
          ARIA_LABEL_INPUT,
          {
            name: 'parse',
            type: '(raw: string) => number | null | undefined',
            default: 'defaultParseNumber',
            description:
              'Draft → number. Return undefined to reject the draft (parse error), null for an intentional empty.',
          },
          {
            name: 'format',
            type: '(value: number | null) => string',
            default: 'defaultFormatNumber',
            description: 'Number → display string for the in-flow text.',
          },
          ...AFFIX_INPUTS,
        ],
        outputs: [
          {
            name: 'savedModelChange',
            type: '{ value: number | null }',
            description: 'The consumer commit event: once per changed settlement, with the numeric model.',
          },
          {
            name: 'saved',
            type: 'InlineNumberSaved',
            description: 'One emission per settled edit session, changed or not.',
          },
          TOUCH_OUTPUT,
        ],
      },
    ],
    tokenGroups: [TEXT_SURFACE_TOKENS, CHROME_TOKENS],
  },

  phone: {
    title: 'Inline Phone',
    components: [
      {
        name: 'AngularInlinePhone',
        selector: 'angular-inline-phone',
        summary:
          'Phone editing on the inline-text machinery: a pluggable codec (e.g. libphonenumber) parses/formats E.164 values, with a flag affordance and a country slash-menu.',
        models: [
          {
            name: 'value',
            type: 'string | null',
            default: 'null',
            description: 'The committed phone number in E.164, or null when empty.',
          },
        ],
        inputs: [
          {
            name: 'codec',
            type: 'PhoneCodec',
            default: '— (required)',
            description: 'The parsing/formatting engine. Required — the component ships no engine of its own.',
          },
          {
            name: 'defaultCountry',
            type: 'PhoneCountry | undefined',
            default: 'undefined',
            description: 'Country assumed for national-format input.',
          },
          {
            name: 'displayFormat',
            type: "'national' | 'international'",
            default: "'international'",
            description: 'How the committed value renders in flow.',
          },
          {
            name: 'numberKind',
            type: 'PhoneNumberKind',
            default: "'fixed-or-mobile'",
            description: 'Which kinds of numbers validate.',
          },
          {
            name: 'showFlag',
            type: 'boolean',
            default: 'true',
            description: 'Show the country flag prefix affordance.',
          },
          {
            name: 'showCountryMenu',
            type: 'boolean',
            default: 'true',
            description: 'Enable the `/` country slash-menu inside the editor.',
          },
          {
            name: 'menuLocale',
            type: 'string | string[] | undefined',
            default: 'undefined',
            description: 'Locale(s) for country display names in the menu.',
          },
          ...FORM_CONTRACT_INPUTS,
          {
            name: 'placeholder',
            type: 'string | undefined',
            default: 'undefined',
            description: 'Placeholder shown while empty.',
          },
          ARIA_LABEL_INPUT,
          ...AFFIX_INPUTS,
        ],
        outputs: [
          {
            name: 'savedModelChange',
            type: '{ value: string | null }',
            description: 'The consumer commit event: once per changed settlement, with the E.164 model.',
          },
          {
            name: 'saved',
            type: 'InlinePhoneSaved',
            description: 'One emission per settled edit session, changed or not.',
          },
          TOUCH_OUTPUT,
        ],
      },
    ],
    tokenGroups: [TEXT_SURFACE_TOKENS, CHROME_TOKENS],
  },

  temporal: {
    title: 'Temporal',
    components: [
      {
        name: 'AngularInlineDate',
        selector: 'angular-inline-date',
        summary:
          'Inline date (and date-range) editing with an optional calendar overlay and quick-pick commands.',
        models: [
          {
            name: 'value',
            type: 'InlineDateValue',
            default: 'null',
            description: 'The committed date or date range.',
          },
          EDITING_MODEL,
          {
            name: 'overlayOrigin',
            type: 'ElementRef<HTMLElement> | HTMLElement | null',
            default: 'null',
            description: 'External anchor for the calendar overlay (defaults to the field itself).',
          },
        ],
        inputs: [
          {
            name: 'ranged',
            type: 'boolean',
            default: 'false',
            description: 'Range mode: start and end dates.',
          },
          ...FORM_CONTRACT_INPUTS,
          {
            name: 'placeholder',
            type: 'string | undefined',
            default: 'undefined',
            description: 'Placeholder for the (start) date.',
          },
          {
            name: 'endPlaceholder',
            type: 'string | undefined',
            default: 'undefined',
            description: 'Placeholder for the end date in range mode.',
          },
          ARIA_LABEL_INPUT,
          {
            name: 'clearBubbleSide',
            type: 'BubbleMenuSide | undefined',
            default: 'undefined',
            description: "Which edge the clear bubble grows from. Unset, the leaf role decides ('start' for inline-start leaves), else 'end'.",
          },
          {
            name: 'locale',
            type: 'string | string[] | undefined',
            default: 'undefined',
            description: 'Locale(s) for parsing and formatting.',
          },
          {
            name: 'zone',
            type: 'string | undefined',
            default: 'undefined',
            description: 'IANA time zone for “today” resolution.',
          },
          {
            name: 'showCalendar',
            type: 'boolean',
            default: 'true',
            description: 'Show the calendar overlay while editing.',
          },
          {
            name: 'quickPicks',
            type: 'readonly DateCommand[] | undefined',
            default: 'undefined',
            description: 'Quick-pick commands (Today, Tomorrow, …) offered in the editor.',
          },
          {
            name: 'now',
            type: '() => Date',
            default: '() => new Date()',
            description: 'Clock source — injectable for tests and fixed-time demos.',
          },
          ...AFFIX_INPUTS,
        ],
        outputs: [
          {
            name: 'savedModelChange',
            type: 'DateSavedDetails',
            description: 'The consumer commit event with the date details model.',
          },
          {
            name: 'saved',
            type: 'InlineDateSaved',
            description: 'One emission per settled edit session, changed or not.',
          },
          TOUCH_OUTPUT,
        ],
      },
      {
        name: 'AngularInlineTime',
        selector: 'angular-inline-time',
        summary: 'Inline time (and time-range) editing with an optional picker list or native input.',
        models: [
          {
            name: 'value',
            type: 'InlineTimeValue',
            default: 'null',
            description: 'The committed time or time range.',
          },
          EDITING_MODEL,
        ],
        inputs: [
          {
            name: 'ranged',
            type: 'boolean',
            default: 'false',
            description: 'Range mode: start and end times.',
          },
          {
            name: 'format',
            type: "'HH:mm' | 'HH:mm:ss'",
            default: "'HH:mm'",
            description: 'Display and parse precision.',
          },
          ...FORM_CONTRACT_INPUTS,
          {
            name: 'placeholder',
            type: 'string',
            default: "'time'",
            description: 'Placeholder for the (start) time.',
          },
          {
            name: 'endPlaceholder',
            type: 'string | undefined',
            default: 'undefined',
            description: 'Placeholder for the end time in range mode.',
          },
          ARIA_LABEL_INPUT,
          {
            name: 'clearBubbleSide',
            type: 'BubbleMenuSide | undefined',
            default: 'undefined',
            description: "Which edge the clear bubble grows from. Unset, the leaf role decides ('start' for inline-start leaves), else 'end'.",
          },
          {
            name: 'locale',
            type: 'string | string[] | undefined',
            default: 'undefined',
            description: 'Locale(s) for parsing and formatting.',
          },
          {
            name: 'zone',
            type: 'string | undefined',
            default: 'undefined',
            description: 'IANA time zone for “now” resolution.',
          },
          {
            name: 'step',
            type: 'number',
            default: '60',
            description: 'Granularity of the native picker, in seconds (forwarded to its `step`).',
          },
          {
            name: 'pickerMin',
            type: 'string | undefined',
            default: 'undefined',
            description: "Native picker lower bound ('HH:mm'), forwarded to the OS input's `min`.",
          },
          {
            name: 'pickerMax',
            type: 'string | undefined',
            default: 'undefined',
            description: "Native picker upper bound ('HH:mm'), forwarded to the OS input's `max`.",
          },
          {
            name: 'native',
            type: 'boolean',
            default: 'false',
            description: 'Use the native time input instead of the picker list.',
          },
          {
            name: 'now',
            type: '() => Date',
            default: '() => new Date()',
            description: 'Clock source — injectable for tests and fixed-time demos.',
          },
          ...AFFIX_INPUTS,
        ],
        outputs: [
          {
            name: 'savedModelChange',
            type: 'TimeSavedDetails',
            description: 'The consumer commit event with the time details model.',
          },
          {
            name: 'saved',
            type: 'InlineTimeSaved',
            description: 'One emission per settled edit session, changed or not.',
          },
          TOUCH_OUTPUT,
        ],
      },
      {
        name: 'AngularInlineDuration',
        selector: 'angular-inline-duration',
        summary: 'Inline duration editing (h:mm and friends) committing a minute count.',
        models: [
          {
            name: 'value',
            type: 'number | null',
            default: 'null',
            description: 'The committed duration in seconds, or null.',
          },
          EDITING_MODEL,
        ],
        inputs: [
          ...FORM_CONTRACT_INPUTS,
          {
            name: 'placeholder',
            type: 'string',
            default: "'0:00'",
            description: 'Placeholder shown while empty.',
          },
          ARIA_LABEL_INPUT,
          {
            name: 'clearBubbleSide',
            type: 'BubbleMenuSide | undefined',
            default: 'undefined',
            description: "Which edge the clear bubble grows from. Unset, the leaf role decides ('start' for inline-start leaves), else 'end'.",
          },
          {
            name: 'durationFormat',
            type: 'DurationFormat',
            default: "'h:mm'",
            description: 'How colon notation reads and how committed values render.',
          },
          {
            name: 'step',
            type: 'number',
            default: '1',
            description: 'Snap committed values to a multiple of this many seconds (1 = off).',
          },
          ...AFFIX_INPUTS,
        ],
        outputs: [
          {
            name: 'savedModelChange',
            type: 'DurationSavedDetails',
            description: 'The consumer commit event with the duration details model.',
          },
          {
            name: 'saved',
            type: 'InlineDurationSaved',
            description: 'One emission per settled edit session, changed or not.',
          },
          TOUCH_OUTPUT,
        ],
      },
      {
        name: 'TemporalRangeGroup',
        selector: '[temporalRangeGroup]',
        summary:
          'Composes independent date/time/duration fields into one coherent range model via the range* item directives (rangeDay, rangeStart, rangeEnd, rangeTimes, rangeEndDay, rangeLength).',
        models: [
          {
            name: 'value',
            type: 'TemporalRangeValue | null',
            default: 'null',
            description: 'The composed range model.',
          },
        ],
        inputs: [
          {
            name: 'zone',
            type: 'string | undefined',
            default: 'undefined',
            description: 'IANA time zone the composition math runs in.',
          },
          ...FORM_CONTRACT_INPUTS.filter((m) => !['required', 'hidden'].includes(m.name)),
        ],
        outputs: [
          {
            name: 'savedModelChange',
            type: 'TemporalRangeValue | null',
            description: 'The consumer commit event with the composed range.',
          },
          {
            name: 'dateRangeChange',
            type: 'ComposedDateRange | null',
            description: 'Composed date range, on every settlement.',
          },
          {
            name: 'timeRangeChange',
            type: 'ComposedTimeRange | null',
            description: 'Composed time range, on every settlement.',
          },
          {
            name: 'durationChange',
            type: 'number | null',
            description: 'Composed duration in minutes, on every settlement.',
          },
          TOUCH_OUTPUT,
        ],
      },
    ],
    tokenGroups: [TEMPORAL_TOKENS, CHROME_TOKENS],
  },

  json: {
    title: 'Inline JSON',
    components: [
      {
        name: 'AngularInlineJson',
        selector: 'angular-inline-json',
        summary:
          'The committed JSON flows in the page as ordinary paragraph text (styled identically to the inline-text display), middle-ellipsing at a measured visual-line budget, and elevates into a real CodeMirror editor: syntax highlighting, bracket matching, auto-indent, live lint. In the EDITOR, identifier keys may be typed without quotes (role: not "role":) — the one leniency, cutting the most common hand-typing errors; everything else stays strict (a trailing comma is still an error). Commit canonicalizes to strict, compact, double-quoted JSON.stringify — the MySQL/Postgres-friendly text the model carries, with primitives keeping their real types.',
        models: [
          {
            name: 'value',
            type: 'string',
            default: "''",
            description:
              'The committed value channel: canonical strict JSON text (compact, double-quoted — JSON.stringify of the parsed draft). Opening a session reformats the editor into the editing form (pretty-printed, bare identifier keys); the semantic dirty check means a reformat alone never counts as a change.',
          },
          EDITING_MODEL,
        ],
        inputs: [
          ...FORM_CONTRACT_INPUTS,
          {
            name: 'placeholder',
            type: 'string',
            default: "'null'",
            description: 'Placeholder shown while empty.',
          },
          ARIA_LABEL_INPUT,
          {
            name: 'maxPreviewLines',
            type: 'number',
            default: '5',
            description:
              'Hard cap on the idle preview’s rendered VISUAL lines. The preview flows inline like paragraph text and, when the compact value would exceed the budget at the current width, middle-ellipses with real head and real tail content — measured against the actual layout (font, container width, mid-paragraph first-line start) via @chenglou/pretext, re-measured on resize. The skipped middle is never materialized, so cost is bounded regardless of value size.',
          },
          {
            name: 'errorTemplate',
            type: 'TemplateRef<unknown> | undefined',
            default: 'undefined',
            description:
              'Consumer error content (the mat-error analogue) as a TEMPLATE — the session UI renders in a portaled dialog component where element projection cannot reach. Content sugar: `ng-template[editableError]`. Takes over the error slot entirely; without it the control renders message-carrying errors itself.',
          },
          ...AFFIX_INPUTS,
        ],
        outputs: [
          {
            name: 'savedModelChange',
            type: '{ value: string }',
            description:
              'THE consumer commit event: fires once per changed settlement (accept-timed, change-gated) with the raw JSON text model.',
          },
          {
            name: 'saved',
            type: 'InlineJsonSaved — { value: string; changed: boolean }',
            description:
              'The machinery channel: exactly one emission per settled edit session — Save, Discard, and clear alike. For wrapping controls; app consumers bind savedModelChange.',
          },
          TOUCH_OUTPUT,
        ],
      },
    ],
    tokenGroups: [JSON_SURFACE_TOKENS, CHROME_TOKENS],
  },
};
