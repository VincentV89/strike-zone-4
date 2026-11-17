/**
 * UiIntent: everything the ui sends to app-shell (business-logic-model-ui-hud §4.3). Values from
 * DOM controls arrive as raw strings; app-shell validates them with applySetupChange and
 * applySettingChange. `send` is called synchronously inside the user activation (BR-UI-42).
 */

export type DialogScreen = 'settings' | 'controls' | 'about' | 'history';

export type UiIntent =
  | { readonly kind: 'enter' }
  | { readonly kind: 'start-match' }
  | { readonly kind: 'change-setup'; readonly field: string; readonly raw: string }
  | { readonly kind: 'change-setting'; readonly key: string; readonly raw: string }
  | { readonly kind: 'open'; readonly screen: DialogScreen }
  | { readonly kind: 'close' }
  | { readonly kind: 'capture-and-start' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'restart' }
  | { readonly kind: 'quit-to-menu' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'play-again' }
  | { readonly kind: 'continue-anyway' }
  | { readonly kind: 'retry-step' }
  | { readonly kind: 'reset-settings' }
  | { readonly kind: 'clear-history' }
  | { readonly kind: 'change-graphics' };

export type UiIntentKind = UiIntent['kind'];

export type SendIntent = (intent: UiIntent) => void;
