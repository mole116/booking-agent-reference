export type ActionVariant = 'primary' | 'secondary' | 'danger';
export type UiKind = 'none' | 'choices' | 'confirmation';

export interface UiAction {
  id: string;
  label: string;
  message: string;
  variant: ActionVariant;
}

export interface UiBlock {
  kind: UiKind;
  actions: UiAction[];
}

export interface ChatResponse {
  text: string;
  sessionId: string;
  ui: UiBlock;
  bookingChanged: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  ui?: UiBlock;
  actionsConsumed?: boolean;
}
